import { NextResponse, type NextRequest } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { empreendimentosDoAutonomo } from "@/lib/apolo/autonomo-cadastro";
import { createApoloAdminClient } from "@/lib/apolo/server";

// OS EMPREENDIMENTOS EM QUE ESTE CORRETOR AUTÔNOMO ESTÁ HABILITADO.
//
// É o espelho de `/api/apolo/imobiliarias/[id]/empreendimentos`, e serve ao mesmo passo do wizard:
// >1 o operador escolhe, ==1 vincula direto, 0 avisa que ele não está habilitado em nada.
//
// ⚠️ ELE SÓ DEVOLVE O QUE É HABILITAÇÃO, e nunca o vínculo de CAD. Medido em produção (28/09/2026):
// existem 170 vínculos `relationship_type = 'empreendimento'` em entidade `pf`, e 169 deles são
// `source = 'publico-cad'` de fichas com papel `prospect` — a marca de qual produto é a CAD daquele
// cliente, não autorização. A separação mora em `idsHabilitadosDoAutonomo`
// (lib/apolo/habilitacao-do-autonomo.ts).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base." }, { status: 503 });

  const habilitados = await empreendimentosDoAutonomo(client, id);
  return NextResponse.json(
    {
      data: {
        empreendimentos: habilitados.map((e) => ({ enterpriseId: String(e.id), nome: e.name })),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
