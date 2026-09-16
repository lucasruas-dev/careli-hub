// CADASTRAR UM PRODUTO NO PANTEON: a ida ao banco, num lugar só, para o portal e para o hub.
//
// Decisão do Lucas (16/09/2026) para o portal da Cecílio Rocha: MESMO banco, MESMAS tabelas, MESMO
// código, e cada produto (`hercules_empreendimentos`) marca QUEM o opera. Os prédios e loteamentos
// que ainda não existem (Ed. Jade, Ed. Rubi, On Sky...) nascem aqui, com o id da sequence da 0170
// (>= 100000), e o C2X legado, que é SOMENTE LEITURA, não recebe nada.
//
// A régua (formato do código, UF, tipo, pai) é a de `./produto-novo`, a mesma que a tela usa. Este
// arquivo só faz o que a régua não pode fazer sem banco: saber quais códigos já existem, quem pode
// ser pai, gravar, e desfazer quando um passo do meio falha.
//
// ⚠️ SÃO ATÉ QUATRO GRAVAÇÕES, E O POSTGREST NÃO TEM TRANSAÇÃO. Produto, configurações do
// empreendimento, vínculo do portal e vínculo da conta. Um produto sem a linha de configurações
// nasceria com os defaults do banco (pré-venda LIGADA, portões de CAD e de imobiliária ABERTOS: ver
// a 0071 e a 0110), e um produto do portal sem o vínculo ficaria invisível para quem o cadastrou.
// Por isso cada passo confere o `error` e, se um falhar, os anteriores são DESFEITOS na ordem
// inversa (compensação). O número queimado da sequence não volta, e não precisa: o id é chave, não
// contador de produtos (0170, ATENCAO 3).
//
// ⚠️ ESCRITA DEPENDE DA MIGRATION 0170, E NÃO TEM CAMINHO SEM ELA. Sem as colunas, a resposta é 503
// e nada é gravado: gravar sem `c2x_enterprise_id` faria o produto sumir do sistema inteiro (reserva
// 409, proposta, contrato, espelho, escopo do portal), e gravar sem `operado_por` entregaria à Careli
// um produto que é do incorporador.
import type { SupabaseClient } from "@supabase/supabase-js";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { chaveDoPortal } from "@/lib/apolo/incorporador/logo";
import {
  podeCadastrarNoProduto,
  type PortalDaEscrita,
} from "@/lib/apolo/incorporador/operacao-do-produto";
import { tipoDePortal, type TipoDePortal } from "@/lib/apolo/incorporador/perfis-de-portal";
import { EXCLUDED_ENTERPRISE_CODES } from "@/lib/guardian/c2x-analytics";

import {
  codigoDoProduto,
  ehColunaDoProdutoAusente,
  ehIdDoPanteon,
  type EntradaDeProdutoNovo,
  type ErrosDoProdutoNovo,
  type ProdutoNovo,
  type TipoProduto,
  validarProdutoNovo,
} from "./produto-novo";

/** Só o `from` é usado: aceita o admin client do Apolo e um SupabaseClient cru (e o fake do teste). */
type Cliente = Pick<SupabaseClient, "from">;

// Mesmo workspace fixo das outras escritas do Hércules. É TEXTO; um uuid aqui casaria zero linhas
// sem erro nenhum (o defeito de 14/09/2026 da rota de premissas).
const WORKSPACE = "careli";
const PAGINA = 1000;

const TABELA_DO_PRODUTO = "hercules_empreendimentos";
const TABELA_DE_CONFIGURACOES = "apolo_enterprise_settings";
const TABELA_DO_PORTAL = "apolo_incorporador_empreendimentos";
const TABELA_DA_CONTA = "apolo_incorporador_usuario_empreendimentos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type OrigemDoCadastroDeProduto = "hub" | "portal";

export type AutorDoCadastroDeProduto = {
  /** Usuário do hub (origem hub) ou `apolo_incorporador_usuarios.id` (origem portal). */
  id: null | string;
  nome: null | string;
};

