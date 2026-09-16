// A LEITURA DO TERMO DE RESCISÃO — os três bancos que o papel de UM contrato precisa.
//
// A montagem é pura e mora em `termo-de-rescisao.ts`. Aqui só se busca, e cada fonte tem dono:
//
//   C2X (read-only) ....... o extrato do comprador (`loadExtratoDoCliente`, a mesma leitura da tela
//                           e do PDF do extrato), o empreendimento da unidade e o texto do contrato
//                           de corretagem. É financeiro e é o contrato assinado.
//   Panteon (Supabase) .... a posse (`hercules_posse`), o município e o PAI do empreendimento
//                           (`hercules_empreendimentos`) e as premissas de rescisão
//                           (`hercules_premissas_de_rescisao`).
//
// Esta é a peça que a rota `app/api/apolo/rescisao/pdf` chama, e é a MESMA que o script de prova
// com dado real chama — por isso ela não está dentro do `route.ts` (um arquivo de rota do Next só
// pode exportar os verbos e as constantes de configuração).
//
// ⚠️ NUNCA LANÇA. Toda falha vira `{ ok: false, status, error }` com a frase que a tela mostra.
//
// ⚠️ A REGRA QUE DECIDE CADA RAMO DE ERRO: "NÃO CONSEGUI LER" NÃO PODE VIRAR "NÃO TEM".
//   • posse ilegível → 503. Tratar como "sem posse" tiraria a fruição do papel, calado.
//   • cadastro do empreendimento ilegível → 503. Tratar como "sem pai" jogaria na praxe uma
//     premissa que está cadastrada no principal (mesma decisão da rota das premissas).
//   • premissas com a TABELA AUSENTE → segue com a praxe. Aqui "não existe" é FATO: a migration
//     0166 está aguardando aplicação, e sem tabela não há cadastro para perder. `calcularRescisao`
//     imprime no papel, rubrica por rubrica, que o percentual é o de praxe. No dia em que a tabela
//     existir, o mesmo código passa a ler o cadastro sem mudar uma linha.
//   • premissas com QUALQUER OUTRO erro → 503. A tabela existe e não respondeu: seguir com a praxe
//     imprimiria "não há premissa cadastrada" sobre um empreendimento que tem.
import type { RowDataPacket } from "mysql2";

import { hojeEmBrasilia } from "@/lib/apolo/extrato-cliente";
import { loadExtratoDoCliente } from "@/lib/apolo/extrato-cliente-c2x";
import {
  type LinhaDePremissa,
  premissasDoRecorte,
  type PremissasResolvidas,
} from "@/lib/apolo/premissas-de-rescisao";
import type { DadosDaRescisao } from "@/lib/apolo/rescisao-pdf";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  comissaoDoContratoDeCorretagem,
  montarDadosDaRescisao,
  motivoParaNaoEmitirTermo,
} from "@/lib/apolo/termo-de-rescisao";
import { getHadesDbPool } from "@/lib/guardian/db";
import { ehTabelaAusente } from "@/lib/temis/tabela-ausente";

// ⚠️ "careli", A STRING. As três tabelas do Panteon lidas aqui têm `workspace_id text default
// 'careli'` (migrations 0123, 0165 e 0166). Um uuid não dá erro de tipo: casa zero linhas em
// silêncio, e o termo sairia "sem posse" e "sem premissa" para todo contrato.
const WORKSPACE = "careli";
const TABELA_DAS_PREMISSAS = "hercules_premissas_de_rescisao";

type ClienteAdmin = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type TermoCarregado =
  | { dados: DadosDaRescisao; ok: true }
  | { error: string; ok: false; status: number };

type Lido<T> = ({ ok: true } & T) | { error: string; ok: false };

function falha(status: number, error: string): TermoCarregado {
  return { error, ok: false, status };
}

type ContratoNoC2xRow = RowDataPacket & {
  enterprise_id: null | number | string;
  texto_da_corretagem: null | string;
};

/**
 * O empreendimento da unidade e o texto do contrato de corretagem mais recente.
 *
 * ⚠️ O EMPREENDIMENTO NÃO VEM DO EXTRATO, e não é descuido do extrato: `ExtratoClienteContrato` só
 * carrega o CÓDIGO (LOS), e a chave das premissas e do cadastro do Panteon é o ID do C2X ("4").
 * Acrescentar o campo lá mexeria num tipo que a tela e os testes do extrato montam à mão.
 *
 * ⚠️ O CONTRATO DE CORRETAGEM MAIS RECENTE (`order by id desc`), como `lib/hades/dossie/dados.ts`
 * faz com o contrato principal: a venda pode ter o documento regerado, e o que vale é o último.
 */
