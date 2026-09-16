// QUEM ESTÁ OPERANDO A TÊMIS — o jurídico da Careli no hub ou o time do incorporador no portal.
//
// Decisões do Lucas (16/09/2026), sobre o portal da Cecílio Rocha: a venda feita pelo time dela vai
// para a confecção DELA, no portal (*"a Cecilio quem vai fazer é o proprio time deles"*), e a venda
// da Gurgel continua indo para a Têmis da Careli. Ela gera o contrato, manda assinar e edita os
// modelos dos produtos dela. Mesmo banco, mesmas tabelas, mesmo código: o que separa é o DONO do
// trabalho (`temis_trabalhos.operado_por`, migration 0172) e o ESCOPO de empreendimento.
//
// ⚠️ POR QUE UM "ATOR", E NÃO UM `if (portal)` EM CADA ROTA. A regra "um código só" pede que a rota
// do hub e a do portal chamem a MESMA função de `lib/`. O que muda entre as duas é quem está do
// outro lado: o hub chega pelo Bearer (papel no `hub_users`, enxerga todo empreendimento por
// desenho), o portal chega pelo cookie `apolo_inc` (escopo assinado no login). A função recebe o
// ator e pergunta a ele; a rota só monta o ator e devolve o que a função disse.
//
// ⚠️ TUDO AQUI É PURO. Sem banco, sem catálogo, sem sessão: é o que deixa a regra de alcance ser
// provada por teste sem mock nenhum. Quem monta o ator do portal (e expande os ids) é
// `autorizarTemisDoPortal`, em `portao-do-portal.ts`.

/** O time da Careli, pela Têmis do hub (Bearer do Apolo). Enxerga tudo, por desenho. */
export type AtorDoHub = {
  nome: string;
  /** O papel do `hub_users` (`admin`, `leader`...). Informativo: quem recorta papel é o portão. */
  papel: string;
  tipo: "hub";
  userId: string;
};

/** O time do incorporador que confecciona a própria venda (hoje só `cecilio-rocha`). */
export type AtorDoPortal = {
  /**
   * Os empreendimentos que a sessão alcança, JÁ EXPANDIDOS por `idsDaSessao`: o id do grupo mais
   * o de cada divisão, quando a sessão tem o grupo; só a divisão, quando a sessão tem só ela.
   *
   * ⚠️ QUEM MONTA O ATOR É QUEM EXPANDE. Esta lista entra pronta e `enterpriseNoAlcance` só
   * pergunta "está aqui?": montar o ator com os ids crus da sessão faria um card gravado no
   * consolidado sumir do portal de quem é dono do conjunto.
   */
  enterpriseIds: string[];
  /** `apolo_incorporadores.id`, conferido contra o cadastro pelo slug no portão. */
  incorporadorId: string;
  nome: string;
  slug: string;
  tipo: "portal";
  /** `apolo_incorporador_usuarios.id` — vai para `aberto_por` e para o registro de quem enviou. */
  usuarioId: string;
};

export type AtorDaTemis = AtorDoHub | AtorDoPortal;

export type OrigemDoAtor = "hub" | "portal";

/**
 * O ator do hub, a partir do que o portão do Apolo devolveu. A ÚNICA forma de montá-lo.
 *
 * ⚠️ POR QUE UMA FUNÇÃO SÓ (arrumação da onda 3, 16/09/2026). As rotas do contrato e da assinatura
 * montavam `{ nome, papel, tipo: "hub", userId }` à mão, cada uma com o seu jeito de tratar o nome
 * ausente. A primeira a esquecer o `?? ""` gravaria "null" como autor.
 *
 * `papel` é o recorte do PORTÃO que a rota usou (`leitura`, `escrita`, `coordenacao`, `emissao`):
 * `authorizeApolo*` devolve só `{ userId, nome }`, sem o papel do `hub_users`, e o campo é
 * informativo (quem recorta papel é o portão). Nome ausente vira texto vazio, e `nomeDoAutor` o
 * devolve como `null`: quem grava aceita a ausência, não inventa autor.
 */
export function atorDoHub(
  auth: { nome?: null | string; userId: string },
  papel: string,
): AtorDoHub {
  return { nome: auth.nome ?? "", papel, tipo: "hub", userId: auth.userId };
}

/** Texto aparado, ou vazio. Número vira texto: o C2X devolve id numérico e a Têmis guarda texto. */
function comoId(valor: unknown): string {
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  return typeof valor === "string" ? valor.trim() : "";
}

