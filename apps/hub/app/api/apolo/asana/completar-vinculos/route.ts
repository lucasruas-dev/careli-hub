import { NextResponse } from "next/server";

import { asanaConfigurado } from "@/lib/apolo/asana-import";
import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  aplicarCompletar,
  EMPREENDIMENTOS_AUTORIZADOS,
  levantarCompletaveis,
  noEscopo,
} from "@/lib/apolo/completar-vinculos";
import { createApoloAdminClient } from "@/lib/apolo/server";

// COMPLETAR VÍNCULOS — corretor, e-mail do corretor e imobiliária das CADs já importadas.
//
// GET  = DRY-RUN puro. Read-only, custo ZERO (nenhum documento lido, nenhuma consulta paga).
//        Devolve os números, as grafias encontradas, os ambíguos e a matriz
//        imobiliária × empreendimento — o insumo do credenciamento.
// POST = ESCREVE. Exige `confirmado: true`. Sem isso, 428 e nada é gravado.
//
// ⚠️ POR QUE NÃO É O `POST /api/apolo/asana/importar`: aquele promove a etapa da esteira
// (default "credito"), reescreve `atualizado_em` nas 392 linhas embaralhando a fila do Board,
// e usa upsert com array heterogêneo — a armadilha do PostgREST que já nos custou dado. Este
// aqui só faz UPDATE de uma coluna por vez, com guarda de NULL no banco.
//
// ⚠️ ESCOPO TRAVADO: `EMPREENDIMENTOS_AUTORIZADOS` = ["Vale do Ouro"], por igualdade
// normalizada (não substring — senão "Vale do Ouro II" entraria). O parâmetro da query NÃO
// consegue ampliar o escopo: ele é validado contra a lista antes de qualquer coisa acontecer.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A varredura pagina o projeto inteiro do Asana e depois cruza com o banco.
export const maxDuration = 300;

// Trava de escopo na porta de entrada. O empreendimento pedido tem que estar na lista
// autorizada; qualquer outro valor é recusado ANTES de tocar no Asana ou no banco.
function empreendimentoPedido(url: URL | null, doCorpo?: string | null): string {
  const bruto = (doCorpo ?? url?.searchParams.get("empreendimento") ?? "").trim();
  if (!bruto) return EMPREENDIMENTOS_AUTORIZADOS[0]!;
  return bruto;
}

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  if (!asanaConfigurado()) {
    return NextResponse.json(
      { error: "ASANA_ACCESS_TOKEN nao configurado neste ambiente." },
      { status: 503 },
    );
  }

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const empreendimento = empreendimentoPedido(new URL(request.url));
  if (!noEscopo(empreendimento)) {
    return NextResponse.json(
      {
        error:
          `Empreendimento fora do escopo autorizado. Liberado: ${EMPREENDIMENTOS_AUTORIZADOS.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  try {
    const plano = await levantarCompletaveis(client, { empreendimento });

    // `linhas` fica DE FORA da resposta: são centenas de registros que a tela não usa, e o
    // POST refaz o levantamento do zero em vez de confiar em plano vindo do cliente.
    const { linhas: _linhas, ...paraTela } = plano;

    return NextResponse.json(
      { data: paraTela },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  if (!asanaConfigurado()) {
    return NextResponse.json(
      { error: "ASANA_ACCESS_TOKEN nao configurado neste ambiente." },
      { status: 503 },
    );
  }

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    apenas?: ("corretor" | "email" | "imobiliaria")[];
    confirmado?: boolean;
    empreendimento?: string | null;
  };

  // DRY-RUN é o padrão. Sem confirmação explícita nada é gravado.
  if (body.confirmado !== true) {
    return NextResponse.json(
      { error: "Confira o levantamento na tela e confirme antes de gravar." },
      { status: 428 },
    );
  }

  const empreendimento = empreendimentoPedido(null, body.empreendimento);
  if (!noEscopo(empreendimento)) {
    return NextResponse.json(
      {
        error:
          `Empreendimento fora do escopo autorizado. Liberado: ${EMPREENDIMENTOS_AUTORIZADOS.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  // Só os campos que esta rota sabe escrever. `etapa` e `analistaId` NÃO existem aqui de
  // propósito: um backfill de vínculo não muda estado operacional de ninguém.
  const CAMPOS_VALIDOS = ["corretor", "email", "imobiliaria"] as const;
  const apenas = (body.apenas ?? []).filter((campo) =>
    (CAMPOS_VALIDOS as readonly string[]).includes(campo),
  );

  // ⚠️ Lista vazia significa "todos os campos" em `aplicarCompletar`. Então um `apenas` que veio
  // preenchido mas SÓ com nomes inválidos (typo, campo renomeado) escalaria de "grave um campo"
  // para "grave os três" — o oposto do que quem pediu queria. Recusa em vez de ampliar.
  if (body.apenas !== undefined && apenas.length === 0) {
    return NextResponse.json(
      {
        error: `Nenhum campo valido em 'apenas'. Validos: ${CAMPOS_VALIDOS.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  try {
    // Refaz o levantamento do ZERO. O servidor não confia em plano vindo do cliente: se
    // confiasse, bastaria forjar o corpo para gravar qualquer valor em qualquer entidade.
    const plano = await levantarCompletaveis(client, { empreendimento });
    const resultado = await aplicarCompletar(client, { apenas, plano });

    return NextResponse.json({
      data: {
        ...resultado,
        // Devolvido para a tela conferir que o que foi gravado bate com o que ela mostrou.
        totais: plano.totais,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
