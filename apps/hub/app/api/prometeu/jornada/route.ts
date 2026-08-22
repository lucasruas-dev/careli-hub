import { NextResponse } from "next/server";

import { createPrometeuClient, getEvento, jornadaDoCredenciado } from "@/lib/prometeu/data";
import { mesclarJornada, passosDasUnidades } from "@/lib/prometeu/jornada-unidades";
import { autorizarOperacao } from "@/lib/prometeu/operador-server";
import { historicoDeUnidadesDoC2x } from "@/lib/prometeu/reservas-c2x";

// A JORNADA de UM cliente (modal da Central). Buscada só ao abrir o modal — não entra no polling da
// fila, que carrega todo mundo. Aceita a sessão do hub OU o cookie do operador.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autorizarOperacao(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const credenciadoId = new URL(request.url).searchParams.get("credenciadoId")?.trim() ?? "";
  if (!credenciadoId) {
    return NextResponse.json({ error: "Informe o credenciadoId." }, { status: 400 });
  }

  const passosDaPessoa = await jornadaDoCredenciado(client, credenciadoId);

  // O CICLO DAS UNIDADES ENTRA AQUI. O caminho pelo salão sozinho não conta o que a pessoa veio
  // fazer: qual lote pegou, se devolveu, se trocou por outro. Vem do C2X, cruzado por CPF.
  //
  // ⚠️ Best-effort de propósito: o legado fora do ar não pode fechar a ficha do cliente no meio
  // do evento. Sem o histórico, a jornada volta como sempre foi.
  const { data: cred } = await client
    .from("prometeu_credenciados")
    .select("documento, evento_id")
    .eq("id", credenciadoId)
    .maybeSingle<{ documento: null | string; evento_id: string }>();

  let passos = passosDaPessoa;
  const cpf = String(cred?.documento ?? "").replace(/\D/g, "");
  if (cpf && cred?.evento_id) {
    // O evento vem da própria linha do credenciado: a ficha pode ser aberta de um lançamento
    // que não é o operável do momento (consulta de evento passado).
    const evento = await getEvento(client, cred.evento_id);
    const enterpriseId = Number(evento?.enterpriseId ?? 0);
    if (enterpriseId) {
      const { historicos } = await historicoDeUnidadesDoC2x(enterpriseId);
      const meu = historicos.find((h) => h.cpf === cpf);
      if (meu && meu.passos.length > 0) {
        passos = mesclarJornada(passosDaPessoa, passosDasUnidades(meu.passos));
      }
    }
  }

  return NextResponse.json({ data: { passos } }, { headers: { "Cache-Control": "no-store" } });
}
