import { NextResponse } from "next/server";

import { authorizePrometeuWrite } from "@/lib/prometeu/auth";
import {
  atualizarEvento,
  createPrometeuClient,
  criarEvento,
  criarMesas,
  listEventos,
} from "@/lib/prometeu/data";
import { autorizarOperacao } from "@/lib/prometeu/operador-server";
import type { PrometeuEventoConfig } from "@/lib/prometeu/types";

// Eventos do Prometeu (os lancamentos). GET lista, POST cria, PATCH salva o Setup.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  // Listagem de eventos: aceita a sessao do hub OU o cookie do operador (as telas do posto
  // resolvem qual evento esta ativo por aqui). Criar/salvar (POST/PATCH) segue so no hub.
  const auth = await autorizarOperacao(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  // ⚠️ A LISTA PODE INCLUIR OS ARQUIVADOS, a pedido (Lucas, 31/08/2026: *"quero que mesmo
  // arquivado deixa aparecendo igual aos outros"*). Arquivar tira o lancamento da OPERACAO, mas
  // ele continua sendo consulta: reservas, fila e relatorios do dia seguem no banco, e sumir da
  // tela de escolha era a unica forma de chegar neles — o Jardim das Gerais foi arquivado no
  // dia seguinte ao evento e desapareceu de vista com as 7 reservas dentro.
  //
  // Os seletores de OPERACAO (Setup, Central, Fila, Etiqueta) continuam pedindo a lista padrao,
  // sem arquivados: la um lancamento morto no dropdown e ruido, e foi por isso que o filtro
  // nasceu em 01/08 com o Vale do Ouro.
  const incluirArquivados =
    new URL(request.url).searchParams.get("incluirArquivados") === "1";
  const eventos = await listEventos(client, { incluirArquivados });
  return NextResponse.json({ data: eventos }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const auth = await authorizePrometeuWrite(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    dataEvento?: string;
    enterpriseCode?: string;
    enterpriseId?: string;
    nome?: string;
  };

  const { error, evento, fila } = await criarEvento({
    client,
    createdBy: auth.userId,
    dataEvento: body.dataEvento ?? null,
    enterpriseCode: body.enterpriseCode ?? null,
    enterpriseId: body.enterpriseId ?? null,
    nome: body.nome ?? "",
  });

  if (error) return NextResponse.json({ error }, { status: 400 });

  // `fila` diz o que a rotina de abertura fez (quantas CADs credenciadas ja entraram). Vai junto
  // do evento para a tela poder contar isso na hora, em vez de o operador criar o lancamento e
  // ficar sem saber se a fila veio.
  return NextResponse.json({ data: { ...evento, fila } });
}

// Salva o Setup. As mesas da secretaria sao criadas junto: o numero delas e configuracao do
// evento, e o Atendente precisa que elas existam pra poder chamar.
export async function PATCH(request: Request) {
  const auth = await authorizePrometeuWrite(request);
  if (!auth.ok) return auth.response;

  const client = createPrometeuClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    config?: PrometeuEventoConfig;
    dataEvento?: string | null;
    enterpriseCode?: string | null;
    enterpriseId?: string | null;
    eventoId?: string;
    nome?: string;
  };

  if (!body.eventoId) {
    return NextResponse.json({ error: "Informe o eventoId." }, { status: 400 });
  }

  const { error, evento } = await atualizarEvento({
    client,
    config: body.config,
    dataEvento: body.dataEvento,
    enterpriseCode: body.enterpriseCode,
    enterpriseId: body.enterpriseId,
    eventoId: body.eventoId,
    nome: body.nome,
  });

  if (error) return NextResponse.json({ error }, { status: 400 });

  const mesas = body.config?.mesasSecretaria;
  let avisoMesas: null | string = null;
  if (mesas && mesas > 0) {
    const ajuste = await criarMesas({
      client,
      eventoId: body.eventoId,
      quantidade: mesas,
      zona: "secretaria",
    });
    // Mesa ocupada não é removida: quem está sentado nela continuaria no atendimento e sumiria
    // da tela. A tela do Setup precisa dizer isso em vez de deixar o número divergir calado.
    if (ajuste.mantidas.length > 0) {
      avisoMesas =
        `As mesas ${ajuste.mantidas.join(", ")} estão ocupadas e continuam no ar. ` +
        `Elas saem sozinhas quando o atendimento terminar e você salvar de novo.`;
    }
  }

  return NextResponse.json({ data: evento, aviso: avisoMesas });
}