export type PedidoDeCadastroDeProduto = {
  autor: AutorDoCadastroDeProduto;
  entrada: EntradaDeProdutoNovo;
  /**
   * `apolo_incorporadores.id` de quem vai OPERAR o produto. Nulo = a Careli opera.
   * ⚠️ Quem chama resolve do BANCO (sessão assinada no portal, slug conferido no hub), nunca do corpo.
   */
  incorporadorId: null | string;
  origem: OrigemDoCadastroDeProduto;
  /**
   * O portal que pede (slug e tipo da sessão já revalidada). OBRIGATÓRIO na origem "portal": é com
   * ele que o pai possível passa pela régua única do portal (`podeCadastrarNoProduto`). No hub não
   * vem, e o pai vale pelo operador igual (a Careli, ou o incorporador escolhido no hub).
   */
  portal?: null | Pick<PortalDaEscrita, "slug" | "tipo">;
};

/** Quem cadastra, do jeito que a escolha do pai precisa: o operador e, no portal, o portal. */
export type QuemCadastraProduto = {
  incorporadorId: null | string;
  portal?: null | Pick<PortalDaEscrita, "slug" | "tipo">;
};

export type ProdutoCadastrado = {
  codigo: string;
  /** O id da sequence da 0170, em texto: a chave que unidades, vendas, planos e escopo usam. */
  enterpriseId: string;
  nome: string;
  operadoPor: null | string;
  paiId: null | string;
  /** `hercules_empreendimentos.id` (uuid), o que a ficha do produto usa em `pai:<uuid>`. */
  produtoId: string;
  tipoProduto: TipoProduto;
  /** Entrou também no recorte próprio da conta que cadastrou (ver `vinculoProprioDaConta`). */
  vinculadoAConta: boolean;
  /** Entrou no recorte do portal do incorporador que opera. */
  vinculadoAoPortal: boolean;
};

export type FalhaDoCadastroDeProduto = {
  erro: string;
  /** Erro por campo, para a tela pintar embaixo do campo. Vazio quando o problema não é de campo. */
  erros: ErrosDoProdutoNovo;
  ok: false;
  status: 422 | 500 | 503;
};

export type ResultadoDoCadastroDeProduto = FalhaDoCadastroDeProduto | { ok: true; produto: ProdutoCadastrado };

export type DependenciasDoCadastroDeProduto = {
  agora?: () => Date;
  /**
   * Códigos do C2X legado. `null` = não deu para ler, e a conferência cai no cadastro do Panteon
   * mais `CODIGOS_DO_LEGADO_FORA_DO_CADASTRO` (ver `cadastrarProduto`).
   */
  codigosDoC2x?: () => Promise<null | string[]>;
};

/**
 * Os códigos do C2X que o cadastro do Panteon NÃO tem, congelados aqui.
 *
 * O semeador (`scripts/hercules/semear-empreendimentos.mjs`, 02/09/2026) copiou para
 * `hercules_empreendimentos` todo empreendimento do legado, menos os que ele ignora (SDT, TSC, ADT:
 * testes e aditivos). O catálogo, por sua vez, esconde `EXCLUDED_ENTERPRISE_CODES` (TSC, SDT, LAB,
 * LAG). Somados ao cadastro, estes cobrem o legado inteiro daquele dia.
 *
 * ⚠️ O QUE ELES NÃO COBREM: empreendimento criado no C2X depois do semeador. Enquanto o C2X responde,
 * o catálogo vivo pega esse caso; com ele fora, fica o risco pequeno, trocado pelo de o cadastro de
 * produto nunca mais funcionar no dia em que o legado for desligado.
 */
export const CODIGOS_DO_LEGADO_FORA_DO_CADASTRO: readonly string[] = [
  ...new Set([...EXCLUDED_ENTERPRISE_CODES, "ADT", "SDT", "TSC"].map((c) => c.toUpperCase())),
];

type Erro = { code?: null | string; details?: null | string; message?: null | string } | null;

function falha(
  status: FalhaDoCadastroDeProduto["status"],
  erro: string,
  erros: ErrosDoProdutoNovo = {},
): FalhaDoCadastroDeProduto {
  return { erro, erros, ok: false, status };
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor : "";
}

/**
 * O corpo do pedido, lido como a régua espera: só texto, só os campos do produto.
 *
 * ⚠️ QUEM OPERA NÃO SAI DAQUI. `operadoPor`, `incorporadorId` ou `enterpriseId` no corpo são
 * ignorados de propósito: no portal o operador é o incorporador da sessão assinada, e o id é da
 * sequence. Um campo a mais no JSON não pode cadastrar produto no portal do vizinho.
 */
