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
 * Duas situações acendem o botão, e confundi-las cria beco sem saída:
 *
 * 1. **Empreendimento NOVO marcado** — há algo a liberar. Habilitar de novo quem já está
 *    habilitada não muda uma linha do banco e só redispara o WhatsApp de boas-vindas; foi o clique
 *    repetido que motivou esta trava.
 *
 * 2. **O PAPEL não está `active`** — a imobiliária foi recusada, reaberta ou está em correção, e
 *    precisa ser (re)habilitada. Aqui os vínculos podem estar TODOS `verified`, porque reabrir a
 *    validação derruba o papel e deixa os vínculos como estavam.
 *
 * ⚠️ SEM A SEGUNDA CONDIÇÃO O BOTÃO NUNCA MAIS ACENDIA. Medido em 17/08: das 420 imobiliárias com
 * papel `active`, as 38 que têm vínculo de empreendimento têm 100% deles `verified`. Ou seja,
 * depois de um clique em "Reabrir validação" NENHUMA delas voltaria a ser habilitada pela tela —
 * o botão exigia um empreendimento novo que não existia, e o rodapé da imobiliária não tem outro
 * caminho. A rota sempre aceitou (o pedido `verified` cai em `jaHabilitados` e o papel volta a
 * `active`); era só a tela que não deixava chegar lá.
 */
export function podeHabilitar(
  lista: EmpreendimentoDaTela[],
  marcados: Record<string, boolean>,
  papelStatus?: null | string,
): boolean {
  if (empreendimentosNovos(lista, marcados).length > 0) return true;

  // Reativação: só faz sentido se ela tem algum empreendimento marcado para valer.
  const temAlgumMarcado = lista.some((item) => marcados[item.enterpriseId] === true);
  return papelStatus !== undefined && papelStatus !== "active" && temAlgumMarcado;
}

/** O botão está reativando um credenciamento derrubado, em vez de liberar produto novo? */
export function ehReativacao(
  lista: EmpreendimentoDaTela[],
  marcados: Record<string, boolean>,
  papelStatus?: null | string,
): boolean {
  return (
    papelStatus !== undefined &&
    papelStatus !== "active" &&
    empreendimentosNovos(lista, marcados).length === 0 &&
    lista.some((item) => marcados[item.enterpriseId] === true)
  );
}

// Tudo o que ela pediu já está liberado. É diferente de "você não marcou nada", e a tela precisa
// dizer as duas coisas com palavras diferentes: uma é estado, a outra é falta de ação.
export function tudoLiberado(lista: EmpreendimentoDaTela[]): boolean {
  return lista.length > 0 && lista.every((item) => item.habilitado);
}
