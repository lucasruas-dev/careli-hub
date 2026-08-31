// DOIS PROJETOS DENTRO DA MESMA CASCA, e eles NÃO se misturam.
//
// Regra do Lucas (17/08/2026): *"o portal da Cecílio é um projeto separado desse, são duas coisas
// diferentes. Na Cecílio estou desenvolvendo um sistema PERSONALIZADO para eles... podemos
// aproveitar ideias, lógicas, mas não pode afetar o comportamento que já fizemos na Cecílio, que
// eu já aprovei, que o cliente está usando. O que estamos fazendo aqui é o que vai ser PADRÃO"*.
//
// ⚠️ POR QUE ISTO EXISTE COMO CÓDIGO, e não como combinado: o portal é UM componente só. Mudar as
// abas, o mapa ou qualquer default mexe nos dois ao mesmo tempo — foi o que aconteceu quando o
// PADRÃO perdeu a aba Produtos e o mapa do Vale do Ouro: o Cecílio, que está no ar e aprovado,
// perderia as duas coisas junto, sem ninguém ter pedido.
//
// Quem está aqui fica CONGELADO no comportamento aprovado. Toda mudança do padrão passa ao largo.
// Sair desta lista é decisão do Lucas, não consequência de um refactor.
const PERSONALIZADOS = new Set(["cecilio-rocha"]);

/** Este portal é um projeto personalizado (congelado) ou o padrão? */
export function ehPortalPersonalizado(slug: string): boolean {
  return PERSONALIZADOS.has(String(slug ?? "").trim().toLowerCase());
}

// PORTAL SÓ DE PRODUTOS — o sócio que enxerga o produto, não a operação.
//
// Pedido do Lucas (28/08/2026) para a MMendes Empreendimentos, sócia da Cecílio Rocha no Garden:
// *"quero criar um perfil igual a cecilio para o socio deles. só que por enquanto deixa somente a
// tela de produto e o produto somente o garden"*.
//
// ⚠️ POR QUE É UMA LISTA E NÃO UMA COLUNA NO BANCO: hoje é um caso e a regra é "por enquanto".
// Coluna nova vira contrato permanente e migration; a lista deixa o recorte explícito no código,
// onde quem for mexer nas abas TROPEÇA nela. Quando virar produto de verdade — vários sócios, cada
// um com seu conjunto de abas —, aí sim vale a tabela. Ver [[project_portal_incorporador_dois_projetos]].
//
// ⚠️ O ESCOPO DO EMPREENDIMENTO NÃO MORA AQUI. "Só o Garden" é o vínculo em
// `apolo_incorporador_empreendimentos`, que já limita TODAS as leituras do portal. Esta lista
// decide apenas quais ABAS aparecem — se um dia a MMendes ganhar outro empreendimento, ela vê o
// novo na aba Produtos sem precisar de deploy.
const SO_PRODUTOS = new Set(["mmendes"]);

/** Portal que enxerga SOMENTE a aba Produtos (sem CRM, Vendas nem Carteira). */
export function ehPortalSoProdutos(slug: string): boolean {
  return SO_PRODUTOS.has(String(slug ?? "").trim().toLowerCase());
}

/**
 * O portal leva a marca do CLIENTE na porta, sem a assinatura do Panteon em cima?
 *
 * ⚠️ Pedido do Lucas (31/08/2026), vendo o login da MMendes: *"nesses perfis que vamos fazer
 * personalizado, pode tirar a logo do panteon por favor"*.
 *
 * ⚠️ POR QUE NÃO É `ehPortalPersonalizado` DIRETO. Aquela lista significa "congelado no
 * comportamento aprovado", e é ela que protege o Cecílio de mudanças no padrão. Esta pergunta é
 * outra: "de quem é a porta". Hoje as duas respostas coincidem, mas amarrar as duas faria um
 * portal novo herdar o congelamento do Cecílio só porque quis a própria marca no login — e aí
 * ele pararia de receber as melhorias do padrão sem ninguém ter pedido.
 */
export function portalAssinaPanteon(slug: string): boolean {
  return !ehPortalPersonalizado(slug) && !ehPortalSoProdutos(slug);
}

// ⚠️ NÃO ACRESCENTE SLUG AQUI PARA "RESOLVER" UM PROBLEMA DO PADRÃO. Cada entrada é uma versão a
// mais para manter viva, e a que ninguém olha é a que apodrece. A lista existe para proteger o que
// JÁ FOI aprovado e entregue, não para adiar decisão de produto.