async function lerContratoNoC2x(
  contratoId: number,
): Promise<Lido<{ comissaoEmReais: null | number; enterpriseId: null | string }>> {
  const poolResult = getHadesDbPool();
  if (!poolResult.ok) {
    return { error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`, ok: false };
  }

  try {
    const [rows] = await poolResult.pool.query<ContratoNoC2xRow[]>(
      `select
         eu.enterprise_id,
         (select arc.complete_text_brokerage
            from acquisition_request_contracts arc
           where arc.acquisition_request_id = ar.id
           order by arc.id desc
           limit 1) as texto_da_corretagem
       from acquisition_requests ar
       join enterprise_unities eu on eu.id = ar.enterprise_unity_id
       where ar.id = ?
       limit 1`,
      [contratoId],
    );

    const linha = rows[0];
    const enterpriseId = String(linha?.enterprise_id ?? "").trim();

    return {
      comissaoEmReais: comissaoDoContratoDeCorretagem(linha?.texto_da_corretagem ?? null),
      enterpriseId: enterpriseId || null,
      ok: true,
    };
  } catch (erro) {
    console.error("[apolo][rescisao] falha ao ler o contrato no C2X", erro);
    return { error: "Não foi possível ler o contrato no C2X.", ok: false };
  }
}

/**
 * A data da posse do contrato, ou `null`.
 *
 * ⚠️ `null` É O ESTADO NORMAL (ver `lib/apolo/posse.ts`): quem chega à rescisão está inadimplente e
 * nunca recebeu a posse. Erro de leitura é OUTRA coisa — ver o cabeçalho.
 */
async function lerPosse(
  admin: ClienteAdmin,
  contratoId: number,
): Promise<Lido<{ dataDaPosse: null | string }>> {
  const naoLi = "Não foi possível ler a posse deste contrato, e sem ela o termo não sabe se há fruição a deduzir.";

  try {
    const { data, error } = await admin
      .from("hercules_posse")
      .select("data_da_posse")
      .eq("workspace_id", WORKSPACE)
      .eq("contrato_c2x_id", contratoId)
      .maybeSingle();

    if (error) {
      console.error("[apolo][rescisao] posse", error.message);
      return { error: naoLi, ok: false };
    }

    const linha = (data ?? null) as null | { data_da_posse: null | string };
    return { dataDaPosse: String(linha?.data_da_posse ?? "").trim() || null, ok: true };
  } catch (erro) {
    console.error("[apolo][rescisao] posse", erro);
    return { error: naoLi, ok: false };
  }
}

type LinhaDoCadastro = {
  c2x_enterprise_id?: null | string;
  cidade: null | string;
  pai_id?: null | string;
  uf: null | string;
};

/**
 * O município do empreendimento e o id do C2X do PAI.
 *
 * ⚠️ O PAI SAI DE `hercules_empreendimentos.pai_id`, E NÃO DO C2X. O C2X não tem hierarquia: o
 * `enterprise_id` da unidade é o do FILHO (LOS = 4, VOC = 37) e nenhuma coluna de `enterprises`
 * aponta para o principal — as divisões foram, nas palavras do Lucas, "a nossa gambiarra" no
 * legado. O parentesco é CADASTRO do Panteon (migration 0123), e é dele que a tela de premissas lê
 * "herdada do empreendimento principal". Se o termo lesse o pai de outro lugar, a tela diria
 * "herdada" e o papel cairia na praxe — a mesma tela com duas verdades.
 *
 * ⚠️ E A LEITURA É A MESMA DA ROTA DAS PREMISSAS (`lerFamilia` em
 * `app/api/apolo/empreendimentos/premissas-de-rescisao/route.ts`): um nível só, sem `maybeSingle`
 * (cadastro duplicado não derruba o termo), e pai sem `c2x_enterprise_id` (o LOX da Lavra do Ouro)
 * vale como "sem pai", porque a tabela de premissas é chaveada por esse id. Não é importada de lá
 * porque arquivo de rota não exporta função — está na lista de dúvidas mover as duas para uma lib.
 *
 * ⚠️ O MUNICÍPIO TAMBÉM É CADASTRO DO PANTEON (regra do Lucas, 14/09/2026: "a parte cadastral é o
 * Apolo"). O filho que não tiver cidade herda a do pai, que é o referencial macro.
 */
async function lerFamilia(
  admin: ClienteAdmin,
  enterpriseId: null | string,
): Promise<Lido<{ cidade: null | string; paiEnterpriseId: null | string; uf: null | string }>> {
  if (!enterpriseId) return { cidade: null, ok: true, paiEnterpriseId: null, uf: null };

  const naoLi =
    "Não foi possível conferir o cadastro do empreendimento, e sem ele o termo não sabe se herda premissas do principal.";

  try {
    const { data, error } = await admin
      .from("hercules_empreendimentos")
      .select("cidade,pai_id,uf")
      .eq("workspace_id", WORKSPACE)
      .eq("c2x_enterprise_id", enterpriseId);

    if (error) {
      console.error("[apolo][rescisao] cadastro do empreendimento", error.message);
      return { error: naoLi, ok: false };
    }

    const linhas = (data ?? []) as LinhaDoCadastro[];
    const propria = linhas.find((linha) => String(linha.pai_id ?? "").trim()) ?? linhas[0];
    const paiId = String(propria?.pai_id ?? "").trim();

    let pai: LinhaDoCadastro | undefined;
    if (paiId) {
      const { data: dadosDoPai, error: erroDoPai } = await admin
        .from("hercules_empreendimentos")
        .select("c2x_enterprise_id,cidade,uf")
        .eq("workspace_id", WORKSPACE)
        .eq("id", paiId);

      if (erroDoPai) {
        console.error("[apolo][rescisao] cadastro do pai", erroDoPai.message);
        return { error: naoLi, ok: false };
      }
      pai = ((dadosDoPai ?? []) as LinhaDoCadastro[])[0];
    }

    const cidadePropria = String(propria?.cidade ?? "").trim();
    return {
      cidade: cidadePropria || String(pai?.cidade ?? "").trim() || null,
      ok: true,
      paiEnterpriseId: String(pai?.c2x_enterprise_id ?? "").trim() || null,
      uf: cidadePropria
        ? String(propria?.uf ?? "").trim() || null
        : String(pai?.uf ?? "").trim() || null,
    };
  } catch (erro) {
    console.error("[apolo][rescisao] cadastro do empreendimento", erro);
    return { error: naoLi, ok: false };
  }
}

type LinhaGravadaDaPremissa = {
  ativa: boolean | null;
  base: null | string;
  clausula: null | string;
  enterprise_id: null | string;
  percentual: null | number | string;
  periodicidade: null | string;
  rubrica: null | string;
};

/** `numeric` do PostgREST pode chegar como texto; vazio é "não cadastrado", e zero é zero. */
function percentualDoBanco(valor: null | number | string): null | number {
  if (valor === null || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

/**
 * As premissas que valem para a unidade, rubrica por rubrica, na régua categoria → filho → pai.
 *
 * ⚠️ QUEM DECIDE É `premissasDoRecorte`, não este arquivo. Aqui só se busca os dois degraus
 * (o empreendimento da unidade e o pai) e se entrega as linhas cruas. Não há degrau de categoria:
 * a tabela da 0166 não tem a coluna, e a régua trata "sem categoria" como o caso normal.
 */
async function lerPremissas(
  admin: ClienteAdmin,
  enterpriseId: null | string,
  paiEnterpriseId: null | string,
): Promise<Lido<{ resolvidas: PremissasResolvidas; tabelaAusente: boolean }>> {
  const vazias: PremissasResolvidas = { origemPorRubrica: {}, premissas: {} };
  if (!enterpriseId) return { ok: true, resolvidas: vazias, tabelaAusente: false };

  const degraus = paiEnterpriseId ? [enterpriseId, paiEnterpriseId] : [enterpriseId];
  const naoLi = "Não foi possível ler as premissas de rescisão deste empreendimento.";

  try {
    const { data, error } = await admin
      .from(TABELA_DAS_PREMISSAS)
      .select("rubrica,ativa,percentual,base,periodicidade,clausula,enterprise_id")
      .eq("workspace_id", WORKSPACE)
      .in("enterprise_id", degraus);

    if (error) {
      if (ehTabelaAusente(error, TABELA_DAS_PREMISSAS)) {
        return { ok: true, resolvidas: vazias, tabelaAusente: true };
      }
      console.error("[apolo][rescisao] premissas", error.message);
      return { error: naoLi, ok: false };
    }

    const linhas: LinhaDePremissa[] = ((data ?? []) as LinhaGravadaDaPremissa[]).map((linha) => ({
      // `=== true`, e não `Boolean()`: é a mesma porta estreita da rota das premissas.
      ativa: linha.ativa === true,
      base: String(linha.base ?? "").trim(),
      clausula: linha.clausula ?? null,
      enterpriseId: String(linha.enterprise_id ?? "").trim() || null,
      percentual: percentualDoBanco(linha.percentual),
      periodicidade: String(linha.periodicidade ?? "").trim(),
      rubrica: String(linha.rubrica ?? "").trim(),
    }));

    return {
      ok: true,
      resolvidas: premissasDoRecorte(
        { categoriaId: null, enterpriseId, paiEnterpriseId },
        linhas,
      ),
      tabelaAusente: false,
    };
  } catch (erro) {
    console.error("[apolo][rescisao] premissas", erro);
    return { error: naoLi, ok: false };
  }
}

export type EscopoDoTermo = {
  /** `users.id` do C2X — o mesmo `c2xId` do extrato. */
  c2xId: number;
  /** `acquisition_requests.id`. OBRIGATÓRIO: o termo é de um contrato, não do cliente. */
  contratoId: number;
  /** 'YYYY-MM-DD'. Default: hoje em Brasília. */
  hoje?: string;
};

/**
 * Tudo que o papel de UM contrato precisa, ou a frase de por que ele não sai.
 *
 * ⚠️ A RECUSA DO CONTRATO VEM ANTES DO SUPABASE. Contrato encerrado e unidade sem preço são
 * respondidos só com o extrato, e o operador lê a frase certa mesmo num ambiente sem Supabase.
 */
export async function carregarTermoDeRescisao(escopo: EscopoDoTermo): Promise<TermoCarregado> {
  const hoje = escopo.hoje ?? hojeEmBrasilia();

  const extrato = await loadExtratoDoCliente({
    c2xId: escopo.c2xId,
    contratoId: escopo.contratoId,
    hoje,
  });
  if (!extrato.ok) return falha(503, extrato.error);

  const relatorio = extrato.data.contratos.find(
    (item) => item.contrato.id === escopo.contratoId,
  );
  if (!relatorio) {
    return falha(
      404,
      "Este contrato não está entre os contratos com carteira deste cliente no C2X.",
    );
  }

  const motivo = motivoParaNaoEmitirTermo(relatorio);
  if (motivo) return falha(422, motivo);

  const admin = createApoloAdminClient();
  if (!admin) {
    return falha(
      503,
      "Supabase indisponível: sem ele o termo não sabe se há posse nem premissa cadastrada.",
    );
  }

  const [doC2x, posse] = await Promise.all([
    lerContratoNoC2x(escopo.contratoId),
    lerPosse(admin, escopo.contratoId),
  ]);
  if (!doC2x.ok) return falha(503, doC2x.error);
  if (!posse.ok) return falha(503, posse.error);

  const familia = await lerFamilia(admin, doC2x.enterpriseId);
  if (!familia.ok) return falha(503, familia.error);

  const premissas = await lerPremissas(admin, doC2x.enterpriseId, familia.paiEnterpriseId);
  if (!premissas.ok) return falha(503, premissas.error);

  if (premissas.tabelaAusente) {
    // Uma linha por emissão, em `info`: é a pendência conhecida da 0166, não um defeito.
    console.info("[apolo][rescisao] premissas: tabela ainda ausente, termo segue com a praxe.");
  }

  const montado = montarDadosDaRescisao({
    cidade: familia.cidade,
    cliente: {
      documentoMascarado: extrato.data.cliente.documentoMascarado,
      nome: extrato.data.cliente.nome,
    },
    comissaoEmReais: doC2x.comissaoEmReais,
    dataDaPosse: posse.dataDaPosse,
    emitidoEm: hoje,
    premissas: premissas.resolvidas.premissas,
    relatorio,
    uf: familia.uf,
  });

  return montado.ok ? { dados: montado.dados, ok: true } : falha(422, montado.error);
}
