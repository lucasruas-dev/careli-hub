import { NextResponse } from "next/server";

import { getApoloDocumentSignedUrl } from "@/lib/apolo/documentos";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { authorizeHadesWrite } from "@/lib/guardian/auth";
import { gerarDossieJuridico } from "@/lib/hades/dossie/gerar";

// DOSSIÊ JURÍDICO — gera o relatório executivo da negociação e anexa nos documentos do cliente.
//
// POST porque escreve (cria documento na ficha) e porque `authorizeHadesWrite` é o único que
// devolve o NOME do usuário logado — e o nome é o "Responsável pela Elaboração" impresso na capa
// do documento que vai para o processo. Com `authorizeHadesRead` só viria o id.

export const dynamic = "force-dynamic";
// pdf-lib + mysql2 não rodam no edge.
export const runtime = "nodejs";
// A geração toca o C2X (MySQL legado) e o Supabase, e a memória de cálculo pode ter centenas de
// parcelas. 30s é o teto observado nas rotas de PDF do Apolo.
export const maxDuration = 30;

type Corpo = {
  acquisitionRequestId?: number | string;
  correcaoPercent?: null | number | string;
  correcaoReferencia?: null | string;
  motivoEncaminhamento?: string;
  processo?: null | string;
  recomendacao?: string;
};

export async function POST(request: Request) {
  const auth = await authorizeHadesWrite(request);
  if (!auth.ok) return auth.response;

  let corpo: Corpo;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  // ⚠️ `client.c2xAcquisitionRequestId` chega como STRING da UI; o agregador exige número.
  const acquisitionRequestId = Number(corpo.acquisitionRequestId);
  if (!Number.isFinite(acquisitionRequestId) || acquisitionRequestId <= 0) {
    return NextResponse.json({ error: "Negociação não informada." }, { status: 400 });
  }

  const motivoEncaminhamento = (corpo.motivoEncaminhamento ?? "").trim();
  const recomendacao = (corpo.recomendacao ?? "").trim();
  if (!motivoEncaminhamento) {
    return NextResponse.json({ error: "Informe o motivo do encaminhamento." }, { status: 400 });
  }
  if (!recomendacao) {
    return NextResponse.json({ error: "Informe a recomendação operacional." }, { status: 400 });
  }

  // Correção monetária é digitada (o sistema não tem os índices alimentados). Aceita vírgula
  // decimal, que é como o operador digita. Valor inválido vira "sem correção", nunca zero mudo:
  // o PDF avisa em amarelo que a correção não entrou.
  const correcaoBruta =
    typeof corpo.correcaoPercent === "string"
      ? Number(corpo.correcaoPercent.replace(",", "."))
      : Number(corpo.correcaoPercent);
  const correcaoPercent =
    Number.isFinite(correcaoBruta) && correcaoBruta > 0 ? correcaoBruta : null;

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });
  }

  const responsavel = auth.user.displayName ?? auth.user.email ?? "Equipe Careli";

  try {
    const gerado = await gerarDossieJuridico({
      acquisitionRequestId,
      client,
      correcaoPercent,
      correcaoReferencia: corpo.correcaoReferencia?.trim() || null,
      motivoEncaminhamento,
      processo: corpo.processo ?? null,
      recomendacao,
      responsavel,
    });

    if (!gerado.ok) return NextResponse.json({ error: gerado.error }, { status: 404 });

    const { resultado } = gerado;

    // A URL assinada é o que abre o PDF na aba nova. Sem anexo (cliente sem ficha no Apolo) o
    // documento ainda volta em base64 — o operador não pode ficar sem a peça só porque o
    // vínculo do CRM está faltando.
    let url: null | string = null;
    if (resultado.documentId) {
      const assinada = await getApoloDocumentSignedUrl(client, "entidade", resultado.documentId);
      url = assinada.url ?? null;
    }

    return NextResponse.json({
      data: {
        anexado: resultado.anexado,
        arquivo: resultado.nomeArquivo,
        avisoAnexo: resultado.erroAnexo ?? null,
        cliente: resultado.dados.cliente.trim(),
        codigoVenda: resultado.dados.codigoVenda,
        documentId: resultado.documentId ?? null,
        // Só vai o base64 quando NÃO anexou — evita trafegar o PDF à toa.
        pdfBase64: url ? null : Buffer.from(resultado.bytes).toString("base64"),
        url,
        valorAtualizado: resultado.dados.valorInadimplenciaAtualizado,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
