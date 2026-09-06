"use client";

import { AlertTriangle, Clock, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  type Atividade,
  type EstagioDoTrabalho,
  type TipoDeTrabalho,
  NOME_DO_TIPO,
  atividadesDoEstagio,
  prazoDeEmissao,
  progresso,
  situacaoDoPrazo,
} from "@/lib/temis/trabalhos";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// O BOARD DA TÊMIS — kanban do trabalho, e não painel de configuração.
//
// ⚠️ O BOARD ANTIGO RESPONDIA OUTRA PERGUNTA. Ele mostrava quantos planos e minutas cada
// empreendimento tinha — informação de Setup, útil uma vez por empreendimento. Quem passa o dia em
// contrato precisa saber o que está na mão dele hoje. Pedido do Lucas (02/09/2026): *"o board está
// errado, aqui eu quero um kaban com os estágios que vamos seguir dentro da temis"*.
//
// ⚠️ AS COLUNAS SÃO FIXAS, E ISSO É DE PROPÓSITO. Um kanban com coluna configurável vira duas
// verdades: o que a tela mostra e o que o código sabe fazer andar. Aqui as colunas vêm de ESTAGIOS,
// que é a mesma lista que decide o avanço automático.
//
// ⚠️ E NÃO SE ARRASTA CARD. O card anda quando as atividades do estágio acabam — arrastar à mão
// deixaria o board dizer "em assinatura" com o documento por gerar. Marcar a última atividade é o
// gesto que move.
//
// ⚠️ O MESMO BOARD SERVE O PORTAL COMERCIAL (Hércules, 02/09/2026), e lá serve SÓ PARA LER. A aba
// Contratos do coordenador é este componente com três props opcionais: `rota` (a escopada pela
// sessão do portal, em vez da interna), `semToken` (quem autentica é o cookie do portal — e
// `getApoloAccessToken` LANÇA sem sessão do hub, que o coordenador não tem) e `somenteLeitura`
// (checkbox travado, nenhum POST: quem faz o card andar continua sendo a Têmis). Sem as três, o
// comportamento interno é exatamente o de antes.

type TrabalhoDaTela = {
  atividadesFeitas: string[];
  canal: "coordenador" | "hercules" | "iris";
  clienteCpf: null | string;
  clienteNome: string;
  criadoEm: string;
  empreendimentoCodigo: string;
  empreendimentoNome: string;
  estagio: EstagioDoTrabalho;
  estagioDesde: string;
  evidenciaPath: null | string;
  id: string;
  irisTicketId: null | string;
  observacao: null | string;
  tipo: TipoDeTrabalho;
  trabalhoOrigemId: null | string;
  unidade: string;
};

type Colunas = { descricao: string; id: EstagioDoTrabalho; nome: string }[];

// ⚠️ O QUE DESFAZ A VENDA É VERMELHO (Lucas, 06/09/2026: *"cancelamento em vermelho"*). O
// cancelamento estava em cinza, do lado do contrato em verde — a única cor do board que importa
// para quem passa os olhos é a que separa "a venda anda" de "a venda cai", e ela não existia.
// ⚠️ O DISTRATO VAI JUNTO, em tom mais forte: ele é o MESMO ato com outro instrumento (e é o que
// mexe em dinheiro do cliente). Deixá-lo azul ao lado de um cancelamento vermelho faria dois
// parentes parecerem coisas diferentes no mesmo quadro.
const CLASSE_DO_TIPO: Record<TipoDeTrabalho, string> = {
  cancelamento: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  cancelamento_correcao: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  cessao: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  contrato: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  distrato: "bg-rose-200 text-rose-900 dark:bg-rose-500/25 dark:text-rose-200",
};

/**
 * "2026-09-06T18:19:00Z" → "06/09".
 *
 * ⚠️ NO FUSO DA OPERAÇÃO (−03:00), e não em UTC: um trabalho aberto às 21h de Brasília é gravado no
 * dia seguinte em UTC, e o card diria que o pedido chegou amanhã.
 */
function dataCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

