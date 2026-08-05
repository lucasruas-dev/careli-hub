import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  listEnterpriseSettings,
  setEnterpriseAnaliseCredito,
  setEnterpriseCredenciamento,
  setEnterpriseLimiteCredito,
  setEnterprisePrevenda,
  setEnterpriseValorPix,
} from "@/lib/apolo/enterprise-settings";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Settings do empreendimento:
//  - POST  → flag `credenciamentoAtivo` (master "Recebendo CAD": empreendimento na ativa; o portal
//            de credenciamento oferece somente os ativos).
//  - PATCH → campos parciais das sub-etapas: `analiseCreditoHabilitada` + `limiteCredito` (Análise
//            de Crédito) e `prevendaHabilitada` + `valorPix` (Pré-venda). Cada campo é opcional; a
//            tela envia só o que o operador mexeu.
// O GET devolve todos os campos por empreendimento.
//
// AUTORIZAÇÃO: GET usa leitura (`authorizeApoloRead`); POST e PATCH usam ESCRITA
// (`authorizeApoloWrite`, sem o papel `viewer`). Os dois gravam regra de negócio do empreendimento
// (recebe CAD, pré-venda, análise de crédito, limite de crédito, valor do PIX), então quem só
// VISUALIZA não pode ligar/desligar essas travas. Antes os dois chamavam `authorizeApoloRead` e o
// `viewer` conseguia salvar.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const settings = await listEnterpriseSettings(adminClient);
  return NextResponse.json(
    { data: { settings } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  // Escrita: liga/desliga o master "Recebendo CAD". `viewer` não passa.
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  let body: { ativo?: boolean; code?: string; enterpriseId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });
  }

  if (!body.enterpriseId || typeof body.ativo !== "boolean") {
    return NextResponse.json(
      { error: "Informe o empreendimento e o estado (ativo)." },
      { status: 400 },
    );
  }

  const result = await setEnterpriseCredenciamento({
    adminClient,
    ativo: body.ativo,
    code: body.code,
    enterpriseId: body.enterpriseId,
    updatedBy: auth.userId,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json({ data: { ativo: body.ativo } });
}

// Salva campos parciais das sub-etapas (Análise de Crédito e Pré-venda), SEM mexer no master
// `credenciamento_ativo`. Cada campo é opcional: a tela envia só o bloco que o operador salvou.
export async function PATCH(request: Request) {
  // Escrita: mexe em pré-venda, análise de crédito, limite e valor do PIX. `viewer` não passa.
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  let body: {
    analiseCreditoHabilitada?: boolean;
    code?: string;
    enterpriseId?: string;
    limiteCredito?: number | null;
    prevendaHabilitada?: boolean;
    valorPix?: number | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });
  }

  if (!body.enterpriseId) {
    return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });
  }

  // Vazio/nulo = volta ao padrão; caso contrário, número >= 0. Cada campo é opcional: a tela
  // salva o que o operador mexeu.
  const numeroOuNull = (v: number | null | undefined) =>
    v === null || v === undefined ? null : Number(v);
  const invalido = (v: number | null) => v !== null && (!Number.isFinite(v) || v < 0);

  const mexeuAnalise = "analiseCreditoHabilitada" in body;
  const mexeuLimite = "limiteCredito" in body;
  const mexeuPrevenda = "prevendaHabilitada" in body;
  const mexeuValorPix = "valorPix" in body;

  if (
    (mexeuAnalise && typeof body.analiseCreditoHabilitada !== "boolean") ||
    (mexeuPrevenda && typeof body.prevendaHabilitada !== "boolean")
  ) {
    return NextResponse.json({ error: "Estado invalido." }, { status: 400 });
  }

  const limite = numeroOuNull(body.limiteCredito);
  const valorPix = numeroOuNull(body.valorPix);
  if ((mexeuLimite && invalido(limite)) || (mexeuValorPix && invalido(valorPix))) {
    return NextResponse.json({ error: "Valor invalido." }, { status: 400 });
  }

  // Não deixa habilitar sem o valor obrigatório do bloco (a mesma trava da tela, no servidor).
  if (mexeuAnalise && body.analiseCreditoHabilitada && mexeuLimite && limite === null) {
    return NextResponse.json(
      { error: "Informe o limite de crédito para habilitar a análise." },
      { status: 400 },
    );
  }
  if (mexeuPrevenda && body.prevendaHabilitada && mexeuValorPix && valorPix === null) {
    return NextResponse.json(
      { error: "Informe o valor do PIX para habilitar a pré-venda." },
      { status: 400 },
    );
  }

  // Flags primeiro (podem criar a linha), depois os valores (encontram a linha e fazem UPDATE).
  if (mexeuAnalise) {
    const r = await setEnterpriseAnaliseCredito({
      adminClient,
      code: body.code,
      enterpriseId: body.enterpriseId,
      habilitada: Boolean(body.analiseCreditoHabilitada),
      updatedBy: auth.userId,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  }

  if (mexeuLimite) {
    const r = await setEnterpriseLimiteCredito({
      adminClient,
      code: body.code,
      enterpriseId: body.enterpriseId,
      limite,
      updatedBy: auth.userId,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  }

  if (mexeuPrevenda) {
    const r = await setEnterprisePrevenda({
      adminClient,
      code: body.code,
      enterpriseId: body.enterpriseId,
      habilitada: Boolean(body.prevendaHabilitada),
      updatedBy: auth.userId,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  }

  if (mexeuValorPix) {
    const r = await setEnterpriseValorPix({
      adminClient,
      code: body.code,
      enterpriseId: body.enterpriseId,
      updatedBy: auth.userId,
      valor: valorPix,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  }

  return NextResponse.json({
    data: {
      analiseCreditoHabilitada: body.analiseCreditoHabilitada,
      limiteCredito: limite,
      prevendaHabilitada: body.prevendaHabilitada,
      valorPix,
    },
  });
}
