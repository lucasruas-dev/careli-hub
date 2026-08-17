import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import { setEnterpriseGestaoCarteira } from "@/lib/apolo/enterprise-settings";
import { loadPoliticaComercial } from "@/lib/apolo/politica-comercial";
import { createApoloAdminClient } from "@/lib/apolo/server";

// POLÍTICA COMERCIAL DO EMPREENDIMENTO — as duas fontes, com a precedência do Lucas (17/08/2026):
//
//   GET   → junta o que vem do C2X (comissão total, entrada mínima, parcelas do sinal, split da
//           cadeia por papel) com a % de gestão de carteira que mora no Apolo, e devolve os avisos
//           quando a política do legado está furada.
//   PATCH → grava SÓ a % de gestão de carteira. O resto é do C2X, que é read-only.
//
// AUTORIZAÇÃO: leitura no GET; ESCRITA no PATCH. A % define quanto o incorporador recebe e se a
// aba Carteira aparece para ele — quem só visualiza não muda isso.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const codes = (new URL(request.url).searchParams.get("codes") ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);

  if (codes.length === 0) {
    return NextResponse.json(
      { error: "Informe ao menos um codigo de empreendimento." },
      { status: 400 },
    );
  }

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  // A % do Apolo vem primeiro: é ela que a leitura do C2X recebe para montar os avisos.
  //
  // ⚠️ O ERRO É CHECADO, e a rota FALHA em vez de seguir com o Map vazio. Sem isto, qualquer
  // problema de leitura (timeout, 5xx do PostgREST) faria a tela dizer "a Careli não administra a
  // carteira deste empreendimento" — uma AFIRMAÇÃO DE NEGÓCIO — a partir de uma falha técnica. E o
  // operador estaria a um clique de gravar esse vazio falso por cima do percentual real.
  const { data: settings, error: erroSettings } = await adminClient
    .from("apolo_enterprise_settings")
    .select("enterprise_id, gestao_carteira_percentual")
    .limit(2000);

  if (erroSettings) {
    return NextResponse.json(
      { error: `Nao foi possivel ler a gestao de carteira: ${erroSettings.message}` },
      { status: 503 },
    );
  }

  const gestaoPorEnterpriseId = new Map<string, null | number>(
    ((settings ?? []) as Array<{
      enterprise_id: string;
      gestao_carteira_percentual: null | number | string;
    }>).map((linha) => [
      String(linha.enterprise_id),
      linha.gestao_carteira_percentual === null ||
      linha.gestao_carteira_percentual === undefined
        ? null
        : Number(linha.gestao_carteira_percentual),
    ]),
  );

  const resultado = await loadPoliticaComercial(codes, gestaoPorEnterpriseId);

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: 502 });
  }

  return NextResponse.json(
    { data: { politicas: resultado.politicas } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  let corpo: {
    code?: null | string;
    /** Uma divisão (compatível) ou várias, quando o empreendimento tem fases/glebas. */
    enterpriseId?: string;
    enterpriseIds?: string[];
    // `null` APAGA, e apagar tem significado: "não fazemos a gestão de carteira deste
    // empreendimento". Por isso o campo distingue ausente (não mexeu) de null (limpou).
    gestaoCarteiraPercentual?: null | number | string;
  };

  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });
  }

  // ⚠️ AS DIVISÕES GRAVAM NUMA CHAMADA SÓ, e isso é o que impede estado meio-feito. A tela fazia
  // um PATCH por divisão em sequência: se a segunda falhasse, a Lagoa Bonita ficaria com uma gleba
  // em 97% e outra em 96% — exatamente o que a regra "uma % por empreendimento" proíbe —, e a tela
  // ainda diria "a política NÃO mudou", afirmação que ela não tinha como honrar.
  const ids = [
    ...(Array.isArray(corpo.enterpriseIds) ? corpo.enterpriseIds : []),
    ...(corpo.enterpriseId ? [corpo.enterpriseId] : []),
  ]
    .map((id) => String(id).trim())
    .filter(Boolean);

  const enterpriseIds = [...new Set(ids)];

  if (enterpriseIds.length === 0) {
    return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });
  }

  if (!("gestaoCarteiraPercentual" in corpo)) {
    return NextResponse.json({ error: "Nada para salvar." }, { status: 400 });
  }

  const bruto = corpo.gestaoCarteiraPercentual;
  const percentual =
    bruto === null || bruto === undefined || bruto === ""
      ? null
      : typeof bruto === "string"
        ? Number(bruto.replace(",", "."))
        : Number(bruto);

  if (percentual !== null && !Number.isFinite(percentual)) {
    return NextResponse.json(
      { error: "Percentual invalido: informe um numero entre 0 e 100." },
      { status: 400 },
    );
  }

  const gravados: string[] = [];

  for (const enterpriseId of enterpriseIds) {
    const gravado = await setEnterpriseGestaoCarteira({
      adminClient,
      code: corpo.code ?? null,
      enterpriseId,
      percentual,
      updatedBy: auth.userId,
    });

    if (!gravado.ok) {
      // Relata O QUE JÁ GRAVOU. Uma falha no meio deixa o empreendimento inconsistente, e o
      // operador precisa saber disso para corrigir — não pode ler "não salvou" e ir embora.
      return NextResponse.json(
        {
          error:
            gravados.length > 0
              ? `${gravado.error} Atenção: ${gravados.length} de ${enterpriseIds.length} divisões já foram salvas (${gravados.join(", ")}). Tente de novo para igualar as demais.`
              : gravado.error,
          gravados,
        },
        { status: 400 },
      );
    }

    gravados.push(enterpriseId);
  }

  return NextResponse.json({
    data: {
      divisoes: gravados.length,
      gestaoCarteiraPercentual: percentual,
      // A tela usa isto para dizer "sem gestão de carteira" em vez de mostrar 0%.
      semGestao: percentual === null,
    },
  });
}
