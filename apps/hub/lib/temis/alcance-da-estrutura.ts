import { NextResponse } from "next/server";

import { foraDoEscopo } from "@/lib/apolo/incorporador/escopo";
import type { PortalDaEscrita } from "@/lib/apolo/incorporador/operacao-do-produto";
import {
  escritaNoProduto,
  respostaDaEscrita,
  type ResultadoDaEscrita,
} from "@/lib/apolo/incorporador/operacao-do-produto-servidor";
import type { createApoloAdminClient } from "@/lib/apolo/server";

import { type AtorDaTemis, type AtorDoPortal, enterpriseNoAlcance } from "./ator";

// O ALCANCE DAS PEÇAS DO MODELO — minuta, anexo, assinante, categoria, faixa e unidade.
//
// Decisões do Lucas (16/09/2026): a equipe da Cecílio *"também cria e edita os modelos"* dos
// produtos dela. As rotas `/api/temis/*` não conferiam escopo nenhum (o jurídico da Careli enxerga
// tudo por desenho) e aceitavam qualquer id vindo da URL ou do corpo. Aqui mora a pergunta que as
// funções de `minutas-servico.ts` e `estrutura-servico.ts` fazem ANTES de ler ou gravar: "a peça
// com este id é deste ator?".
//
// ⚠️ O HUB NUNCA CONSULTA NADA AQUI. Para o ator do hub toda resposta é "dentro" sem ida ao banco:
// é o que garante que a Têmis da Careli continua fazendo exatamente as mesmas consultas de antes.
//
// ⚠️ O CONSOLIDADO. As peças moram num `enterprise_id` de TEXTO, e ele pode ser:
//   • a divisão (VOC = 37), que `enterpriseNoAlcance` responde direto;
//   • o id do grupo (`group:Vale do Ouro`), que só está na lista de quem tem o GRUPO na sessão;
//   • o id do PAI no cadastro do Panteon (VLO = 35, LAB = 31), onde a categoria mora por desenho
//     ("o Condomínio e o Loteamento não interfere nos filhos, é tudo junto"). Esse id NUNCA está na
//     lista da sessão: o catálogo do C2X agrupa só as divisões.
// Para o pai, a regra é a dos FILHOS no cadastro (`hercules_empreendimentos.pai_id`):
//   • "inteiro": todos os filhos no alcance. É o que vale para ESCREVER e para ler minuta, anexo,
//     assinante e faixa. Uma peça do consolidado vale para as vendas de TODOS os donos das divisões
//     (VOC é da Cecílio, VOL é do Lino); abrir para quem tem só uma delas deixaria a Cecílio editar
//     o contrato do Lino, e até ler o que é dele.
//   • "parcial": algum filho no alcance. Só para LER a categoria, que o portal não edita e que rege
//     os lotes da divisão dela — e mesmo aí quem lê recorta o que é de outro dono (contagem de lotes,
//     ordem de assinatura das outras divisões).
// Um GRUPO só parcialmente no escopo (`group:` sem o grupo na sessão) é 404, leitura e escrita: é a
// assimetria de `idsDaSessao`, e o teste de `ator.ts` a prende.
//
// ⚠️ ESCREVER PEDE MAIS QUE O ESCOPO (decisão do Lucas, 16/09/2026: escrita só no que a Cecílio
// opera). O VOC (37) e o VOR (41) estão no escopo da Cecílio e continuam da Gurgel e da Careli: ela
// lê a minuta, o anexo e o quadro de assinatura deles, e não mexe. Toda escrita da Têmis do portal
// passa por `alcanceParaEscrever`, que exige o escopo "inteiro" de sempre e DEPOIS a régua de quem
// opera o produto (`escritaNoProduto`, de `operacao-do-produto-servidor.ts`, a mesma de todas as
// rotas de escrita do portal). Produto do escopo operado por outro é "so-consulta" (403 com
// `soConsulta: true`); sem a 0170, ou com o cadastro fora do ar, é "falha" (503). Nunca "dentro".

type Admin = NonNullable<ReturnType<typeof createApoloAdminClient>>;

const WORKSPACE = "careli";

/**
 * `falha` = a leitura que decidiria o alcance não aconteceu. Nunca vira "dentro" nem "fora".
 * `so-consulta` = a peça é do escopo, mas o produto é operado por outro: lê, não escreve.
 */
export type Alcance = "dentro" | "falha" | "fora" | "so-consulta";

export type ModoDoConsolidado = "inteiro" | "parcial";