export function entradaDoCorpo(corpo: unknown): EntradaDeProdutoNovo {
  const c = corpo && typeof corpo === "object" ? (corpo as Record<string, unknown>) : {};
  return {
    cidade: texto(c.cidade),
    codigo: texto(c.codigo),
    nome: texto(c.nome),
    paiCodigo: texto(c.paiCodigo) || null,
    tipoProduto: texto(c.tipoProduto),
    uf: texto(c.uf),
  };
}

type LinhaExistente = {
  c2x_enterprise_id: null | string;
  codigo: null | string;
  id: string;
  operado_por: null | string;
  pai_id: null | string;
};

/**
 * Quem pode ser pai do produto novo: RAIZ do cadastro, do MESMO operador, e que não perca estoque.
 *
 * ⚠️ MESMO OPERADOR PORQUE O PAI É O ESPELHO (0123): unidades e vendas moram nele, e o filho é uma
 * visão por cima. Um filho da Cecílio pendurado num pai da Careli (ou de outro incorporador) poria
 * o produto dela dentro da carteira de quem não é dono. A mensagem de recusa é a mesma de "não
 * existe": dizer "existe, mas é de outro" viraria um enumerador de produtos alheios.
 *
 * ⚠️ E SÓ RAIZ QUE NÃO TEM ESTOQUE PRÓPRIO VIVO (revisão de 16/09/2026). Pai com filho vira espelho:
 * `alcanceDoPai` passa a responder SÓ pelos filhos e ignora o id do próprio pai, e o cadastro de
 * unidade recusa o pai "dividido em glebas". Pendurar uma etapa no Garden (39) ou num prédio com 120
 * apartamentos vendendo tiraria o estoque e as vendas dele das telas. Então pode ser pai:
 *   • raiz sem id (pai de grupo, como LOX, RDX e PDX): não tem estoque próprio;
 *   • raiz que JÁ é pai: o id dela já é espelho, e uma etapa a mais não muda nada;
 *   • raiz nascida no Panteon (id >= 100000) sem nenhuma unidade (`comEstoque` diz quais têm).
 * Raiz do C2X sem filho nunca: o estoque dela está no legado, e o retrato daqui não prova que é zero.
 */
export function paisPossiveisDoOperador(
  linhas: LinhaExistente[],
  quem: null | QuemCadastraProduto | string,
  comEstoque: ReadonlySet<string> = new Set(),
): Set<string> {
  const jaSaoPais = new Set(linhas.map((l) => l.pai_id).filter((id): id is string => Boolean(id)));

  return new Set(
    linhas
      .filter((l) => !l.pai_id && operaOPai(l, quem))
      .filter((l) => {
        const id = String(l.c2x_enterprise_id ?? "").trim();
        if (!id || jaSaoPais.has(l.id)) return true;
        return ehIdDoPanteon(id) && !comEstoque.has(id);
      })
      .map((l) => codigoDoProduto(l.codigo))
      .filter(Boolean),
  );
}

/**
 * O pai é do mesmo operador de quem cadastra?
 *
 * ⚠️ NO PORTAL É A RÉGUA ÚNICA (`podeCadastrarNoProduto`, D1 de 16/09/2026), e não uma comparação
 * escrita aqui: o comercial nunca pendura etapa (não cadastra produto), o portal que confecciona só
 * no pai que ele opera, e ninguém sem dono marcado. As colunas da 0170 já foram lidas por
 * `lerCadastroExistente` (sem elas o cadastro para antes com 503), por isso `com0170` é verdade aqui.
 *
 * No HUB (sem portal) vale o operador igual: nulo com nulo é a Careli pendurando etapa no que ela
 * opera, e o incorporador escolhido no hub só no pai dele.
 */
function operaOPai(linha: Pick<LinhaExistente, "operado_por">, quem: null | QuemCadastraProduto | string): boolean {
  const pedido: QuemCadastraProduto = typeof quem === "object" && quem !== null ? quem : { incorporadorId: quem };
  if (pedido.portal) {
    return podeCadastrarNoProduto(
      { incorporadorId: pedido.incorporadorId, slug: pedido.portal.slug, tipo: pedido.portal.tipo },
      linha.operado_por,
      true,
    );
  }
  return (linha.operado_por?.trim() || null) === (pedido.incorporadorId?.trim() || null);
}

