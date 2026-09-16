import { NextResponse } from "next/server";

import {
  catalogoDeEmpreendimentos,
  type EmpreendimentoDoCatalogo,
} from "@/lib/apolo/catalogo-empreendimentos";
import { idsDoEmpreendimento } from "@/lib/apolo/empreendimento-equivalencia";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { EXCLUDED_ENTERPRISE_CODES } from "@/lib/guardian/c2x-analytics";
import { getHadesDbPool } from "@/lib/guardian/db";
import {
  carregarCadastroDeEmpreendimentos,
  type LinhaDoCadastro,
  soDoPanteon,
} from "@/lib/hercules/cadastro";
import { ehIdDoPanteon } from "@/lib/hercules/produto-novo";

import { empreendimentosPermitidos, sessaoDoRequest, type SessaoIncorporador } from "./sessao";

// O ESCOPO DO INCORPORADOR: por onde TODA consulta nova do portal tem que passar.
//
// ⚠️ POR QUE ISTO EXISTE. O portal já tem sessão assinada com os empreendimentos do cliente, e
// `empreendimentosPermitidos` já sabe filtrar — mas nenhuma rota de produção passava por ele
// (grep em 17/08/2026: só o próprio teste). Enquanto isso, as leituras que a Carteira e a tela de
// Unidade precisam (`loadApoloVendaProposta`, `loadApoloUnitInstallments`) recebem só um `unitId`
// e NÃO filtram empreendimento nenhum: elas nasceram para o Apolo interno, onde o gate é o papel
// no Hub. Reusá-las no portal como estão deixaria o incorporador pedir qualquer unidade do C2X e
// receber a proposta e as parcelas de um comprador de outro loteamento.
//
// Já existe o mesmo risco mapeado no masterplan (o Cecílio, que só tem o VOC, recebendo o mapa
// inteiro do Vale do Ouro com os lotes do Lino). A regra é a mesma dos dois lados: o cliente vê o
// que é dele, e o "dele" sai do TOKEN, nunca da URL.

export type ContextoDoIncorporador = {
  sessao: SessaoIncorporador;
};

export type Autorizacao =
  | { ok: false; response: NextResponse }
  | { ok: true } & ContextoDoIncorporador;

/** Porta de entrada de toda rota `/api/incorporador/*`. Sem sessão válida, 401 seco. */
export function autorizar(request: Request): Autorizacao {
  const sessao = sessaoDoRequest(request);
  if (!sessao) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Sessao expirada." }, { status: 401 }),
    };
  }
  return { ok: true, sessao };
}

/**
 * Os CÓDIGOS dos empreendimentos que esta sessão enxerga (VOC, LBF…).
 *
 * A sessão guarda ids do C2X; quase toda leitura de negócio (carteira, vendas, unidades) recebe
 * `codes`. Esta é a ponte, e ela existe num lugar só porque a tradução feita na mão em cada rota
 * é onde nasce o furo: basta uma esquecer.
 *
 * ⚠️ O PRODUTO NASCIDO NO PANTEON ENTRA AQUI, e não rota a rota. Até 16/09/2026 a tradução passava
 * SÓ pelo catálogo do C2X (um select em `enterprises` do legado), e produto cadastrado no Panteon
 * (id a partir de 100000, e o ZZ TESTE 9001) não virava código: sumia de vendas, contratos,
 * assinaturas, espelho, CRM, carteira e masterplan. Cada rota que precisava dele somava
 * `soDoPanteon` por conta própria, e as que não somavam ficavam cegas. Com a decisão do Lucas
 * (16/09/2026: mesmo banco, mesmas tabelas, cada produto marca quem opera), o portal da Cecílio
 * passa a ter produto só do Panteon como regra, não como exceção de teste.
 *
 * É TRADUÇÃO, NÃO PERMISSÃO (a regra de `soDoPanteon`): só entra o id que a sessão JÁ traz. As rotas
 * que ainda somam `soDoPanteon`/`propriosDoPortal` continuam certas, porque a soma é por `Set`.
 *
 * ⚠️ UMA FONTE CAIR NÃO DERRUBA A OUTRA, MAS NÃO ESCONDE A QUEDA. Cadastro fora do ar: sai o que o
 * C2X traduz, como antes. C2X fora do ar: só a sessão 100% do Panteon ganha código; com qualquer id do
 * legado na sessão sai vazio, e a rota responde o 503 de sempre (ver `codigosDoEscopo`).
 *
 * @param pedido O que a tela pediu. `null` = tudo o que a sessão autoriza.
 */
