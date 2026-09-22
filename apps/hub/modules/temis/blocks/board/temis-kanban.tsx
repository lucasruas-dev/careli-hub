"use client";

import { AlertTriangle, Clock, FileCheck2, Loader2, MailX, PenLine } from "lucide-react";
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
import {
  acharQuadro,
  colunaDoCard,
  colunasDoQuadro,
  QUADRO_RESUMO,
  QUADROS,
  quadroDoTipo,
} from "@/lib/temis/quadros";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";
import { useApiDaTemis } from "@/modules/temis/api-da-temis";

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
//
// ⚠️ E O PORTAL QUE CONFECCIONA (Cecílio, 16/09/2026) NÃO USA NENHUMA DAS TRÊS. Lá o quadro é
// OPERÁVEL e abre a tela de trabalho, então a troca não pode ser só da rota da lista: todas as
// chamadas da tela de trabalho precisam da mesma porta. Quem troca é o `ApiDaTemisProvider`
// (`modules/temis/api-da-temis.tsx`) montado por cima: sem `rota`, a lista vem de `temisFetch`, que
// no hub é `/api/temis/trabalhos` com Bearer (o de sempre) e no portal é
// `/api/incorporador/temis/trabalhos` com o cookie. `rota` e `semToken` ficam para o board
// só-leitura do comercial, que lê outra rota e nunca abre a tela de trabalho.

type ContratoDoCard = {
  criadoEm: string;
  id: string;
  nome: string;
  observacao?: null | string;
  versao: null | number;
};