/**
 * O pai pedido tem unidade? Só pergunta ao banco quando a resposta decide: raiz do Panteon, do mesmo
 * operador e ainda sem filho (nos outros casos `paisPossiveisDoOperador` decide sem estoque).
 * `null` = não deu para ler.
 */
async function estoqueDoPaiPedido(
  admin: Cliente,
  linhas: LinhaExistente[],
  entrada: EntradaDeProdutoNovo,
  quem: QuemCadastraProduto,
): Promise<null | Set<string>> {
  const codigo = codigoDoProduto(entrada.paiCodigo);
  if (!codigo) return new Set();

  const pai = linhas.find((l) => codigoDoProduto(l.codigo) === codigo);
  const id = String(pai?.c2x_enterprise_id ?? "").trim();
  if (
    !pai ||
    pai.pai_id ||
    !operaOPai(pai, quem) ||
    !ehIdDoPanteon(id) ||
    linhas.some((l) => l.pai_id === pai.id)
  ) {
    return new Set();
  }

  const { data, error } = await admin
    .from("hercules_unidades")
    .select("id")
    .eq("workspace_id", WORKSPACE)
    .eq("enterprise_id", id)
    .limit(1);

  if (error) {
    console.error("[hercules][cadastrar-produto] falha ao ler o estoque do pai", error);
    return null;
  }
  return (data ?? []).length > 0 ? new Set([id]) : new Set();
}

/**
 * Os códigos do C2X legado, pelo catálogo, somados aos que o catálogo esconde.
 *
 * ⚠️ CATÁLOGO VAZIO É "NÃO DEU PARA LER", E NÃO "NÃO EXISTE CÓDIGO". `catalogoDeEmpreendimentos`
 * devolve lista vazia quando o C2X está fora, sem dizer. Seguir só com a lista vazia deixaria passar
 * um código que já existe lá (TSC, LBF...). Por isso `null`, e quem chama cai no cadastro do Panteon
 * mais `CODIGOS_DO_LEGADO_FORA_DO_CADASTRO`, e não em 503: o C2X está sendo desligado, e um 503 aqui
 * seria o cadastro de produto parado para sempre.
 *
 * ⚠️ `EXCLUDED_ENTERPRISE_CODES` ENTRA JUNTO. O catálogo tira esses códigos (TSC, SDT, LAB, LAG) de
 * propósito, mas eles EXISTEM no C2X e em ~15 leituras do legado; um produto novo "LAG" colidiria
 * com eles.
 */
async function codigosDoCatalogoDoC2x(): Promise<null | string[]> {
  const catalogo = await catalogoDeEmpreendimentos(Date.now());
  if (catalogo.length === 0) return null;
  return [...catalogo.flatMap((e) => e.codes), ...EXCLUDED_ENTERPRISE_CODES];
}

/** O cadastro inteiro do Panteon, paginado: o PostgREST corta em 1.000 linhas SEM erro. */
async function lerCadastroExistente(
  admin: Cliente,
): Promise<{ falha: FalhaDoCadastroDeProduto; ok: false } | { linhas: LinhaExistente[]; ok: true }> {
  const linhas: LinhaExistente[] = [];

  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await admin
      .from(TABELA_DO_PRODUTO)
      .select("id,codigo,pai_id,operado_por,c2x_enterprise_id")
      .eq("workspace_id", WORKSPACE)
      .order("codigo", { ascending: true })
      .range(de, de + PAGINA - 1);

    if (error) {
      if (ehColunaDoProdutoAusente(error)) {
        return { falha: falhaDaMigrationPendente(), ok: false };
      }
      console.error("[hercules][cadastrar-produto] falha ao ler o cadastro", error);
      return {
        falha: falha(503, "Não foi possível conferir os produtos já cadastrados agora. Tente de novo em instantes."),
        ok: false,
      };
    }

    const pagina = (data ?? []) as LinhaExistente[];
    linhas.push(...pagina);
    if (pagina.length < PAGINA) break;
  }

  return { linhas, ok: true };
}

function falhaDaMigrationPendente(): FalhaDoCadastroDeProduto {
  return falha(
    503,
    "O cadastro de produto ainda não está disponível: falta aplicar a migration 0170 no banco. Avise a Careli.",
  );
}