export async function codigosDaSessao(
  sessao: SessaoIncorporador,
  pedido?: null | string | string[],
): Promise<string[]> {
  const permitidos = empreendimentosPermitidos(sessao, pedido);
  if (permitidos.length === 0) return [];

  // As duas leituras não dependem uma da outra. O catálogo tem cache de 10 minutos; o cadastro
  // são dezenas de linhas no Supabase.
  const [catalogo, cadastro] = await Promise.all([
    catalogoDeEmpreendimentos(Date.now()),
    cadastroDoPanteonOuNulo(),
  ]);

  return codigosDoEscopo({ cadastro, catalogo, permitidos });
}

/** O cadastro do Panteon, ou `null` quando a leitura falha (quem chama degrada, não cai). */
async function cadastroDoPanteonOuNulo(): Promise<LinhaDoCadastro[] | null> {
  try {
    return await carregarCadastroDeEmpreendimentos();
  } catch (erro) {
    console.error("[incorporador][escopo] cadastro do Panteon indisponível", erro);
    return null;
  }
}

/**
 * O núcleo PURO de `codigosDaSessao`: o que o C2X traduz mais o que só o Panteon conhece.
 *
 * ⚠️ C2X FORA DO AR COM ID DO LEGADO NA SESSÃO: VAZIO (revisão de 16/09/2026). As rotas de vendas,
 * CRM e carteira leem "zero código" como "C2X fora" e respondem 503 controlado; os loaders delas
 * (`loadApoloEnterpriseVendas`, `loadApoloEnterpriseCarteira`) vão ao MySQL sem `try/catch` e LANÇAM.
 * Se o cadastro respondesse pelos códigos do legado, a rota seguiria para o loader, esperaria o
 * timeout do MySQL de novo e cairia num 500 sem JSON, que quebra a tela. Sessão só com produto do
 * Panteon (id >= 100000) não depende do C2X e continua com os códigos dela.
 *
 * @param cadastro   `null` = a leitura do cadastro falhou; sai só o que o catálogo traduz.
 * @param catalogo   Vazio = C2X fora do ar (sem cache); ver o aviso acima.
 * @param permitidos Os ids da sessão JÁ recortados pelo pedido (`empreendimentosPermitidos`).
 */
export function codigosDoEscopo(entrada: {
  cadastro: LinhaDoCadastro[] | null;
  catalogo: EmpreendimentoDoCatalogo[];
  permitidos: string[];
}): string[] {
  const { cadastro, catalogo, permitidos } = entrada;
  if (permitidos.length === 0) return [];
  if (catalogo.length === 0 && permitidos.some((id) => !ehIdDoPanteon(String(id).trim()))) return [];

  const doC2x = catalogo.length > 0 ? codesDosIds(catalogo, permitidos) : [];
  const doPanteon = linhasSoDoPanteon({ cadastro, catalogo, permitidos }).map((l) => l.codigo);

  return [
    ...new Set(
      [...doC2x, ...doPanteon].map((code) => String(code ?? "").trim().toUpperCase()).filter(Boolean),
    ),
  ];
}

