// O CADASTRO DO EMPREENDIMENTO, VISTO DE FORA — as abas Cadastro e Relacionamentos da ficha do
// produto no portal que opera a própria venda (hoje o da Cecílio Rocha).
//
// Lucas (16/09/2026): *"literalmente ter dois sistemas, mas ele seria uma replica que temos hoje"*.
// A TELA é a do Apolo (`CadastroTab` e `RelacionamentosTab`, exportadas de
// modules/apolo/blocks/empreendimentos/empreendimentos-view.tsx); o PAYLOAD não é. A rota interna
// (/api/apolo/empreendimentos/cadastro) devolve `loadApoloEnterpriseCadastro` cru, e cada player
// sai de lá com telefone, e-mail, CPF/CNPJ, endereço e o `entityId` do CRM interno. Aquilo é para
// o analista da Careli; o time do cliente é gente de fora, e a regra do portal já está escrita em
// crm.ts e ficha-cadastro.ts: *"REPLICAR A TELA NÃO É REUSAR O PAYLOAD"* e *"SEM telefone/e-mail de
// terceiros"*. Este arquivo é a allowlist campo a campo, pura e testada.
//
// ⚠️ O SHAPE CONTINUA O DE `ApoloEnterpriseCadastro`, com os campos retidos VAZIOS (e não
// removidos): a tela é a mesma nos dois lugares, e um campo que falta no tipo quebraria a do Apolo.
// É a mesma decisão da rota produto/unidades com o comprador e a imobiliária.
import type {
  ApoloEnterpriseCadastro,
  ApoloEnterprisePlayer,
  ApoloEnterprisePlayerRelation,
} from "@/lib/apolo/empreendimentos";
import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";

/**
 * Os papéis que atravessam, e só eles.
 *
 * ⚠️ ALLOWLIST, E NÃO "TUDO MENOS O ESCONDIDO". O `coordenador_c2x` do legado está errado (o mesmo
 * player nos 24 empreendimentos) e a tela interna já o filtra; aqui ele nem entra no JSON. Um papel
 * novo que nascer no loader fica de fora até alguém decidir que o cliente pode vê-lo.
 */
const PAPEIS_DO_PORTAL: ReadonlySet<ApoloEnterprisePlayerRelation> = new Set([
  "captador",
  "coordenador_vendas",
  "incorporador",
]);

/**
 * Um player no recorte do portal: o NOME e o PAPEL, que é o que responde "quem é quem neste
 * produto".
 *
 *   • telefone e e-mail: dado de contato de terceiro (o captador e o coordenador de vendas não são
 *     o cliente) — a regra de ficha-cadastro.ts;
 *   • CPF/CNPJ e endereço: dado pessoal de quem NÃO é comprador do cliente. O documento inteiro que
 *     o portal mostra (ordem do Lucas, 18/08/2026) é o do COMPRADOR e da imobiliária dele, no CRM;
 *     o do captador e o do coordenador de vendas nunca foram parte disso;
 *   • `entityId`: o id interno da ficha no CRM do hub. No portal o card não abre o CRM (não há CRM
 *     do hub para abrir), então ele não tem uso nenhum lá, e id interno não sai sem uso.
 */
export function playerParaOPortal(player: ApoloEnterprisePlayer): ApoloEnterprisePlayer {
  return {
    address: null,
    document: null,
    email: null,
    entityId: "",
    name: player.name,
    phone: null,
    relation: player.relation,
  };
}

/**
 * A ficha do empreendimento no recorte do portal.
 *
 * Fica o que a aba Cadastro desenha (nome, divulgação, sigla, cidade/UF, previsão de entrega,
 * tipo, tabela) e o NOME do contato focal. Saem:
 *   • telefone e e-mail do contato focal — contato de terceiro, pela mesma regra dos players;
 *   • `actValue` (valor do ato) e `createdAt` — nenhuma das duas abas os mostra, e a regra
 *     comercial do produto tem aba própria (Políticas comerciais), com a porta dela.
 */