/**
 * A conta que cadastra tem recorte PRÓPRIO (0122)?
 *
 * ⚠️ SEM ISTO, QUEM CADASTROU NÃO VÊ O QUE CADASTROU. `escopoDoUsuario` usa o vínculo da conta NO
 * LUGAR do vínculo do portal quando ele existe (e no portal comercial, SÓ ele vale). O produto novo
 * entra no portal; se a conta tem recorte próprio, ele entra nela também, senão a próxima
 * revalidação da sessão devolveria o escopo antigo e o produto recém-criado sumiria da tela.
 * Só a conta de quem cadastrou: as outras contas com recorte próprio continuam decididas no Setup.
 */
async function vinculoProprioDaConta(
  admin: Cliente,
  usuarioId: string,
): Promise<{ ok: false } | { ok: true; temVinculo: boolean }> {
  const { data, error } = await admin
    .from(TABELA_DA_CONTA)
    .select("enterprise_id")
    .eq("usuario_id", usuarioId)
    .limit(1);

  if (error) {
    console.error("[hercules][cadastrar-produto] falha ao ler o recorte da conta", error);
    return { ok: false };
  }
  return { ok: true, temVinculo: (data ?? []).length > 0 };
}

/**
 * Traduz o erro do INSERT do produto numa resposta que a tela entende.
 *
 * ⚠️ `23505` NO CÓDIGO É CORRIDA, E VIRA ERRO DE CAMPO. Dois cadastros com o mesmo código ao mesmo
 * tempo (o time da Cecílio e o administrativo da Careli) passam os dois pela conferência; quem trava
 * é o índice `hercules_empreendimentos_codigo_uk` (0123). Conferir de novo em JavaScript perderia a
 * mesma corrida.
 *
 * ⚠️ `23505` NO ID (`hercules_empreendimentos_c2x_uk`) NÃO É CULPA DE QUEM DIGITOU: só acontece se
 * alguém gravou à mão um id à frente da sequence. Tentar de novo pega o próximo número.
 */
export function falhaDoInsertDoProduto(error: NonNullable<Erro>, produto: ProdutoNovo): FalhaDoCadastroDeProduto {
  const mensagem = `${error.message ?? ""} ${error.details ?? ""}`;

  if (ehColunaDoProdutoAusente(error)) return falhaDaMigrationPendente();

  if (error.code === "23505") {
    if (/c2x_uk|c2x_enterprise_id/i.test(mensagem)) {
      return falha(503, "O número gerado para o produto já estava em uso. Tente de novo.");
    }
    return falha(422, "Confira os campos destacados.", {
      codigo: `O código ${produto.codigo} acabou de ser usado por outro cadastro. Escolha outro.`,
    });
  }

  // O gatilho de um nível só (0123) e a FK do pai: o pai virou filho, ou foi apagado, entre a
  // conferência e a gravação.
  if (/precisa ser raiz/i.test(mensagem) || (error.code === "23503" && /pai_id/i.test(mensagem))) {
    return falha(422, "Confira os campos destacados.", {
      paiCodigo: `O empreendimento ${produto.paiCodigo ?? ""} não pode ser pai: ele não existe ou já é filho de outro.`,
    });
  }

  if (error.code === "23503" && /operado_por/i.test(mensagem)) {
    return falha(422, "O incorporador que vai operar este produto não existe mais no cadastro.");
  }

  if (error.code === "23514") {
    return falha(503, "O banco recusou o tipo do produto. Confira se a migration 0170 foi aplicada inteira.");
  }

  return falha(500, "Não foi possível cadastrar o produto agora. Nada foi gravado.");
}

type Gravado = { desfazer: () => PromiseLike<{ error: Erro }>; nome: string };

/**
 * Desfaz, na ordem inversa, o que já foi gravado. Devolve o nome do que NÃO saiu.
 *
 * ⚠️ CADA DELETE CONFERE O `error` E SEGUE PARA O PRÓXIMO. Parar no primeiro que falha deixaria o
 * produto de pé por causa de um vínculo; tentar todos deixa o mínimo possível para trás, e a lista
 * do que sobrou vai na mensagem e no log, para alguém limpar sabendo o quê.
 */
async function desfazer(gravados: Gravado[]): Promise<string[]> {
  const sobrou: string[] = [];
  for (const passo of [...gravados].reverse()) {
    try {
      const { error } = await passo.desfazer();
      if (error) sobrou.push(passo.nome);
    } catch {
      sobrou.push(passo.nome);
    }
  }
  return sobrou;
}

