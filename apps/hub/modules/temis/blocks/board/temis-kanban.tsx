"use client";

import { AlertTriangle, Clock, FileCheck2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { TelaDeTrabalho } from "@/modules/temis/blocks/trabalho/tela-de-trabalho";

import { contratoVigente } from "@/lib/temis/contrato-guardado";
import {
  type EstagioDoTrabalho,
  type TipoDeTrabalho,
  NOME_DO_TIPO,
  prazoDeEmissao,
  situacaoDoPrazo,
} from "@/lib/temis/trabalhos";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";
import { EnviarParaAssinatura } from "@/modules/temis/blocks/assinatura/enviar-para-assinatura";

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

type ContratoDoCard = {
  criadoEm: string;
  id: string;
  nome: string;
  observacao?: null | string;
  versao: null | number;
};

type TrabalhoDaTela = {
  atividadesFeitas: string[];
  canal: "coordenador" | "hercules" | "iris";
  clienteCpf: null | string;
  clienteNome: string;
  /** O que já foi gerado e guardado desta proposta. Vazio = ainda não há papel. */
  contratos?: ContratoDoCard[];
  criadoEm: string;
  empreendimentoCodigo: string;
  empreendimentoNome: string;
  estagio: EstagioDoTrabalho;
  estagioDesde: string;
  evidenciaPath: null | string;
  id: string;
  irisTicketId: null | string;
  observacao: null | string;
  /** A proposta de onde o contrato saiu. É a chave do envio para assinatura. */
  propostaId?: null | string;
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
  /**
   * O card cuja TELA DE TRABALHO está aberta.
   *
   * ⚠️ A EXPANSÃO INLINE DO CARD ACABOU, e o `aberto` que a controlava saiu junto. Lucas
   * (09/09/2026): *"ao clicar no card abrisse uma tela de trabalho"*. Manter os dois caminhos
   * daria dois lugares para gerar o mesmo contrato — e a primeira tentativa deixou o estado vivo
   * sem ninguém para acendê-lo, o que tornou "Gerar contrato" e "Enviar para assinatura"
   * inalcançáveis sem nenhum erro aparecer. Agora as duas ações moram na tela de trabalho.
   */
  const [emTrabalho, setEmTrabalho] = useState<null | string>(null);
  /** A proposta cujo contrato está indo para assinatura (o modal aberto). */
  const [enviando, setEnviando] = useState<null | string>(null);
  /**
   * O recado de uma etapa que acabou de ser encerrada.
   *
   * ⚠️ ELE VIVE NO QUADRO, e não na tela que o produziu: a tela fecha no mesmo instante, e um aviso
   * que morre junto com quem o escreveu nunca chega a ser lido. Some sozinho depois de alguns
   * segundos — é confirmacao, nao alerta.
   */
  const [recado, setRecado] = useState<null | string>(null);

  useEffect(() => {
    if (!recado) return;
    const relogio = setTimeout(() => setRecado(null), 8000);
    return () => clearTimeout(relogio);
  }, [recado]);

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

  /**
   * O QUADRO SE ATUALIZA SOZINHO ENQUANTO ALGUÉM O OLHA.
   *
   * Lucas (11/09/2026): *"enviei para contrato e não apareceu, tem que criar essa comunicação que
   * ao enviar ele aparece, se ficar assim pode ser que o operador não atualiza a página e fica sem
   * ver"*. O card nasce no banco quando o Hércules entrega a venda, e até agora o quadro só sabia
   * disso se a pessoa recarregasse a página — ou seja, a fila crescia sem ninguém ver.
   *
   * ⚠️ SÓ COM A ABA VISÍVEL, e é isso que separa isto de um polling caro. `document.hidden` corta o
   * relógio quando a aba vai para segundo plano: um quadro esquecido aberto a tarde inteira não
   * gera nenhuma chamada. A casa já teve fatura alta por polling (o Hermes), e a regra que ficou é
   * não pagar por tela que ninguém está olhando.
   *
   * ⚠️ E RECARREGA AO VOLTAR O FOCO, que é o caso real do dia a dia: o operador está no Hércules ou
   * no WhatsApp, volta para a Têmis e quer ver o que chegou — sem esperar o próximo minuto.
   */
  useEffect(() => {
    const aoVoltar = () => {
      if (!document.hidden) void carregar();
    };

    const relogio = setInterval(aoVoltar, 60_000);
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);

    return () => {
      clearInterval(relogio);
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("focus", aoVoltar);
    };
  }, [carregar]);


  /**
   * Gera o contrato da proposta e guarda — o mesmo caminho da prévia do Hércules.
   *
   * ⚠️ AQUI, E NÃO SÓ NO HÉRCULES, porque o quadro é onde o time de contratos trabalha. Antes o
   * botão de gerar vivia só na tela de Venda: quem estava no board marcava "Gerar o contrato pela
   * minuta" na checklist, o card andava, e nada tinha sido gerado. O card do Henrique chegou a
   * "finalizado" com as cinco atividades marcadas, sem contrato e sem envelope.
   *
   * ⚠️ E A LACUNA CONTINUA BLOQUEANDO: quem recusa é a rota, que devolve o que falta. O botão não
   * repete a validação — repetir daria duas verdades sobre o mesmo contrato.
   */

  /**
   * Abre o contrato guardado numa aba.
   *
   * ⚠️ A ABA É ABERTA ANTES DO `await`, e não depois. A URL do arquivo é assinada no servidor, o
   * que leva uma ida e volta; um `window.open` depois dela acontece fora do gesto do usuário e o
   * navegador o bloqueia como pop-up — o clique "não faz nada" e ninguém descobre por quê.
   *
   * ⚠️ SÓ NA TÊMIS. No board do comercial (`semToken`) quem autentica é o cookie do portal, e esta
   * rota pede o Bearer do hub: o botão nem aparece lá. O coordenador abre o mesmo arquivo pela aba
   * Documentos da venda, que é a porta dele.
   */

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
    // `relative` porque a tela de trabalho é um overlay absoluto por cima do quadro.
    //
    // ⚠️ E O PAI PRECISA TER ALTURA ENQUANTO ELA ESTÁ ABERTA. `inset-0` copia a altura de quem
    // posiciona: sem a altura mínima, a tela de trabalho herdava a do QUADRO — que encolhe quando
    // há poucos cards — e a análise inteira ficava espremida numa faixa de uns 600px, rolando por
    // dentro com a metade de baixo da janela vazia. Lucas (10/09/2026): *"a tela está cortando"*.
    <div
      className={`relative flex flex-col gap-3 ${
        emTrabalho ? "min-h-[calc(100vh-10rem)]" : ""
      }`}
    >
      {emTrabalho ? (
        <TelaDeTrabalho
          aoConcluir={(recado) => {
            // A ordem importa: o recado primeiro, a volta depois. Fechar a tela antes faria o
            // quadro aparecer em branco por um instante e só então mostrar o aviso.
            setRecado(recado);
            void carregar();
            setEmTrabalho(null);
          }}
          aoEnviarParaAssinatura={(id) => setEnviando(id)}
          aoFechar={() => setEmTrabalho(null)}
          aoMudar={() => void carregar()}
          trabalhoId={emTrabalho}
        />
      ) : null}
      {/* ⚠️ O RECADO FICA NO TOPO E EM VERDE: e a confirmacao de que a etapa fechou. Sem ele, gerar
          o contrato parecia nao ter feito nada — o modal fechava e o quadro voltava igual. */}
      {recado ? (
        <p className="flex items-start gap-2 rounded-lg border border-emerald-300/70 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
          <FileCheck2 aria-hidden="true" className="mt-0.5 shrink-0" size={15} /> {recado}
        </p>
      ) : null}
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
                      // ⚠️ O CARD SÓ INFORMA E ABRE. As ações (gerar contrato, enviar para
                      // assinatura, abrir o PDF) migraram para a tela de trabalho — Lucas
                      // (09/09/2026): *"queria ela informativa, ao clicar no card abrisse uma tela
                      // de trabalho"*. No board só-leitura do comercial, o clique não abre nada.
                      aoAbrir={somenteLeitura ? null : () => setEmTrabalho(t.id)}
                      key={t.id}
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

      {/* ⚠️ O MODAL VIVE FORA DAS COLUNAS, e não dentro do card. Dentro, ele herdaria o `overflow`
          da coluna do kanban e apareceria cortado (ou preso à rolagem lateral) — e o botão que
          confirma o envio ficaria fora da tela. */}
      {enviando ? (
        <EnviarParaAssinatura
          aoFechar={() => {
            setEnviando(null);
            // O card acabou de mudar de estado (o envio move o trabalho para "em assinatura"):
            // recarrega para o board não continuar mostrando o passo anterior.
            void carregar();
          }}
          propostaId={enviando}
        />
      ) : null}
    </div>
  );
}

