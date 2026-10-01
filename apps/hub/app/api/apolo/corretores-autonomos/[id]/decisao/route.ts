import { NextResponse, type NextRequest } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { decidirPedidoDoAutonomo, type AcaoDoTime } from "@/lib/apolo/autonomo-do-link";
import { createApoloAdminClient } from "@/lib/apolo/server";

// A DECISÃO DO TIME SOBRE O AUTÔNOMO QUE SE CADASTROU PELO LINK: aprovar, pedir correção ou indeferir.
//
// Lucas (01/10/2026) escolheu as MESMAS três ações da validação da imobiliária
// ([[reference_apolo_validacao_imobiliaria_tres_acoes]]). Aprovar dá o código CA e o papel ativo, que
// é o que o cadastro interno grava; a habilitação em empreendimento continua sendo a outra porta
// (`/api/apolo/corretores-autonomos/[id]/habilitar`), produto a produto.
//
// ⚠️ `authorizeApoloWrite`: admin, leader e operator, os mesmos que validam a imobiliária. `viewer`
// não decide nada.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACOES: AcaoDoTime[] = ["aprovar", "correcao", "indeferir"];

type Corpo = { acao?: unknown; motivos?: unknown; observacao?: unknown };

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Escrita no Apolo indisponível." }, { status: 503 });
  }

  let corpo: Corpo;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const acao = ACOES.find((valor) => valor === corpo.acao);
  if (!acao) {
    return NextResponse.json({ error: "Escolha aprovar, pedir correção ou indeferir." }, { status: 400 });
  }

  const resultado = await decidirPedidoDoAutonomo(client, {
    acao,
    autorNome: auth.nome,
    autorUserId: auth.userId,
    entityId: id,
    motivos: Array.isArray(corpo.motivos) ? corpo.motivos.map((m) => String(m ?? "")) : [],
    observacao: typeof corpo.observacao === "string" ? corpo.observacao : null,
  });

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.mensagem }, { status: resultado.status });
  }
  return NextResponse.json({ data: resultado, ok: true });
}
