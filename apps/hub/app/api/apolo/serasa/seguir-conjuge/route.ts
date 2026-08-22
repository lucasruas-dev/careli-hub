import { NextResponse } from "next/server";

import { authorizeApoloCoordenacao } from "@/lib/apolo/auth";
import { registrarOverrideCredito } from "@/lib/apolo/credito-override";
import { destinoAposCredito } from "@/lib/apolo/destino-credito";
import { atualizarEtapa } from "@/lib/apolo/esteira";
import { normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
import { resolverLimiteCredito, resolverPrevendaHabilitada } from "@/lib/apolo/limite-credito";
import { avaliarCredito } from "@/lib/serasa/avaliacao";
import { createApoloAdminClient } from "@/lib/apolo/server";

// SEGUIR O CREDENCIAMENTO PELO CÔNJUGE — decisão humana, de ADMIN.
//
// Regra do Lucas (22/08): *"posso fazer análise de crédito do cônjuge, contudo eu tenho que
// aprovar se segue o cadastro pelo cônjuge ou não, não pode ser automático"*, e *"o botão de
// avançar com o cônjuge titular aparece somente para um perfil admin"*.
//
// ⚠️ POR QUE ISTO NÃO É CONSEQUÊNCIA DO SCORE. Até 22/08 a consulta do cônjuge, quando aprovada,
// chamava `atualizarEtapa` na hora e o credenciamento seguia sozinho. Só que trocar a renda que
// sustenta a compra é escolha COMERCIAL: muda quem assina, o regime de bens pesa, e o titular
// reprovado continua no contrato. Score aprovado é insumo da decisão, não a decisão.
//
// Mesma disciplina de `aprovar-restricao`: coordenação decide, a saída de "revisao" é autorizada
// explicitamente, e a decisão fica registrada com autor e motivo — não é um clique que some.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Corpo = {
  enterpriseId?: null | number | string;
  entityId?: string;
  motivo?: string;
};

export async function POST(request: Request) {
  // authorizeApoloCoordenacao = admin/leader. É o mesmo portão da aprovação com restrição.
  const auth = await authorizeApoloCoordenacao(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => ({}))) as Corpo;
  const entityId = String(corpo.entityId ?? "").trim();
  if (!entityId) {
    return NextResponse.json({ error: "Informe a ficha." }, { status: 400 });
  }

  const enterpriseId = normalizarEnterpriseId(corpo.enterpriseId);

  // A CONSULTA DO CÔNJUGE PRECISA EXISTIR E TER SIDO APROVADA. Sem isso, este caminho viraria um
  // "avançar sem crédito" com outro nome — e é justamente o que a esteira barra.
  // ⚠️ A finalidade é `analise-credito-conjuge` — é o valor que a rota de consulta grava
  // (consultar/route.ts:489). Chutar o nome aqui fazia a rota jurar que não havia consulta
  // nenhuma logo depois de o operador ter pago por ela.
  const { data: consulta } = await client
    .from("serasa_consultas")
    .select("id, created_at, resposta")
    .eq("entity_id", entityId)
    .eq("finalidade", "analise-credito-conjuge")
    .eq("status", "sucesso")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ created_at: string; id: string; resposta: unknown }>();

  if (!consulta) {
    return NextResponse.json(
      {
        error:
          "Nao existe consulta de credito do conjuge nesta ficha. Consulte o conjuge antes de " +
          "seguir por ele.",
      },
      { status: 412 },
    );
  }

  // ⚠️ O VEREDITO NÃO ESTÁ GRAVADO — ele é CALCULADO da resposta crua contra o limite do
  // empreendimento, do mesmo jeito que a tela faz. `resumo.aprovado` vem null em todas as
  // consultas, então testar aquele campo reprovava até quem tinha passado.
  const limite = await resolverLimiteCredito(client, entityId, enterpriseId);
  const veredito = consulta.resposta ? avaliarCredito(consulta.resposta, limite ?? 1000) : null;
  if (!veredito?.aprovado) {
    return NextResponse.json(
      { error: "A ultima consulta do conjuge nao foi aprovada. Nao da para seguir por ele." },
      { status: 412 },
    );
  }

  const prevenda = await resolverPrevendaHabilitada(client, entityId, enterpriseId);
  const destino = destinoAposCredito({ aprovado: true, prevendaHabilitada: prevenda });

  const motivo =
    String(corpo.motivo ?? "").trim() ||
    "Credenciamento segue pela renda do conjuge (credito do conjuge aprovado).";

  // ⚠️ `saidaDeRevisaoAutorizada`: a ficha está em "revisao" porque o TITULAR reprovou, e sair de
  // lá é barrado por padrão. Este é um dos dois caminhos legítimos de destrave — o outro é a
  // aprovação com restrição.
  const transicao = await atualizarEtapa(client, entityId, destino, {
    atualizadoPor: auth.userId,
    automatico: false,
    enterpriseId,
    motivo,
    saidaDeRevisaoAutorizada: true,
  });

  if (transicao?.error) {
    return NextResponse.json({ error: transicao.error }, { status: 500 });
  }

  // Nome de quem decidiu, para o rastro (mesmo padrão da aprovação com restrição).
  const { data: operador } = await client
    .from("hub_users")
    .select("display_name, email")
    .eq("id", auth.userId)
    .maybeSingle<{ display_name: null | string; email: null | string }>();

  // A decisão fica registrada com autor: daqui a três meses alguém vai perguntar por que esta
  // ficha andou com o titular reprovado.
  await registrarOverrideCredito({
    adminClient: client,
    aprovadoPor: auth.userId,
    aprovadoPorNome: operador?.display_name ?? operador?.email ?? null,
    destino,
    enterpriseId: String(enterpriseId ?? ""),
    entityId,
    evidenciaDocId: null,
    motivo,
  });

  return NextResponse.json({
    data: { destino, etapa: transicao?.etapa ?? destino, ok: true },
  });
}