/**
 * As linhas do cadastro do Panteon que a sessão alcança e o catálogo do C2X NÃO traduz.
 *
 * É a mesma regra de `soDoPanteon` (o id tem que estar na sessão; o que o C2X conhece fica com o
 * C2X), com DUAS travas a mais (o LAB 31 no cadastro é o da leitura de 08/09/2026 registrada em
 * produtos-do-portal.test.ts; não medi o banco de novo em 16/09):
 *
 *   • ⚠️ O CÓDIGO EXCLUÍDO DO CATÁLOGO NÃO VOLTA PELA PORTA DOS FUNDOS. O LAB (31, o espelho da
 *     Lagoa Bonita) está no cadastro e em `EXCLUDED_ENTERPRISE_CODES`: o catálogo o tira de
 *     propósito, e por isso ele "não existe no C2X" para `soDoPanteon`. A sessão do /gurgel carrega
 *     o 31; sem esta trava o LAB viraria código em toda rota e o consolidado contaria a Lagoa Bonita
 *     duas vezes (espelho + glebas). Produto nascido no Panteon (id >= 100000) não cai nesta trava,
 *     mesmo que alguém o batize com uma dessas siglas.
 *   • ⚠️ C2X FORA DO AR (catálogo vazio, sem cache): não há como saber quem é do legado, e o
 *     cadastro responde por TODOS os ids da sessão. Não amplia: o id continua saindo da sessão, e o
 *     código do cadastro é o mesmo do C2X para o mesmo id (o semeador copiou do legado; produto novo
 *     não pode repetir código de nenhum dos dois). Um id de GRUPO ("group:Lagoa Bonita") não tem
 *     linha no cadastro e fica de fora: menos que o correto, nunca mais.
 *
 * Exportada porque o painel de Produtos e a rota de cards precisam da LINHA (nome, cidade, UF), e
 * não só do código.
 */
export function linhasSoDoPanteon(entrada: {
  cadastro: LinhaDoCadastro[] | null;
  catalogo: Array<Pick<EmpreendimentoDoCatalogo, "stageIds">>;
  permitidos: Iterable<string>;
}): LinhaDoCadastro[] {
  const { cadastro, catalogo } = entrada;
  if (!cadastro || cadastro.length === 0) return [];

  const idsNoC2x = new Set(catalogo.flatMap((emp) => emp.stageIds.map((id) => String(id).trim())));
  const excluidos = new Set(EXCLUDED_ENTERPRISE_CODES.map((code) => code.toUpperCase()));

  const ids = new Set(
    soDoPanteon(cadastro, [...entrada.permitidos], idsNoC2x)
      .filter((p) => ehIdDoPanteon(p.enterpriseId) || !excluidos.has(p.codigo.toUpperCase()))
      .map((p) => p.enterpriseId),
  );

  const vistos = new Set<string>();
  return cadastro.filter((linha) => {
    const id = linha.c2xEnterpriseId;
    if (!id || !ids.has(id) || vistos.has(id) || !linha.codigo) return false;
    vistos.add(id);
    return true;
  });
}

/**
 * Traduz ids autorizados em códigos, SEM ampliar o escopo.
 *
 * ⚠️ A EQUIVALÊNCIA SÓ VALE NO SENTIDO GRUPO → DIVISÕES, e essa assimetria é a regra de negócio.
 * Para a IMOBILIÁRIA, Lagoa Bonita é um empreendimento só ("para eles não tem essa de divisão,
 * isso é interno"). Para o INCORPORADOR, não: cada divisão é a gleba de um responsável DIFERENTE
 * (LBF é do Fernando, LBR do Raposo, LBP do Paulo). Tratá-los como a mesma coisa aqui entrega a
 * carteira de um para o outro.
 *
 * Então:
 *   • sessão com `group:Lagoa Bonita` → LBF + LBR + LBP (ele é dono do conjunto);
 *   • sessão com `33` (LBF)          → SÓ o LBF.
 *
 * Vale igual para Lavra do Ouro, Rio de Pedras e Portal dos Vales. E não é hipotético: a tela de
 * gestão lista os empreendimentos direto de `enterprises`, sem agrupar, então um incorporador
 * desses nasce obrigatoriamente com id de DIVISÃO.
 */
function codesDosIds(
  catalogo: Awaited<ReturnType<typeof catalogoDeEmpreendimentos>>,
  permitidos: string[],
): string[] {
  const daSessao = new Set(permitidos.map((id) => String(id).trim()));
  const codes: string[] = [];

  for (const emp of catalogo) {
    // O id do GRUPO na sessão significa o conjunto inteiro.
    if (daSessao.has(emp.id)) {
      codes.push(...emp.codes);
      continue;
    }

    // Id de DIVISÃO: entra só o código daquela divisão, na posição correspondente.
    emp.stageIds.forEach((stageId, i) => {
      if (!daSessao.has(String(stageId))) return;
      const code = emp.codes[i];
      if (code) codes.push(code);
    });
  }

  return [...new Set(codes.filter(Boolean))];
}

