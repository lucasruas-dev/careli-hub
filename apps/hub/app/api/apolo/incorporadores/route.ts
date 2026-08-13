import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  listarEmpreendimentosDisponiveis,
  listarIncorporadores,
  salvarIncorporador,
} from "@/lib/apolo/incorporador/gestao";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Gestão dos acessos de incorporador (ferramenta INTERNA do Setup do Apolo).
//   GET  = os incorporadores, seus usuários e o que cada um enxerga + a lista de empreendimentos.
//   POST = cria ou atualiza um incorporador com a lista de empreendimentos dele.
//
// ⚠️ `authorizeApoloWrite` nas DUAS pernas, inclusive no GET. A leitura aqui é o mapa de quem vê
// o quê, e a lista de e-mails que entram no portal: não é dado de consulta, é a permissão.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base do Apolo." }, { status: 503 });

  try {
    // O C2X pode estar fora sem que isso impeça a tela: dá para editar usuário e senha mesmo
    // sem a lista de empreendimentos carregada.
    const [incorporadores, empreendimentos] = await Promise.all([
      listarIncorporadores(client),
      listarEmpreendimentosDisponiveis().catch(() => []),
    ]);

    return NextResponse.json(
      { data: { empreendimentos, incorporadores } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[apolo][incorporadores] falha ao listar", error);
    return NextResponse.json({ error: "Não foi possível carregar os incorporadores." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base do Apolo." }, { status: 503 });

  const corpo = (await request.json().catch(() => null)) as null | {
    ativo?: boolean;
    empreendimentos?: { carteiraAdministrada?: boolean; enterpriseId?: string }[];
    id?: null | string;
    logoEscuraPath?: null | string;
    logoPath?: null | string;
    nome?: string;
    slug?: string;
  };

  if (!corpo?.nome?.trim()) {
    return NextResponse.json({ error: "Informe o nome do incorporador." }, { status: 400 });
  }

  const resultado = await salvarIncorporador(client, {
    ativo: corpo.ativo,
    empreendimentos: (corpo.empreendimentos ?? [])
      .filter((e) => e?.enterpriseId)
      .map((e) => ({
        carteiraAdministrada: Boolean(e.carteiraAdministrada),
        enterpriseId: String(e.enterpriseId),
      })),
    id: corpo.id ?? null,
    logoEscuraPath: corpo.logoEscuraPath ?? null,
    logoPath: corpo.logoPath ?? null,
    nome: corpo.nome,
    slug: corpo.slug ?? corpo.nome,
  });

  if (!resultado.ok) return NextResponse.json({ error: resultado.erro }, { status: 400 });

  return NextResponse.json({ data: { id: resultado.id } });
}