type TrabalhoDaTela = {
  /**
   * O ANDAMENTO DA ASSINATURA, EM TRÊS NÚMEROS — o que o card precisa dizer de relance.
   *
   * Lucas (12/09/2026): *"no card, gostaria de ter essa visao de quantas assinaturas ja foram
   * feitas, tipo 1/5"*.
   *
   * ⚠️ OPCIONAL DE PROPÓSITO, como `contratos` e `propostaId`. Enquanto a versão de produção da
   * rota não mandar o campo — e o board do portal comercial aponta para OUTRA rota —, o quadro
   * precisa continuar desenhando o card sem o selo, e não quebrar.
   *
   * ⚠️ `conviteNaoEntregue` NÃO É "ESTÁ DEMORANDO": é convite que BATEU E VOLTOU (o `bounce` da
   * Clicksign). Ver a nota do selo, no `Card`.
   *
   * ⚠️ OS TRÊS NOMES SÃO OS DE `ContagemDeAssinaturas` (`lib/temis/trabalhos-db.ts`), LETRA POR
   * LETRA, e isso não é preferência: o campo atravessa a rota como JSON, onde o TypeScript não
   * confere nada. Este bloco chegou a chamar o terceiro de `algumNaoEntregue` enquanto o servidor
   * mandava `conviteNaoEntregue` — typecheck limpo dos dois lados, e o selo vermelho do convite
   * devolvido simplesmente nunca acendia, que é a única coisa que o Lucas pediu para o card gritar.
   */
  assinaturas?: null | { assinaram: number; conviteNaoEntregue: boolean; total: number };
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
  /**
   * Quem confecciona: o uuid do incorporador que opera o card no portal dele, ou nulo (a Careli).
   * Opcional pelo mesmo motivo de `assinaturas`: o board só-leitura do comercial lê outra rota.
   */
  operadoPor?: null | string;
  /** A proposta de onde o contrato saiu. Quem envia para assinatura é a tela de trabalho. */
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
  incluirIncorporadores = false,
  rota,
  semToken = false,
  somenteLeitura = false,
}: {
  enterpriseId: null | string;
  /**
   * A SUPERVISÃO DA CARELI (decisão do Lucas, 16/09/2026, na fundação da Têmis do portal). O board
   * da Careli esconde, por padrão, o que o time de um incorporador confecciona no portal dele; com
   * isto ligado ele pede `?incluir=incorporadores` e os cards de fora voltam, com o selo
   * "Incorporador". Só na Têmis do hub: a rota do portal ignora o parâmetro, e o board só-leitura
   * do comercial (`rota`) nunca o manda.
   */
  incluirIncorporadores?: boolean;
  /**
   * De onde os cards vêm. O portal comercial aponta para a rota escopada pela sessão dele. Sem ela,
   * `/trabalhos` pela porta do `ApiDaTemisProvider` (sem provedor: `/api/temis/trabalhos`).
   */
  rota?: string;
  /**
   * Sem `Authorization`: quem autentica é o cookie same-origin (portal do incorporador).
   *
   * ⚠️ SÓ VALE JUNTO COM `rota`. Sem `rota`, a credencial é a do provedor — e só o provedor sabe
   * se a tela de trabalho que este quadro abre fala com o hub ou com o portal.
   */
  semToken?: boolean;
  /** Só olhar: checkbox travado e nenhum POST. */
  somenteLeitura?: boolean;
}) {
  const [trabalhos, setTrabalhos] = useState<null | TrabalhoDaTela[]>(null);
  /**
   * O quadro aberto. Começa no resumo, de propósito.
   *
   * Lucas, 21/09/2026: *"quando abrir essa parte do board da Têmis, a gente vai ter um todos e
   * nesse todos a gente terá três sessões somente (...) só para a gente ter um overview geral da
   * operação"*. Quem chega quer ver a operação inteira; quem vai trabalhar escolhe o serviço.
   */
  const [quadroId, setQuadroId] = useState<string>(QUADRO_RESUMO);
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
  /**
   * O recado de uma etapa que acabou de ser encerrada.
   *
   * ⚠️ ELE VIVE NO QUADRO, e não na tela que o produziu: a tela fecha no mesmo instante, e um aviso
   * que morre junto com quem o escreveu nunca chega a ser lido. Some sozinho depois de alguns
   * segundos — é confirmacao, nao alerta.
   */
  const [recado, setRecado] = useState<null | { pedeAcao: boolean; texto: string }>(null);

  // ⚠️ SÓ A CONFIRMAÇÃO SOME SOZINHA. O recado que PEDE AÇÃO (o lote não voltou para a
  // disponibilidade, um card ficou aberto, a venda não acompanhou) fica em âmbar até alguém fechar:
  // em oito segundos numa faixa verde ele era lido como "deu certo" (revisão de 18/09/2026).
  useEffect(() => {
    if (!recado || recado.pedeAcao) return;
    const relogio = setTimeout(() => setRecado(null), 8000);
    return () => clearTimeout(relogio);
  }, [recado]);

  const { temisFetch } = useApiDaTemis();

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const partes: string[] = [];
      if (enterpriseId) partes.push(`empreendimento=${encodeURIComponent(enterpriseId)}`);
      if (incluirIncorporadores && !rota) partes.push("incluir=incorporadores");
      const q = partes.length > 0 ? `?${partes.join("&")}` : "";
      let r: Response;
      if (rota) {
        const token = semToken ? null : await getApoloAccessToken();
        r = await fetch(`${rota}${q}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
      } else {
        r = await temisFetch(`/trabalhos${q}`);
      }
      const j = (await r.json()) as {
        data?: { estagios: Colunas; trabalhos: TrabalhoDaTela[] };
        error?: string;
      };
      if (!r.ok) throw new Error(j.error ?? `Falhou (${r.status}).`);
      setTrabalhos(j.data?.trabalhos ?? []);
      // ⚠️ AS COLUNAS NÃO VÊM MAIS DO SERVIDOR (`data.estagios`), e ele pode seguir mandando.
      // Quem as desenha é `colunasDoQuadro`, porque elas dependem do QUADRO aberto — e a lista
      // que o servidor manda é uma só, sem indeferido e com a palavra "Faturado" para todo tipo.
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui carregar o board.");
      setTrabalhos([]);
    }
  }, [enterpriseId, incluirIncorporadores, rota, semToken, temisFetch]);

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

  const quadro = useMemo(() => acharQuadro(quadroId), [quadroId]);
  const colunas = useMemo(() => colunasDoQuadro(quadro), [quadro]);

  /** Quantos cards cada quadro tem, para a aba dizer o tamanho antes de ser aberta. */
  const porQuadro = useMemo(() => {
    const conta = new Map<string, number>();
    for (const t of trabalhos ?? []) {
      conta.set(QUADRO_RESUMO, (conta.get(QUADRO_RESUMO) ?? 0) + 1);
      const doTipo = quadroDoTipo(t.tipo);
      conta.set(doTipo, (conta.get(doTipo) ?? 0) + 1);
    }
    return conta;
  }, [trabalhos]);

  const porEstagio = useMemo(() => {
    const mapa = new Map<string, TrabalhoDaTela[]>();
    for (const t of trabalhos ?? []) {
      // O quadro de um serviço mostra só os tipos dele; o resumo mostra todos.
      if (quadro.tipos.length > 0 && !quadro.tipos.includes(t.tipo)) continue;
      const chave = colunaDoCard(quadro, t.estagio);
      const lista = mapa.get(chave) ?? [];
      lista.push(t);
      mapa.set(chave, lista);
    }
    return mapa;
  }, [quadro, trabalhos]);

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
    // posiciona: sem isso, a tela de trabalho herdava a do QUADRO — que encolhe quando há poucos
    // cards — e a análise inteira ficava espremida numa faixa de uns 600px, rolando por dentro com
    // a metade de baixo da janela vazia. Lucas (10/09/2026 e de novo 11/09/2026): *"a tela está
    // cortando"*.
    //
    // ⚠️ ERA UM CHUTE, E ERRAVA POR UNS 50px. O `min-h-[calc(100vh-10rem)]` supunha 160px de cromo
    // acima do quadro; o cromo real é 3,25rem da topbar + 2rem do padding do main + 1,5rem do p-3
    // da TemisPage ≈ 108px. Agora não se chuta: aqui só se diz "ocupe o que sobrou" (`flex-1`
    // dentro do `flex flex-col` que a TemisPage passou a ser).
    //
    // ⚠️ MAS A ALTURA NÃO DESCE SOZINHA DE PAI PARA FILHO, e este comentário afirmava que sim.
    // `flex-1` é `flex: 1 1 0%` num pai de altura INDEFINIDA (`min-h-full` é mínimo, não altura):
    // a base 0% não tem de quê ser porcentagem, então a caixa resolve por `max-content` — ou seja,
    // pela coluna de cards mais alta. Medido a 1920x900 com a tela de trabalho aberta: 2 cards dão
    // 738px de overlay, 9 cards dão 925px e o botão dourado do envio nasce em y 1099, FORA da
    // janela, e 16 cards dão 1606px. Hoje a Têmis tem 2 cards e ninguém viu — mas ela enche. O
    // `max-h-full` é o teto que faltava: o overlay nunca passa do painel, e quem rola é a tela de
    // trabalho por dentro, como ela já sabe fazer.
    //
    // ⚠️ E O TETO SÓ VALE PORQUE A `TemisPage` DÁ ALTURA AO PAI. `max-height: 100%` contra um pai de
    // altura indefinida resolve como `none`, ou seja: sozinho, este `max-h-full` seria um conserto
    // que não conserta nada. Quem fecha a conta é o `has-[[data-temis-trabalho]]:h-full` do div que
    // embrulha este componente lá — mexer num dos dois sem o outro devolve o overlay de 1606px.
    //
    // ⚠️ O `overflow-hidden` SÓ É SEGURO PORQUE OS MODAIS DESTA SUBÁRVORE SÃO `position: fixed` —
    // a prévia do contrato e o visor de documento se posicionam pela janela, não por este `div`, e
    // por isso não são cortados por ele. Um painel novo aqui dentro que use `absolute` precisa
    // caber, ou volta a sumir sem erro nenhum.
    <div
      className={`relative flex flex-col gap-3 ${
        emTrabalho ? "max-h-full min-h-0 flex-1 overflow-hidden" : ""
      }`}
    >
      {emTrabalho ? (
        <TelaDeTrabalho
          aoConcluir={(texto, pedeAcao) => {
            // A ordem importa: o recado primeiro, a volta depois. Fechar a tela antes faria o
            // quadro aparecer em branco por um instante e só então mostrar o aviso.
            setRecado({ pedeAcao: Boolean(pedeAcao), texto });
            void carregar();
            setEmTrabalho(null);
          }}
          aoFechar={() => setEmTrabalho(null)}
          aoMudar={() => void carregar()}
          trabalhoId={emTrabalho}
        />
      ) : null}
      {/* ⚠️ O RECADO FICA NO TOPO E EM VERDE: e a confirmacao de que a etapa fechou. Sem ele, gerar
          o contrato parecia nao ter feito nada — o modal fechava e o quadro voltava igual. */}
      {recado && !recado.pedeAcao ? (
        <p className="flex items-start gap-2 rounded-lg border border-emerald-300/70 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
          <FileCheck2 aria-hidden="true" className="mt-0.5 shrink-0" size={15} /> {recado.texto}
        </p>
      ) : null}
      {recado && recado.pedeAcao ? (
        <div
          className="flex items-start gap-2 rounded-lg border border-amber-400/70 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-950 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100"
          role="alert"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={15} />
          <span className="flex-1">{recado.texto}</span>
          <button
            aria-label="Fechar o aviso"
            className="shrink-0 rounded px-1.5 text-xs font-semibold underline-offset-2 hover:underline"
            onClick={() => setRecado(null)}
            title="Fechar o aviso"
            type="button"
          >
            Fechar
          </button>
        </div>
      ) : null}
      {erro ? (
        <p className="flex items-start gap-2 rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-ink dark:border-red-500/40 dark:bg-red-500/10">
          <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={14} /> {erro}
        </p>
      ) : null}

      {/* ⚠️ UM QUADRO POR SERVIÇO, e o resumo na frente. Antes era um quadro só, com contrato,
          cessão, distrato, cancelamento e correção de fluxo misturados nas mesmas colunas — e
          serviços de caminho diferente dividindo coluna fazem a fila de um parecer a do outro. */}
      <div className="flex flex-wrap gap-1.5">
        {QUADROS.filter((q) => {
          // ⚠️ NO PORTAL, ABA VAZIA NÃO APARECE. Lá o incorporador só acompanha o contrato dele
          // (`somenteLeitura`), e "Cessão de direitos" ou "Correção de fluxo" zeradas seriam três
          // abas que ele nunca vai abrir. Na Têmis todas ficam: o quadro é o mapa do trabalho, e
          // uma aba que some faz quem opera achar que o serviço não existe.
          if (!somenteLeitura) return true;
          return q.id === QUADRO_RESUMO || (porQuadro.get(q.id) ?? 0) > 0;
        }).map((q) => {
          const aberto = q.id === quadro.id;
          const quantos = porQuadro.get(q.id) ?? 0;
          return (
            <button
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                aberto
                  ? "bg-ink text-white dark:bg-white dark:text-ink"
                  : "border border-line text-ink-muted hover:bg-subtle"
              }`}
              key={q.id}
              onClick={() => setQuadroId(q.id)}
              type="button"
            >
              {q.nome}
              <span className="ml-1.5 opacity-70">{quantos}</span>
            </button>
          );
        })}
      </div>

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
                      mostrarDono={incluirIncorporadores && !rota}
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

      {/* ⚠️ O MODAL DE ENVIO NÃO MORA MAIS AQUI. Ele era montado neste ponto e aberto por uma prop
          da tela de trabalho, `aoEnviarParaAssinatura(trabalhoId)` — e o nome MENTIA: o destino
          espera o id da PROPOSTA e o callsite mandava `card.id`. Em produção (11/09/2026) isso
          respondia "Esta proposta ainda não tem contrato gerado" com o PDF aberto na tela ao lado.
          Agora quem organiza e envia é a `OrganizacaoDaAssinatura`, dentro da etapa contrato, que
          recebe a proposta e nada mais — não há mais um id atravessando o quadro para se trocar
          pelo outro. */}
    </div>
  );
}

