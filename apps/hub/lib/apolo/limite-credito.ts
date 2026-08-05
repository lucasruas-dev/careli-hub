// Resolução do LIMITE DE CRÉDITO do empreendimento de um cliente — a fonte única usada tanto na
// DECISÃO (aprovado/reprovado no /serasa/consultar) quanto na CAD (seção "Análise de crédito").
//
// Antes essa lógica vivia só no consultar/route.ts; a CAD recomputava o veredito com o default
// R$ 1.000 e podia CONTRADIZER a decisão (dizer APROVADO num aviso de reprovação quando o
// empreendimento tem limite abaixo de 1.000). Centralizar aqui garante que os dois usem o MESMO
// limite.

import { loadApoloEnterprises } from "@/lib/apolo/empreendimentos";
import { getLimiteCredito } from "@/lib/apolo/enterprise-settings";
import { lerCadDaEsteira, normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
import { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// Regra do Vale do Ouro, herdada quando o empreendimento não tem limite próprio.
export const LIMITE_CREDITO_PADRAO = 1000;

function normalizarNome(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

// NOME do empreendimento -> id do C2X. Exportada porque a importação do Asana precisa da MESMA
// tradução: lá a CAD só traz o nome ("Vale do Ouro"), e desde a 0080 a esteira exige o id.
// Best-effort: qualquer falha (C2X fora do ar, nome desconhecido) devolve null. Nunca lança.
export async function resolverEnterpriseIdPorNome(nome: null | string): Promise<string | null> {
  const bruto = (nome ?? "").trim();
  if (!bruto) return null;
  try {
    const alvoNome = normalizarNome(bruto);
    const alvoCode = bruto.toUpperCase();
    const c2x = await loadApoloEnterprises();
    if (!c2x.ok) return null;
    for (const row of c2x.data.rows) {
      // Produto consolidado tem id sintético ("group:..."): procura nas etapas, que carregam
      // o id REAL do C2X. Linha simples usa o próprio id.
      const candidatos = row.stages.length ? row.stages : [row];
      const match = candidatos.find(
        (candidato) =>
          normalizarNome(candidato.name) === alvoNome || candidato.code.toUpperCase() === alvoCode,
      );
      if (match) return match.id;
    }
    return null;
  } catch {
    return null;
  }
}

// Id do EMPREENDIMENTO (C2X) do cliente.
//
// ⚠️ DEPOIS DA 0080 ESTA PERGUNTA MUDOU DE SENTIDO: uma pessoa pode ter CAD em vários
// empreendimentos, e "o empreendimento do cliente" deixou de existir. Por isso o `enterpriseId`
// do chamador MANDA — quem sabe de qual CAD está falando não deve deixar a heurística decidir.
// Sem ele, a resposta é a CAD MAIS RECENTE, com ordem explícita (ver `lerCadDaEsteira`).
// Best-effort: qualquer falha devolve null. Nunca lança.
export async function resolverEnterpriseId(
  client: AdminClient,
  entityId: string,
  enterpriseId?: unknown,
): Promise<string | null> {
  const informado = normalizarEnterpriseId(enterpriseId);
  if (informado) return informado;

  try {
    const esteira = await lerCadDaEsteira<{
      empreendimento: string | null;
      enterprise_id: string | null;
    }>(client, entityId, "enterprise_id, empreendimento");

    if (!esteira) return null;

    const daLinha = (esteira.enterprise_id ?? "").trim();
    if (daLinha) return daLinha;

    // Linha legada sem id (antes do backfill de 04/08). A 0080 torna isso impossível para linhas
    // novas, mas o caminho fica: ler um banco não migrado não pode virar exceção.
    return await resolverEnterpriseIdPorNome(esteira.empreendimento);
  } catch {
    return null;
  }
}

// Limite DO EMPREENDIMENTO do cliente (em R$). null = usar o padrão da aplicação. Nunca lança.
export async function resolverLimiteCredito(
  client: AdminClient,
  entityId: string,
  enterpriseId?: unknown,
): Promise<number | null> {
  const alvo = await resolverEnterpriseId(client, entityId, enterpriseId);
  if (!alvo) return null;
  try {
    return await getLimiteCredito(client, alvo);
  } catch {
    return null;
  }
}

// A PRÉ-VENDA (PIX) está ligada no empreendimento do cliente? Decide, quando o crédito é
// aprovado, se a ficha vai para "prevenda" (gera PIX) ou direto para "credenciado". Default TRUE:
// sem empreendimento resolvido ou sem a coluna, mantém o comportamento de hoje (com PIX). Nunca lança.
export async function resolverPrevendaHabilitada(
  client: AdminClient,
  entityId: string,
  enterpriseId?: unknown,
): Promise<boolean> {
  const alvo = await resolverEnterpriseId(client, entityId, enterpriseId);
  if (!alvo) return true;
  try {
    const { data } = await client
      .from("apolo_enterprise_settings")
      .select("prevenda_habilitada")
      .eq("enterprise_id", alvo)
      .maybeSingle<{ prevenda_habilitada: boolean | null }>();
    return data?.prevenda_habilitada ?? true;
  } catch {
    return true;
  }
}

// A ANÁLISE DE CRÉDITO está ligada no empreendimento do cliente? Desligada = o lançamento não faz
// crédito, então NÃO se consulta o Serasa (consulta é paga): a ficha com documento OK avança
// direto. Default TRUE: sem empreendimento resolvido ou sem a coluna, mantém o comportamento de
// hoje (com análise). Nunca lança.
export async function resolverAnaliseHabilitada(
  client: AdminClient,
  entityId: string,
  enterpriseId?: unknown,
): Promise<boolean> {
  const alvo = await resolverEnterpriseId(client, entityId, enterpriseId);
  if (!alvo) return true;
  try {
    const { data } = await client
      .from("apolo_enterprise_settings")
      .select("analise_credito_habilitada")
      .eq("enterprise_id", alvo)
      .maybeSingle<{ analise_credito_habilitada: boolean | null }>();
    return data?.analise_credito_habilitada ?? true;
  } catch {
    return true;
  }
}
