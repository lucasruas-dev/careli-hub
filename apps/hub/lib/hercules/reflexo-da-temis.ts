import type { EtapaDoFluxo } from "./fluxo-de-venda";

// O REFLEXO DA TÊMIS NO HÉRCULES — a tradução pura, sem banco.
//
// Lucas, 24/09/2026: *"preciso garantir que tudo que acontece na temis reflete no hercules, pode
// corrigir isso, o contrato da vitoria tem que estar em assinatura"*.
//
// ⚠️ ATÉ AQUI SÓ O CARD ANDAVA. Medido em produção em 24/09/2026: os 5 cards de contrato que a Nívea
// mandou para assinatura em 23/09 ficaram com a venda em `contrato` (5 de 5). `moverCardDaTemis`
// (lib/assinatura/estado-db.ts) movia `temis_trabalhos.estagio` e nada no Panteon avançava
// `hercules_propostas.etapa` depois de `contrato`; quem fazia isso era a carga do C2X, encerrada
// pelo Lucas em 21/09/2026.
//
// ⚠️ ESTE ARQUIVO SÓ RESPONDE "PARA ONDE A VENDA VAI, E DE ONDE ELA PODE SAIR". Quem escreve é
// `refletirCardNaVenda` (reflexo-da-temis-server.ts). Separado e puro pelo mesmo motivo de
// `cardAndouDepoisDe`: é a regra, e a regra se confere sem um duplo de Supabase inteiro. E puro
// também porque a tela pode querer a frase do aviso sem arrastar o cliente do banco.
//
// ⚠️ O VOCABULÁRIO É O MESMO DOS DOIS LADOS, E NÃO É COINCIDÊNCIA: `lib/temis/trabalhos.ts` declara
// que as etapas do card são "o mesmo do funil do Hércules". A tabela abaixo só existe porque o card
// tem duas etapas que a venda não tem (Análise e Pré-faturamento) e uma saída que não é etapa
// (Indeferido).

/** O pedaço da tabela de tradução que vale para UM movimento do card. */
export type TraducaoParaAVenda = {
  /** A etapa em que a venda tem de ficar depois deste movimento do card. */
  destino: EtapaDoFluxo;
  /**
   * De onde a venda pode sair para chegar ao destino. Lista CURTA de propósito: a venda nunca pula
   * duas etapas e nunca sai de `reservado` ou `proposta` por causa do card. Venda que já está no
   * destino não está nesta lista, e o reflexo devolve "já estava" sem escrever.
   */
  origensAceitas: readonly EtapaDoFluxo[];
};

/**
 * Para onde a venda vai quando o card de `tipo` sai de `estagioDe` para `estagioPara`.
 *
 * `null` = este movimento não mexe na venda, e o reflexo nem lê o banco.
 *
 * ⚠️ SÓ O CARD DE TIPO `contrato` REFLETE. O pedido de cancelamento ou de distrato tem dono próprio
 * (o motor `concluirCancelamentoDoCard`, que derruba a venda e solta o lote) e, enquanto corre, a
 * venda fica na etapa com a marca do pedido, de propósito (`fluxo-de-venda.ts`, a régua pinta
 * `em_cancelamento`). A cessão e o cancelamento por correção NUNCA mexem na venda nem soltam a
 * unidade: Lucas (02/09/2026), sobre a cessão, *"ae cancela o contrato antigo e nasce um novo nas
 * mesmas condições"*, e o intervalo entre os dois é onde a unidade ficaria sem dono.
 *
 * ⚠️ `indeferido` TAMBÉM É NULL: o indeferimento tem dono próprio, `devolverAQuemVendeu`
 * (indeferimento-na-venda-server.ts), com guardas que o reflexo não deve duplicar (pedido aberto,
 * outro card aberto, envelope vivo).
 *
 * ⚠️ O NASCIMENTO DO CARD (`estagioDe` nulo) TAMBÉM É NULL: quem abre o card de contrato é a rota
 * `venda/contrato/route.ts`, que já gravou a venda em `contrato` com o histórico na mesma operação.
 */
