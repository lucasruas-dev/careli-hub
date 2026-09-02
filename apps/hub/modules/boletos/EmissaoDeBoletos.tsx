"use client";

import {
  AlertTriangle,
  Check,
  FileSpreadsheet,
  IdCard,
  KeyRound,
  Loader2,
  Search,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { valorDaCelula } from "@/lib/apolo/boletos/celula-do-excel";
import type { EmpreendimentoDeBoleto } from "@/lib/apolo/boletos/empreendimentos";
import {
  type AbaLida,
  type ClienteDaPlanilha,
  lerAba,
  linhaDoCliente,
  type ResumoDaAba,
  resumirAba,
} from "@/lib/apolo/boletos/ler-planilha";
import { vereditoDaLinha } from "@/lib/apolo/boletos/regra-de-emissao";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// A EMISSÃO MENSAL DE BOLETOS — o administrativo abre o arquivo do mês, confere e dispara.
//
// ⚠️ Pedido do Lucas (31/08/2026): *"vamos ter que emitir todos esses pelo panteon (...) quero
// organizar a tela que faremos esses envio"*, e *"pode seguir os valores que estão descritos"* —
// a planilha manda no valor, o Panteon não recalcula. O LSoft guarda o valor de contrato; é a
// planilha que aplica o índice do mês.
//
// ⚠️ O ARQUIVO É LIDO NO NAVEGADOR, e não enviado ao servidor. São nove abas com nome, telefone e
// situação de pagamento de ~200 pessoas: enquanto ninguém manda emitir, nada disso precisa sair
// da máquina de quem abriu. Mesmo desenho do importador de unidades do Apolo.
//
// ⚠️ A TELA MOSTRA QUEM NÃO VAI RECEBER, E POR QUÊ. Foi o erro que eu cometi na conferência do
// Garden: somei a coluna do mês e listei como pendentes dois clientes que já tinham pago, porque
// não li a coluna solta de observação. Aqui cada exclusão aparece com o texto que a causou.
//
// ⚠️ E MOSTRA O QUE FALTA ANTES DO CLIQUE. Conta do Asaas e CPF são bloqueios reais: sem conta o
// boleto sairia no CNPJ de outra empresa, e sem CPF o Asaas nem cria o cliente. Descobrir isso no
// meio da emissão significa metade dos boletos criados e nenhuma forma limpa de voltar atrás.

const CAIXA = "rounded-xl border border-line bg-surface";
const ROTULO = "text-[0.7rem] font-semibold uppercase tracking-wide text-ink-muted";

type TemplateDoBoleto = {
  erro: null | string;
  existe: boolean;
  parecidos: { categoria: null | string; idioma: null | string; nome: null | string; status: null | string }[];
  previa: string;
  proposto: { categoria: string; corpo: string; idioma: string; nome: string };
  status: null | string;
};

type Prontidao = {
  contas: {
    ambiente: "desconhecido" | "producao" | "sandbox";
    configurada: boolean;
    /** O nome que o Asaas devolve para a chave — a prova de que ela é da conta certa. */
    /** O cadastro no Asaas está aprovado? Conta não aprovada não emite, mesmo com a chave certa. */
    cadastro?: null | {
      aprovado: boolean;
      banco: string;
      comercial: string;
      documentos: string;
      geral: string;
    };
    donoDaChave?: null | string;
    erroDaChave?: null | string;
    conta: string;
    rotulo: string;
    variavel: string;
  }[];
  empreendimentos: {
    ambiente: null | string;
    conta: null | string;
    contaConfigurada: boolean;
    cpf: null | { clientes: number; comCpf: number; semCpf: number };
    nome: string;
    origem: string;
    slug: string;
    variavel: null | string;
  }[];
};

function moeda(v: number): string {
  return v.toLocaleString("pt-BR", { currency: "BRL", minimumFractionDigits: 2, style: "currency" });
}

/** As competências que fazem sentido oferecer: o mês atual e os três seguintes. */
function competenciasSugeridas(): string[] {
  const hoje = new Date();
  return Array.from({ length: 4 }, (_, i) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto",
  "setembro", "outubro", "novembro", "dezembro"];

function rotuloDaCompetencia(c: string): string {
  const [ano, mes] = c.split("-");
  return `${MESES[Number(mes) - 1] ?? mes} de ${ano}`;
}

export function EmissaoDeBoletos() {
  const [competencia, setCompetencia] = useState(() => competenciasSugeridas()[0]!);
  const [abas, setAbas] = useState<AbaLida[]>([]);
  const [ignoradas, setIgnoradas] = useState<{ aba: string; motivo: string }[]>([]);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<null | string>(null);
  const [aberta, setAberta] = useState<null | string>(null);
  const [busca, setBusca] = useState("");
  const [prontidao, setProntidao] = useState<null | Prontidao>(null);
  // ⚠️ TRES ESTADOS, E NAO DOIS. "carregando" e "falhou" NAO sao a mesma coisa que "nao ha conta":
  // tratar ignorancia como fato faria a tela afirmar "0 boletos - R$ 0,00 - 181 parados por falta
  // de conta" com a tabela logo acima somando R$ 512.835,55. E esse numero que o administrativo
  // levaria para a conferencia do financeiro.
  const [estadoDaProntidao, setEstadoDaProntidao] = useState<"carregando" | "erro" | "pronta">(
    "carregando",
  );

  // O template de WhatsApp que leva o link do boleto ao cliente.
  const [template, setTemplate] = useState<null | TemplateDoBoleto>(null);
  const [criandoTemplate, setCriandoTemplate] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        // ⚠️ COM O BEARER DA SESSAO. A rota exige `authorizeApoloRead`, e um fetch solto leva so
        // o cookie e volta 401 — o `proxy.ts` corta antes mesmo de a rota rodar. Sem isto a
        // prontidao nunca chegava e a tela mostrava "chave ausente" com a chave configurada.
        const token = await getApoloAccessToken();
        const r = await fetch("/api/boletos/prontidao", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(`prontidao ${r.status}`);
        const j = (await r.json()) as { data?: Prontidao };
        if (!vivo) return;
        if (!j.data) throw new Error("prontidao sem dados");
        setProntidao(j.data);
        setEstadoDaProntidao("pronta");

        // O template é consulta à parte: se a Meta estiver fora, a prontidão do Asaas continua
        // valendo, e o painel do template mostra o próprio erro.
        const rt = await fetch("/api/boletos/template", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (rt.ok && vivo) {
          const jt = (await rt.json()) as { data?: TemplateDoBoleto };
          if (jt.data) setTemplate(jt.data);
        }
      } catch {
        if (vivo) setEstadoDaProntidao("erro");
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  /**
   * Cria o template na Meta.
   *
   * ⚠️ NÃO SE DESFAZ POR AQUI. A Meta enfileira para revisão humana e um template criado só sai
   * pelo Business Manager. Por isso o botão só aparece quando a consulta diz que ele ainda não
   * existe, e o texto fica à vista antes do clique.
   */
  const criarTemplate = useCallback(async () => {
    setCriandoTemplate(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/boletos/template", {
        headers: { Authorization: `Bearer ${token}` },
        method: "POST",
      });
      const j = (await r.json()) as { data?: { status: null | string }; error?: string };
      if (!r.ok) throw new Error(j.error ?? `Falhou (${r.status}).`);

      const rt = await fetch("/api/boletos/template", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (rt.ok) {
        const jt = (await rt.json()) as { data?: TemplateDoBoleto };
        if (jt.data) setTemplate(jt.data);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui criar o template na Meta.");
    } finally {
      setCriandoTemplate(false);
    }
  }, []);

  const ler = useCallback(async (arquivo: File, mes: string) => {
    setLendo(true);
    setErro(null);
    try {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await arquivo.arrayBuffer());

      const lidas: AbaLida[] = [];
      const fora: { aba: string; motivo: string }[] = [];
      for (const ws of wb.worksheets) {
        // A aba de índices do reajuste não tem cliente nenhum.
        if (/[íi]ndice/i.test(ws.name)) continue;

        const grade: { texto: null | string; valor: unknown }[][] = [];
        ws.eachRow({ includeEmpty: true }, (linha) => {
          const l: { texto: null | string; valor: unknown }[] = [];
          linha.eachCell({ includeEmpty: true }, (celula, col) => {
            // ⚠️ `valorDaCelula` e não `celula.value`: fórmula, texto formatado e link chegam
            // como OBJETO, e um `String()` neles viraria "[object Object]" — o bastante para a
            // regra não ver um "PAGO ATÉ DEZ/26" em negrito e cobrar quem já pagou.
            const bruto = valorDaCelula(celula);
            l[col - 1] = {
              texto: bruto instanceof Date || bruto === null ? null : String(bruto),
              valor: bruto,
            };
          });
          grade.push(l);
        });

        const r = lerAba(ws.name, grade, mes);
        if ("motivo" in r) fora.push({ aba: ws.name, motivo: r.motivo });
        else lidas.push(r);
      }
      setAbas(lidas);
      setIgnoradas(fora);
      setAberta(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui ler o arquivo.");
    } finally {
      setLendo(false);
    }
  }, []);

  const resumos = useMemo(() => abas.map(resumirAba), [abas]);

  // ⚠️ A ABA FORA DA LISTA APARECE MAS NÃO SOMA. O arquivo traz o VALE DO OURO, que o Lucas tirou
  // da emissão pelo Panteon (*"tirando o vale do ouro"*, 31/08/2026) e continua sendo cobrado
  // pelo caminho de sempre. Somá-lo daria ao administrativo um total que não vai acontecer — e é
  // esse número que ele leva para a conferência do financeiro. Esconder a aba seria pior: ela
  // está no arquivo, e sumir sem explicação parece perda de carteira.
  const naLista = useMemo(() => resumos.filter((r) => r.empreendimento), [resumos]);
  const foraDaLista = useMemo(() => resumos.filter((r) => !r.empreendimento), [resumos]);

  const geral = useMemo(
    () =>
      naLista.reduce(
        (a, r) => ({
          emitem: a.emitem + r.emitem,
          fora: a.fora + r.fora.length,
          total: Math.round((a.total + r.total) * 100) / 100,
        }),
        { emitem: 0, fora: 0, total: 0 },
      ),
    [naLista],
  );

  // O que a tela precisa saber por empreendimento: o resumo do mês somado ao estado da conta.
  const estadoPorSlug = useMemo(() => {
    const m = new Map<string, Prontidao["empreendimentos"][number]>();
    for (const e of prontidao?.empreendimentos ?? []) m.set(e.slug, e);
    return m;
  }, [prontidao]);

  // ⚠️ SO CLASSIFICA QUANDO SABE. Enquanto a prontidao nao chegou ninguem e "liberado" nem
  // "travado por falta de conta" — os dois seriam afirmacoes sobre algo que a tela ainda ignora.
  const sabeDasContas = estadoDaProntidao === "pronta";
  const liberados = useMemo(
    () =>
      sabeDasContas
        ? naLista.filter((r) => {
            const e = estadoPorSlug.get(r.empreendimento!.slug);
            return r.emitem > 0 && Boolean(e?.contaConfigurada);
          })
        : [],
    [estadoPorSlug, naLista, sabeDasContas],
  );
  const travados = useMemo(
    () => (sabeDasContas ? naLista.filter((r) => r.emitem > 0 && !liberados.includes(r)) : []),
    [liberados, naLista, sabeDasContas],
  );

  return (
    <div className="flex flex-col gap-4 pb-24">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-ink">Emissão de boletos</h1>
          <p className="text-sm text-ink-muted">
            Abra a planilha do mês. O valor cobrado é o que está nela.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Competência"
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
            onChange={(e) => {
              setCompetencia(e.target.value);
              setAbas([]);
            }}
            value={competencia}
          >
            {competenciasSugeridas().map((c) => (
              <option key={c} value={c}>
                {rotuloDaCompetencia(c)}
              </option>
            ))}
          </select>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-inverse px-4 py-2 text-sm font-bold text-brand-ink transition hover:opacity-90">
            {lendo ? (
              <Loader2 aria-hidden="true" className="animate-spin" size={16} />
            ) : (
              <Upload aria-hidden="true" size={16} />
            )}
            {abas.length > 0 ? "Trocar planilha" : "Abrir planilha"}
            <input
              accept=".xlsx,.xlsm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void ler(f, competencia);
                e.target.value = "";
              }}
              type="file"
            />
          </label>
        </div>
      </header>

      {erro ? (
        <p className="rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
          {erro}
        </p>
      ) : null}

      <PainelDeProntidao estado={estadoDaProntidao} prontidao={prontidao} />
      <DeQuemESaChave contas={prontidao?.contas ?? null} />

      <PainelDoTemplate
        aoCriar={() => void criarTemplate()}
        criando={criandoTemplate}
        template={template}
      />

      {abas.length === 0 && !lendo ? (
        <div className={`${CAIXA} grid place-items-center gap-2 px-6 py-14 text-center`}>
          <FileSpreadsheet aria-hidden="true" className="text-ink-muted" size={30} />
          <p className="text-sm font-semibold text-ink">Nenhuma planilha aberta</p>
          <p className="max-w-md text-sm text-ink-muted">
            O arquivo é lido aqui no navegador — enquanto você não mandar emitir, nada sai desta
            máquina.
          </p>
        </div>
      ) : null}

      {abas.length > 0 ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Cartao rotulo="A emitir" valor={String(geral.emitem)} nota={moeda(geral.total)} />
            <Cartao
              rotulo="Fora da emissão"
              valor={String(geral.fora)}
              nota="cada um com o motivo"
            />
            <Cartao
              rotulo="Empreendimentos"
              valor={String(naLista.length)}
              nota={
                foraDaLista.length > 0
                  ? `+${foraDaLista.length} fora da emissão pelo Panteon`
                  : `${rotuloDaCompetencia(competencia)}`
              }
            />
          </div>

          <div className={`${CAIXA} overflow-x-auto`}>
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className={`${ROTULO} px-4 py-2.5 text-left`}>Empreendimento</th>
                  <th className={`${ROTULO} px-4 py-2.5 text-left`}>Carteira</th>
                  <th className={`${ROTULO} px-4 py-2.5 text-right`}>Boletos</th>
                  <th className={`${ROTULO} px-4 py-2.5 text-right`}>Total</th>
                  <th className={`${ROTULO} px-4 py-2.5 text-left`}>Conta Asaas</th>
                </tr>
              </thead>
              <tbody>
                {[...naLista, ...foraDaLista].map((r) => (
                  <LinhaDoEmpreendimento
                    aberta={aberta === r.aba}
                    aoAbrir={() => {
                      setAberta(aberta === r.aba ? null : r.aba);
                      setBusca("");
                    }}
                    busca={aberta === r.aba ? busca : ""}
                    clientes={abas.find((a) => a.aba === r.aba)?.clientes ?? []}
                    estado={r.empreendimento ? (estadoPorSlug.get(r.empreendimento.slug) ?? null) : null}
                    key={r.aba}
                    resumo={r}
                    sabeDasContas={sabeDasContas}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {aberta ? (
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
                size={15}
              />
              <input
                className="w-full rounded-lg border border-line bg-canvas py-2 pl-9 pr-3 text-sm text-ink"
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar cliente na lista aberta"
                value={busca}
              />
            </div>
          ) : null}

          {ignoradas.length > 0 ? (
            <p className="text-xs text-ink-muted">
              Abas não lidas: {ignoradas.map((i) => `${i.aba} (${i.motivo})`).join(" · ")}
            </p>
          ) : null}

          <BarraDeAcao
            aEmitirSemSaber={geral.emitem}
            competencia={competencia}
            liberados={liberados}
            sabeDasContas={sabeDasContas}
            travados={travados}
          />
        </>
      ) : null}
    </div>
  );
}

// ⚠️ A CHAVE EXISTIR NÃO PROVA QUE É A CHAVE CERTA. Ter a variável preenchida diz que alguém colou
// algo ali; não diz de quem é a conta. Uma chave trocada entre dois empreendimentos emite o boleto
// no CNPJ da outra empresa e o dinheiro cai lá — e não há erro nenhum: a emissão funciona
// perfeitamente, na conta errada, e só o extrato conta. `/myAccount` é a única resposta que vem do
// lado do Asaas dizendo o NOME de quem é a chave, e é isto que esta seção mostra.
function DeQuemESaChave({ contas }: { contas: null | Prontidao["contas"] }) {
  if (!contas) return null;
  const configuradas = contas.filter((c) => c.configurada);
  if (configuradas.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-4 py-3">
      <h2 className="flex items-center gap-2 text-sm font-bold text-ink">
        <KeyRound aria-hidden="true" size={15} /> De quem é cada chave
      </h2>
      <p className="text-xs text-ink-muted">
        O nome vem do próprio Asaas. Confira se cada linha bate com a empresa esperada: uma chave
        no lugar errado emite no CNPJ de outra empresa, sem erro nenhum.
      </p>
      {configuradas.some((c) => c.cadastro && !c.cadastro.aprovado) ? (
        <p className="rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-ink dark:border-red-500/40 dark:bg-red-500/10">
          <b className="text-red-700 dark:text-red-300">
            {configuradas
              .filter((c) => c.cadastro && !c.cadastro.aprovado)
              .map((c) => c.rotulo)
              .join(", ")}
          </b>{" "}
          {configuradas.filter((c) => c.cadastro && !c.cadastro.aprovado).length === 1
            ? "está com o cadastro pendente no Asaas e não emite"
            : "estão com o cadastro pendente no Asaas e não emitem"}
          , mesmo com a chave certa. Passe o mouse na coluna Cadastro para ver o que falta aprovar.
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-muted">
              <th className="py-1 pr-4 text-xs font-semibold">Conta</th>
              <th className="py-1 pr-4 text-xs font-semibold">Variável</th>
              <th className="py-1 pr-4 text-xs font-semibold">Quem o Asaas diz que é</th>
              <th className="py-1 pr-4 text-xs font-semibold">Cadastro</th>
              <th className="py-1 text-xs font-semibold">Ambiente</th>
            </tr>
          </thead>
          <tbody>
            {configuradas.map((c) => (
              <tr className="border-t border-line" key={c.conta}>
                <td className="py-1.5 pr-4 font-semibold text-ink">{c.rotulo}</td>
                <td className="py-1.5 pr-4 font-mono text-[0.7rem] text-ink-muted">{c.variavel}</td>
                <td className="py-1.5 pr-4 text-ink">
                  {c.donoDaChave ? (
                    c.donoDaChave
                  ) : (
                    <span className="text-red-600 dark:text-red-400">
                      {c.erroDaChave ?? "a chave não respondeu"}
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-4">
                  {/* ⚠️ A CHAVE FUNCIONAR NÃO SIGNIFICA QUE A CONTA EMITE. O On Sky e o Guaimbé
                      tinham a chave certa e a emissão não saía: o cadastro no Asaas ainda não
                      estava aprovado. Sem esta coluna, isso só aparecia depois de tentar. */}
                  {!c.cadastro ? (
                    <span className="text-xs text-ink-muted">—</span>
                  ) : c.cadastro.aprovado ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      <Check aria-hidden="true" size={11} /> aprovado
                    </span>
                  ) : (
                    <span
                      className="text-xs font-bold text-red-600 dark:text-red-400"
                      title={`geral: ${c.cadastro.geral} · documentos: ${c.cadastro.documentos} · comercial: ${c.cadastro.comercial} · banco: ${c.cadastro.banco}`}
                    >
                      {c.cadastro.geral === "REJECTED" ? "REJEITADO" : "não aprovado"} — não emite
                    </span>
                  )}
                </td>
                <td className="py-1.5">
                  {c.ambiente === "producao" ? (
                    <span className="text-xs text-ink-muted">produção</span>
                  ) : (
                    <span className="text-xs font-bold text-amber-700 dark:text-amber-300">
                      {c.ambiente === "sandbox" ? "sandbox" : "desconhecido"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Cartao({ nota, rotulo, valor }: { nota: string; rotulo: string; valor: string }) {
  return (
    <div className={`${CAIXA} px-4 py-3`}>
      <span className={ROTULO}>{rotulo}</span>
      <p className="mt-1 text-2xl font-bold tabular-nums text-ink">{valor}</p>
      <p className="text-sm text-ink-muted">{nota}</p>
    </div>
  );
}

/**
 * O que falta antes de qualquer clique: conta do Asaas e CPF.
 *
 * ⚠️ ESTE PAINEL EXISTE PARA SER CHATO. Os dois bloqueios são silenciosos de outro jeito: sem
 * conta o boleto sai no CNPJ errado (e o dinheiro cai na conta errada), e sem CPF o Asaas recusa
 * a criação do cliente no meio do lote.
 */
/**
 * O template de WhatsApp que leva o link do boleto ao cliente.
 *
 * ⚠️ ESTE PAINEL É A ÚNICA PORTA DE CRIAÇÃO, e o botão fica aqui e não no portal do incorporador de
 * propósito: criar template é ato de MARCA. O texto vai para a Meta em nome da empresa, passa por
 * revisão humana, e um template criado só sai pelo Business Manager. Quem faz isso é a Careli.
 *
 * ⚠️ "PENDING" É O ESTADO NORMAL depois de criar. A revisão da Meta leva de minutos a dias, e
 * disparar antes devolve o erro 132001. Enquanto isso, o envio pelo Relacionamento funciona.
 */
function PainelDoTemplate({
  aoCriar,
  criando,
  template,
}: {
  aoCriar: () => void;
  criando: boolean;
  template: null | TemplateDoBoleto;
}) {
  if (!template) return null;

  const aprovado = template.status === "APPROVED";

  return (
    <section className={`${CAIXA} p-4`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={ROTULO}>Template do WhatsApp</span>

        {template.existe ? (
          <span
            className={
              aprovado
                ? "rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                : "rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
            }
          >
            {template.proposto.nome} · {template.status ?? "sem status"}
          </span>
        ) : (
          <span className="text-sm text-ink-muted">
            ainda não existe na conta do WhatsApp
          </span>
        )}

        {!template.existe ? (
          <button
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-ink px-3.5 py-2 text-sm font-semibold text-surface disabled:opacity-50"
            disabled={criando}
            onClick={aoCriar}
            type="button"
          >
            {criando ? <Loader2 className="animate-spin" size={14} /> : <Check size={14} />}
            Criar o template na Meta
          </button>
        ) : null}
      </div>

      {template.erro ? (
        <p className="mt-2 text-sm text-red-700 dark:text-red-300">
          Não consegui consultar a Meta: {template.erro}
        </p>
      ) : null}

      {!template.existe ? (
        <>
          <p className="mt-2 text-sm text-ink-muted">
            Sem ele, o envio pelo Atendimento falha com &ldquo;template não existe&rdquo;. O envio
            pelo Relacionamento não depende dele e já funciona. Criar não se desfaz por aqui: a Meta
            enfileira para revisão e só o Business Manager remove.
          </p>
          <pre className="mt-3 whitespace-pre-wrap rounded-lg border border-line bg-canvas px-3.5 py-3 text-sm leading-relaxed text-ink">
            {template.previa}
          </pre>
        </>
      ) : null}

      {/* ⚠️ HOMÔNIMO É ARMADILHA: um template criado à mão no Business Manager com outro nome faria
          a casa ter dois dizendo a mesma coisa, e ninguém saberia qual está aprovado. */}
      {template.parecidos.length > 0 ? (
        <p className="mt-2 text-xs text-ink-muted">
          Outros templates com nome parecido nesta conta:{" "}
          {template.parecidos.map((t) => `${t.nome} (${t.status})`).join(", ")}
        </p>
      ) : null}
    </section>
  );
}

function PainelDeProntidao({
  estado,
  prontidao,
}: {
  estado: "carregando" | "erro" | "pronta";
  prontidao: null | Prontidao;
}) {
  // ⚠️ O ERRO PRECISA APARECER. Este painel e a unica garantia da tela contra emitir no CNPJ
  // errado ou sem CPF; se ele sumir calado quando a consulta falha, a tela fica parecendo que
  // esta tudo certo justamente quando ela nao sabe de nada.
  if (estado === "erro") {
    return (
      <section className="flex items-start gap-2 rounded-xl border border-red-300/60 bg-red-50 px-4 py-3 dark:border-red-500/40 dark:bg-red-500/10">
        <AlertTriangle
          aria-hidden="true"
          className="mt-0.5 shrink-0 text-red-600 dark:text-red-400"
          size={15}
        />
        <p className="text-sm text-ink">
          <b className="text-red-700 dark:text-red-300">
            Não consegui consultar as contas do Asaas nem os CPFs.
          </b>{" "}
          A conferência da planilha abaixo continua valendo, mas a tela não sabe dizer quais
          empreendimentos estão prontos para emitir. Recarregue a página; se persistir, sua sessão
          pode ter expirado.
        </p>
      </section>
    );
  }

  if (estado === "carregando") {
    return (
      <p className="flex items-center gap-2 px-1 text-sm text-ink-muted">
        <Loader2 aria-hidden="true" className="animate-spin" size={14} />
        Consultando as contas do Asaas e a cobertura de CPF…
      </p>
    );
  }

  if (!prontidao) return null;

  const semConta = prontidao.empreendimentos.filter((e) => !e.contaConfigurada);
  const sandbox = prontidao.empreendimentos.filter(
    (e) => e.contaConfigurada && e.ambiente === "sandbox",
  );
  const semCpf = prontidao.empreendimentos
    .filter((e) => (e.cpf?.semCpf ?? 0) > 0)
    .map((e) => `${e.nome} (${e.cpf!.semCpf})`);
  const semFonteDeCpf = prontidao.empreendimentos.filter((e) => e.origem === "planilha");

  if (semConta.length === 0 && semCpf.length === 0 && semFonteDeCpf.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-amber-400/70 bg-amber-50 px-4 py-3 dark:border-amber-500/40 dark:bg-amber-500/10">
      <h2 className="flex items-center gap-2 text-sm font-bold text-amber-800 dark:text-amber-300">
        <AlertTriangle aria-hidden="true" size={15} /> O que falta para emitir
      </h2>

      {semConta.length > 0 ? (
        <p className="flex items-start gap-2 text-sm text-ink">
          <KeyRound aria-hidden="true" className="mt-0.5 shrink-0 text-ink-muted" size={14} />
          <span>
            <b>
              {semConta.length}{" "}
              {semConta.length === 1 ? "empreendimento sem conta" : "empreendimentos sem conta"} no
              Asaas
            </b>{" "}
            — {semConta.map((e) => e.nome).join(", ")}. Sem conta própria, o boleto sairia no CNPJ
            de outra empresa: eles não entram na emissão.
          </span>
        </p>
      ) : null}

      {sandbox.length > 0 ? (
        <p className="flex items-start gap-2 text-sm text-ink">
          <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0 text-ink-muted" size={14} />
          <span>
            <b>Chave de sandbox</b> em {sandbox.map((e) => e.nome).join(", ")} — o que sair daqui
            não é cobrança de verdade.
          </span>
        </p>
      ) : null}

      {semCpf.length > 0 ? (
        <p className="flex items-start gap-2 text-sm text-ink">
          <IdCard aria-hidden="true" className="mt-0.5 shrink-0 text-ink-muted" size={14} />
          <span>
            <b>Clientes sem CPF no cadastro</b> — {semCpf.join(", ")}. O Asaas não cria cliente sem
            CPF ou CNPJ, então eles ficam de fora até o documento entrar.
          </span>
        </p>
      ) : null}

      {semFonteDeCpf.length > 0 ? (
        <p className="flex items-start gap-2 text-sm text-ink">
          <IdCard aria-hidden="true" className="mt-0.5 shrink-0 text-ink-muted" size={14} />
          <span>
            <b>Sem fonte de CPF</b> em {semFonteDeCpf.map((e) => e.nome).join(", ")} — a carteira
            desses vive só na planilha, que não tem coluna de documento.
          </span>
        </p>
      ) : null}
    </section>
  );
}

function LinhaDoEmpreendimento({
  aberta,
  aoAbrir,
  busca,
  clientes,
  estado,
  resumo,
  sabeDasContas,
}: {
  aberta: boolean;
  aoAbrir: () => void;
  busca: string;
  clientes: ClienteDaPlanilha[];
  estado: null | Prontidao["empreendimentos"][number];
  resumo: ResumoDaAba;
  sabeDasContas: boolean;
}) {
  const emp: EmpreendimentoDeBoleto | null = resumo.empreendimento;
  const carteira =
    emp?.origem === "lsoft" ? "LSoft" : emp?.origem === "planilha" ? "só a planilha" : "—";

  const filtrados = useMemo(() => {
    const t = busca.trim().toLocaleLowerCase("pt-BR");
    if (!t) return clientes;
    return clientes.filter((c) => c.nome.toLocaleLowerCase("pt-BR").includes(t));
  }, [busca, clientes]);

  return (
    <>
      <tr
        className={`cursor-pointer border-b border-line transition last:border-0 hover:bg-black/[0.03] dark:hover:bg-white/5 ${
          emp ? "" : "opacity-60"
        }`}
        onClick={aoAbrir}
      >
        <td className="px-4 py-2.5 font-semibold text-ink">
          {emp?.nome ?? resumo.aba}
          {!emp ? (
            <span className="ml-2 text-xs font-normal text-ink-muted">
              não emitido pelo Panteon
            </span>
          ) : null}
        </td>
        <td className="px-4 py-2.5 text-ink-muted">{carteira}</td>
        <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
          {resumo.emitem}
          {resumo.fora.length > 0 ? (
            <span className="ml-1 text-xs font-normal text-ink-muted">−{resumo.fora.length}</span>
          ) : null}
        </td>
        <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-ink">
          {moeda(resumo.total)}
        </td>
        <td className="px-4 py-2.5">
          {!emp ? (
            <span className="rounded-full bg-subtle px-2 py-0.5 text-[0.7rem] font-bold text-ink-muted">
              fora da emissão
            </span>
          ) : !sabeDasContas ? (
            <span className="text-[0.7rem] font-semibold text-ink-muted">consultando…</span>
          ) : estado?.contaConfigurada ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[0.7rem] font-bold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              <Check aria-hidden="true" size={11} />
              {estado.conta}
              {estado.ambiente === "sandbox" ? " · sandbox" : ""}
            </span>
          ) : (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.7rem] font-bold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              {emp?.conta ? "chave ausente" : "a configurar"}
            </span>
          )}
        </td>
      </tr>

      {aberta ? (
        <tr>
          <td className="bg-black/[0.02] px-4 py-3 dark:bg-white/[0.03]" colSpan={5}>
            {filtrados.length === 0 ? (
              <p className="py-2 text-sm text-ink-muted">Ninguém com esse nome nesta aba.</p>
            ) : (
              <ul className="flex flex-col">
                {filtrados.map((c, i) => (
                  <ItemDoCliente cliente={c} key={`${c.nome}-${i}`} />
                ))}
              </ul>
            )}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ItemDoCliente({ cliente }: { cliente: ClienteDaPlanilha }) {
  const v = vereditoDaLinha(linhaDoCliente(cliente));

  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line/60 py-1.5 last:border-0">
      <span className="min-w-0 flex-1 truncate font-medium text-ink">{cliente.nome}</span>
      {cliente.unidade ? (
        <span className="text-xs text-ink-muted">{cliente.unidade}</span>
      ) : null}
      {cliente.vencimento ? (
        <span className="text-xs text-ink-muted">dia {cliente.vencimento}</span>
      ) : null}
      {v.emite ? (
        <span className="font-semibold tabular-nums text-ink">{moeda(v.valor)}</span>
      ) : (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
          <X aria-hidden="true" size={11} />
          {v.explicacao}
        </span>
      )}
    </li>
  );
}

/**
 * A barra que fica no rodapé com o que sairia deste clique.
 *
 * ⚠️ O BOTÃO SÓ CONTA O QUE ESTÁ LIBERADO. Um total que some empreendimento sem conta daria ao
 * operador um número que não vai acontecer — e é justamente o número que ele levaria para a
 * conferência do financeiro.
 */
function BarraDeAcao({
  aEmitirSemSaber,
  competencia,
  liberados,
  sabeDasContas,
  travados,
}: {
  /** O que a planilha diz, independente do que se sabe das contas. */
  aEmitirSemSaber: number;
  competencia: string;
  liberados: ResumoDaAba[];
  sabeDasContas: boolean;
  travados: ResumoDaAba[];
}) {
  const quantos = liberados.reduce((a, r) => a + r.emitem, 0);
  const total = Math.round(liberados.reduce((a, r) => a + r.total, 0) * 100) / 100;
  const parados = travados.reduce((a, r) => a + r.emitem, 0);

  // ⚠️ SEM SABER DAS CONTAS, A BARRA NAO DA NUMERO DE EMISSAO. Dizer "0 boletos - R$ 0,00" com a
  // tabela logo acima somando meio milhao seria a tela mentindo com cara de precisao.
  if (!sabeDasContas) {
    return (
      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="text-sm text-ink-muted">
          <b className="tabular-nums text-ink">{aEmitirSemSaber}</b> na planilha para{" "}
          {rotuloDaCompetencia(competencia)}. Quantos podem ser emitidos depende das contas do
          Asaas, que não consegui consultar.
        </div>
        <button
          className="rounded-lg bg-inverse px-5 py-2 text-sm font-bold text-brand-ink opacity-40"
          disabled
          type="button"
        >
          Emitir no Asaas
        </button>
      </div>
    );
  }

  return (
    <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur">
      <div className="text-sm text-ink">
        <b className="tabular-nums">{quantos}</b> boleto{quantos === 1 ? "" : "s"} de{" "}
        {rotuloDaCompetencia(competencia)} · <b className="tabular-nums">{moeda(total)}</b>
        {parados > 0 ? (
          <span className="text-ink-muted">
            {" "}
            · {parados} parado{parados === 1 ? "" : "s"} por falta de conta
          </span>
        ) : null}
      </div>
      <button
        className="rounded-lg bg-inverse px-5 py-2 text-sm font-bold text-brand-ink transition enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        disabled
        title="A emissão entra quando as contas do Asaas estiverem configuradas e os CPFs preenchidos."
        type="button"
      >
        Emitir no Asaas
      </button>
    </div>
  );
}
