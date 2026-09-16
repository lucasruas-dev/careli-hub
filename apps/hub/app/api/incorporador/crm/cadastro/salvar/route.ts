import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import type { SalvarPayload } from "@/lib/apolo/cadastro-salvar";
import {
  produtosDoPanteonDaSessao,
  recusaDaEscritaNoCadastro,
  salvarCadastroDoPortal,
} from "@/lib/apolo/incorporador/cadastro-do-portal";
import { respostaDaEscrita } from "@/lib/apolo/incorporador/operacao-do-produto-servidor";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";

// CLIENTE NOVO PELO CRM DO PORTAL — o salvar.
//
// Decisão do Lucas (16/09/2026): a equipe da Cecílio cadastra cliente novo pelo CRM do portal. A
// gravação é a MESMA do hub (`salvarCadastroDoApolo`: campos, documentos obrigatórios, uma ficha por
// pessoa, CAD em PDF autenticada). Antes dela, `salvarCadastroDoPortal` confere o produto (tem de
// ser da sessão) e a imobiliária (tem de estar habilitada nele), e depois traduz a recusa sem
// nomear terceiros.
//
// ⚠️ E O PRODUTO TEM DE SER OPERADO PELA CECÍLIO (decisão do Lucas, 16/09/2026): VOC e VOR são só
// consulta para ela (403), e sem a 0170 aplicada ninguém cadastra (503). A régua roda antes de ler
// catálogo e cadastro, porque recusar é mais barato que preparar a gravação.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });
  }

  let payload: SalvarPayload;
  try {
    payload = (await request.json()) as SalvarPayload;
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const recusa = await recusaDaEscritaNoCadastro(auth.ator, payload?.vinculo?.enterpriseId);
  if (recusa) return respostaDaEscrita(recusa);

  const catalogo = await catalogoDeEmpreendimentos(Date.now());
  const resposta = await salvarCadastroDoPortal({
    adminClient,
    ator: auth.ator,
    catalogo,
    // O nome do produto nascido no Panteon, para a esteira (o catálogo do C2X não o conhece).
    doPanteon: await produtosDoPanteonDaSessao(auth.ator, catalogo),
    payload,
  });

  return NextResponse.json(resposta.corpo, { status: resposta.status });
}