/**
 * O empreendimento está no alcance deste ator?
 *
 * Hub: sempre (o jurídico da Careli confecciona para todos os produtos).
 *
 * Portal: o id precisa estar na lista expandida. ⚠️ A EQUIVALÊNCIA É A DO PORTAL, E ELA É
 * ASSIMÉTRICA DE PROPÓSITO (ver `idsDaSessao` e `comIdsDoGrupo`): a sessão que tem o GRUPO alcança
 * o grupo e cada divisão dele; a sessão que tem só uma DIVISÃO alcança só a divisão, e NÃO o grupo.
 * Cada divisão pode ser de um dono diferente (VOC é da Cecílio, VOL é do Lino; LBF, LBR e LBP são
 * de três responsáveis). Aceitar o id do grupo porque um filho está no escopo deixaria a Cecílio
 * abrir, e EDITAR, a minuta gravada no consolidado, que vale também para os lotes do Lino.
 *
 * ⚠️ ID VAZIO NUNCA ESTÁ NO ALCANCE DO PORTAL. "Sem empreendimento" é a pergunta que um parâmetro
 * esquecido faz, e a resposta fail-closed é "não é seu".
 */
export function enterpriseNoAlcance(ator: AtorDaTemis, enterpriseId: unknown): boolean {
  if (ator.tipo === "hub") return true;

  const alvo = comoId(enterpriseId);
  if (!alvo) return false;

  return ator.enterpriseIds.some((id) => comoId(id) === alvo);
}

/** O mínimo de uma linha de `temis_trabalhos` para decidir o alcance (nomes das colunas). */
export type DonoDoTrabalho = {
  enterprise_id: unknown;
  operado_por: unknown;
};

/**
 * O trabalho está no alcance deste ator?
 *
 * Hub: sempre. O board da Careli ESCONDE, por padrão, o que um incorporador confecciona (ver
 * `trabalhosDoBoard`), mas o card continua abrindo pelo id: esconder da fila é organização, e a
 * supervisão da Careli sobre um contrato feito com a conta de assinatura dela não pode ser trancada.
 *
 * Portal: as DUAS condições. O dono tem de ser este incorporador E o empreendimento tem de estar no
 * escopo da sessão. Só o dono não basta: um usuário da Cecílio com recorte de conta menor que o do
 * portal não pode abrir o card de um produto que não é dele. Só o escopo não basta: a venda que a
 * Gurgel fez no VOC está no escopo da Cecílio e é confeccionada pela Careli.
 */
export function trabalhoNoAlcance(ator: AtorDaTemis, trabalho: DonoDoTrabalho): boolean {
  if (ator.tipo === "hub") return true;

  const dono = comoId(trabalho.operado_por).toLowerCase();
  if (!dono || dono !== comoId(ator.incorporadorId).toLowerCase()) return false;

  return enterpriseNoAlcance(ator, trabalho.enterprise_id);
}

/**
 * O nome que vai para `enviado_por_nome`, `gerado_por_nome` e afins.
 *
 * ⚠️ NULO QUANDO NÃO HÁ NOME, E NUNCA "Sistema". `hub_users.display_name` não é obrigatório, e a
 * nota de `ApoloAuthResult` já decidiu: quem grava aceita a ausência, não inventa autor.
 */
export function nomeDoAutor(ator: AtorDaTemis): null | string {
  const nome = typeof ator.nome === "string" ? ator.nome.trim() : "";
  return nome || null;
}

/** De que porta o ator veio. Vai para o registro de quem enviou e para o log. */
export function origemDoAtor(ator: AtorDaTemis): OrigemDoAtor {
  return ator.tipo;
}

/** O id de quem agiu, na coluna de autor (`aberto_por`, `quem`): o usuário do hub ou do portal. */
export function idDoAutor(ator: AtorDaTemis): string {
  return ator.tipo === "hub" ? ator.userId : ator.usuarioId;
}

/**
 * O `operado_por` de um trabalho que ESTE ATOR abre, e o recorte do board que ele enxerga.
 *
 * Hub: `null` (a Careli confecciona). Portal: o id do incorporador.
 *
 * ⚠️ NÃO É O CAMINHO DA VENDA DO PORTAL COMERCIAL. A Gurgel abre o trabalho pelas rotas de venda,
 * com a sessão dela, e lá quem decide é `portalConfeccionaContrato(slug, tipo)` — que devolve
 * `false` para o comercial. Este ator só existe para quem JÁ passou por esse predicado.
 */
export function operadoPorDoAtor(ator: AtorDaTemis): null | string {
  return ator.tipo === "hub" ? null : ator.incorporadorId;
}
