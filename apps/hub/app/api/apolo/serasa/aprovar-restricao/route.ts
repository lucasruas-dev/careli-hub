import { NextResponse } from "next/server";

import { authorizeApoloCoordenacao } from "@/lib/apolo/auth";
import { registrarOverrideCredito } from "@/lib/apolo/credito-override";
import { destinoAposCredito } from "@/lib/apolo/destino-credito";
import { uploadApoloDocument } from "@/lib/apolo/documentos";
import { atualizarEtapa } from "@/lib/apolo/esteira";
import { lerCadDaEsteira, normalizarEnterpriseId } from "@/lib/apolo/esteira-cad";
import { resolverPrevendaHabilitada } from "@/lib/apolo/limite-credito";
import { comLimiteDeTempo, gerarESalvarCad } from "@/lib/apolo/salvar-cad";
import { createApoloAdminClient } from "@/lib/apolo/server";

// APROVAR COM RESTRIÇÃO (COORDENAÇÃO) — PROBLEMA 3 (Lucas, 04/08).
//
// Crédito reprovado no Serasa trava a ficha em `apolo_esteira.etapa = 'revisao'`. Esta rota é o
// ÚNICO caminho legítimo para destravar por decisão humana: a coordenação (admin/leader) aprova
// "com restrição", ANEXA a evidência do de-acordo (PDF/PNG/JPEG, obrigatória), e a esteira segue o
// fluxo normal — prevenda se ligada, senão credenciado (PROBLEMA 1, respeitado no `atualizarEtapa`).
//
// É esta rota que passa `saidaDeRevisaoAutorizada` ao `atualizarEtapa`; sem ela, sair de "revisao"
// para avançar é BARRADO (PROBLEMA 2). O clique cru do Board ("Aprovar crédito (coordenador)"), que
// empurrava reprovado -> prevenda sem nada disso, deixa de existir.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Sobe a evidência + regenera a CAD; folga para não estourar o tempo da função.
export const maxDuration = 30;

// Só a evidência do de-acordo: PDF, PNG ou JPEG. O filtro é por extensão E pelo mimeType informado.
const MIME_PERMITIDO: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
};
const MIMES_VALIDOS = new Set(Object.values(MIME_PERMITIDO));

// Teto do upload. ⚠️ ELE PRECISA SER MENOR QUE O DA PLATAFORMA, não maior.
//
// O arquivo viaja em base64 dentro do JSON, o que INFLA ~33%, e a Vercel corta o body em ~4,5 MB
// (ver [[reference_apolo_upload_413]]). Um teto de 8 MB aqui era uma promessa que a rota não podia
// cumprir: a evidência de 5 MB morria com um 413 da plataforma, antes de chegar neste arquivo, e a
// coordenação via um erro sem explicação. 3 MB de arquivo = ~4 MB de base64, com folga.
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_FILE_MB = 3;

// Resolve o tipo da evidência a partir do mimeType informado e/ou da extensão. Devolve o mime
// normalizado quando é PDF/PNG/JPEG, senão null (recusa).
function tipoEvidencia(fileName: string, mimeType: string | null): string | null {
  const porMime = (mimeType ?? "").trim().toLowerCase();
  if (MIMES_VALIDOS.has(porMime)) return porMime;
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME_PERMITIDO[ext] ?? null;
}

type Corpo = {
  enterpriseId?: null | number | string;
  entityId?: string;
  fileBase64?: string;
  fileName?: string;
  mimeType?: string;
  motivo?: string;
};