/** `12345678901` → `123.456.789-01`. */
function cpfLegivel(bruto: null | string): null | string {
  const d = String(bruto ?? "").replace(/\D/g, "");
  if (d.length !== 11) return bruto;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export function TemisKanban({
  enterpriseId,
  rota = "/api/temis/trabalhos",
  semToken = false,
  somenteLeitura = false,
}: {
  enterpriseId: null | string;
  /** De onde os cards vêm. O portal comercial aponta para a rota escopada pela sessão dele. */
  rota?: string;
  /** Sem `Authorization`: quem autentica é o cookie same-origin (portal do incorporador). */
  semToken?: boolean;
  /** Só olhar: checkbox travado e nenhum POST. */
  somenteLeitura?: boolean;
}) {
  const [trabalhos, setTrabalhos] = useState<null | TrabalhoDaTela[]>(null);
  const [colunas, setColunas] = useState<Colunas>([]);
  const [erro, setErro] = useState<null | string>(null);
  const [aberto, setAberto] = useState<null | string>(null);
  const [ocupado, setOcupado] = useState<null | string>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const token = semToken ? null : await getApoloAccessToken();
      const q = enterpriseId ? `?empreendimento=${encodeURIComponent(enterpriseId)}` : "";
      const r = await fetch(`${rota}${q}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const j = (await r.json()) as {
        data?: { estagios: Colunas; trabalhos: TrabalhoDaTela[] };
        error?: string;
      };
      if (!r.ok) throw new Error(j.error ?? `Falhou (${r.status}).`);
      setTrabalhos(j.data?.trabalhos ?? []);
      setColunas(j.data?.estagios ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui carregar o board.");
      setTrabalhos([]);
    }
  }, [enterpriseId, rota, semToken]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const marcar = useCallback(
    async (id: string, atividade: string, feita: boolean) => {
      // ⚠️ A TRAVA DE LEITURA MORA AQUI, e não só no checkbox: um `disabled` esquecido numa
      // versão futura do card não pode virar POST numa rota que nem aceita POST.
      if (somenteLeitura) return;

      setOcupado(id);
      setErro(null);
      try {
        const token = semToken ? null : await getApoloAccessToken();
        const r = await fetch(rota, {
          body: JSON.stringify({ acao: "atividade", atividade, feita, id }),
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          method: "POST",
        });
        const j = (await r.json()) as { error?: string };
        if (!r.ok) throw new Error(j.error ?? `Falhou (${r.status}).`);
        await carregar();
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não consegui marcar a atividade.");
      } finally {
        setOcupado(null);
      }
    },
    [carregar, rota, semToken, somenteLeitura],
  );

  const porEstagio = useMemo(() => {
    const mapa = new Map<EstagioDoTrabalho, TrabalhoDaTela[]>();
    for (const t of trabalhos ?? []) {
      const lista = mapa.get(t.estagio) ?? [];
      lista.push(t);
      mapa.set(t.estagio, lista);
    }
    return mapa;
  }, [trabalhos]);

  if (trabalhos === null) {
    return (
      <p className="flex items-center gap-2 px-1 py-6 text-sm text-ink-muted">
        <Loader2 aria-hidden="true" className="animate-spin" size={15} /> Carregando o board…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {erro ? (
        <p className="flex items-start gap-2 rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-ink dark:border-red-500/40 dark:bg-red-500/10">
          <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={14} /> {erro}
        </p>
      ) : null}

      {/* ⚠️ ROLA NA HORIZONTAL, e a página nunca. Quatro colunas não cabem em tela estreita, e o
          board inteiro apertado deixa o card ilegível justamente onde ele é lido de relance. */}
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max gap-3">
          {colunas.map((coluna) => {
            const cards = porEstagio.get(coluna.id) ?? [];
            return (
              <section
                className="flex w-[19rem] shrink-0 flex-col gap-2 rounded-xl border border-line bg-subtle/40 p-2"
                key={coluna.id}
              >
                <header className="px-1 pt-1">
                  <h3 className="flex items-baseline gap-2 text-sm font-bold text-ink">
                    {coluna.nome}
                    <span className="text-xs font-semibold text-ink-muted">{cards.length}</span>
                  </h3>
                  {/* ⚠️ "Chegou e ninguém pegou", "No D4Sign esperando os signatários" — isso é
                      recado de QUEM EXECUTA. No board do comercial (Lucas, 06/09/2026: *"é somente
                      informativo (...) aqui é para eles verem onde está os contratos e somente. a
                      parte de operação vai ficar na Têmis mesmo"*) o nome da coluna já responde a
                      pergunta que eles têm: em que passo o contrato está. */}
                  {somenteLeitura ? null : (
                    <p className="text-[0.7rem] text-ink-muted">{coluna.descricao}</p>
                  )}
                </header>

                {cards.length === 0 ? (
                  <p className="px-1 py-4 text-center text-xs text-ink-muted">Nada aqui.</p>
                ) : (
                  cards.map((t) => (
                    <Card
                      aberto={aberto === t.id}
                      aoAbrir={() => setAberto(aberto === t.id ? null : t.id)}
                      aoMarcar={(atividade, feita) => void marcar(t.id, atividade, feita)}
                      key={t.id}
                      ocupado={ocupado === t.id}
                      somenteLeitura={somenteLeitura}
                      trabalho={t}
                    />
                  ))
                )}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Card({
  aberto,
  aoAbrir,
  aoMarcar,
  ocupado,
  somenteLeitura,
  trabalho,
}: {
  aberto: boolean;
  aoAbrir: () => void;
  aoMarcar: (atividade: string, feita: boolean) => void;
  ocupado: boolean;
  somenteLeitura: boolean;
  trabalho: TrabalhoDaTela;
}) {
  const p = progresso(trabalho);
  const prazo = situacaoDoPrazo(trabalho);
  // A promessa de ponta a ponta: "quando o contrato fica pronto?", que é a pergunta do comercial.
  const emissao = prazoDeEmissao(trabalho);
  const doEstagio = atividadesDoEstagio(trabalho.tipo, trabalho.estagio);
  const feitas = new Set(trabalho.atividadesFeitas);

  return (
    <article
      className={`rounded-lg border bg-surface p-2.5 text-left shadow-sm ${
        prazo.atrasado
          ? "border-red-400/70"
          : prazo.vencendo
            ? "border-amber-400/70"
            : "border-line"
      }`}
    >
      {/* Sem nada para revelar, o card do comercial deixa de ser clicável: um clique que não faz
          nada é pior do que um bloco que não promete clique. */}
      <button
        className={`w-full text-left ${somenteLeitura ? "cursor-default" : ""}`}
        onClick={somenteLeitura ? undefined : aoAbrir}
        type="button"
      >
        <div className="flex items-center justify-between gap-2">
          <span
            className={`rounded-full px-1.5 py-0.5 text-[0.65rem] font-bold ${CLASSE_DO_TIPO[trabalho.tipo]}`}
          >
            {NOME_DO_TIPO[trabalho.tipo]}
          </span>
          {/* ⚠️ SÓ O ATRASO NOSSO PINTA DE VERMELHO. Esperar o cliente assinar aparece como
              informação — se fosse cobrança, o vermelho perderia sentido em duas semanas. */}
          {prazo.atrasado ? (
            <span className="flex items-center gap-1 text-[0.65rem] font-bold text-red-600 dark:text-red-400">
              <Clock aria-hidden="true" size={10} /> {prazo.decorridos}d
            </span>
          ) : prazo.decorridos > 0 ? (
            <span className="text-[0.65rem] text-ink-muted">há {prazo.decorridos}d</span>
          ) : null}
        </div>

        <p className="mt-1.5 text-sm font-semibold leading-tight text-ink">{trabalho.clienteNome}</p>
        {trabalho.clienteCpf ? (
          <p className="text-[0.7rem] tabular-nums text-ink-muted">{cpfLegivel(trabalho.clienteCpf)}</p>
        ) : null}
        <p className="mt-0.5 text-[0.7rem] text-ink-muted">
          {trabalho.empreendimentoCodigo} · {trabalho.unidade}
        </p>

        {/* ⚠️ QUANDO CHEGOU E PARA QUANDO ESTÁ (Lucas, 06/09/2026: *"pode continuar trazer o prazo,
            emissão de contrato 24 horas úteis"*, *"pode colocar no card a data de envio"*). O
            "há N dias" sozinho conta o tempo decorrido e não responde a pergunta de quem mandou o
            contrato: quando ele volta pronto. A data de envio é o outro lado da mesma conta — sem
            ela, "vence em 09/09" não diz se o pedido é de ontem ou da semana passada. */}
        <p className="mt-1 text-[0.7rem] text-ink-muted">
          Enviado {dataCurta(trabalho.criadoEm)}
          {emissao ? (
            <>
              {" · "}
              <span
                className={
                  emissao.estourou ? "font-bold text-red-600 dark:text-red-400" : "font-semibold"
                }
              >
                emissão em {emissao.escrito}
                {emissao.estourou ? " (vencido)" : ` · até ${dataCurta(emissao.em.toISOString())}`}
              </span>
            </>
          ) : null}
        </p>

        {/* ⚠️ O CHECKLIST É TRABALHO DE QUEM EXECUTA, e o board do comercial não executa nada
            (Lucas, 06/09/2026: *"é somente informativo (...) a parte de operação vai ficar na Têmis
            mesmo"*). O contador "0 de 1 nesta etapa" media o andamento do jurídico dentro do
            passo; para o comercial, a resposta é o passo — e o passo é a coluna. */}
        {!somenteLeitura && doEstagio.length > 0 ? (
          <p className="mt-1.5 text-[0.7rem] font-semibold text-ink-muted">
            {p.feitas} de {p.total} nesta etapa
          </p>
        ) : null}
      </button>

      {aberto && !somenteLeitura ? (
        <div className="mt-2 flex flex-col gap-1.5 border-t border-line pt-2">
          {doEstagio.map((a) => (
            <ItemDoChecklist
              atividade={a}
              aoMarcar={aoMarcar}
              feita={feitas.has(a.texto)}
              key={a.texto}
              ocupado={ocupado}
              somenteLeitura={somenteLeitura}
            />
          ))}

          {/* O rastro fica visível ao abrir: é o que prova de onde veio a solicitação. */}
          <p className="mt-1 text-[0.65rem] text-ink-muted">
            {trabalho.canal === "iris"
              ? `Atendimento · ticket ${trabalho.irisTicketId ?? "—"}`
              : trabalho.canal === "hercules"
                ? "Hércules · emissão de contrato"
                : "Coordenação"}
          </p>
          {/* ⚠️ A OBSERVAÇÃO É O BILHETE PARA O JURÍDICO, e sai escrita pelo sistema: "apurado pelo
              sistema: nenhuma assinatura registrada...". Ela serve a quem vai redigir o
              instrumento; no board do comercial é ruído sobre o que eles foram ver ali. */}
          {trabalho.observacao ? (
            <p className="text-[0.7rem] italic text-ink-muted">{trabalho.observacao}</p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function ItemDoChecklist({
  aoMarcar,
  atividade,
  feita,
  ocupado,
  somenteLeitura,
}: {
  aoMarcar: (atividade: string, feita: boolean) => void;
  atividade: Atividade;
  feita: boolean;
  ocupado: boolean;
  somenteLeitura: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-1.5 text-[0.72rem] leading-snug text-ink ${
        somenteLeitura ? "cursor-default" : "cursor-pointer"
      }`}
    >
      {/* No portal o checkbox é só o retrato do que a Têmis já fez: travado, sem `onChange`
          alcançável — e `marcar` recusa por cima, caso alguém destrave o input por fora. */}
      <input
        checked={feita}
        className="mt-0.5"
        disabled={ocupado || somenteLeitura}
        onChange={(e) => aoMarcar(atividade.texto, e.target.checked)}
        type="checkbox"
      />
      <span className={feita ? "text-ink-muted line-through" : ""}>
        {atividade.texto}
        {/* ⚠️ ATIVIDADE DE CLIENTE É DITA, e não escondida: quem olha precisa saber que aquele item
            não depende da equipe antes de cobrar alguém por ele. */}
        {atividade.quem === "cliente" ? (
          <span className="ml-1 text-[0.62rem] text-ink-muted">(com o cliente)</span>
        ) : null}
      </span>
    </label>
  );
}
