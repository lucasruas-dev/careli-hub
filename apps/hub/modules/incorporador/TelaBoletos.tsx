"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";

import { lerArquivoDeBoletos } from "@/lib/apolo/boletos/ler-arquivo";
import { linhaDoCliente } from "@/lib/apolo/boletos/ler-planilha";
import { vereditoDaLinha } from "@/lib/apolo/boletos/regra-de-emissao";

import { T } from "./tema";

// A EMISSÃO DE BOLETOS NO PORTAL — o consolidado, uma aba por prédio, e o botão que emite.
//
// Pedido do Lucas (01/09/2026): *"vamos ter uma aba trazendo o consolidado de tudo, vamos ter cada
// produto sua aba. vai ter uma tabela igual temos na carteira hoje... nome, cpf, valor da fatura,
// emissão vencimento, data de pagamento, vencido e tal. além do link do boleto"*.
//
// ⚠️ O RECORTE DESTE MÊS É DECLARADO: *"não tem empreendimento para essas empresas ainda dentro o
// panteon, mas como precisamos emitir esses boletos urgente, esse mês vou fazer de forma mais
// manual, somente com essa tela, e durante o mês vamos construir o processo correto"*. Por isso a
// planilha do administrativo é a fonte, e não uma carteira do sistema.
//
// ⚠️ A PLANILHA NÃO SOBE PARA O SERVIDOR. Ela é lida aqui no navegador; para a rota vão só as
// linhas do prédio que se está emitindo, e só no clique. O arquivo tem nome, telefone e valor de
// gente que não pediu para estar num servidor nosso.
//
// ⚠️ QUEM DECIDE QUEM RECEBE BOLETO É O SERVIDOR. Esta tela mostra o veredito para o operador
// conferir antes do clique, mas a rota reaplica a regra inteira sobre as linhas cruas — o valor do
// boleto não pode ser escolhido pelo lado que o operador consegue editar.

type Carteira = {
  conta: null | string;
  contaConfigurada: boolean;
  nome: string;
  slug: string;
};

type BoletoEmitido = {
  cobranca: string;
  documento: null | string;
  emissao: null | string;
  empreendimento: string;
  link: null | string;
  nome: string;
  pagamento: null | string;
  situacao: string;
  unidade: string;
  valor: number;
  vencido: boolean;
  vencimento: string;
};

type ItemDoEnsaio = {
  nome: string;
  referencia: string;
  unidade: string;
  valor: number;
  vencimento: string;
};

type Ensaio = {
  conta: string;
  divergencias: { cadastro: string; planilha: string; unidade: string }[];
  empreendimento: string;
  fora: { motivo: string; nome: string; unidade: null | string }[];
  impedimentos: string[];
  itens: ItemDoEnsaio[];
};

type Emissao = {
  emitidos: number;
  falhas: number;
  repetidos: number;
  resultados: {
    cobranca: null | string;
    erro: null | string;
    ja_existia: boolean;
    link: null | string;
    nome: string;
    unidade: string;
    valor: number;
  }[];
};

/** As linhas da planilha daquele prédio, prontas para a rota reavaliar. */
type LinhaParaRota = {
  contato: null | string;
  marcaNoMes: null | string;
  nome: string;
  observacao: null | string;
  unidade: null | string;
  valor: null | number;
  vencimento: null | number;
};

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function moeda(v: number): string {
  return v.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}

/**
 * `2026-09-15` → `15/09/2026`.
 *
 * ⚠️ FATIANDO A STRING, sem `new Date`. A data vem do Asaas como `AAAA-MM-DD`; passada por
 * `new Date` ela vira meia-noite UTC e, exibida no Brasil (UTC−3), mostra o DIA ANTERIOR — um
 * vencimento dia 1º apareceria como do mês passado.
 */
function dia(iso: null | string): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

function rotuloDaCompetencia(c: string): string {
  const [ano, mes] = c.split("-");
  return `${MESES[Number(mes) - 1] ?? mes} de ${ano}`;
}

/** Os seis meses a partir do atual — o administrativo emite o corrente e, às vezes, adianta. */
function competenciasSugeridas(): string[] {
  const hoje = new Date();
  const lista: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const d = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth() + i, 1));
    lista.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return lista;
}