export async function POST(request: Request) {
  // Só a COORDENAÇÃO (admin/leader). Analista (operator) não destrava crédito reprovado.
  const auth = await authorizeApoloCoordenacao(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });

  const corpo = (await request.json().catch(() => ({}))) as Corpo;

  const entityId = (corpo.entityId ?? "").trim();
  const enterpriseId = normalizarEnterpriseId(corpo.enterpriseId);
  const fileBase64 = (corpo.fileBase64 ?? "").trim();
  const fileName = (corpo.fileName ?? "").trim();
  const motivo = (corpo.motivo ?? "").trim() || null;

  if (!entityId) {
    return NextResponse.json({ error: "Informe a ficha." }, { status: 400 });
  }
  if (!fileBase64 || !fileName) {
    return NextResponse.json(
      { error: "Anexe a evidência do de-acordo da coordenação (PDF, PNG ou JPEG)." },
      { status: 400 },
    );
  }

  const mime = tipoEvidencia(fileName, corpo.mimeType ?? null);
  if (!mime) {
    return NextResponse.json(
      { error: "A evidência precisa ser um arquivo PDF, PNG ou JPEG." },
      { status: 415 },
    );
  }

  // Tamanho aproximado a partir do comprimento do base64 (sem decodificar duas vezes).
  const corpoBase64 =
    fileBase64.startsWith("data:") && fileBase64.includes(",")
      ? fileBase64.slice(fileBase64.indexOf(",") + 1)
      : fileBase64;
  const bytesAprox = Math.floor((corpoBase64.length * 3) / 4);
  if (bytesAprox > MAX_FILE_BYTES) {
    return NextResponse.json(
      {
        error:
          `Evidência acima do limite de ${MAX_FILE_MB} MB. Se for um PDF grande, mande só a ` +
          `página do de-acordo, ou um print da tela.`,
      },
      { status: 413 },
    );
  }

  // SÓ FAZ SENTIDO SOBRE UM REPROVADO. Se a ficha não está em "revisao", não há crédito reprovado
  // para destravar — override aqui seria mexer numa ficha aprovada ou já credenciada. 409.
  const cad = await lerCadDaEsteira<{ enterprise_id: null | string; etapa: null | string }>(
    client,
    entityId,
    "enterprise_id, etapa",
    { enterpriseId },
  );
  if (cad?.etapa !== "revisao") {
    return NextResponse.json(
      {
        error:
          "Esta ficha não está em revisão de crédito. O override só se aplica a crédito reprovado.",
      },
      { status: 409 },
    );
  }

  // Empreendimento efetivo: o informado manda; sem ele, o da CAD que acabamos de ler. É ele que
  // decide o toggle e carimba o registro — não pode ficar vazio.
  const enterpriseIdEfetivo = enterpriseId ?? normalizarEnterpriseId(cad.enterprise_id);

  // Destino pela regra única (PROBLEMA 1): aprovado -> prevenda se ligada, senão credenciado.
  const prevendaHabilitada = await resolverPrevendaHabilitada(
    client,
    entityId,
    enterpriseIdEfetivo,
  );
  const destino = destinoAposCredito({ aprovado: true, prevendaHabilitada });

  // Nome do coordenador que está aprovando (para o rastro).
  const { data: operador } = await client
    .from("hub_users")
    .select("display_name, email")
    .eq("id", auth.userId)
    .maybeSingle<{ display_name: string | null; email: string | null }>();
  const aprovadoPorNome = operador?.display_name ?? operador?.email ?? null;

  // 1) A EVIDÊNCIA PRIMEIRO. Se o upload falhar, NÃO destrava — override sem evidência é o que a
  //    coordenação está justamente evitando.
  const upload = await uploadApoloDocument({
    adminClient: client,
    documentType: "aprovacao-credito-restricao",
    fileBase64,
    fileName,
    label: "Aprovação com restrição (coordenação)",
    metadataExtra: { enterpriseId: enterpriseIdEfetivo, motivo, origem: "override-credito" },
    mimeType: mime,
    ownerId: entityId,
    scope: "entidade",
    uploadedByName: aprovadoPorNome,
  });
  if (!upload.ok) {
    return NextResponse.json(
      { error: upload.error ?? "Não foi possível salvar a evidência." },
      { status: 500 },
    );
  }

  // 2) DESTRAVA A ESTEIRA. `saidaDeRevisaoAutorizada` é o que libera o guard do PROBLEMA 2. O motivo
  //    SOBRESCREVE o motivo de reprovação velho (o do Ramon ficou "Crédito reprovado…" mesmo depois
  //    de movido) por "Aprovado com restrição pela coordenação".
  const motivoEsteira = motivo
    ? `Aprovado com restrição pela coordenação. ${motivo}`
    : "Aprovado com restrição pela coordenação.";
  const transicao = await atualizarEtapa(client, entityId, destino, {
    atualizadoPor: auth.userId,
    enterpriseId: enterpriseIdEfetivo,
    motivo: motivoEsteira,
    saidaDeRevisaoAutorizada: true,
  });

  if (transicao.error) {
    // Evidência já subiu; a etapa não gravou (sem CAD, ou falha do banco). Devolve o erro para a
    // tela — a evidência fica na pasta do cliente e a coordenação pode repetir.
    return NextResponse.json(
      { error: transicao.error },
      { status: transicao.semCad || transicao.bloqueado ? 409 : 500 },
    );
  }

  // 3) RASTRO da decisão (quem/quando/por quê + evidência). A esteira já destravou, então uma falha
  //    aqui não desfaz nada — mas VOLTA para a tela em vez de virar um log que ninguém lê.
  const rastro = await registrarOverrideCredito({
    adminClient: client,
    aprovadoPor: auth.userId,
    aprovadoPorNome,
    destino: transicao.etapa,
    enterpriseId: enterpriseIdEfetivo ?? "",
    entityId,
    evidenciaDocId: upload.id ?? null,
    motivo,
  });

  // CAD VIVA: regenera com a etapa nova, como o move de etapa do Board faz. Best-effort e com teto
  // de tempo — a etapa já gravou; sob C2X lento a CAD não pode segurar a resposta.
  try {
    await comLimiteDeTempo(
      gerarESalvarCad(client, entityId, {
        enterpriseId: enterpriseIdEfetivo,
        uploadedByName: aprovadoPorNome,
      }),
      15000,
    );
  } catch {
    /* segue */
  }

  return NextResponse.json({
    data: {
      etapa: transicao.etapa,
      evidenciaDocId: upload.id ?? null,
      ok: true,
      // Null quando o rastro gravou nos dois lugares. Preenchido = a ficha destravou mas a decisão
      // ficou sem registro estruturado, e a tela avisa para alguém olhar.
      rastroIncompleto: rastro.erro,
    },
  });
}
