import { NextResponse } from "next/server";

import {
  createMetaWhatsAppMessageTemplate,
  getMetaWhatsAppOutboundConfig,
  uploadMetaWhatsAppTemplateHeaderMedia,
} from "@/lib/iris/meta-whatsapp";
import { authorizePrometeuWrite } from "@/lib/prometeu/auth";
import {
  CATEGORIA_BOAS_VINDAS,
  componentesDoTemplateBoasVindas,
  NOME_TEMPLATE_BOAS_VINDAS,
  URL_LOGO_HEADER,
} from "@/lib/prometeu/boas-vindas-template";

// Cria (submete à Meta) o template de boas-vindas do check-in. Ação ADMIN, disparada uma vez pelo
// botão do Setup. A logo do header é fixa: baixamos da URL pública e subimos como header handle.
// A aprovação fica com a Meta (horas a dias). Ver [[project_prometeu_tela_cliente]].
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Mesmo número do convite (WABA da Elife). O template tem que viver na mesma WABA do número que
// vai disparar, senão o envio não acha o template.
const PHONE_4143 = "1167201739813897";

export async function POST(request: Request) {
  const auth = await authorizePrometeuWrite(request);
  if (!auth.ok) return auth.response;

  const config = { ...getMetaWhatsAppOutboundConfig(), phoneNumberId: PHONE_4143 };

  let buffer: Buffer;
  let mimeType = "image/png";
  try {
    const img = await fetch(URL_LOGO_HEADER, { cache: "no-store" });
    if (!img.ok) throw new Error(`HTTP ${img.status}`);
    mimeType = img.headers.get("content-type") || mimeType;
    buffer = Buffer.from(await img.arrayBuffer());
  } catch (erro) {
    return NextResponse.json(
      { error: `Não consegui baixar a logo do header: ${String(erro)}` },
      { status: 502 },
    );
  }

  try {
    const upload = await uploadMetaWhatsAppTemplateHeaderMedia({
      config,
      fileBuffer: buffer,
      fileLength: buffer.length,
      fileName: "c2x-logo.png",
      mimeType,
    });
    if (!upload.handle) {
      return NextResponse.json(
        { error: "O upload da logo não retornou o handle do header." },
        { status: 502 },
      );
    }

    const criado = await createMetaWhatsAppMessageTemplate({
      category: CATEGORIA_BOAS_VINDAS,
      components: componentesDoTemplateBoasVindas(upload.handle),
      config,
      language: "pt_BR",
      name: NOME_TEMPLATE_BOAS_VINDAS,
      phoneNumberId: PHONE_4143,
    });

    return NextResponse.json({
      data: {
        id: criado.id,
        name: criado.name ?? NOME_TEMPLATE_BOAS_VINDAS,
        status: criado.status ?? "submetido",
      },
    });
  } catch (erro) {
    const msg = erro instanceof Error ? erro.message : String(erro);
    // Já existe na Meta: não é falha, o template está lá (só aguardando/aprovado).
    if (/already exists|duplicate|ja existe|2388023/i.test(msg)) {
      return NextResponse.json(
        {
          aviso: "O template já existe na Meta.",
          data: { name: NOME_TEMPLATE_BOAS_VINDAS, status: "ja_existe" },
        },
        { status: 200 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
