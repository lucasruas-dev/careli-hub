import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import {
  carregarChamadorDoSetup,
  ehAdmin,
  podeAbrirSetupDePessoas,
} from "@/lib/hub/gestao-de-pessoas";
import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A tela precisa saber se mostra o Setup de pessoas — e a resposta tem que vir da MESMA
// função que a rota de escrita usa, senão as duas divergem com o tempo e a divergência sempre
// aparece como "some para quem devia ver" ou, pior, "aparece para quem não devia".
//
// ⚠️ ISTO NÃO É UMA TRAVA, É UMA PERGUNTA. Quem protege é o GET/POST/PATCH de
// /api/setup/users. Esta rota só evita que a tela ofereça o que o servidor vai recusar.
export async function GET(request: NextRequest) {
  const { serviceRoleKey, url: supabaseUrl } = getServerSupabaseConfig();

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ data: { ehAdmin: false, podeGerirPessoas: false } });
  }

  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;

  if (!accessToken) {
    return NextResponse.json({ data: { ehAdmin: false, podeGerirPessoas: false } });
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData } = await adminClient.auth.getUser(accessToken);

  if (!authData.user) {
    return NextResponse.json({ data: { ehAdmin: false, podeGerirPessoas: false } });
  }

  const chamador = await carregarChamadorDoSetup(adminClient, authData.user.id);

  return NextResponse.json({
    data: {
      ehAdmin: chamador ? ehAdmin(chamador) : false,
      podeGerirPessoas: chamador ? podeAbrirSetupDePessoas(chamador) : false,
    },
  });
}