function Card({
  aoAbrir,
  somenteLeitura,
  trabalho,
}: {
  /** `null` no board só-leitura do portal comercial: lá o card não abre tela de trabalho. */
  aoAbrir: null | (() => void);
  somenteLeitura: boolean;
  trabalho: TrabalhoDaTela;
}) {
  const contratos = trabalho.contratos ?? [];
  // ⚠️ VALE A GERAÇÃO MAIS RECENTE, e a regra mora na lib com teste. Duas versões guardadas são o
  // caso normal (alguém consertou um dado e gerou de novo); mostrar as duas com o mesmo peso é o
  // caminho mais curto para despachar a versão errada para assinatura.
  const vigente = contratoVigente<ContratoDoCard>(contratos);
  const prazo = situacaoDoPrazo(trabalho);
  // A promessa de ponta a ponta: "quando o contrato fica pronto?", que é a pergunta do comercial.
  const emissao = prazoDeEmissao(trabalho);

  /**
   * Qual das duas ações este card oferece — `null` quando nenhuma.
   *
   * ⚠️ O ESTÁGIO PEDE, MAS O FATO DECIDE. O Lucas pediu "na entrada, gerar contrato; em contrato,
   * enviar para assinatura", e é isso que a ordem abaixo faz. Só que `enviar` também exige o
   * contrato vigente EXISTIR: um card que chegou à confecção sem nada gerado (o caso do Henrique,
   * que atravessou a esteira na marcação) mostraria um botão de enviar que só produz erro. Nesse
   * caso ele volta a oferecer `gerar`, que é o passo que de fato falta.
   *
   * ⚠️ E SÓ PARA CONTRATO. Cessão, distrato e cancelamento têm documento próprio e caminho
   * próprio; dar-lhes o botão de gerar contrato mandaria a minuta errada.
   */

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
        onClick={somenteLeitura ? undefined : (aoAbrir ?? undefined)}
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


        {/* ⚠️ "O DOCUMENTO EXISTE" É INFORMAÇÃO DE RELANCE, e por isso fica na FACE do card, não
            dentro do checklist. A pergunta de quem olha a coluna Confecção é "o que ainda não tem
            papel?" — se a resposta exigisse abrir card por card, o board voltaria a depender de
            memória. Vale nos dois boards: no do comercial ele responde "meu contrato saiu?", que é
            a pergunta que hoje vira ligação. */}
        {vigente ? (
          <p className="mt-1.5 flex items-center gap-1 text-[0.7rem] font-semibold text-emerald-700 dark:text-emerald-300">
            <FileCheck2 aria-hidden="true" className="shrink-0" size={11} />
            Contrato gerado
            {vigente.versao && vigente.versao > 1 ? ` · v${vigente.versao}` : ""}
            <span className="font-normal text-ink-muted">{dataCurta(vigente.criadoEm)}</span>
          </p>
        ) : null}
      </button>

      {/* ⚠️ O CARD NÃO EXPANDE MAIS. As versões do contrato, os dois botões, o rastro e a
          observação viviam aqui e agora moram na TELA DE TRABALHO — Lucas (09/09/2026): *"ao
          clicar no card abrisse uma tela de trabalho"*. Dois lugares para gerar o mesmo
          contrato seria pior do que um; o card volta a ser o que ele pediu: informativo. */}
    </article>
  );
}