/**
 * Para que a conferência serve. "ler" é o escopo de sempre; "escrever" acrescenta a régua de quem
 * opera o produto (ver o topo). O padrão é "ler", para quem já chamava continuar igual.
 */
export type UsoDoAlcance = "escrever" | "ler";

/** Texto aparado, ou vazio. Número vira texto: o C2X devolve id numérico e a Têmis guarda texto. */
function comoId(valor: unknown): string {
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  return typeof valor === "string" ? valor.trim() : "";
}

/**
 * A regra do consolidado, pura: com os filhos do pai na mão, o pai está no alcance?
 *
 * ⚠️ FILHO SEM ID CONTA COMO "FORA". Um filho que o cadastro não sabe identificar não pode ser
 * provado deste dono, e "todos os filhos" com um desconhecido no meio não é "todos".
 */
export function paiNoAlcance(
  ator: AtorDaTemis,
  idsDosFilhos: readonly unknown[],
  modo: ModoDoConsolidado,
): boolean {
  if (ator.tipo === "hub") return true;
  if (idsDosFilhos.length === 0) return false;

  const dentro = idsDosFilhos.filter((id) => {
    const limpo = comoId(id);
    return Boolean(limpo) && enterpriseNoAlcance(ator, limpo);
  }).length;

  return modo === "parcial" ? dentro > 0 : dentro === idsDosFilhos.length;
}

/**
 * O empreendimento onde a peça mora está no alcance do ator?
 *
 * Hub: "dentro", sem consulta. Portal: a lista expandida da sessão primeiro; depois, se o id é de um
 * PAI no cadastro, a regra dos filhos (ver o topo). Qualquer falha na consulta do pai é "fora":
 * sem conseguir provar que o consolidado é dele, ele não é dele.
 */
export async function alcanceDoEmpreendimento(
  admin: Admin,
  ator: AtorDaTemis,
  enterpriseId: unknown,
  modo: ModoDoConsolidado = "inteiro",
): Promise<Alcance> {
  if (ator.tipo === "hub") return "dentro";
  if (enterpriseNoAlcance(ator, enterpriseId)) return "dentro";

  const alvo = comoId(enterpriseId);
  // O grupo não existe no cadastro do Panteon: ou está na lista da sessão, ou é 404.
  if (!alvo || alvo.startsWith("group:")) return "fora";

  const lido = await filhosNoCadastro(admin, alvo);
  if (!lido.ok || lido.filhos === null) return "fora";
  return paiNoAlcance(ator, lido.filhos, modo) ? "dentro" : "fora";
}

/**
 * Os filhos (`c2x_enterprise_id`) da linha do cadastro do Panteon com este id do C2X.
 *
 * `filhos: null` = o id não é linha do cadastro. Lista vazia = é linha, sem filho nenhum (um produto
 * simples, como o Garden). `ok: false` = a leitura falhou, e quem chama decide o que isso vale: na
 * régua do escopo é "fora" (sem provar que o consolidado é dele, ele não é dele); na da escrita é
 * "falha" (503), porque o produto É do escopo e só não deu para conferir quem o opera.
 */
async function filhosNoCadastro(
  admin: Admin,
  alvo: string,
): Promise<{ filhos: null | unknown[]; ok: true } | { ok: false }> {
  try {
    const { data: pai, error } = await admin
      .from("hercules_empreendimentos")
      .select("id")
      .eq("workspace_id", WORKSPACE)
      .eq("c2x_enterprise_id", alvo)
      .maybeSingle();

    if (error) return { ok: false };
    const idDoPai = (pai as null | { id?: unknown })?.id;
    if (typeof idDoPai !== "string" || !idDoPai) return { filhos: null, ok: true };

    const { data: filhos, error: erroFilhos } = await admin
      .from("hercules_empreendimentos")
      .select("c2x_enterprise_id")
      .eq("workspace_id", WORKSPACE)
      .eq("pai_id", idDoPai);

    if (erroFilhos) return { ok: false };

    return {
      filhos: ((filhos ?? []) as Array<{ c2x_enterprise_id: unknown }>).map(
        (filho) => filho.c2x_enterprise_id,
      ),
      ok: true,
    };
  } catch {
    return { ok: false };
  }
}

/** O ator do portal no formato da régua de quem opera o produto. */
function portalDaEscrita(ator: AtorDoPortal): PortalDaEscrita {
  // ⚠️ `tipo: "incorporador"`: o ator do portal só existe para quem já passou por
  // `portalConfeccionaContrato` em `autorizarTemisDoPortal`; na régua, quem decide o resto é o slug.
  return { incorporadorId: ator.incorporadorId, slug: ator.slug, tipo: "incorporador" };
}