async function falhaNoMeio(
  gravados: Gravado[],
  etapa: string,
  error: Erro,
  codigo: string,
): Promise<FalhaDoCadastroDeProduto> {
  const sobrou = await desfazer(gravados);
  console.error("[hercules][cadastrar-produto] falha no meio do cadastro", { codigo, error, etapa, sobrou });

  if (sobrou.length > 0) {
    return falha(
      500,
      `O cadastro do produto ${codigo} parou em ${etapa} e não deu para desfazer tudo. Sobrou no banco: ${sobrou.join(", ")}. Avise a Careli antes de tentar de novo.`,
    );
  }
  return falha(503, `Não foi possível concluir o cadastro do produto ${codigo} (${etapa}). Nada ficou gravado; tente de novo.`);
}

/**
 * Cadastra um produto: confere, grava o produto, as configurações e os vínculos, e desfaz tudo se
 * um passo do meio falhar.
 */
export async function cadastrarProduto(
  admin: Cliente,
  pedido: PedidoDeCadastroDeProduto,
  dependencias: DependenciasDoCadastroDeProduto = {},
): Promise<ResultadoDoCadastroDeProduto> {
  const incorporadorId = pedido.incorporadorId?.trim() || null;
  const autorId = pedido.autor.id?.trim() || null;

  // Erros de quem CHAMA, não de quem digita: a rota do portal sempre resolve os dois da sessão.
  if (incorporadorId && !UUID.test(incorporadorId)) {
    return falha(500, "Incorporador inválido para o cadastro do produto.");
  }
  if (pedido.origem === "portal" && (!incorporadorId || !autorId || !pedido.portal)) {
    return falha(500, "Cadastro pelo portal sem o incorporador, sem o portal ou sem a conta de quem cadastra.");
  }
  const quem: QuemCadastraProduto = {
    incorporadorId,
    portal: pedido.origem === "portal" ? pedido.portal : null,
  };

  // ── 1. O QUE JÁ EXISTE: o cadastro do Panteon e o catálogo do C2X ──────────────────────────
  const existente = await lerCadastroExistente(admin);
  if (!existente.ok) return existente.falha;

  let codigosDoC2x: null | string[];
  try {
    codigosDoC2x = await (dependencias.codigosDoC2x ?? codigosDoCatalogoDoC2x)();
  } catch {
    codigosDoC2x = null;
  }
  if (!codigosDoC2x) {
    // O semeador já copiou o legado para o cadastro (lido acima); os que ele pulou vão congelados.
    console.warn("[hercules][cadastrar-produto] C2X sem resposta: códigos conferidos pelo cadastro do Panteon");
    codigosDoC2x = [...CODIGOS_DO_LEGADO_FORA_DO_CADASTRO];
  }

  const codigosExistentes = new Set([
    ...codigosDoC2x.map(codigoDoProduto),
    ...existente.linhas.map((l) => codigoDoProduto(l.codigo)),
  ]);
  codigosExistentes.delete("");

  const comEstoque = await estoqueDoPaiPedido(admin, existente.linhas, pedido.entrada, quem);
  if (!comEstoque) {
    return falha(503, "Não foi possível conferir o empreendimento principal agora. Tente de novo em instantes.");
  }

  // ── 2. A RÉGUA (a mesma da tela) ────────────────────────────────────────────────────────────
  const validacao = validarProdutoNovo(pedido.entrada, {
    codigosExistentes,
    paisPossiveis: paisPossiveisDoOperador(existente.linhas, quem, comEstoque),
  });
  if (!validacao.ok) return falha(422, "Confira os campos destacados.", validacao.erros);

  const produto = validacao.produto;
  const paiId = produto.paiCodigo
    ? (existente.linhas.find((l) => codigoDoProduto(l.codigo) === produto.paiCodigo)?.id ?? null)
    : null;
  if (produto.paiCodigo && !paiId) {
    return falha(422, "Confira os campos destacados.", {
      paiCodigo: `O empreendimento ${produto.paiCodigo} não pode ser pai: ele não existe ou já é filho de outro.`,
    });
  }

  // Lido ANTES de gravar qualquer coisa: se falhar, nada precisa ser desfeito. Fail-closed: sem saber
  // o recorte da conta, não dá para garantir que quem cadastrou vai enxergar o produto.
  let incluirNaConta = false;
  if (pedido.origem === "portal" && autorId) {
    const conta = await vinculoProprioDaConta(admin, autorId);
    if (!conta.ok) {
      return falha(503, "Não foi possível conferir o acesso da sua conta agora. Tente de novo em instantes.");
    }
    incluirNaConta = conta.temVinculo;
  }

  const agora = (dependencias.agora ?? (() => new Date()))().toISOString();

  // ── 3. O PRODUTO ────────────────────────────────────────────────────────────────────────────
  // ⚠️ SEM `c2x_enterprise_id` NO CORPO: o DEFAULT da 0170 (nextval da sequence) só vale quando a
  // coluna é OMITIDA. Mandar `null` explícito gravaria nulo, que é o que só pai de grupo sem unidade
  // própria (LOX, RDX, PDX) deve ter.
  const { data: inserido, error: erroDoProduto } = await admin
    .from(TABELA_DO_PRODUTO)
    .insert({
      cidade: produto.cidade,
      codigo: produto.codigo,
      criado_origem: pedido.origem,
      criado_por: autorId,
      nome: produto.nome,
      operado_por: incorporadorId,
      pai_id: paiId,
      tipo_produto: produto.tipoProduto,
      uf: produto.uf,
      vendendo: true,
      workspace_id: WORKSPACE,
    })
    .select("id,c2x_enterprise_id")
    .single<{ c2x_enterprise_id: null | string; id: string }>();

  if (erroDoProduto || !inserido?.id) {
    if (!erroDoProduto) return falha(500, "Não foi possível cadastrar o produto agora. Nada foi gravado.");
    console.error("[hercules][cadastrar-produto] insert do produto recusado", erroDoProduto);
    return falhaDoInsertDoProduto(erroDoProduto, produto);
  }

  const produtoId = inserido.id;
  const gravados: Gravado[] = [
    {
      desfazer: () => admin.from(TABELA_DO_PRODUTO).delete().eq("id", produtoId).eq("workspace_id", WORKSPACE),
      nome: `o produto ${produto.codigo}`,
    },
  ];

  // ⚠️ O ID TEM QUE SER DA SEQUENCE. Colunas da 0170 aplicadas sem o DEFAULT (migration pela metade)
  // gravariam o produto com id nulo, e produto sem id some de reserva, proposta, contrato e escopo.
  const enterpriseId = String(inserido.c2x_enterprise_id ?? "").trim();
  if (!ehIdDoPanteon(enterpriseId)) {
    const sobrou = await desfazer(gravados);
    console.error("[hercules][cadastrar-produto] produto gravado sem id da sequence", {
      codigo: produto.codigo,
      enterpriseId,
      sobrou,
    });
    return sobrou.length > 0
      ? falha(500, `O produto ${produto.codigo} foi gravado sem número e não deu para desfazer. Avise a Careli antes de tentar de novo.`)
      : falha(503, "O banco não gerou o número do produto (a sequence da migration 0170 não está ativa). Avise a Careli.");
  }

  // ── 4. AS CONFIGURAÇÕES DO EMPREENDIMENTO, TUDO DESLIGADO ───────────────────────────────────
  // ⚠️ PORTÕES E PRÉ-VENDA VÃO EXPLÍCITOS EM `false`. Os defaults do banco são `true` para
  // `prevenda_habilitada` (0071) e para `recepcao_cad`/`recepcao_imobiliaria` (0110): foi assim que
  // VOL, VOC e GDN amanheceram cobrando R$ 1.000 de pré-venda que ninguém ligou (10/08/2026). Quem
  // abre o produto para CAD e credenciamento é uma decisão na tela de configurações, não o cadastro.
  //
  // `analise_credito_habilitada` fica no default (ligada) de propósito: ela não abre porta, ela
  // RECUSA cliente com restrição. Desligar aqui faria a primeira CAD passar sem Serasa no dia em que
  // alguém abrisse o credenciamento sem olhar o resto.
  const { error: erroDasConfiguracoes } = await admin.from(TABELA_DE_CONFIGURACOES).insert({
    code: produto.codigo,
    comprovante_renda_habilitado: false,
    credenciamento_ativo: false,
    enterprise_id: enterpriseId,
    prevenda_habilitada: false,
    recepcao_cad: false,
    recepcao_imobiliaria: false,
    updated_at: agora,
    // `updated_by` é uuid de usuário do HUB. A conta do portal é de outro cadastro; gravar o id dela
    // aqui faria a trilha apontar para um "usuário do hub" que não existe.
    updated_by: pedido.origem === "hub" && autorId && UUID.test(autorId) ? autorId : null,
    workspace_id: WORKSPACE,
  });

  if (erroDasConfiguracoes) {
    return falhaNoMeio(gravados, "as configurações do empreendimento", erroDasConfiguracoes, produto.codigo);
  }
  gravados.push({
    desfazer: () => admin.from(TABELA_DE_CONFIGURACOES).delete().eq("enterprise_id", enterpriseId),
    nome: "as configurações do empreendimento",
  });

  // ── 5. O VÍNCULO DO PORTAL ──────────────────────────────────────────────────────────────────
  // Todo produto com operador entra no recorte do portal dele, venha do portal ou do hub: o Setup
  // (gestao.ts) só oferece empreendimento do C2X, então um produto do Panteon sem este vínculo não
  // teria por onde ser liberado para quem o opera.
  let vinculadoAoPortal = false;
  if (incorporadorId) {
    const { error } = await admin.from(TABELA_DO_PORTAL).insert({
      carteira_administrada: false,
      enterprise_id: enterpriseId,
      incorporador_id: incorporadorId,
    });
    if (error) return falhaNoMeio(gravados, "o vínculo com o portal", error, produto.codigo);
    gravados.push({
      desfazer: () =>
        admin.from(TABELA_DO_PORTAL).delete().eq("incorporador_id", incorporadorId).eq("enterprise_id", enterpriseId),
      nome: "o vínculo com o portal",
    });
    vinculadoAoPortal = true;
  }

  // ── 6. O VÍNCULO DA CONTA (só quando ela tem recorte próprio) ───────────────────────────────
  let vinculadoAConta = false;
  if (incluirNaConta && autorId) {
    const { error } = await admin.from(TABELA_DA_CONTA).insert({ enterprise_id: enterpriseId, usuario_id: autorId });
    if (error) return falhaNoMeio(gravados, "o vínculo com a sua conta", error, produto.codigo);
    vinculadoAConta = true;
  }

  return {
    ok: true,
    produto: {
      codigo: produto.codigo,
      enterpriseId,
      nome: produto.nome,
      operadoPor: incorporadorId,
      paiId,
      produtoId,
      tipoProduto: produto.tipoProduto,
      vinculadoAConta,
      vinculadoAoPortal,
    },
  };
}

