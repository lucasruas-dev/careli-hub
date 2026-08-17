// EM QUE PONTO DA TRILHA A IMOBILIÁRIA ESTÁ, e quando o botão de habilitar faz sentido.
//
// ⚠️ A IMOBILIÁRIA NÃO TEM LINHA EM `apolo_esteira` (medido em 17/08/2026: 435 de 435 sem
// esteira). O estado dela vive em dois lugares, porque nenhum dos dois sozinho comporta os
// quatro desfechos:
//   • `apolo_entity_profiles.status` -> active = habilitada · review = em validação ·
//     blocked = recusada (o CHECK da coluna só aceita active | review | blocked | archived);
//   • `apolo_entities.status`        -> attention = esperando a imobiliária corrigir algo
//     (não existe valor de "correção" no CHECK do papel, então essa metade mora aqui).
//
// Este arquivo é só a REGRA, sem banco e sem React: é o que dá para testar e o que impede a
// tela de inventar uma terceira definição de "habilitada".

// A trilha da imobiliária é `Validação -> Habilitada`. Quem passou pelas duas está CONCLUÍDA, e
// concluída é `total`, não `total - 1`: é o mesmo tratamento que a CAD credenciada recebe
// (board-view: `credenciado` vale `etapas.length`), e é o que pinta as duas bolinhas de verde,
// mostra o selo "Apta" e tira da tela os botões de decisão.
//
// Antes daqui a imobiliária habilitada era semeada na POSIÇÃO da etapa "Habilitada" (1), o que a
// deixava como *etapa atual*: bolinha cinza com o número 2, o painel pedindo uma decisão que já
// tinha sido tomada e um botão "Habilitar imobiliária" que só sabia mostrar um aviso. Foi o que o
// Lucas viu em 17/08 na ficha da EDSON LUIZ BARBOSA 06914662622, já habilitada.
export function posicaoDaImobiliaria(input: {
  entidadeStatus?: null | string;
  papelStatus?: null | string;
  // Quantas etapas a trilha dela tem na tela (hoje 2). Vem de fora para a regra não repetir a
  // lista de etapas que o Board desenha.
  totalEtapas: number;
}): null | number {
  // Sem papel carregado não há o que afirmar: devolver 0 aqui empurraria para "Validação" uma
  // ficha cujo estado a tela simplesmente ainda não sabe, e a posição da sessão seria perdida.
  if (!input.papelStatus) {
    return null;
  }

  if (input.papelStatus === "active") {
    return input.totalEtapas;
  }

  // review, blocked, archived e a correção (`attention` na entidade) são todos ANTES da decisão
  // ou a decisão desfeita: a trilha volta para a Validação, que é onde o trabalho está.
  return 0;
}

// Uma linha da lista de empreendimentos que a tela mostra ao operador.
export type EmpreendimentoDaTela = { enterpriseId: string; habilitado: boolean };

// O que este clique VAI liberar de novo. Marcar um empreendimento que já está habilitado não
// libera nada: só redispara a mensagem.
export function empreendimentosNovos(
  lista: EmpreendimentoDaTela[],
  marcados: Record<string, boolean>,
): string[] {
  return lista
    .filter((item) => !item.habilitado && marcados[item.enterpriseId] === true)
    .map((item) => item.enterpriseId);
}

/**
 * PODE HABILITAR?
 *
 * ⚠️ SÓ QUANDO HÁ EMPREENDIMENTO NOVO MARCADO. Habilitar de novo quem já está habilitada não
 * muda uma linha do banco, mas DISPARA OUTRA VEZ o WhatsApp de boas-vindas para a imobiliária e
 * para o coordenador do empreendimento (a rota avisa depois de gravar, sem olhar se algo mudou).
 * O clique repetido já aconteceu, e é por isso que a trava é da regra e não do capricho da tela.
 *
 * O caminho legítimo continua aberto: imobiliária já credenciada que pede um empreendimento NOVO
 * ganha um vínculo pendente, ele aparece desmarcado na lista, e aí sim há algo a liberar.
 */
export function podeHabilitar(
  lista: EmpreendimentoDaTela[],
  marcados: Record<string, boolean>,
): boolean {
  return empreendimentosNovos(lista, marcados).length > 0;
}

// Tudo o que ela pediu já está liberado. É diferente de "você não marcou nada", e a tela precisa
// dizer as duas coisas com palavras diferentes: uma é estado, a outra é falta de ação.
export function tudoLiberado(lista: EmpreendimentoDaTela[]): boolean {
  return lista.length > 0 && lista.every((item) => item.habilitado);
}