/**
 * Os IDS de empreendimento que esta sessão enxerga — todos os formatos equivalentes.
 *
 * ⚠️ POR QUE ISTO EXISTE AO LADO DE `codigosDaSessao`. As leituras do C2X recebem CÓDIGO (VOC,
 * LBF); as tabelas do Apolo (`apolo_esteira.enterprise_id`, `apolo_relationships.metadata
 * ->>enterpriseId`) guardam ID. E guardam em DOIS formatos ao mesmo tempo: medido em 17/08/2026,
 * os vínculos de empreendimento têm 150 linhas com a divisão ("35", "38", "40") e 1 com o grupo
 * ("group:Lagoa Bonita"). Comparar só um dos formatos é a falha descrita em
 * [[empreendimento-equivalencia]]: a habilitação existe no banco e não existe na prática.
 *
 * Devolve, para cada empreendimento autorizado, o id do grupo E o de cada divisão — é a lista que
 * um `in (...)` pode usar direto sem perder ninguém.
 *
 * @param pedido O que a tela pediu. `null` = tudo o que a sessão autoriza.
 */
export async function idsDaSessao(
  sessao: SessaoIncorporador,
  pedido?: null | string | string[],
): Promise<string[]> {
  const permitidos = empreendimentosPermitidos(sessao, pedido);
  if (permitidos.length === 0) return [];

  const catalogo = await catalogoDeEmpreendimentos(Date.now());

  // Sem catálogo (C2X fora do ar) não há como expandir grupo em divisões. Devolver o que a sessão
  // traz é menos que o correto, nunca mais — e assim a tela mostra o que dá, em vez de nada.
  if (catalogo.length === 0) return [...new Set(permitidos)];

  // Mesma assimetria de `codesDosIds`: o id do GRUPO abre as divisões; o id de uma DIVISÃO vale
  // só por ela. Sem isto, quem tem a gleba do Fernando passa a ler as CADs das glebas do Raposo e
  // do Paulo — pessoas, documentos e corretores de carteira alheia.
  const daSessao = new Set(permitidos.map((id) => String(id).trim()));
  const ids: string[] = [];

  for (const emp of catalogo) {
    if (daSessao.has(emp.id)) {
      // Dono do conjunto: o id do grupo e o de cada divisão.
      ids.push(...idsDoEmpreendimento(emp));
      continue;
    }
    for (const stageId of emp.stageIds) {
      if (daSessao.has(String(stageId))) ids.push(String(stageId));
    }
  }

  // O que a sessão traz entra sempre: se o empreendimento sumiu do catálogo, o id gravado no
  // vínculo continua valendo — some do C2X, não da permissão.
  return [...new Set([...ids, ...permitidos])].filter(Boolean);
}

/**
 * A UNIDADE pertence a um empreendimento desta sessão?
 *
 * ⚠️ É A CONSULTA QUE NINGUÉM FAZIA, e a razão de este arquivo existir. As leituras por unidade
 * recebem um id numérico da URL; sem esta conferência, trocar o número na barra de endereço
 * devolve o contrato de outro loteamento — nome do comprador, valor, parcelas.
 *
 * Roda ANTES da leitura, nunca depois: conferir o escopo com o dado já em mãos é o mesmo que não
 * conferir, porque o dado já saiu do banco e basta um `console.log` mal colocado para vazar.
 *
 * ⚠️ DOIS TIPOS DE UNIDADE, DUAS FONTES DO DONO. Id numérico é unidade do C2X (`enterprise_unities`,
 * no MySQL, como sempre foi). Uuid é unidade do PANTEON (`hercules_unidades.id`): é onde nasce a
 * unidade do produto cadastrado pelo portal (decisão do Lucas, 16/09/2026: o C2X é somente
 * leitura), e ela não tem id no legado. Antes disto o uuid caía no `Number()` e respondia "não é
 * sua" para a unidade de um produto que É da sessão. A régua de quem alcança o dono é a MESMA
 * para as duas (`alcanceDaSessao`).
 */
