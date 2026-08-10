import { NextResponse } from "next/server";

import {
  loadApoloEnterprises,
  type ApoloEnterpriseRow,
} from "@/lib/apolo/empreendimentos";
import { listEnterpriseLogos } from "@/lib/apolo/enterprise-logos";
import { sessaoDoRequest } from "@/lib/apolo/incorporador/sessao";
import { createApoloAdminClient } from "@/lib/apolo/server";

// PRODUTOS: um card por empreendimento do incorporador logado.
//
// O recorte NÃO vem da query string: sai do cookie assinado. Uma rota de portal externo que
// aceitasse `enterpriseId` do cliente seria a mesma porta que o CRM interno abre de propósito
// para o analista — e aqui de propósito não pode.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export type ProdutoDoIncorporador = {
  carteiraAdministrada: boolean;
  code: string;
  /** Ids REAIS do C2X que este card representa (mais de um quando o produto tem etapas). */
  enterpriseIds: string[];
  id: string;
  logoUrl: string | null;
  nome: string;
};

/**
 * O Apolo consolida etapas do mesmo produto numa linha só (Lavra do Ouro = LOS + LOU, Lagoa
 * Bonita = três glebas), e a linha consolidada tem id sintético `group:<nome>`, não um id do
 * C2X. A permissão do incorporador é por id REAL, então:
 *
 *   • grupo com TODAS as etapas liberadas -> um card só, com o nome do produto (é assim que o
 *     dono chama: "Lavra do Ouro", não "LOS e LOU");
 *   • grupo com só ALGUMAS liberadas -> um card por etapa, porque juntar somaria número de
 *     empreendimento que este incorporador não pode ver;
 *   • linha simples -> um card, o caso do piloto (Garden e Vale do Ouro não são agrupados).
 */
function recortar(
  linhas: ApoloEnterpriseRow[],
  permitidos: Set<string>,
): ApoloEnterpriseRow[] {
  const saida: ApoloEnterpriseRow[] = [];

  for (const linha of linhas) {
    const etapas = linha.stages ?? [];

    if (etapas.length === 0) {
      if (permitidos.has(String(linha.id))) saida.push(linha);
      continue;
    }

    const liberadas = etapas.filter((etapa) => permitidos.has(String(etapa.id)));

    if (liberadas.length === 0) continue;
    if (liberadas.length === etapas.length) {
      saida.push(linha);
      continue;
    }

    saida.push(...liberadas);
  }

  return saida;
}

function idsReais(linha: ApoloEnterpriseRow): string[] {
  const etapas = linha.stages ?? [];

  return etapas.length > 0
    ? etapas.map((etapa) => String(etapa.id))
    : [String(linha.id)];
}

export async function GET(request: Request) {
  const sessao = sessaoDoRequest(request);

  if (!sessao) {
    return NextResponse.json({ error: "Sessão ausente." }, { status: 401 });
  }

  const permitidos = new Set(sessao.enterpriseIds);
  const comCarteira = new Set(sessao.enterpriseIdsComCarteira);

  const c2x = await loadApoloEnterprises();

  if (!c2x.ok) {
    return NextResponse.json(
      { error: "Não foi possível carregar os empreendimentos agora." },
      { status: 503 },
    );
  }

  // Logo por empreendimento (a que o operador sobe na ficha). Falha aqui não derruba a tela: o
  // card cai no nome, mesmo comportamento do LogoEmpreendimento no resto do sistema.
  const admin = createApoloAdminClient();
  const logos: Record<string, string | null> = admin
    ? await listEnterpriseLogos(admin).catch(() => ({}))
    : {};

  const produtos: ProdutoDoIncorporador[] = recortar(c2x.data.rows, permitidos)
    .map((linha) => {
      const ids = idsReais(linha);

      return {
        // Carteira do produto: basta UMA etapa administrada para a aba fazer sentido no card.
        carteiraAdministrada: ids.some((id) => comCarteira.has(id)),
        code: linha.code ?? "",
        enterpriseIds: ids,
        id: String(linha.id),
        logoUrl: ids.map((id) => logos[id]).find(Boolean) ?? null,
        nome: linha.name ?? linha.code ?? "Empreendimento",
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

  return NextResponse.json(
    { data: { produtos } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