export function etapaDaVendaParaOCard(
  tipo: string,
  estagioDe: null | string,
  estagioPara: string,
): null | TraducaoParaAVenda {
  if (tipo !== "contrato") return null;
  if (!estagioDe) return null;
  if (estagioDe === estagioPara) return null;

  switch (estagioPara) {
    // ⚠️ ANÁLISE E CONTRATO DO CARD SÃO A MESMA ETAPA `contrato` DA VENDA. O card entra na Análise
    // por dois caminhos: nascendo (acima, null) ou voltando para correção. A volta de `assinatura`
    // ou de `prazo_legal` devolve a venda de `assinatura` para `contrato` — e isso não é enfeite:
    // sem ela, o Indeferir seguinte não devolve a venda a quem vendeu, porque `devolverAQuemVendeu`
    // só age em venda em `contrato`. Lucas (11-12/09/2026): *"pode cancelar o envelope"*;
    // *"prefaturamento pode desde que nao esteja todo assinado"*.
    //
    // ⚠️ SÓ A VOLTA PARA CORREÇÃO TIRA A VENDA DE `assinatura` (revisão de 24/09/2026). Ela é o único
    // caminho do card para a Análise vindo de Em assinatura ou do Pré-faturamento
    // (`retornarParaAnalise`, retorno-para-correcao.ts), e é o único que mata o envelope ANTES de o
    // card andar. Da coluna Contrato para a Análise a venda já está em `contrato`: nada a tirar de
    // `assinatura`, e uma venda lá é divergência que o log mostra.
    case "analise":
      return {
        destino: "contrato",
        origensAceitas: estagioDe === "assinatura" || estagioDe === "prazo_legal" ? ["assinatura"] : [],
      };

    // ⚠️ O GERAR NUNCA TIRA A VENDA DE `assinatura` (revisão de 24/09/2026). O card chega a Contrato
    // pelo Gerar (`contrato-servico.ts`, a partir da Análise) ou pela marcação de atividade, e nos dois
    // a venda já está em `contrato` ("já estava"). Aceitar `assinatura` aqui era o que deixava uma aba
    // velha com o card em Em assinatura levar a venda de volta para `contrato` com o envelope vivo ou
    // já assinado. `moverCardDaTemis` também não move mais o card para trás; esta lista vazia é a
    // segunda tranca, para o dia em que outro chamador aparecer.
    case "contrato":
      return { destino: "contrato", origensAceitas: [] };

    // ⚠️ O DEFEITO 1. Lucas (09/09/2026, docs/operations/temis-redesenho-decisoes.md): *"é quando
    // mandamos para assinar que é a proxima etapa"*. E Lucas (03/09/2026): *"quero ter os mesmos
    // status ... propostas, contrato assinatura faturamento"*.
    case "assinatura":
      return { destino: "assinatura", origensAceitas: ["contrato"] };

    // ⚠️ DECISÃO PENDENTE DO LUCAS: O PRÉ-FATURAMENTO NÃO TEM ETAPA NO HÉRCULES. O check de
    // `hercules_propostas.etapa` (0126) não tem nada entre `assinatura` e `faturado`, e a dobra do
    // C2X fechada com ele (lib/apolo/vendas.ts) também não. Lado conservador: a venda FICA em
    // `assinatura` até o card faturar. Aceita alcançar de `contrato` para o caso de o reflexo do
    // envio ter falhado (o webhook "assinado" é a segunda chance), e nunca vai além de `assinatura`.
    case "prazo_legal":
      return { destino: "assinatura", origensAceitas: ["contrato"] };

    // ⚠️ SÓ DE `assinatura`. De `contrato` a venda RECUSA e o log grita "venda atrasada": pular duas
    // etapas esconderia que o envio nunca refletiu. Lucas (09/09/2026): *"passado 7 dias da
    // assinatura e os pagamentos foram realizados, mover para ultima sessão de faturado"*.
    case "faturado":
      return { destino: "faturado", origensAceitas: ["assinatura"] };

    default:
      return null;
  }
}

/** Por que a venda não acompanhou o card. */
export type PorqueDoReflexoRecusado =
  | "escrita_falhou"
  | "etapa_fora_da_origem"
  | "leitura_falhou"
  | "mudou_no_meio"
  | "venda_desfeita";

/** O que aconteceu com a venda quando o card andou. */
export type ReflexoNaVenda =
  | { de: string; feito: "andou"; para: string }
  | { etapaLida: null | string; feito: "recusado"; porque: PorqueDoReflexoRecusado }
  | { feito: "ja_estava" | "nao_se_aplica" };

const FRASE_DO_PORQUE: Record<PorqueDoReflexoRecusado, string> = {
  escrita_falhou: "a gravação da venda falhou",
  etapa_fora_da_origem: "a venda não estava na etapa de onde este passo sai",
  leitura_falhou: "não deu para ler a venda",
  mudou_no_meio: "a venda mudou enquanto o card andava",
  venda_desfeita: "a venda já foi desfeita",
};

/**
 * A frase para a tela quando a venda NÃO acompanhou o card. `null` quando acompanhou (ou não tinha
 * o que acompanhar).
 *
 * ⚠️ É AVISO, NÃO ERRO. O card já andou e o fato do lado de fora já aconteceu (o envelope está ativo
 * na Clicksign, o envelope velho foi cancelado): trocar o `ok: true` por erro mandaria alguém clicar
 * de novo num envio que não se repete.
 */
export function avisoDoHercules(reflexos: readonly ReflexoNaVenda[]): null | string {
  const recusado = reflexos.find(
    (r): r is Extract<ReflexoNaVenda, { feito: "recusado" }> => r.feito === "recusado",
  );
  if (!recusado) return null;
  const onde = recusado.etapaLida ? ` Ela continua em "${recusado.etapaLida}" no Hércules.` : "";
  return `O card andou, mas a venda no Hércules não acompanhou: ${FRASE_DO_PORQUE[recusado.porque]}.${onde} Avise a Careli para conferir a etapa da venda.`;
}
