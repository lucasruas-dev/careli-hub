import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  FRASE_TROCA_DE_EMPREENDIMENTO,
  lerCadsDaEsteira,
  lerEmpreendimentosDoCadastro,
  lerVinculosDeEmpreendimento,
  mesmoEmpreendimento,
  normalizarEnterpriseId,
} from "@/lib/apolo/esteira-cad";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Exclui (ARQUIVA, mantém histórico) um relacionamento do cliente. Identifica pelo related_entity_id
// (quando o vínculo aponta para uma entidade) ou pelo label (contato leve). Arquiva TODAS as linhas
// que casam — a mesma entidade pode ter vindo em mais de um papel. Registra no histórico.
//
// ⚠️ O VÍNCULO DE EMPREENDIMENTO DA CAD NÃO SE EXCLUI POR AQUI (24/09/2026). Foi por esta rota que a
// CAD do JONATAS ficou no produto errado: o time arquivou o vínculo do Veredas do Ouro (19), criou o do
// Vale do Ouro (35), e a CAD (apolo_esteira) continuou no 19, porque esta rota nunca tocou a esteira.
// O card passou a dizer "Vale do Ouro" e a agir no 19: crédito pela regra do Veredas, coordenador do
// Vale do Ouro sem ver o cliente. Agora, arquivar o vínculo de empreendimento de quem tem CAD naquele
// produto responde 409 e aponta para o "Mover CAD" do Board, que move tudo junto.
//
// A trava é ESTREITA:
//   • só vínculo de EMPREENDIMENTO (imobiliária, corretor e contato seguem livres);
//   • só quando existe CAD da pessoa num empreendimento EQUIVALENTE (régua de mercado, nunca igualdade
//     crua: CAD em "group:Vale do Ouro" com vínculo no 37 é o mesmo produto);
//   • e só quando, depois do arquivamento, nenhum outro vínculo ativo cobriria essa CAD (limpar um
//     vínculo duplicado do mesmo produto continua possível).
//
// ⚠️ QUEM DECIDE É A EXISTÊNCIA DA CAD, NÃO O PERFIL (decisão do Zeus na revisão de 24/09/2026). A
// primeira versão isentava toda entidade com perfil imobiliária, porque o vínculo de empreendimento da
// imobiliária é o credenciamento dela. Mas imobiliária também compra: medido em 24/09/2026, das 481
// entidades com perfil imobiliária, 1 tem CAD (b343b378, CAD de cliente no 20, em validação, com o
// vínculo do 20 vindo do CAD público). A isenção pelo perfil deixava o "exclui e adiciona" recriar o
// caso do Jonatas nessa CAD. A imobiliária sem CAD (as outras 480) segue livre do mesmo jeito: sem CAD
// na esteira, a trava nem lê o cadastro.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A frase do 409, pronta para a tela (sem travessão). Não é exportada: arquivo de rota do Next só
// pode exportar os handlers e a configuração da rota (o build recusa outro nome).
// ⚠️ A segunda frase é a MESMA do 409 do Consultar crédito e das dicas do painel
// (`FRASE_TROCA_DE_EMPREENDIMENTO`): diz que é a coordenação quem move, porque esta rota aceita o
// analista e o Mover CAD é só de admin/leader.
const MENSAGEM_VINCULO_DA_CAD = `Este empreendimento é o da CAD. ${FRASE_TROCA_DE_EMPREENDIMENTO}`;

type LinhaDoVinculo = {
  id: string;
  label: string | null;
  metadata: unknown;
  relationship_type: null | string;
};

const comoRegistro = (valor: unknown): Record<string, unknown> =>
  valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};

/**
 * O arquivamento deixaria uma CAD sem o vínculo do produto dela? Devolve o `enterprise_id` dessa CAD,
 * ou null quando pode arquivar. ⚠️ LANÇA na falha de leitura (a rota responde 503).
 */
