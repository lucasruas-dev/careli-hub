import { NextResponse } from "next/server";

import {
  BOTOES_CONVITE,
  NOME_TEMPLATE_CONVITE,
  TXT_CONVITE,
} from "@/lib/apolo/acao-template";
import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { APOLO_DOCS_BUCKET } from "@/lib/apolo/documentos";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  MetaWhatsAppSendError,
  createMetaWhatsAppMessageTemplate,
  getMetaWhatsAppOutboundConfig,
  uploadMetaWhatsAppTemplateHeaderMedia,
} from "@/lib/iris/meta-whatsapp";

// Cria na Meta o template do CONVITE da ação (com IMAGEM no topo + 3 botões de resposta). Mesmo
// padrão dos 4 templates da imobiliária: um clique cria pronto — só que aqui o operador escolhe a
// arte (a imagem vai no formData). Número 4143, categoria MARKETING. Texto aprovado pelo Lucas.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const PHONE_4143 = "1167201739813897";
const NOME_TEMPLATE = NOME_TEMPLATE_CONVITE;
const BOTOES = BOTOES_CONVITE;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ acaoId: string }> },
) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base." }, { status: 503 });

  const { acaoId } = await params;

  const form = await request.formData().catch(() => null);
  const file = form?.get("imagem");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Envie a imagem do convite." }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "A imagem passa de 5 MB (limite da Meta)." }, { status: 400 });
  }

  const config = { ...getMetaWhatsAppOutboundConfig(), phoneNumberId: PHONE_4143 };

  const buffer = Buffer.from(await file.arrayBuffer());

  // Guarda a arte no bucket privado ANTES de falar com a Meta — o disparo gera uma signed URL dela
  // a cada envio. Fica fora do try da Meta para valer mesmo quando o template já existe (duplicata).
  const ext = file.type === "image/png" ? "png" : "jpg";
  const imagemPath = `acoes/${acaoId}/convite.${ext}`;
  const bucket = process.env.APOLO_DOCS_BUCKET ?? APOLO_DOCS_BUCKET;
  await client.storage
    .from(bucket)
    .upload(imagemPath, buffer, { contentType: file.type || "image/jpeg", upsert: true });

  try {
    const upload = await uploadMetaWhatsAppTemplateHeaderMedia({
      config,
      fileBuffer: buffer,
      fileLength: buffer.length,
      fileName: file.name || "convite.jpg",
      mimeType: file.type || "image/jpeg",
    });
    if (!upload.handle) {
      return NextResponse.json(
        { error: "A Meta não devolveu o identificador da imagem." },
        { status: 502 },
      );
    }

    const template = await createMetaWhatsAppMessageTemplate({
      category: "MARKETING",
      components: [
        { example: { header_handle: [upload.handle] }, format: "IMAGE", type: "HEADER" },
        { example: { body_text: [["Maria"]] }, text: TXT_CONVITE, type: "BODY" },
        { buttons: BOTOES.map((text) => ({ text, type: "QUICK_REPLY" })), type: "BUTTONS" },
      ],
      config,
      language: "pt_BR",
      name: NOME_TEMPLATE,
      phoneNumberId: PHONE_4143,
    });

    // Amarra o nome do template + o caminho da arte na ação — é o que o disparo usa.
    await client
      .from("apolo_acoes")
      .update({
        imagem_path: imagemPath,
        template_meta_name: NOME_TEMPLATE,
        updated_at: new Date().toISOString(),
      })
      .eq("id", acaoId);

    return NextResponse.json({
      data: { id: template.id, name: NOME_TEMPLATE, status: template.status },
    });
  } catch (e) {
    const erroMeta = e instanceof MetaWhatsAppSendError ? e : null;
    const msg = erroMeta ? erroMeta.message : (e as Error).message;
    const dup = /already exists|duplicate|ja existe|2388023/i.test(msg);
    if (dup) {
      // Já existe: mesmo assim amarra o nome + a arte na ação, pra o disparo achar.
      await client
        .from("apolo_acoes")
        .update({
          imagem_path: imagemPath,
          template_meta_name: NOME_TEMPLATE,
          updated_at: new Date().toISOString(),
        })
        .eq("id", acaoId);
      return NextResponse.json(
        { error: "Esse template já existe na Meta (amarrei na ação assim mesmo)." },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
