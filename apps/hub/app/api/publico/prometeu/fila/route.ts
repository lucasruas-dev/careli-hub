import { NextResponse } from "next/server";

import { createPrometeuClient } from "@/lib/prometeu/data";
import { acompanhamentoDoCliente } from "@/lib/prometeu/fila-do-cliente-server";
import { verificarTokenDaFila } from "@/lib/prometeu/link-da-fila";

// A fila vista pelo CLIENTE, no celular dele. Rota PUBLICA (sem login) — quem autoriza e' o
// token assinado do link, nao uma sessao: o cliente nao tem conta no hub e nao vai criar uma no
// meio do lancamento.
//
// ⚠️ ZONA HOSTIL: esta rota responde ao mundo. Ela devolve SO' o `AcompanhamentoDaFila` daquela
// pessoa (nome, posicao, quantos na frente, estado). Nada de CPF, telefone, PIX, PA ou nome de
// terceiro — ver o comentario do tipo em lib/prometeu/fila-do-cliente.ts. Nao devolver o
// credenciado cru aqui e' a metade da protecao; a outra metade e' o tipo.
//
// SEM rate limit de banco (o `lib/publico/cad/rate-limit`) de proposito: aqui nao ha o que
// enumerar — sem a chave HMAC nao se forja um token, entao nao existe varredura possivel. E o
// balde custa uma ESCRITA no banco por requisicao, num endpoint que centenas de celulares batem
// a cada 15s: seria mais caro que o ataque que evitaria. A defesa de carga e' o snapshot com
// cache curto em fila-do-cliente-server.ts.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t");
  const tk = verificarTokenDaFila(token);

  if (!tk.ok) {
    return NextResponse.json(
      { error: "Link invalido. Peca um novo link na recepcao." },
      { headers: NO_STORE, status: 400 },
    );
  }

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json(
      { error: "Acompanhamento indisponivel no momento." },
      { headers: NO_STORE, status: 503 },
    );
  }

  // O credenciado E o evento saem do TOKEN, nunca da URL: e' isso que impede reapontar um link
  // legitimo para outra pessoa ou para outro lancamento trocando um parametro.
  const { acompanhamento, error } = await acompanhamentoDoCliente(client, {
    credenciadoId: tk.payload.c,
    eventoId: tk.payload.e,
  });

  if (!acompanhamento) {
    return NextResponse.json({ error }, { headers: NO_STORE, status: 404 });
  }

  return NextResponse.json({ data: acompanhamento }, { headers: NO_STORE });
}