export function TelaBoletos() {
  const [competencia, setCompetencia] = useState(() => competenciasSugeridas()[0]!);
  const [carteiras, setCarteiras] = useState<Carteira[]>([]);
  const [emitidos, setEmitidos] = useState<BoletoEmitido[]>([]);
  const [falhas, setFalhas] = useState<{ conta: string; erro: string }[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);
  const [aba, setAba] = useState<string>("consolidado");

  // A planilha do mês, lida no navegador. `null` = ninguém escolheu arquivo ainda.
  const [daPlanilha, setDaPlanilha] = useState<Map<string, LinhaParaRota[]> | null>(null);
  const [nomeDoArquivo, setNomeDoArquivo] = useState<null | string>(null);
  const [lendo, setLendo] = useState(false);

  const [ensaio, setEnsaio] = useState<null | { dados: Ensaio; slug: string }>(null);
  const [emitindo, setEmitindo] = useState(false);
  const [emissao, setEmissao] = useState<null | Emissao>(null);

  const arquivoRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/incorporador/boletos?competencia=${competencia}`, {
        cache: "no-store",
      });
      if (!r.ok) throw new Error(`Não consegui carregar (${r.status}).`);
      const j = (await r.json()) as {
        data?: { boletos: BoletoEmitido[]; carteiras: Carteira[]; falhas: typeof falhas };
      };
      setEmitidos(j.data?.boletos ?? []);
      setCarteiras(j.data?.carteiras ?? []);
      setFalhas(j.data?.falhas ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui carregar.");
    } finally {
      setCarregando(false);
    }
  }, [competencia]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Trocar de mês invalida a leitura: a planilha foi lida NAQUELA competência.
  useEffect(() => {
    setDaPlanilha(null);
    setNomeDoArquivo(null);
    setEnsaio(null);
    setEmissao(null);
  }, [competencia]);

  const lerArquivo = useCallback(
    async (arquivo: File) => {
      setLendo(true);
      setErro(null);
      setEnsaio(null);
      setEmissao(null);
      try {
        const { abas } = await lerArquivoDeBoletos(arquivo, competencia);
        const mapa = new Map<string, LinhaParaRota[]>();
        for (const lida of abas) {
          if (!lida.empreendimento) continue;
          mapa.set(
            lida.empreendimento.slug,
            lida.clientes.map((c) => ({
              contato: c.contato,
              marcaNoMes: c.marcaNoMes,
              nome: c.nome,
              observacao: c.observacao,
              unidade: c.unidade,
              valor: c.valor,
              vencimento: c.vencimento,
            })),
          );
        }
        setDaPlanilha(mapa);
        setNomeDoArquivo(arquivo.name);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não consegui ler o arquivo.");
      } finally {
        setLendo(false);
      }
    },
    [competencia],
  );

  const chamar = useCallback(
    async (slug: string, confirmar: boolean) => {
      const linhas = daPlanilha?.get(slug);
      if (!linhas || linhas.length === 0) {
        setErro("A planilha não trouxe nenhuma linha para este empreendimento.");
        return;
      }
      if (confirmar) setEmitindo(true);
      setErro(null);
      try {
        const r = await fetch("/api/incorporador/boletos", {
          body: JSON.stringify({ competencia, confirmar, empreendimento: slug, linhas }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        });
        const j = (await r.json()) as { data?: Ensaio & Emissao; error?: string };
        if (!r.ok) throw new Error(j.error ?? `Falhou (${r.status}).`);
        if (confirmar) {
          setEmissao(j.data as Emissao);
          setEnsaio(null);
          await carregar();
        } else {
          setEnsaio({ dados: j.data as Ensaio, slug });
        }
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não consegui falar com o servidor.");
      } finally {
        setEmitindo(false);
      }
    },
    [carregar, competencia, daPlanilha],
  );

  const porEmpreendimento = useMemo(() => {
    const mapa = new Map<string, BoletoEmitido[]>();
    for (const b of emitidos) {
      if (!mapa.has(b.empreendimento)) mapa.set(b.empreendimento, []);
      mapa.get(b.empreendimento)!.push(b);
    }
    return mapa;
  }, [emitidos]);

  const visiveis = aba === "consolidado" ? emitidos : (porEmpreendimento.get(aba) ?? []);

  const totais = useMemo(() => {
    const pagos = visiveis.filter((b) => b.pagamento);
    const vencidos = visiveis.filter((b) => b.vencido);
    return {
      pago: pagos.reduce((a, b) => a + b.valor, 0),
      pagos: pagos.length,
      total: visiveis.reduce((a, b) => a + b.valor, 0),
      vencido: vencidos.reduce((a, b) => a + b.valor, 0),
      vencidos: vencidos.length,
    };
  }, [visiveis]);

  const semChave = carteiras.filter((c) => !c.contaConfigurada);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Cabecalho
        aoAtualizar={() => void carregar()}
        carregando={carregando}
        competencia={competencia}
        onCompetencia={setCompetencia}
      />

      {semChave.length > 0 ? (
        <Aviso tom="alerta">
          Sem chave do Asaas configurada: {semChave.map((c) => c.nome).join(", ")}. Enquanto ela não
          entrar no ambiente, estes empreendimentos não emitem nem aparecem na lista.
        </Aviso>
      ) : null}

      {falhas.map((f) => (
        <Aviso key={f.conta} tom="erro">
          Não consegui ler a conta {f.conta} no Asaas: {f.erro}
        </Aviso>
      ))}
      {erro ? <Aviso tom="erro">{erro}</Aviso> : null}

      <PainelDeEmissao
        aoEscolherArquivo={() => arquivoRef.current?.click()}
        aoEmitir={(slug) => void chamar(slug, true)}
        aoSimular={(slug) => void chamar(slug, false)}
        carteiras={carteiras}
        competencia={competencia}
        daPlanilha={daPlanilha}
        emissao={emissao}
        emitindo={emitindo}
        ensaio={ensaio}
        lendo={lendo}
        nomeDoArquivo={nomeDoArquivo}
      />

      <input
        accept=".xlsx,.xls"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void lerArquivo(f);
          e.target.value = "";
        }}
        ref={arquivoRef}
        style={{ display: "none" }}
        type="file"
      />

      <div style={{ display: "grid", gap: 12 }}>
        <Abas
          aba={aba}
          carteiras={carteiras}
          contagem={porEmpreendimento}
          onAba={setAba}
          total={emitidos.length}
        />

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <Cartao rotulo="Boletos" valor={String(visiveis.length)} />
          <Cartao rotulo="Total" valor={moeda(totais.total)} />
          <Cartao nota={`${totais.pagos} boleto(s)`} rotulo="Pago" valor={moeda(totais.pago)} />
          <Cartao
            nota={`${totais.vencidos} boleto(s)`}
            rotulo="Vencido"
            tom={totais.vencidos > 0 ? "alerta" : undefined}
            valor={moeda(totais.vencido)}
          />
        </div>

        <Tabela boletos={visiveis} carregando={carregando} mostrarPredio={aba === "consolidado"} />
      </div>
    </div>
  );
}

// ── CABEÇALHO ───────────────────────────────────────────────────────────────

function Cabecalho({
  aoAtualizar,
  carregando,
  competencia,
  onCompetencia,
}: {
  aoAtualizar: () => void;
  carregando: boolean;
  competencia: string;
  onCompetencia: (c: string) => void;
}) {
  return (
    <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 12 }}>
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>
        <h1 style={{ color: T.text, fontSize: 20, fontWeight: 700, margin: 0 }}>
          Emissão de boletos
        </h1>
        <p style={{ color: T.sub, fontSize: 13, margin: "4px 0 0" }}>
          Competência de {rotuloDaCompetencia(competencia)}
        </p>
      </div>

      <select
        onChange={(e) => onCompetencia(e.target.value)}
        style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          color: T.text,
          fontSize: 14,
          padding: "8px 12px",
        }}
        value={competencia}
      >
        {competenciasSugeridas().map((c) => (
          <option key={c} value={c}>
            {rotuloDaCompetencia(c)}
          </option>
        ))}
      </select>

      <button
        disabled={carregando}
        onClick={aoAtualizar}
        style={{
          alignItems: "center",
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 8,
          color: T.text,
          cursor: carregando ? "default" : "pointer",
          display: "inline-flex",
          fontSize: 14,
          gap: 6,
          padding: "8px 12px",
        }}
        type="button"
      >
        {carregando ? (
          <Loader2 className="inc-girando" size={15} />
        ) : (
          <RefreshCw size={15} />
        )}
        Atualizar
      </button>
    </div>
  );
}

// ── O PAINEL QUE EMITE ──────────────────────────────────────────────────────

function PainelDeEmissao({
  aoEmitir,
  aoEscolherArquivo,
  aoSimular,
  carteiras,
  competencia,
  daPlanilha,
  emissao,
  emitindo,
  ensaio,
  lendo,
  nomeDoArquivo,
}: {
  aoEmitir: (slug: string) => void;
  aoEscolherArquivo: () => void;
  aoSimular: (slug: string) => void;
  carteiras: Carteira[];
  competencia: string;
  daPlanilha: Map<string, LinhaParaRota[]> | null;
  emissao: null | Emissao;
  emitindo: boolean;
  ensaio: null | { dados: Ensaio; slug: string };
  lendo: boolean;
  nomeDoArquivo: null | string;
}) {
  return (
    <section
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        display: "grid",
        gap: 12,
        padding: 16,
      }}
    >
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10 }}>
        <FileSpreadsheet size={18} style={{ color: T.gold }} />
        <strong style={{ color: T.text, fontSize: 15 }}>Emitir a partir da planilha do mês</strong>
        <button
          disabled={lendo}
          onClick={aoEscolherArquivo}
          style={{
            alignItems: "center",
            background: T.btnBg,
            border: "none",
            borderRadius: 8,
            color: T.btnFg,
            cursor: lendo ? "default" : "pointer",
            display: "inline-flex",
            fontSize: 14,
            fontWeight: 600,
            gap: 6,
            marginLeft: "auto",
            padding: "8px 14px",
          }}
          type="button"
        >
          {lendo ? <Loader2 className="inc-girando" size={15} /> : <Upload size={15} />}
          {nomeDoArquivo ? "Trocar arquivo" : "Escolher arquivo"}
        </button>
      </div>

      {nomeDoArquivo ? (
        <p style={{ color: T.sub, fontSize: 13, margin: 0 }}>
          Lendo <strong style={{ color: T.text }}>{nomeDoArquivo}</strong> na competência de{" "}
          {rotuloDaCompetencia(competencia)}. O arquivo não sai do seu navegador.
        </p>
      ) : (
        <p style={{ color: T.sub, fontSize: 13, margin: 0 }}>
          Escolha a planilha que o administrativo envia. Ela é lida aqui no seu navegador — só as
          linhas do prédio que você emitir chegam ao servidor.
        </p>
      )}

      {daPlanilha ? (
        <div style={{ display: "grid", gap: 8 }}>
          {carteiras.map((c) => (
            <LinhaDaCarteira
              aoEmitir={() => aoEmitir(c.slug)}
              aoSimular={() => aoSimular(c.slug)}
              carteira={c}
              emitindo={emitindo}
              ensaio={ensaio?.slug === c.slug ? ensaio.dados : null}
              key={c.slug}
              linhas={daPlanilha.get(c.slug) ?? []}
            />
          ))}
        </div>
      ) : null}

      {emissao ? <ResultadoDaEmissao emissao={emissao} /> : null}
    </section>
  );
}

function LinhaDaCarteira({
  aoEmitir,
  aoSimular,
  carteira,
  emitindo,
  ensaio,
  linhas,
}: {
  aoEmitir: () => void;
  aoSimular: () => void;
  carteira: Carteira;
  emitindo: boolean;
  ensaio: null | Ensaio;
  linhas: LinhaParaRota[];
}) {
  // ⚠️ A CONTA DA TELA É UMA PRÉVIA, NÃO A DECISÃO. Quem decide é a rota, que reaplica a regra
  // sobre as linhas cruas. Aqui só se antecipa o número para o operador não clicar às cegas.
  const previa = useMemo(() => {
    let emitem = 0;
    let total = 0;
    for (const l of linhas) {
      const v = vereditoDaLinha(linhaDoCliente({ ...l, lote: null, parcelaAtual: null, quadra: null, totalParcelas: null }));
      if (v.emite) {
        emitem += 1;
        total += v.valor;
      }
    }
    return { emitem, total: Math.round(total * 100) / 100 };
  }, [linhas]);

  const semLinhas = linhas.length === 0;

  return (
    <div
      style={{
        background: T.soft,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        display: "grid",
        gap: 8,
        padding: 12,
      }}
    >
      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 10 }}>
        <strong style={{ color: T.text, fontSize: 14 }}>{carteira.nome}</strong>
        <span style={{ color: T.sub, fontSize: 13 }}>
          {semLinhas
            ? "sem aba na planilha"
            : `${previa.emitem} de ${linhas.length} emitem · ${moeda(previa.total)}`}
        </span>

        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
          <button
            disabled={semLinhas || !carteira.contaConfigurada || emitindo}
            onClick={aoSimular}
            style={{
              background: "transparent",
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              color: T.text,
              cursor: semLinhas || !carteira.contaConfigurada ? "default" : "pointer",
              fontSize: 13,
              opacity: semLinhas || !carteira.contaConfigurada ? 0.5 : 1,
              padding: "6px 12px",
            }}
            type="button"
          >
            Conferir
          </button>
          {ensaio ? (
            <button
              disabled={emitindo || ensaio.itens.length === 0 || ensaio.impedimentos.length > 0}
              onClick={aoEmitir}
              style={{
                alignItems: "center",
                background: T.btnBg,
                border: "none",
                borderRadius: 8,
                color: T.btnFg,
                cursor: emitindo ? "default" : "pointer",
                display: "inline-flex",
                fontSize: 13,
                fontWeight: 600,
                gap: 6,
                opacity: ensaio.itens.length === 0 || ensaio.impedimentos.length > 0 ? 0.5 : 1,
                padding: "6px 12px",
              }}
              type="button"
            >
              {emitindo ? <Loader2 className="inc-girando" size={14} /> : <Check size={14} />}
              Emitir {ensaio.itens.length}
            </button>
          ) : null}
        </div>
      </div>

      {ensaio ? <DetalheDoEnsaio ensaio={ensaio} /> : null}
    </div>
  );
}

function DetalheDoEnsaio({ ensaio }: { ensaio: Ensaio }) {
  const total = ensaio.itens.reduce((a, i) => a + i.valor, 0);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {ensaio.impedimentos.map((i) => (
        <Aviso key={i} tom="erro">
          {i}
        </Aviso>
      ))}

      {ensaio.divergencias.length > 0 ? (
        <Aviso tom="alerta">
          Nome diferente do cadastro em {ensaio.divergencias.length} unidade(s):{" "}
          {ensaio.divergencias
            .map((d) => `${d.unidade} (planilha “${d.planilha}”, cadastro “${d.cadastro}”)`)
            .join("; ")}
          . O boleto sai no CPF do cadastro — confira antes de emitir.
        </Aviso>
      ) : null}

      {ensaio.itens.length > 0 ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 420, width: "100%" }}>
            <thead>
              <tr style={{ color: T.sub, textAlign: "left" }}>
                <th style={{ padding: "4px 8px 4px 0" }}>Unidade</th>
                <th style={{ padding: "4px 8px" }}>Cliente</th>
                <th style={{ padding: "4px 8px" }}>Vencimento</th>
                <th style={{ padding: "4px 0 4px 8px", textAlign: "right" }}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {ensaio.itens.map((i) => (
                <tr key={i.referencia} style={{ borderTop: `1px solid ${T.border}` }}>
                  <td style={{ color: T.text, padding: "5px 8px 5px 0" }}>{i.unidade}</td>
                  <td style={{ color: T.text, padding: "5px 8px" }}>{i.nome}</td>
                  <td style={{ color: T.sub, padding: "5px 8px" }}>{dia(i.vencimento)}</td>
                  <td
                    style={{
                      color: T.text,
                      fontVariantNumeric: "tabular-nums",
                      padding: "5px 0 5px 8px",
                      textAlign: "right",
                    }}
                  >
                    {moeda(i.valor)}
                  </td>
                </tr>
              ))}
              <tr style={{ borderTop: `1px solid ${T.border}`, fontWeight: 700 }}>
                <td colSpan={3} style={{ color: T.sub, padding: "6px 8px 0 0" }}>
                  {ensaio.itens.length} boleto(s) na conta {ensaio.conta}
                </td>
                <td
                  style={{
                    color: T.text,
                    fontVariantNumeric: "tabular-nums",
                    padding: "6px 0 0 8px",
                    textAlign: "right",
                  }}
                >
                  {moeda(total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      {/* ⚠️ QUEM FICA DE FORA APARECE COM O MOTIVO. Uma lista que só mostra quem emite esconde o
          cliente esquecido — e o esquecido só reclama no mês seguinte. */}
      {ensaio.fora.length > 0 ? (
        <details>
          <summary style={{ color: T.sub, cursor: "pointer", fontSize: 13 }}>
            {ensaio.fora.length} não recebem boleto — ver o motivo de cada um
          </summary>
          <ul style={{ display: "grid", gap: 3, listStyle: "none", margin: "6px 0 0", padding: 0 }}>
            {ensaio.fora.map((f, i) => (
              <li key={`${f.nome}-${i}`} style={{ color: T.sub, fontSize: 12.5 }}>
                <span style={{ color: T.text }}>
                  {f.nome}
                  {f.unidade ? ` (${f.unidade})` : ""}
                </span>{" "}
                — {f.motivo}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function ResultadoDaEmissao({ emissao }: { emissao: Emissao }) {
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <Aviso tom={emissao.falhas > 0 ? "alerta" : "ok"}>
        {emissao.emitidos} boleto(s) emitido(s)
        {emissao.repetidos > 0 ? ` · ${emissao.repetidos} já existia(m)` : ""}
        {emissao.falhas > 0 ? ` · ${emissao.falhas} falhou(ram)` : ""}
      </Aviso>

      {emissao.resultados
        .filter((r) => r.erro)
        .map((r) => (
          <Aviso key={r.unidade} tom="erro">
            {r.nome} ({r.unidade}): {r.erro}
          </Aviso>
        ))}
    </div>
  );
}

// ── ABAS ────────────────────────────────────────────────────────────────────

function Abas({
  aba,
  carteiras,
  contagem,
  onAba,
  total,
}: {
  aba: string;
  carteiras: Carteira[];
  contagem: Map<string, unknown[]>;
  onAba: (a: string) => void;
  total: number;
}) {
  const itens = [
    { chave: "consolidado", contagem: total, rotulo: "Consolidado" },
    ...carteiras.map((c) => ({
      chave: c.slug,
      contagem: contagem.get(c.slug)?.length ?? 0,
      rotulo: c.nome,
    })),
  ];

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {itens.map((i) => {
        const ativa = aba === i.chave;
        return (
          <button
            key={i.chave}
            onClick={() => onAba(i.chave)}
            style={{
              background: ativa ? T.soft : "transparent",
              border: `1px solid ${ativa ? T.gold : T.border}`,
              borderRadius: 999,
              color: ativa ? T.text : T.sub,
              cursor: "pointer",
              fontSize: 13,
              fontWeight: ativa ? 600 : 500,
              padding: "6px 14px",
            }}
            type="button"
          >
            {i.rotulo}
            <span style={{ color: T.sub, fontWeight: 500, marginLeft: 6 }}>{i.contagem}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── A TABELA ────────────────────────────────────────────────────────────────

function Tabela({
  boletos,
  carregando,
  mostrarPredio,
}: {
  boletos: BoletoEmitido[];
  carregando: boolean;
  mostrarPredio: boolean;
}) {
  if (carregando) {
    return (
      <p style={{ color: T.sub, fontSize: 14, padding: 24, textAlign: "center" }}>
        <Loader2 className="inc-girando" size={16} style={{ verticalAlign: "middle" }} /> Lendo o
        Asaas…
      </p>
    );
  }

  if (boletos.length === 0) {
    return (
      <p
        style={{
          background: T.card,
          border: `1px dashed ${T.border}`,
          borderRadius: 12,
          color: T.sub,
          fontSize: 14,
          padding: 24,
          textAlign: "center",
        }}
      >
        Nenhum boleto emitido nesta competência.
      </p>
    );
  }

  const cabecalho = [
    "Cliente",
    ...(mostrarPredio ? ["Prédio"] : []),
    "Unidade",
    "CPF/CNPJ",
    "Valor",
    "Emissão",
    "Vencimento",
    "Pagamento",
    "Situação",
    "Boleto",
  ];

  return (
    // ⚠️ A ROLAGEM É DA TABELA, e não da página: com dez colunas no celular, deixar o corpo rolar
    // de lado empurra o menu do portal para fora da tela.
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 13.5, minWidth: 900, width: "100%" }}>
        <thead>
          <tr style={{ color: T.sub, textAlign: "left" }}>
            {cabecalho.map((c) => (
              <th
                key={c}
                style={{
                  borderBottom: `1px solid ${T.border}`,
                  fontWeight: 600,
                  padding: "8px 10px",
                  textAlign: c === "Valor" ? "right" : "left",
                  whiteSpace: "nowrap",
                }}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {boletos.map((b) => (
            <tr key={b.cobranca} style={{ borderBottom: `1px solid ${T.border}` }}>
              <td style={{ color: T.text, padding: "8px 10px" }}>{b.nome}</td>
              {mostrarPredio ? (
                <td style={{ color: T.sub, padding: "8px 10px", whiteSpace: "nowrap" }}>
                  {b.empreendimento}
                </td>
              ) : null}
              <td style={{ color: T.sub, padding: "8px 10px" }}>{b.unidade}</td>
              <td style={{ color: T.sub, padding: "8px 10px", whiteSpace: "nowrap" }}>
                {b.documento ?? "—"}
              </td>
              <td
                style={{
                  color: T.text,
                  fontVariantNumeric: "tabular-nums",
                  padding: "8px 10px",
                  textAlign: "right",
                  whiteSpace: "nowrap",
                }}
              >
                {moeda(b.valor)}
              </td>
              <td style={{ color: T.sub, padding: "8px 10px", whiteSpace: "nowrap" }}>
                {dia(b.emissao)}
              </td>
              <td style={{ color: T.sub, padding: "8px 10px", whiteSpace: "nowrap" }}>
                {dia(b.vencimento)}
              </td>
              <td style={{ color: T.sub, padding: "8px 10px", whiteSpace: "nowrap" }}>
                {dia(b.pagamento)}
              </td>
              <td style={{ padding: "8px 10px" }}>
                <Selo boleto={b} />
              </td>
              <td style={{ padding: "8px 10px" }}>
                {b.link ? (
                  <a
                    href={b.link}
                    rel="noreferrer"
                    style={{
                      alignItems: "center",
                      color: T.gold,
                      display: "inline-flex",
                      gap: 4,
                      textDecoration: "none",
                    }}
                    target="_blank"
                  >
                    Abrir <ExternalLink size={12} />
                  </a>
                ) : (
                  <span style={{ color: T.sub }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * O estado do boleto em uma palavra.
 *
 * ⚠️ PAGO VENCE VENCIDO. Quem pagou com atraso tem data de pagamento E venceu; mostrar "vencido"
 * para quem já quitou é o tipo de erro que gera ligação de cliente.
 */
function Selo({ boleto }: { boleto: BoletoEmitido }) {
  const [fundo, cor, texto] = boleto.pagamento
    ? [T.okBg, T.ok, "Pago"]
    : boleto.vencido
      ? [T.dangerBg, T.danger, "Vencido"]
      : [T.soft, T.sub, "Em aberto"];

  return (
    <span
      style={{
        background: fundo,
        borderRadius: 999,
        color: cor,
        display: "inline-block",
        fontSize: 12,
        fontWeight: 600,
        padding: "3px 10px",
        whiteSpace: "nowrap",
      }}
    >
      {texto}
    </span>
  );
}

// ── PEÇAS ───────────────────────────────────────────────────────────────────

function Cartao({
  nota,
  rotulo,
  tom,
  valor,
}: {
  nota?: string;
  rotulo: string;
  tom?: "alerta";
  valor: string;
}) {
  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${tom === "alerta" ? T.danger : T.border}`,
        borderRadius: 10,
        flex: "1 1 150px",
        padding: "10px 14px",
      }}
    >
      <div
        style={{
          color: T.sub,
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {rotulo}
      </div>
      <div
        style={{
          color: tom === "alerta" ? T.danger : T.text,
          fontSize: 18,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 700,
          marginTop: 2,
        }}
      >
        {valor}
      </div>
      {nota ? <div style={{ color: T.sub, fontSize: 12, marginTop: 1 }}>{nota}</div> : null}
    </div>
  );
}

function Aviso({ children, tom }: { children: React.ReactNode; tom: "alerta" | "erro" | "ok" }) {
  const cor = tom === "ok" ? T.ok : T.danger;
  const fundo = tom === "ok" ? T.okBg : T.dangerBg;

  return (
    <div
      style={{
        alignItems: "flex-start",
        background: fundo,
        border: `1px solid ${cor}`,
        borderRadius: 10,
        color: T.text,
        display: "flex",
        fontSize: 13.5,
        gap: 8,
        padding: "10px 12px",
      }}
    >
      {tom === "ok" ? (
        <Check size={16} style={{ color: cor, flexShrink: 0, marginTop: 1 }} />
      ) : (
        <AlertTriangle size={16} style={{ color: cor, flexShrink: 0, marginTop: 1 }} />
      )}
      <span>{children}</span>
    </div>
  );
}