function alcanceDaRegua(resultado: ResultadoDaEscrita): Alcance {
  if (resultado === "pode") return "dentro";
  if (resultado === "so-consulta") return "so-consulta";
  if (resultado === "indisponivel") return "falha";
  return "fora";
}

/**
 * Este ator pode ESCREVER nas peças destes empreendimentos (minuta, anexo, assinante, contrato,
 * card)? A porta ÚNICA de escrita da Têmis do portal.
 *
 * Hub: "dentro", sem consulta nenhuma (a Careli confecciona e edita para todos os produtos).
 *
 * Portal, nesta ordem, parando no primeiro "não":
 *   1. cada id no escopo "inteiro" (`alcanceDoEmpreendimento`): fora do escopo é 404, como sempre;
 *   2. o PAI do cadastro vira os ids de TODOS os filhos. Pelo pai se escreve a peça que vale para as
 *      vendas de todas as divisões, e um filho só consulta basta para recusar;
 *   3. a régua de quem opera (`escritaNoProduto`): "pode" segue, "so-consulta" é 403 e
 *      "indisponivel" é 503.
 *
 * ⚠️ LISTA VAZIA NÃO É "PODE". Escrita sem alvo é o parâmetro esquecido, e a resposta é 404.
 */
export async function alcanceParaEscreverNosEmpreendimentos(
  admin: Admin,
  ator: AtorDaTemis,
  enterpriseIds: readonly unknown[],
): Promise<Alcance> {
  if (ator.tipo === "hub") return "dentro";

  const alvos = [...new Set(enterpriseIds.map(comoId).filter(Boolean))];
  if (alvos.length === 0) return "fora";

  for (const alvo of alvos) {
    const doEscopo = await alcanceDoEmpreendimento(admin, ator, alvo, "inteiro");
    if (doEscopo !== "dentro") return doEscopo;
  }

  const produtos: string[] = [];
  for (const alvo of alvos) {
    // O grupo do catálogo não é linha do cadastro: vai como está, e a régua recusa (não tem dono).
    if (alvo.startsWith("group:")) {
      produtos.push(alvo);
      continue;
    }
    const lido = await filhosNoCadastro(admin, alvo);
    if (!lido.ok) return "falha";
    const filhos = (lido.filhos ?? []).map(comoId);
    if (filhos.length === 0) {
      produtos.push(alvo);
      continue;
    }
    // Filho sem id não pode ser provado deste dono (a mesma régua de `paiNoAlcance`).
    if (filhos.some((filho) => !filho)) return "fora";
    produtos.push(...filhos);
  }

  try {
    return alcanceDaRegua(await escritaNoProduto(portalDaEscrita(ator), produtos));
  } catch (erro) {
    console.error("[temis][alcance] falha ao conferir quem opera o produto", erro);
    return "falha";
  }
}

/** `alcanceParaEscreverNosEmpreendimentos` com um empreendimento só. */
export async function alcanceParaEscrever(
  admin: Admin,
  ator: AtorDaTemis,
  enterpriseId: unknown,
): Promise<Alcance> {
  return alcanceParaEscreverNosEmpreendimentos(admin, ator, [enterpriseId]);
}

/** O lugar da peça pela régua do uso: ler é o escopo; escrever é o escopo inteiro e a operação. */
function alcanceDoLugar(
  admin: Admin,
  ator: AtorDaTemis,
  enterpriseId: unknown,
  modo: ModoDoConsolidado,
  uso: UsoDoAlcance,
): Promise<Alcance> {
  return uso === "escrever"
    ? alcanceParaEscrever(admin, ator, enterpriseId)
    : alcanceDoEmpreendimento(admin, ator, enterpriseId, modo);
}

/**
 * Lê as colunas que decidem o alcance de UMA linha, pelo id.
 *
 * ⚠️ `22P02` (id que não é uuid) é "não existe", e não falha: é o que um id forjado na URL produz,
 * e a resposta a ele é a mesma de qualquer id de outro dono.
 */
