import { NextResponse, type NextRequest } from "next/server";

import { createPrometeuClient, getEvento } from "@/lib/prometeu/data";
import { validarTokenDoTelao } from "@/lib/prometeu/link-do-telao";
import { masterplanDoEvento } from "@/lib/prometeu/masterplan-do-evento";

// O ESTADO DO MASTERPLAN PARA O TELÃO — rota PÚBLICA, sem login.
//
// Quem autoriza é o token HS256 do link (lib/prometeu/link-do-telao.ts), validado aqui dentro.
// O telão fica em computador de terceiro, projetado no salão: não há sessão possível, e uma
// sessão que expirasse no meio do evento derrubaria a projeção — foi o que aconteceu com a TV
// da fila em 02/08, antes de ela ganhar link próprio.
//
// ⚠️ NÃO EXIGE QUE SEJA O EVENTO OPERÁVEL, de propósito. É essa comparação que faz o link da
// fila morrer sozinho no encerramento, e aqui o requisito é o oposto (Lucas, 28/08: "tem que
// ser um link publico que nunca expira"). A revogação, se um dia precisar, é trocar o segredo.
//
// ⚠️ A RESPOSTA É SÓ SITUAÇÃO. Nome da unidade e uma palavra por lote — nunca comprador, nunca
// valor. Ver o cabeçalho de lib/prometeu/masterplan-do-evento.ts.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("tv");
  const eventoId = validarTokenDoTelao(token);
  if (!eventoId) {
    return NextResponse.json({ error: "Link inválido." }, { status: 401 });
  }

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json(
      { error: "Supabase indisponivel." },
      { status: 503 },
    );
  }

  const evento = await getEvento(client, eventoId);
  if (!evento) {
    return NextResponse.json(
      { error: "Evento nao encontrado." },
      { status: 404 },
    );
  }

  const { dados, error } = await masterplanDoEvento(client, evento);
  if (error || !dados) {
    return NextResponse.json(
      { error: error ?? "Falha ao montar o mapa." },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      contagem: dados.contagem,
      // O nome do lançamento é público desde sempre (telão, etiqueta, WhatsApp do cliente).
      evento: { data: evento.dataEvento, nome: evento.nome },
      lotes: dados.lotes,
      atualizadoEm: dados.atualizadoEm,
    },
    {
      headers: {
        // Cache curto na CDN: o realtime é quem avisa a mudança; isto só segura rajada de
        // reload e o custo de bater no C2X a cada carga.
        "Cache-Control":
          "public, max-age=0, s-maxage=10, stale-while-revalidate=30",
      },
    },
  );
}