async function cadDoVinculo(
  client: NonNullable<ReturnType<typeof createApoloAdminClient>>,
  entityId: string,
  linhas: LinhaDoVinculo[],
): Promise<null | string> {
  const aArquivar = linhas
    .filter((linha) => linha.relationship_type === "empreendimento")
    .map((linha) => ({
      enterpriseId: normalizarEnterpriseId(comoRegistro(linha.metadata).enterpriseId),
      id: linha.id,
    }))
    .filter((v): v is { enterpriseId: string; id: string } => v.enterpriseId !== null);
  if (aArquivar.length === 0) return null;

  // Sem olhar o perfil (ver o cabeçalho): a imobiliária sem CAD sai logo abaixo, sem CAD na esteira.
  const cads = await lerCadsDaEsteira<{ enterprise_id: null | string }>(
    client,
    entityId,
    "enterprise_id",
    { limite: 50 },
  );
  if (cads.length === 0) return null;

  const cadastro = await lerEmpreendimentosDoCadastro(client);
  const saem = new Set(aArquivar.map((v) => v.id));
  // Os vínculos ativos que FICAM depois do arquivamento.
  const ficam = (await lerVinculosDeEmpreendimento(client, entityId)).filter(
    (v) => v.status !== "archived" && v.enterpriseId !== null && !saem.has(v.id),
  );

  for (const cad of cads) {
    const eid = normalizarEnterpriseId(cad.enterprise_id);
    if (!eid) continue;
    const daCad = (outro: null | string) => mesmoEmpreendimento(outro, eid, cadastro);
    if (aArquivar.some((v) => daCad(v.enterpriseId)) && !ficam.some((v) => daCad(v.enterpriseId))) {
      return eid;
    }
  }
  return null;
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Escrita indisponível." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as {
    entityId?: string;
    label?: string;
    relatedEntityId?: string | null;
  };
  const entityId = body.entityId?.trim();
  const relatedEntityId = body.relatedEntityId?.trim();
  const label = body.label?.trim();
  if (!entityId || (!relatedEntityId && !label)) {
    return NextResponse.json({ error: "Informe o relacionamento a excluir." }, { status: 400 });
  }

  const base = client
    .from("apolo_relationships")
    .select("id, label, metadata, relationship_type")
    .eq("entity_id", entityId)
    .neq("status", "archived");
  const sel = relatedEntityId
    ? base.eq("related_entity_id", relatedEntityId)
    : base.is("related_entity_id", null).eq("label", label ?? "");
  const { data: linhas, error: erroSel } = await sel.returns<LinhaDoVinculo[]>();
  if (erroSel) return NextResponse.json({ error: erroSel.message }, { status: 500 });
  if (!linhas?.length) {
    return NextResponse.json({ error: "Relacionamento não encontrado." }, { status: 404 });
  }

  // A TRAVA, antes de qualquer escrita. Leitura que falha não vira "pode arquivar": sem saber se o
  // vínculo é o da CAD, arquivar pode repetir o caso do Jonatas.
  let enterpriseIdDaCad: null | string;
  try {
    enterpriseIdDaCad = await cadDoVinculo(client, entityId, linhas);
  } catch {
    return NextResponse.json(
      { error: "Não foi possível conferir a CAD deste cliente agora. Tente de novo em instantes." },
      { status: 503 },
    );
  }
  if (enterpriseIdDaCad) {
    // `enterpriseIdDaCad` vai junto para a tela abrir o Mover CAD já com o `de` certo.
    return NextResponse.json(
      { enterpriseIdDaCad, error: MENSAGEM_VINCULO_DA_CAD },
      { status: 409 },
    );
  }

  const agora = new Date().toISOString();
  const rotulos = new Set<string>();
  for (const linha of linhas) {
    if (linha.label) rotulos.add(linha.label);
    const meta = { ...comoRegistro(linha.metadata) };
    await client
      .from("apolo_relationships")
      .update({
        metadata: { ...meta, arquivadoEm: agora, arquivadoPor: auth.userId },
        status: "archived",
        updated_at: agora,
      })
      .eq("id", linha.id);
  }

  await client.from("apolo_timeline_events").insert({
    description: "Vínculo arquivado pelo Apolo.",
    entity_id: entityId,
    event_type: "relacionamento_excluido",
    metadata: { por: auth.userId, relatedEntityId: relatedEntityId ?? null },
    occurred_at: agora,
    status: "attention",
    title: `Relacionamento removido: ${[...rotulos].join(", ") || "vínculo"}`,
  });

  return NextResponse.json({ data: { arquivados: linhas.length, ok: true } });
}