async function lerParaConferir<T>(
  admin: Admin,
  tabela: string,
  colunas: string,
  id: unknown,
): Promise<{ linha: null | T; ok: true } | { ok: false }> {
  const alvo = comoId(id);
  if (!alvo) return { linha: null, ok: true };

  try {
    const { data, error } = await admin
      .from(tabela)
      .select(colunas)
      .eq("workspace_id", WORKSPACE)
      .eq("id", alvo)
      .maybeSingle();

    if (error) {
      if ((error as { code?: unknown }).code === "22P02") return { linha: null, ok: true };
      console.error(`[temis][alcance] falha ao conferir ${tabela}`, error);
      return { ok: false };
    }
    return { linha: (data ?? null) as null | T, ok: true };
  } catch (erro) {
    console.error(`[temis][alcance] falha ao conferir ${tabela}`, erro);
    return { ok: false };
  }
}

/**
 * A minuta (pelo id) é deste ator? Hub: sempre, sem consulta.
 *
 * `uso: "escrever"` (salvar, publicar, arquivar, mídia, agente, capa) exige também que o produto
 * da minuta seja operado pelo portal.
 */
export async function alcanceDaMinuta(
  admin: Admin,
  ator: AtorDaTemis,
  minutaId: unknown,
  uso: UsoDoAlcance = "ler",
): Promise<Alcance> {
  if (ator.tipo === "hub") return "dentro";

  const lida = await lerParaConferir<{ enterprise_id: unknown }>(
    admin,
    "temis_minutas",
    "enterprise_id",
    minutaId,
  );
  if (!lida.ok) return "falha";
  if (!lida.linha) return "fora";
  return alcanceDoLugar(admin, ator, lida.linha.enterprise_id, "inteiro", uso);
}

/**
 * A categoria (pelo id) é deste ator?
 *
 * ⚠️ O MODO É DE QUEM PERGUNTA. Ler a categoria (ou o anexo pendurado nela) aceita o pai com um
 * filho no alcance; gravar exige o pai inteiro. Ver o topo.
 */
export async function alcanceDaCategoria(
  admin: Admin,
  ator: AtorDaTemis,
  categoriaId: unknown,
  modo: ModoDoConsolidado,
  uso: UsoDoAlcance = "ler",
): Promise<Alcance> {
  if (ator.tipo === "hub") return "dentro";

  const lida = await lerParaConferir<{ enterprise_id: unknown }>(
    admin,
    "temis_categorias",
    "enterprise_id",
    categoriaId,
  );
  if (!lida.ok) return "falha";
  if (!lida.linha) return "fora";
  return alcanceDoLugar(admin, ator, lida.linha.enterprise_id, modo, uso);
}

/**
 * A unidade do Panteon (pelo id) é deste ator?
 *
 * ⚠️ A LINHA DO PAI (o espelho do lote, `espelho_de`) SEGUE A REGRA DO CONSOLIDADO INTEIRO. O mesmo
 * terreno existe no pai e na divisão; a linha da divisão responde pela divisão, e a do pai só é de
 * quem tem o conjunto.
 */
export async function alcanceDaUnidade(
  admin: Admin,
  ator: AtorDaTemis,
  unidadeId: unknown,
  uso: UsoDoAlcance = "ler",
): Promise<Alcance> {
  if (ator.tipo === "hub") return "dentro";

  const lida = await lerParaConferir<{ enterprise_id: unknown }>(
    admin,
    "hercules_unidades",
    "enterprise_id",
    unidadeId,
  );
  if (!lida.ok) return "falha";
  if (!lida.linha) return "fora";
  return alcanceDoLugar(admin, ator, lida.linha.enterprise_id, "inteiro", uso);
}

/** O alvo de um anexo: exatamente um dos três, como `temis_anexos_um_alcance` (0156). */
export type AlvoDoAnexo = {
  categoriaId?: null | string;
  enterpriseId?: null | string;
  unidadeId?: null | string;
};

/**
 * O alvo de um anexo (o que o corpo manda, ou o que a linha guarda) é deste ator?
 *
 * ⚠️ TODOS OS NÍVEIS INFORMADOS PRECISAM PASSAR. A leitura da tela manda os três de uma vez
 * (empreendimento + categoria + unidade); aceitar porque UM deles é do ator devolveria os anexos
 * dos outros dois junto.
 */