export type IncorporadorDoCadastro = { ativo: boolean; id: string; slug: string; tipo: TipoDePortal };

/**
 * O incorporador pelo slug, magro: só o que o cadastro de produto precisa para decidir.
 *
 * ⚠️ NÃO É `carregarIncorporadorPorSlug` (dados.ts) porque aquela devolve `null` tanto para portal
 * inativo quanto para banco fora, e aqui as duas respostas são diferentes: banco fora é 503, portal
 * inexistente é recusa. O slug passa por `chaveDoPortal`, que mata o `%` e o `_` do `ilike` antes da
 * consulta (senão `cec%` casaria com `cecilio-rocha`).
 */
export async function resolverIncorporadorPorSlug(
  admin: Cliente,
  slug: string,
): Promise<{ incorporador: IncorporadorDoCadastro | null; ok: true } | { ok: false }> {
  const alvo = chaveDoPortal(slug);
  if (!alvo) return { incorporador: null, ok: true };

  const { data, error } = await admin
    .from("apolo_incorporadores")
    .select("id,slug,tipo,ativo")
    .eq("workspace_id", WORKSPACE)
    .ilike("slug", alvo)
    .maybeSingle<{ ativo: boolean | null; id: string; slug: string; tipo: null | string }>();

  if (error) {
    console.error("[hercules][cadastrar-produto] falha ao ler o incorporador", error);
    return { ok: false };
  }
  if (!data) return { incorporador: null, ok: true };

  return {
    incorporador: { ativo: data.ativo === true, id: String(data.id), slug: String(data.slug), tipo: tipoDePortal(data.tipo) },
    ok: true,
  };
}
