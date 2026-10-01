import { NextResponse, type NextRequest } from "next/server";

import { authorizeApoloCoordenacao } from "@/lib/apolo/auth";
import { decidirPedidoDoAutonomo, type AcaoDoTime } from "@/lib/apolo/autonomo-do-link";
import { createApoloAdminClient } from "@/lib/apolo/server";

// A DECISÃO DO TIME SOBRE UM PEDIDO DO LINK DO CORRETOR AUTÔNOMO: aprovar, pedir correção ou indeferir.
//
// Lucas (01/10/2026) escolheu as MESMAS três ações da validação da imobiliária
// ([[reference_apolo_validacao_imobiliaria_tres_acoes]]). O `id` é o do PEDIDO (o evento
// `corretor_autonomo_solicitado`), porque antes da aprovação não existe ficha. Aprovar grava a ficha
// pela porta do cadastro interno, dá o código CA e o papel ativo; a habilitação em empreendimento
// continua sendo a outra rota, produto a produto.
//
// ⚠️ SÓ A COORDENAÇÃO DECIDE (`authorizeApoloCoordenacao`: admin e líder). Segunda rodada de revisão
// (01/10/2026): com `authorizeApoloWrite`, o operador, inclusive o externo, aprovava autônomo.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACOES: AcaoDoTime[] = ["aprovar", "correcao", "indeferir"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Corpo = { acao?: unknown; motivos?: unknown; observacao?: unknown };

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApoloCoordenacao(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!UUID_RE.test(String(id ?? ""))) {
    return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  }
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
    motivos: Array.isArray(corpo.motivos) ? corpo.motivos.map((m) => String(m ?? "")) : [],
    observacao: typeof corpo.observacao === "string" ? corpo.observacao : null,
    pedidoId: id,
  });

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.mensagem }, { status: resultado.status });
  }
  return NextResponse.json({ data: resultado, ok: true });
}