export function cadastroParaOPortal(cadastro: ApoloEnterpriseCadastro): ApoloEnterpriseCadastro {
  return {
    actValue: null,
    city: cadastro.city,
    code: cadastro.code,
    createdAt: null,
    divulgationName: cadastro.divulgationName,
    expectedDelivery: cadastro.expectedDelivery,
    focalEmail: null,
    focalName: cadastro.focalName,
    focalPhone: null,
    kind: cadastro.kind,
    name: cadastro.name,
    players: cadastro.players
      .filter((player) => PAPEIS_DO_PORTAL.has(player.relation))
      .map(playerParaOPortal),
    state: cadastro.state,
    tableKind: cadastro.tableKind,
  };
}

/**
 * A ficha de um empreendimento que só existe no PANTEON, montada do cadastro próprio.
 *
 * ⚠️ SEM ISTO A ABA FICA EM BRANCO, e em branco parece defeito. O loader lê `enterprises` do C2X,
 * e o produto nascido aqui (o ZZ TESTE; todo produto antes de subir para o legado) não está lá. O
 * cadastro do Panteon sabe o nome, a sigla e a cidade/UF — o resto fica "-", que é a verdade: ainda
 * não foi cadastrado.
 */
export function cadastroDoPanteon(linha: LinhaDoCadastro): ApoloEnterpriseCadastro {
  return {
    actValue: null,
    city: linha.cidade,
    code: linha.codigo,
    createdAt: null,
    divulgationName: null,
    expectedDelivery: null,
    focalEmail: null,
    focalName: null,
    focalPhone: null,
    kind: null,
    name: linha.nome,
    players: [],
    state: linha.uf,
    tableKind: null,
  };
}

/**
 * Junta as duas fontes na ordem dos `codes` que a rota resolveu, já no recorte do portal.
 *
 *   • o código que o C2X devolveu sai do C2X (filtrado por `cadastroParaOPortal`);
 *   • o código que é do Panteon e o C2X não conhece sai do cadastro próprio;
 *   • o que não está em `codes` NÃO sai, mesmo que a fonte o traga — o recorte da rota é o teto.
 */
export function montarCadastrosDoProduto(entrada: {
  cadastroDoPanteon: LinhaDoCadastro[];
  codes: string[];
  doC2x: ApoloEnterpriseCadastro[];
  proprios: { codigo: string; enterpriseId: string }[];
}): ApoloEnterpriseCadastro[] {
  const chave = (codigo: string) => String(codigo ?? "").trim().toUpperCase();
  const doC2x = new Map(entrada.doC2x.map((c) => [chave(c.code), c]));
  const idDoProprio = new Map(entrada.proprios.map((p) => [chave(p.codigo), p.enterpriseId]));
  const saida: ApoloEnterpriseCadastro[] = [];
  const vistos = new Set<string>();

  for (const codigo of entrada.codes) {
    const alvo = chave(codigo);
    if (!alvo || vistos.has(alvo)) continue;
    vistos.add(alvo);

    const doLegado = doC2x.get(alvo);
    if (doLegado) {
      saida.push(cadastroParaOPortal(doLegado));
      continue;
    }

    const enterpriseId = idDoProprio.get(alvo);
    if (!enterpriseId) continue;

    // Pelo id do C2X que o cadastro guarda E pelo código: duas linhas com a mesma sigla (um pai e
    // um filho renomeado) não podem trocar de ficha.
    const linha = entrada.cadastroDoPanteon.find(
      (l) => l.c2xEnterpriseId === enterpriseId && chave(l.codigo) === alvo,
    );
    if (linha) saida.push(cadastroDoPanteon(linha));
  }

  return saida;
}

/** Os códigos que valem uma ida ao C2X: os do recorte que NÃO são só do Panteon. */
export function codigosParaOC2x(
  codes: string[],
  proprios: { codigo: string; enterpriseId: string }[],
): string[] {
  const doPanteon = new Set(proprios.map((p) => p.codigo.trim().toUpperCase()));
  return codes.filter((code) => !doPanteon.has(String(code).trim().toUpperCase()));
}
