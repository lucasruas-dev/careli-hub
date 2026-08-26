import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  listEnterpriseSettings,
  setEnterpriseAnaliseCredito,
  setEnterpriseComprovanteRenda,
  setEnterpriseCredenciamento,
  setEnterpriseLimiteCredito,
  setEnterprisePrevenda,
  setEnterpriseRecepcaoCad,
  setEnterpriseRecepcaoImobiliaria,
  setEnterpriseValorPix,
} from "@/lib/apolo/enterprise-settings";
import { varrerPrevendaDesligada } from "@/lib/apolo/prevenda-varredura";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Settings do empreendimento:
//  - POST  → flag `credenciamentoAtivo` (master "Recebendo CAD": empreendimento na ativa; o portal
//            de credenciamento oferece somente os ativos).
//  - PATCH → campos parciais das sub-etapas: `analiseCreditoHabilitada` + `limiteCredito` (Análise
//            de Crédito), `prevendaHabilitada` + `valorPix` (Pré-venda) e
//            `comprovanteRendaHabilitado` (Comprovante de renda, que é só um flag — não tem valor
//            a configurar) e os portões públicos `recepcaoCad` / `recepcaoImobiliaria` (migration
//            0110 — CAD e habilitação de imobiliária abrem em momentos diferentes; caso Recanto
//            do Vale). Cada campo é opcional; a tela envia só o que o operador mexeu.
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
    comprovanteRendaHabilitado?: boolean;
    enterpriseId?: string;
    limiteCredito?: number | null;
    prevendaHabilitada?: boolean;
    recepcaoCad?: boolean;
    recepcaoImobiliaria?: boolean;
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
  const mexeuRenda = "comprovanteRendaHabilitado" in body;
  const mexeuRecepcaoCad = "recepcaoCad" in body;
  const mexeuRecepcaoImob = "recepcaoImobiliaria" in body;
  const mexeuValorPix = "valorPix" in body;

  if (
    (mexeuAnalise && typeof body.analiseCreditoHabilitada !== "boolean") ||
    (mexeuPrevenda && typeof body.prevendaHabilitada !== "boolean") ||
    (mexeuRenda && typeof body.comprovanteRendaHabilitado !== "boolean") ||
    (mexeuRecepcaoCad && typeof body.recepcaoCad !== "boolean") ||
    (mexeuRecepcaoImob && typeof body.recepcaoImobiliaria !== "boolean")
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

  // Comprovante de renda: só o flag (não há valor a configurar). Ligado, as duas rotas de salvar
  // passam a exigir o documento — a leitura fica em `exigeComprovanteRenda`.
  if (mexeuRenda) {
    const r = await setEnterpriseComprovanteRenda({
      adminClient,
      code: body.code,
      enterpriseId: body.enterpriseId,
      habilitada: Boolean(body.comprovanteRendaHabilitado),
      updatedBy: auth.userId,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  }

  // Portões públicos: cada um salva só o próprio flag, sem tocar o master nem os demais campos.
  if (mexeuRecepcaoCad) {
    const r = await setEnterpriseRecepcaoCad({
      adminClient,
      code: body.code,
      enterpriseId: body.enterpriseId,
      habilitada: Boolean(body.recepcaoCad),
      updatedBy: auth.userId,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  }

  if (mexeuRecepcaoImob) {
    const r = await setEnterpriseRecepcaoImobiliaria({
      adminClient,
      code: body.code,
      enterpriseId: body.enterpriseId,
      habilitada: Boolean(body.recepcaoImobiliaria),
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

  // A varredura roda DEPOIS do toggle e só quando ele desliga. Fora do `if` para o resultado poder
  // ir na resposta.
  let varredura: Awaited<ReturnType<typeof varrerPrevendaDesligada>> | null = null;

  if (mexeuPrevenda) {
    const r = await setEnterprisePrevenda({
      adminClient,
      code: body.code,
      enterpriseId: body.enterpriseId,
      habilitada: Boolean(body.prevendaHabilitada),
      updatedBy: auth.userId,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });

    // DESLIGAR A PRÉ-VENDA ALCANÇA O PRESENTE, NÃO SÓ O FUTURO (Lucas, 10/08). Antes o toggle só
    // valia para a próxima ficha: quem já estava na coluna Pré-venda ficava lá, num empreendimento
    // que não cobra nada, até alguém varrer na mão por SQL — foram 146 CADs em 09/08.
    if (!body.prevendaHabilitada) {
      varredura = await varrerPrevendaDesligada(adminClient, body.enterpriseId, auth.userId);
    }
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
      comprovanteRendaHabilitado: body.comprovanteRendaHabilitado,
      limiteCredito: limite,
      prevendaHabilitada: body.prevendaHabilitada,
      recepcaoCad: body.recepcaoCad,
      recepcaoImobiliaria: body.recepcaoImobiliaria,
      // Null quando não houve desligamento. Preenchido, diz quantas CADs saíram da pré-venda e para
      // onde — a tela mostra, senão o operador não fica sabendo que o clique dele mexeu na fila.
      varredura,
      valorPix,
    },
  });
}