export async function alcanceDoAlvo(
  admin: Admin,
  ator: AtorDaTemis,
  alvo: AlvoDoAnexo,
  modo: ModoDoConsolidado,
  uso: UsoDoAlcance = "ler",
): Promise<Alcance> {
  if (ator.tipo === "hub") return "dentro";

  const enterpriseId = comoId(alvo.enterpriseId);
  const categoriaId = comoId(alvo.categoriaId);
  const unidadeId = comoId(alvo.unidadeId);
  if (!enterpriseId && !categoriaId && !unidadeId) return "fora";

  const respostas: Alcance[] = [];
  // ⚠️ O EMPREENDIMENTO DO ANEXO É SEMPRE "INTEIRO", até na leitura: a peça do consolidado vale para
  // as vendas de todos os donos, igual à minuta. Só a CATEGORIA lê pelo filho.
  if (enterpriseId) respostas.push(await alcanceDoLugar(admin, ator, enterpriseId, "inteiro", uso));
  if (categoriaId) respostas.push(await alcanceDaCategoria(admin, ator, categoriaId, modo, uso));
  if (unidadeId) respostas.push(await alcanceDaUnidade(admin, ator, unidadeId, uso));

  // ⚠️ A PIOR RESPOSTA VENCE. A falha continua na frente, como sempre foi (sem ler, não se decide
  // nada); depois o de fora do escopo (404), que também vence o "só consulta" (403): um nível de
  // outro dono não pode ser confirmado pela frase do produto. Só "dentro" em todos segue.
  if (respostas.includes("falha")) return "falha";
  if (respostas.includes("fora")) return "fora";
  if (respostas.includes("so-consulta")) return "so-consulta";
  return "dentro";
}

/**
 * O anexo gravado (pelo id) é deste ator, PARA ESCREVER? Só quem desativa pergunta: consolidado
 * inteiro e o produto operado pelo portal.
 */
export async function alcanceDoAnexo(
  admin: Admin,
  ator: AtorDaTemis,
  anexoId: unknown,
): Promise<Alcance> {
  if (ator.tipo === "hub") return "dentro";

  const lida = await lerParaConferir<{
    categoria_id: null | string;
    enterprise_id: null | string;
    unidade_id: null | string;
  }>(admin, "temis_anexos", "enterprise_id,categoria_id,unidade_id", anexoId);
  if (!lida.ok) return "falha";
  if (!lida.linha) return "fora";

  return alcanceDoAlvo(
    admin,
    ator,
    {
      categoriaId: lida.linha.categoria_id,
      enterpriseId: lida.linha.enterprise_id,
      unidadeId: lida.linha.unidade_id,
    },
    "inteiro",
    "escrever",
  );
}

/**
 * O assinante do quadro (pelo id) é deste ator, PARA ESCREVER? Só quem remove pergunta: o produto
 * do quadro precisa ser operado pelo portal.
 */
export async function alcanceDoAssinante(
  admin: Admin,
  ator: AtorDaTemis,
  assinanteId: unknown,
): Promise<Alcance> {
  if (ator.tipo === "hub") return "dentro";

  const lida = await lerParaConferir<{ enterprise_id: unknown }>(
    admin,
    "temis_assinantes",
    "enterprise_id",
    assinanteId,
  );
  if (!lida.ok) return "falha";
  if (!lida.linha) return "fora";
  return alcanceParaEscrever(admin, ator, lida.linha.enterprise_id);
}

/**
 * A resposta de um alcance que NÃO é "dentro", ou `null` para seguir.
 *
 * ⚠️ "FORA" É 404 COM A FRASE DE `foraDoEscopo`, sem dizer se a peça não existe ou é de outro dono:
 * as duas respostas têm de ser indistinguíveis, senão trocar o id na URL vira um jeito de mapear o
 * que existe na casa. "FALHA" é 503: um 404 aqui mandaria o time procurar uma minuta que existe.
 * "SO-CONSULTA" é o 403 da régua de quem opera o produto (`respostaDaEscrita`), com `soConsulta:
 * true`: a peça é do escopo e a tela já a mostra, então responder "não existe" seria mentir.
 */
export function respostaDoAlcance(alcance: Alcance): NextResponse | null {
  if (alcance === "dentro") return null;
  if (alcance === "fora") return foraDoEscopo();
  if (alcance === "so-consulta") return respostaDaEscrita("so-consulta");
  return NextResponse.json(
    { error: "Não foi possível conferir o acesso agora." },
    { status: 503 },
  );
}

/**
 * A porta das peças que o portal só LÊ (faixas e categorias continuam com a Careli).
 *
 * ⚠️ 404, E NÃO 403: para o portal, a escrita dessas peças não existe. A mesma frase de qualquer
 * id fora do escopo.
 */
export function somenteLeituraNoPortal(ator: AtorDaTemis): NextResponse | null {
  return ator.tipo === "portal" ? foraDoEscopo() : null;
}