function Card({
  aoAbrir,
  mostrarDono,
  somenteLeitura,
  trabalho,
}: {
  /** `null` no board só-leitura do portal comercial: lá o card não abre tela de trabalho. */
  aoAbrir: null | (() => void);
  /**
   * Pinta o selo "Incorporador" no card confeccionado fora da Careli. Só na supervisão: no quadro
   * do próprio portal todo card é dele, e o selo em todos não diria nada.
   */
  mostrarDono: boolean;
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
          <span className="flex min-w-0 items-center gap-1">
            <span
              className={`rounded-full px-1.5 py-0.5 text-[0.65rem] font-bold ${CLASSE_DO_TIPO[trabalho.tipo]}`}
            >
              {NOME_DO_TIPO[trabalho.tipo]}
            </span>
            {/* ⚠️ O SELO DIZ QUEM CONFECCIONA, E NÃO QUEM VENDEU. A venda da Gurgel no produto da
                Cecílio é da Careli e não ganha selo; o card aberto pelo time da Cecílio, no portal
                dela, ganha. A Careli supervisiona sem confundir com a fila dela. */}
            {mostrarDono && trabalho.operadoPor ? (
              <span
                className="rounded-full border border-line bg-subtle px-1.5 py-0.5 text-[0.65rem] font-bold text-ink-muted"
                title="Confeccionado pelo time do incorporador, no portal dele."
              >
                Incorporador
              </span>
            ) : null}
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

        {/* ⚠️ O CONTADOR DE ASSINATURAS, NA MESMA RÉGUA DO "Contrato gerado" — Lucas (12/09/2026):
            *"no card, gostaria de ter essa visao de quantas assinaturas ja foram feitas, tipo
            1/5"*. Até aqui a coluna "Em assinatura" era uma pilha de cards idênticos: quem olhava
            não sabia se faltava um signatário ou os cinco.

            ⚠️ E O CONVITE QUE VOLTOU PINTA DE VERMELHO, no mesmo vermelho do atraso logo acima —
            porque não é espera, é PROBLEMA. Medido em produção (12/09/2026, envelope
            `3e9a331d`): o contrato da Beatriz foi para dois signatários, o e-mail do segundo não
            existe (`550 5.1.1 ... NoSuchUser`), a Clicksign devolveu `bounce` quatro segundos
            depois do envio e a tela dizia só "Parcialmente assinado". Um convite que bateu e
            voltou NUNCA vira assinatura sozinho: sem cor, o card ficaria parado para sempre com
            cara de normal, e a fila envelheceria esperando alguém que não foi avisado. O conserto
            é humano — voltar para análise, corrigir o e-mail e mandar de novo.

            ⚠️ OS DOIS FATOS CONVIVEM NA MESMA LINHA, e a primeira versão TROCAVA um pelo outro —
            Lucas (12/09/2026), vendo o card: *"além do não enviado, o assinado; nesse que está com
            1/2 não entregue teve uma assinatura"*. O selo dizia "1/2 convite não entregue" e a
            assinatura que EXISTE sumia da leitura: o número ficava órfão, encostado numa frase que
            fala de outra coisa. São duas perguntas — quanto já andou, e o que travou.

            ⚠️ E O VERMELHO DISPENSA A FRASE: *"não precisa da frase, convite não entregue, só de
            ser vermelho a gente sabe"*. O card é leitura de relance, e cinco palavras a mais em
            cada card custam a varredura da coluna inteira. O envelope riscado vermelho já diz; o
            nome do fato vive no `title` e no `aria-label`, para quem passa o mouse e para quem
            usa leitor de tela — a mesma régua dos botões só-ícone do topo da tela de trabalho.

            ⚠️ O VERDE É O QUE O CARD JÁ USA para "Contrato gerado" (`text-emerald-700`), e o
            vermelho o que o quadro já usa para erro (`text-red-600`, o mesmo do prazo estourado).
            Nenhum tom novo: o rosa deste card já significa OUTRA coisa — o tipo que desfaz a
            venda (cancelamento, distrato). */}
        {trabalho.assinaturas ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-[0.7rem] font-semibold">
            <span
              className="flex items-center gap-1 text-emerald-700 dark:text-emerald-300"
              title={`${trabalho.assinaturas.assinaram} de ${trabalho.assinaturas.total} assinaram.`}
            >
              <PenLine aria-hidden="true" className="shrink-0" size={11} />
              <span className="tabular-nums">
                {trabalho.assinaturas.assinaram}/{trabalho.assinaturas.total}
              </span>
              assinaram
            </span>

            {trabalho.assinaturas.conviteNaoEntregue ? (
              <MailX
                aria-label="Um convite não foi entregue: o e-mail voltou. Essa assinatura não chega sozinha — abra o card para ver de quem é e corrigir o endereço."
                className="shrink-0 text-red-600 dark:text-red-400"
                size={12}
              />
            ) : null}
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