export async function unidadeNoEscopo(
  unitId: number | string,
  sessao: SessaoIncorporador,
): Promise<boolean> {
  const tipo = tipoDoIdDeUnidade(unitId);
  if (!tipo) return false;

  try {
    const dono =
      tipo === "c2x" ? await donoNoC2x(Number(unitId)) : await donoNoPanteon(String(unitId).trim());
    if (dono === null) return false;

    const catalogo = await catalogoDeEmpreendimentos(Date.now());
    return alcanceDaSessao(catalogo, empreendimentosPermitidos(sessao)).has(dono);
  } catch {
    // Falha de leitura NÃO autoriza. Fail-closed: sem conseguir provar que a unidade é dele, ela
    // não é dele.
    return false;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * De qual cadastro é o id que veio da URL. `null` = não é id de unidade nenhuma (e a rota responde
 * como unidade inexistente, sem consulta).
 */
export function tipoDoIdDeUnidade(unitId: unknown): "c2x" | "panteon" | null {
  if (typeof unitId === "number") return Number.isInteger(unitId) && unitId > 0 ? "c2x" : null;
  if (typeof unitId !== "string") return null;

  const limpo = unitId.trim();
  if (/^\d{1,15}$/.test(limpo)) return Number(limpo) > 0 ? "c2x" : null;
  return UUID.test(limpo) ? "panteon" : null;
}

/**
 * Os ids REAIS que a sessão alcança: os dela, mais as divisões de cada GRUPO que ela traz inteiro.
 *
 * ⚠️ SEM CANONIZAR OS DOIS LADOS. Canonizar o dono da unidade e o id da sessão para o grupo faria a
 * unidade da gleba do Raposo passar no escopo de quem só tem a gleba do Fernando: as duas viram
 * "group:Lagoa Bonita". A conferência é contra os ids REAIS que a sessão alcança.
 *
 * Produto do Panteon não tem grupo: o id dele está na sessão e passa pela primeira regra.
 */
export function alcanceDaSessao(
  catalogo: Array<Pick<EmpreendimentoDoCatalogo, "id" | "stageIds">>,
  permitidos: string[],
): Set<string> {
  const daSessao = new Set(permitidos.map((eid) => String(eid).trim()).filter(Boolean));
  const alcanca = new Set<string>(daSessao);

  for (const emp of catalogo) {
    // Só o id do GRUPO na sessão traz as divisões junto.
    if (daSessao.has(emp.id)) {
      for (const stageId of emp.stageIds) alcanca.add(String(stageId).trim());
    }
  }

  return alcanca;
}

async function donoNoC2x(id: number): Promise<null | string> {
  const pool = getHadesDbPool();
  if (!pool.ok) return null;

  const [linhas] = await pool.pool.query(
    "select u.enterprise_id from enterprise_unities u where u.id = ? limit 1",
    [id],
  );

  const dono = (linhas as Array<{ enterprise_id: null | number }>)[0]?.enterprise_id;
  return dono == null ? null : String(dono).trim();
}

async function donoNoPanteon(id: string): Promise<null | string> {
  const admin = createApoloAdminClient();
  if (!admin) return null;

  const { data, error } = await admin
    .from("hercules_unidades")
    .select("enterprise_id")
    .eq("workspace_id", "careli")
    .eq("id", id)
    .maybeSingle<{ enterprise_id: null | string }>();

  // Erro de leitura sobe para o `catch` de quem chama: fail-closed, nunca "não achei, então passa".
  if (error) throw new Error(error.message);

  const dono = String(data?.enterprise_id ?? "").trim();
  return dono || null;
}

/** Para quem não tem o empreendimento, ele não existe. 404, nunca 403. */
export function foraDoEscopo(): NextResponse {
  return NextResponse.json({ error: "Nao encontrado." }, { status: 404 });
}
