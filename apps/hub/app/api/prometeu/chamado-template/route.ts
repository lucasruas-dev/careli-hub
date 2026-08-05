import { NextResponse } from "next/server";

import {
  createMetaWhatsAppMessageTemplate,
  getMetaWhatsAppOutboundConfig,
} from "@/lib/iris/meta-whatsapp";
import { authorizePrometeuWrite } from "@/lib/prometeu/auth";
import {
  CATEGORIA_CHAMADO,
  componentesDoTemplateChamado,
  NOME_TEMPLATE_CHAMADO,
} from "@/lib/prometeu/chamado-template";

// Cria (submete à Meta) o template do chamado. Ação ADMIN, disparada uma vez pelo botão do Setup.
// Sem header de imagem (o corpo é só texto + botão), então nem precisa subir mídia. A aprovação
// fica com a Meta (horas a dias). Ver [[project_prometeu_tela_cliente]].
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Mesma WABA (número) do convite e das boas-vindas: o template tem que viver na mesma WABA do
// número que dispara, senão o envio não acha o template.
const PHONE_4143 = "1167201739813897";

export async function POST(request: Request) {
  const auth = await authorizePrometeuWrite(request);
  if (!auth.ok) return auth.response;

  const config = { ...getMetaWhatsAppOutboundConfig(), phoneNumberId: PHONE_4143 };

  try {
    const criado = await createMetaWhatsAppMessageTemplate({
      category: CATEGORIA_CHAMADO,
      components: componentesDoTemplateChamado(),
      config,
      language: "pt_BR",
      name: NOME_TEMPLATE_CHAMADO,
      phoneNumberId: PHONE_4143,
    });

    return NextResponse.json({
      data: {
        id: criado.id,
        name: criado.name ?? NOME_TEMPLATE_CHAMADO,
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
          data: { name: NOME_TEMPLATE_CHAMADO, status: "ja_existe" },
        },
        { status: 200 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
