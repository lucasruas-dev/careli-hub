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

// ⚠️ NÃO ACRESCENTE SLUG AQUI PARA "RESOLVER" UM PROBLEMA DO PADRÃO. Cada entrada é uma versão a
// mais para manter viva, e a que ninguém olha é a que apodrece. A lista existe para proteger o que
// JÁ FOI aprovado e entregue, não para adiar decisão de produto.
