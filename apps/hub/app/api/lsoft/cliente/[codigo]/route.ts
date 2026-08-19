import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import {
  CAMPOS_EDITAVEIS,
  type CampoEditavel,
  lerEdicoesDoLsoft,
  lerFichaDoLsoft,
  salvarValidacaoDoLsoft,
  type StatusDaValidacao,
} from "@/lib/lsoft/carteira";

// A FICHA de um cliente do LSoft: cadastro completo + todas as parcelas (pagas e em aberto).
//
// ⚠️ Sob demanda, uma pessoa por vez. A carteira inteira tem ~20 mil parcelas; mandá-las junto da
// lista deixaria a tela lenta para mostrar o que quase ninguém abre de uma vez só.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ codigo: string }> },
) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const { codigo } = await params;
  const resultado = await lerFichaDoLsoft(codigo);

  if (!resultado.ok) {
    const naoAchou = resultado.erro === "Cliente não encontrado.";
    return NextResponse.json({ error: resultado.erro }, { status: naoAchou ? 404 : 503 });
  }

  return NextResponse.json(
    { data: { cadastro: resultado.cadastro, parcelas: resultado.parcelas } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// ── SALVAR A VALIDAÇÃO ──────────────────────────────────────────────────────
//
// ⚠️ QUEM ASSINA A EDIÇÃO É A SESSÃO, não o corpo do pedido. O autor vem de `authorizeApoloRead`
// (o e-mail de quem está logado); aceitar um "autor" enviado pela tela transformaria a trilha em
// ficção — qualquer um poderia gravar alteração no nome de outro.
const STATUS_VALIDOS = ["dispensado", "em_analise", "pendente", "validado"] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ codigo: string }> },
) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const { codigo } = await params;
  const corpo = (await request.json().catch(() => null)) as
    | { campos?: Record<string, unknown>; status?: string }
    | null;

  if (!corpo) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });

  const campos: Partial<Record<CampoEditavel, null | string>> = {};
  for (const campo of CAMPOS_EDITAVEIS) {
    if (corpo.campos && campo in corpo.campos) {
      const valor = corpo.campos[campo];
      campos[campo] = valor === null || valor === undefined ? null : String(valor);
    }
  }

  const status =
    corpo.status && STATUS_VALIDOS.includes(corpo.status as never)
      ? (corpo.status as StatusDaValidacao)
      : undefined;

  // O tipo da autorização só expõe `userId`; é ele que assina a trilha.
  const autor = auth.userId;
  const resultado = await salvarValidacaoDoLsoft({ autor, campos, codigo, status });

  if (!resultado.ok) return NextResponse.json({ error: resultado.erro }, { status: 400 });

  return NextResponse.json({ data: { alterados: resultado.alterados } });
}

// O histórico de edições da ficha.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ codigo: string }> },
) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const { codigo } = await params;
  const resultado = await lerEdicoesDoLsoft(codigo);

  if (!resultado.ok) return NextResponse.json({ error: resultado.erro }, { status: 503 });

  return NextResponse.json({ data: { edicoes: resultado.edicoes } });
}
