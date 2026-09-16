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
// Quem está aqui NÃO RECEBE as mudanças do padrão por tabela. Toda mudança do padrão passa ao
// largo. Sair desta lista é decisão do Lucas, não consequência de um refactor.
//
// ⚠️ DESDE 16/09/2026 O CECÍLIO NÃO É MAIS "CONGELADO": É ONDE SE DESENVOLVE PARA O CLIENTE. O
// Lucas decidiu, olhando o /comercial/gurgel: *"como é um projeto personalizado quero fazer tudo no
// portal Cecilio que tem a logo deles"*. O `cecilio-rocha` virou a RÉPLICA do Hércules operada pelo
// próprio time da Cecílio (ver `portalOperaVenda`, abaixo), e o portal `cer` (o que rodava no
// padrão) será pausado. O que continua valendo desta lista é a direção da proteção: o PADRÃO não
// passa por cima dele; quem muda o Cecílio é pedido explícito do Lucas para o Cecílio.
//
// ⚠️ O COMPORTAMENTO DE `ehPortalPersonalizado` NÃO MUDOU com essa decisão: ela ainda decide o tema
// de partida (seguir o aparelho, em vez do escuro do padrão) e a porta sem a assinatura do Panteon.
// O que mudou foi o PAPEL do portal, e esse mora em `portalOperaVenda`.
const PERSONALIZADOS = new Set(["cecilio-rocha"]);

/** Este portal é um projeto personalizado (fora do alcance do padrão) ou o padrão? */
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
 * ⚠️ POR QUE NÃO É `ehPortalPersonalizado` DIRETO. Aquela lista significa "fora do alcance do
 * padrão", e é ela que protege o Cecílio de mudanças no padrão. Esta pergunta é
 * outra: "de quem é a porta". Hoje as duas respostas coincidem, mas amarrar as duas faria um
 * portal novo herdar a blindagem do Cecílio só porque quis a própria marca no login — e aí
 * ele pararia de receber as melhorias do padrão sem ninguém ter pedido.
 */
export function portalAssinaPanteon(slug: string, tipo?: null | string): boolean {
  // O portal COMERCIAL veste a marca do time (a Gurgel), e não a do Panteon — Lucas, 02/09/2026:
  // *"para esse perfil da Gurgel, quero que use a logo deles no lugar da logo do Panteon"*.
  if (ehPortalComercial(tipo)) return false;
  return !ehPortalPersonalizado(slug) && !ehPortalSoProdutos(slug);
}

// ⚠️ NÃO ACRESCENTE SLUG AQUI PARA "RESOLVER" UM PROBLEMA DO PADRÃO. Cada entrada é uma versão a
// mais para manter viva, e a que ninguém olha é a que apodrece. A lista existe para proteger o que
// JÁ FOI aprovado e entregue, não para adiar decisão de produto.

// O TIPO DO PORTAL — gravado em `apolo_incorporadores.tipo` (migration 0122).
//
// Pedido do Lucas (02/09/2026): *"queria dentro do setup nosso, igual a tela do incorporador uma
// tela de Comercial, aí vou fazendo os perfis, todos terão o mesmo link, final do
// c2x.app.br/gurgel, o que vai mudar são os acessos"*.
//
// ⚠️ É COLUNA, E NÃO MAIS UMA LISTA DE SLUG AQUI EM CIMA. As listas acima dizem, com razão, que
// servem para "um caso, por enquanto". Vários coordenadores, cada um com o próprio recorte de
// empreendimentos, é produto de verdade — e produto de verdade mora no banco, onde o Setup grava
// sem deploy. Ver [[project_hercules_portal_comercial]].
export type TipoDePortal = "comercial" | "incorporador";

/** Normaliza o que veio do banco (ou de um cookie antigo, que não tinha o campo). */
export function tipoDePortal(valor: unknown): TipoDePortal {
  return valor === "comercial" ? "comercial" : "incorporador";
}

/** O HÉRCULES: o time comercial da Careli operando (reserva, proposta, contrato, lançamento). */
export function ehPortalComercial(tipo: null | string | undefined): boolean {
  return tipo === "comercial";
}

// O INCORPORADOR QUE OPERA A PRÓPRIA VENDA — o Hércules sem a Careli no meio.
//
// Pedido do Lucas (16/09/2026), olhando o /comercial/gurgel: *"quero replicar esse portal do
// coordenador (falo de estrutura layout) para o portal da Cecilio. a unica coisa que não teremos é
// o lançamento"* · *"Diferente da gurgel, que quem faz isso tudo é o time administrativo da Careli,
// a Cecilio quem vai fazer é o proprio time deles (...) eles meio que vão andar sozinhos"*.
//
// ⚠️ LISTA EXPLÍCITA, E NÃO `tipo = "comercial"`. Trocar o tipo levaria o Cecílio para /comercial
// (sem o layout.tsx do portal: sem tema antes da pintura e sem o portão de senha), daria a ele o
// Prometeu e derrubaria no login toda conta sem vínculo próprio. O que ele ganha é a OPERAÇÃO da
// venda (reserva, proposta, board de cadastro, contratos) sobre o recorte do PRÓPRIO portal.
//
// ⚠️ CADA SLUG AQUI ABRE ESCRITA PARA GENTE DE FORA DA CARELI. As rotas de venda e de board eram
// fechadas ao incorporador por decisão registrada ("documento pessoal nunca sai daqui"); esta lista
// é a exceção autorizada, não um atalho para resolver tela do padrão.
const OPERAM_A_PROPRIA_VENDA = new Set(["cecilio-rocha"]);

/**
 * O portal opera a venda (reserva, proposta, board de cadastro, contratos)?
 * Comercial sempre; incorporador só os da lista acima. É também o que decide o layout do Hércules
 * (lateral recolhível com a marca do cliente) — quem opera a venda trabalha na mesma casca.
 */
export function portalOperaVenda(slug: null | string | undefined, tipo: null | string | undefined): boolean {
  if (ehPortalComercial(tipo)) return true;
  return OPERAM_A_PROPRIA_VENDA.has(String(slug ?? "").trim().toLowerCase());
}

// QUEM CONFECCIONA O CONTRATO DENTRO DO PORTAL — e por que o comercial NÃO entra.
//
// Decisões do Lucas (16/09/2026): a Gurgel continua vendendo os produtos da Cecílio, *"contrato com
// a Careli"*; a equipe da Cecílio gera, manda assinar e *"também edita os modelos"*. Então quem
// confecciona depende de QUEM VENDEU, não só do produto: a venda do coordenador vai para a Têmis
// da Careli; a venda do próprio time do incorporador fica com ele, no portal.
//
// ⚠️ O COMERCIAL OPERA A VENDA MAS NÃO CONFECCIONA. Por isso esta função não é `portalOperaVenda`:
// a Gurgel reserva, faz proposta e envia para contrato, e quem pega o contrato é o jurídico da Careli.
export function portalConfeccionaContrato(
  slug: null | string | undefined,
  tipo: null | string | undefined,
): boolean {
  if (ehPortalComercial(tipo)) return false;
  return OPERAM_A_PROPRIA_VENDA.has(String(slug ?? "").trim().toLowerCase());
}
