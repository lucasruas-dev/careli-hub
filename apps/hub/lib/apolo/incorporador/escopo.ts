import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import {
  canonizador,
  idsDoEmpreendimento,
} from "@/lib/apolo/empreendimento-equivalencia";
import { getHadesDbPool } from "@/lib/guardian/db";

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
 * @param pedido O que a tela pediu. `null` = tudo o que a sessão autoriza.
 */
export async function codigosDaSessao(
  sessao: SessaoIncorporador,
  pedido?: null | string | string[],
): Promise<string[]> {
  const permitidos = empreendimentosPermitidos(sessao, pedido);
  if (permitidos.length === 0) return [];

  const catalogo = await catalogoDeEmpreendimentos(Date.now());
  if (catalogo.length === 0) return [];

  return codesDosIds(catalogo, permitidos);
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
 */
export async function unidadeNoEscopo(
  unitId: number | string,
  sessao: SessaoIncorporador,
): Promise<boolean> {
  const id = Number(unitId);
  if (!Number.isInteger(id) || id <= 0) return false;

  const pool = getHadesDbPool();
  if (!pool.ok) return false;

  try {
    const [linhas] = await pool.pool.query(
      "select u.enterprise_id from enterprise_unities u where u.id = ? limit 1",
      [id],
    );

    const dono = (linhas as Array<{ enterprise_id: null | number }>)[0]?.enterprise_id;
    if (dono == null) return false;

    // ⚠️ SEM CANONIZAR OS DOIS LADOS. Canonizar o dono da unidade e o id da sessão para o grupo
    // faria a unidade da gleba do Raposo passar no escopo de quem só tem a gleba do Fernando: as
    // duas viram "group:Lagoa Bonita". A conferência é contra os ids REAIS que a sessão alcança.
    const catalogo = await catalogoDeEmpreendimentos(Date.now());
    const permitidos = empreendimentosPermitidos(sessao);
    const daSessao = new Set(permitidos.map((eid) => String(eid).trim()));

    const alcanca = new Set<string>(daSessao);
    for (const emp of catalogo) {
      // Só o id do GRUPO na sessão traz as divisões junto.
      if (daSessao.has(emp.id)) {
        for (const stageId of emp.stageIds) alcanca.add(String(stageId));
      }
    }

    return alcanca.has(String(dono));
  } catch {
    // Falha de leitura NÃO autoriza. Fail-closed: sem conseguir provar que a unidade é dele, ela
    // não é dele.
    return false;
  }
}

/** Para quem não tem o empreendimento, ele não existe. 404, nunca 403. */
export function foraDoEscopo(): NextResponse {
  return NextResponse.json({ error: "Nao encontrado." }, { status: 404 });
}
