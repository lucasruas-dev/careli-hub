// A FRONTEIRA ENTRE O HUB E A PORTA DE FORA — uma pergunta, uma resposta, um arquivo.
//
// O `apps/hub` serve DOIS públicos no mesmo domínio: o time da casa, que faz login no Panteon, e
// quem está de fora — o coordenador da Gurgel, o incorporador, o corretor que recebeu o link do
// espelho, o cliente na fila do lançamento. São telas do mesmo app, com a mesma build, e a única
// coisa que as separa é o CAMINHO.
//
// ⚠️ ISTO EXISTE PORQUE A MESMA FALTA CUSTOU DOIS DEFEITOS NO MESMO DIA (14/09/2026), e os dois
// foram o time comercial batendo na porta errada:
//
//   1. *"o time comercial está tentando logar, contudo quando eles coloca a url da gurgel em vez
//      de aparecer a tela de login da gurgel está aparecendo a do panteon"*. O portal comercial
//      ganhou endereço próprio (`/comercial/<slug>`) em 02/09, e a lista de exceções do
//      `auth-provider` tinha só `/incorporador` — então o AuthProvider mandava o coordenador para
//      o login do Panteon, onde ele não tem conta.
//
//   2. *"ligação do hub não pode aparecer no perfil gurgel"*. O banner de chamada do Hermes, com
//      NOME e FOTO de quem ligou e o botão de aceitar, desenhava por cima do portal — e a página
//      do parceiro ainda abria um canal de realtime do hub.
//
// Duas listas diferentes, mantidas em lugares diferentes, esquecidas na mesma semana. A resposta
// não é uma terceira lista: é esta, com um teste que QUEBRA A BUILD quando alguém cria uma rota de
// topo e não diz de que lado ela fica ([[superficie.test.ts]]).
//
// ⚠️ A CLASSIFICAÇÃO É POR RAIZ, E DE PROPÓSITO. Uma rota não vira externa por acaso, no meio da
// árvore: ou o diretório de topo é uma porta de fora, ou não é. A única exceção é o Chronos, que
// tem sala pública dentro de uma área interna — e ela está escrita aqui embaixo, nomeada.

/**
 * As raízes que servem QUEM ESTÁ DE FORA.
 *
 * Nenhuma delas exige sessão do hub, e nenhuma pode receber nada que o hub desenhe por cima.
 */
export const RAIZES_EXTERNAS = [
  // O portal do coordenador: c2x.app.br/comercial/gurgel. Cookie próprio (`apolo_inc`).
  "comercial",
  // O espelho público no endereço curto: /e/vale-do-ouro-3f9c2a7b. Autoriza pelo selo na URL.
  "e",
  // A fila e o telão do lançamento. O operador do Prometeu tem conta própria, não é do hub.
  "evento",
  // O portal do dono do loteamento: /incorporador/<slug>. Mesmo cookie do comercial.
  "incorporador",
  // Páginas públicas por desenho: CAD do corretor, credenciamento de imobiliária, painel.
  "publico",
  // A TV do stand de vendas: /tv/garden. Não é o hub em tela grande — é um telão que fica ligado o
  // dia todo numa televisão do salão, sem teclado, sem login e sem ninguém operando. Quem autoriza
  // é a lista curta de `lib/hercules/espelho/telas-de-tv.ts`, e não uma sessão.
  "tv",
] as const;

/**
 * As raízes do HUB — o que só existe depois do login do Panteon.
 *
 * ⚠️ `m` É O HUB NO CELULAR, e não uma porta de fora: mesma conta, mesmo dado, tela menor.
 */
export const RAIZES_INTERNAS = [
  "agenda",
  "apolo",
  "ares",
  "atlas",
  "boletos",
  "caredesk",
  "chronos",
  "compras",
  "contatos",
  "drive",
  "financeiro",
  "guardian",
  "hades",
  "hermes",
  "iris",
  "lsoft",
  "m",
  "prometeu",
  "pulsex",
  "setup",
  "squadops",
  "temis",
  "zeus",
] as const;

/**
 * O que não é nem um nem outro, e por quê.
 *
 * `api` não é tela — são as rotas de servidor, e cada uma decide sozinha quem autoriza. `login` é
 * a porta do próprio hub: ela não exige sessão (seria circular) e também não é lugar de overlay.
 */
export const RAIZES_SEM_LADO = ["api", "login"] as const;

/** A primeira parte do caminho, sem barra. `/comercial/gurgel` → `comercial`. */
export function raizDaRota(pathname: null | string): string {
  return (pathname ?? "").split("/").filter(Boolean)[0] ?? "";
}

/**
 * A sala pública do Chronos — a exceção nomeada.
 *
 * O Chronos é área interna, mas a SALA de uma reunião abre para quem foi convidado, que quase
 * nunca é da casa: `/chronos/<sala>` e a visualização de gravação. Duas partes exatas no caminho,
 * porque `/chronos` sozinho é a agenda do time, e `/chronos/<sala>/algo` não existe.
 */
export function ehSalaPublicaDoChronos(pathname: null | string): boolean {
  if (!pathname) return false;
  if (pathname.startsWith("/chronos/recording-view")) return true;
  const partes = pathname.split("/").filter(Boolean);
  return partes.length === 2 && partes[0] === "chronos";
}

/**
 * Esta tela é de quem está DE FORA?
 *
 * ⚠️ A RAIZ DESCONHECIDA CAI AQUI COMO `false`, e quem decide o que fazer com isso é cada
 * chamador — ver `ehSuperficieDoHub`, que é a pergunta que falha fechada.
 */
export function ehRotaExterna(pathname: null | string): boolean {
  const raiz = raizDaRota(pathname);
  if ((RAIZES_EXTERNAS as readonly string[]).includes(raiz)) return true;
  return ehSalaPublicaDoChronos(pathname);
}

/**
 * Esta tela é o HUB — o lugar onde o que é da casa pode aparecer?
 *
 * ⚠️ FALHA FECHADA, E É O PONTO DESTE ARQUIVO. Só devolve `true` para raiz que alguém escreveu na
 * lista interna. Rota nova que ninguém classificou responde `false`: ela nasce SEM o banner de
 * chamada, SEM o toast da central e SEM o canal de realtime — nasce sem vazar. O preço é o
 * contrário do vazamento: um recurso interno que não aparece até alguém acrescentar a raiz, e
 * isso é visível no primeiro uso, enquanto vazamento só aparece quando o cliente reclama.
 *
 * A raiz vazia (`/`) é a Home do hub, e entra.
 */
export function ehSuperficieDoHub(pathname: null | string): boolean {
  const raiz = raizDaRota(pathname);
  if (raiz === "") return true;
  if (ehRotaExterna(pathname)) return false;
  return (RAIZES_INTERNAS as readonly string[]).includes(raiz);
}
