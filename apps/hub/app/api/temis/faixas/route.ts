import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { conferirFaixa, type EntradaDeFaixa } from "@/lib/temis/faixas";

// FAIXAS DE PRAZO DO EMPREENDIMENTO — Temis.
//
//   GET    → as faixas de um empreendimento, mais os índices cadastrados
//   POST   → cria uma faixa
//   PATCH  → edita uma faixa
//   DELETE → desativa (não apaga)
//
// Lucas (13/09/2026): *"em vez de cadastrar os juros e correção dentro de um plano, ter um cadastro
// de juros e correção separado por parcelas"*, e *"Faixa é por empreendimento"*.
//
// ⚠️ FAIXA DE PRAZO, NUNCA "FAIXA DE PARCELAS": aqui "1 a 12" quer dizer PLANOS DE 1 A 12
// PARCELAS, e não as parcelas 1 a 12 de um contrato. A tela do simulador já usa as segundas
// palavras para a tabela de reajuste, e trocar as duas constrói o sistema errado.
//
// ⚠️ DESATIVAR, NUNCA APAGAR — a mesma regra do plano e do índice. Uma faixa desativada continua
// explicando o plano que ela gerou; apagá-la deixaria o plano sem origem.
//
// ⚠️ A SOBREPOSIÇÃO É RECUSADA PELO BANCO, não por esta rota. A `exclude` da migration 0155 usa
// `int4range` e cobre até a corrida entre duas abas abertas ao mesmo tempo — coisa que validação de
// aplicação não pega. Aqui só se traduz o erro para uma frase que o operador entende.
//
// AUTORIZAÇÃO: leitura no GET, ESCRITA nos demais. A faixa decide quanto o comprador paga de juros.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKSPACE = "careli";

/** O empreendimento é TEXT porque convive com id numérico e agrupamento. */
function empreendimentoDaUrl(request: Request): null | string {
  const valor = new URL(request.url).searchParams.get("enterpriseId")?.trim();
  return valor || null;
}

/** `23P01` é a violação de `exclude` — a única que precisa virar texto de gente. */
function erroDoBanco(codigo: string | undefined, mensagem: string): string {
  if (codigo === "23P01") {
    return "Já existe uma faixa ativa cobrindo parte desse intervalo de parcelas.";
  }
  if (codigo === "23503") {
    return "O índice escolhido não está cadastrado.";
  }
  return mensagem;
}

function linhaDoCorpo(entrada: EntradaDeFaixa) {
  return {
    define_entrada: entrada.defineEntrada,
    define_indice: entrada.defineIndice,
    define_juros: entrada.defineJuros,
    entrada_percentual: entrada.defineEntrada
      ? entrada.entradaPercentual
      : null,
    indice_correcao: entrada.defineIndice ? entrada.indiceCorrecao : null,
    juros_convencao: entrada.jurosConvencao,
    juros_periodicidade: entrada.jurosPeriodicidade,
    // ⚠️ NULO AQUI É "SEM JUROS", e não "não informado": é a faixa "1 a 12 sem juros" do exemplo do
    // Lucas. Quem diz se a faixa opina sobre juros é `define_juros`.
    juros_taxa: entrada.defineJuros ? entrada.jurosTaxa : null,
    observacao: entrada.observacao,
    parcela_maxima: entrada.parcelaMaxima,
    parcela_minima: entrada.parcelaMinima,
  };
}

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const enterpriseId = empreendimentoDaUrl(request);
  if (!enterpriseId) {
    return NextResponse.json(
      { error: "Informe o empreendimento." },
      { status: 400 },
    );
  }

  const admin = createApoloAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "Supabase indisponível." },
      { status: 503 },
    );

  const [faixasRes, indicesRes] = await Promise.all([
    admin
      .from("temis_faixas_de_prazo")
      .select(
        "id, parcela_minima, parcela_maxima, define_entrada, entrada_percentual, define_juros, juros_taxa, juros_periodicidade, juros_convencao, define_indice, indice_correcao, ativo, observacao, criado_em",
      )
      .eq("workspace_id", WORKSPACE)
      .eq("enterprise_id", enterpriseId)
      .order("parcela_minima", { ascending: true }),
    // ⚠️ OS ÍNDICES VÊM JUNTO, e da TABELA (migration 0154) — não de uma lista no código. Era assim
    // que nasciam as cinco cópias divergentes que esta casa tinha até 13/09/2026.
    admin
      .from("temis_indices")
      .select("codigo, sigla, nome, aplicacao, fonte, exige_parametro, ordem")
      .eq("workspace_id", WORKSPACE)
      .eq("ativo", true)
      .order("ordem", { ascending: true }),
  ]);

  if (faixasRes.error) {
    return NextResponse.json(
      { error: faixasRes.error.message },
      { status: 500 },
    );
  }
  if (indicesRes.error) {
    return NextResponse.json(
      { error: indicesRes.error.message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { data: { faixas: faixasRes.data ?? [], indices: indicesRes.data ?? [] } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const enterpriseId = empreendimentoDaUrl(request);
  if (!enterpriseId) {
    return NextResponse.json(
      { error: "Informe o empreendimento." },
      { status: 400 },
    );
  }

  const corpo = (await request
    .json()
    .catch(() => null)) as null | EntradaDeFaixa;
  if (!corpo)
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });

  const problemas = conferirFaixa(corpo);
  if (problemas.length > 0) {
    return NextResponse.json({ error: problemas.join(" ") }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "Supabase indisponível." },
      { status: 503 },
    );

  const { data, error } = await admin
    .from("temis_faixas_de_prazo")
    .insert({
      ...linhaDoCorpo(corpo),
      criado_por: auth.userId,
      enterprise_id: enterpriseId,
      workspace_id: WORKSPACE,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: erroDoBanco(error.code, error.message) },
      { status: error.code === "23P01" ? 409 : 500 },
    );
  }

  return NextResponse.json({ data: { id: data?.id ?? null } });
}

export async function PATCH(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id)
    return NextResponse.json({ error: "Informe a faixa." }, { status: 400 });

  const corpo = (await request
    .json()
    .catch(() => null)) as null | EntradaDeFaixa;
  if (!corpo)
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });

  const problemas = conferirFaixa(corpo);
  if (problemas.length > 0) {
    return NextResponse.json({ error: problemas.join(" ") }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "Supabase indisponível." },
      { status: 503 },
    );

  const { error } = await admin
    .from("temis_faixas_de_prazo")
    .update({ ...linhaDoCorpo(corpo), atualizado_em: new Date().toISOString() })
    .eq("workspace_id", WORKSPACE)
    .eq("id", id);

  if (error) {
    return NextResponse.json(
      { error: erroDoBanco(error.code, error.message) },
      { status: error.code === "23P01" ? 409 : 500 },
    );
  }

  return NextResponse.json({ data: { ok: true } });
}

export async function DELETE(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id)
    return NextResponse.json({ error: "Informe a faixa." }, { status: 400 });

  const admin = createApoloAdminClient();
  if (!admin)
    return NextResponse.json(
      { error: "Supabase indisponível." },
      { status: 503 },
    );

  // ⚠️ DESATIVA, NÃO APAGA. E desativar LIBERA o intervalo: a `exclude` da 0155 é parcial
  // (`where (ativo)`), então a faixa antiga não impede a nova de ocupar o mesmo prazo.
  const { error } = await admin
    .from("temis_faixas_de_prazo")
    .update({ ativo: false, atualizado_em: new Date().toISOString() })
    .eq("workspace_id", WORKSPACE)
    .eq("id", id);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: { ok: true } });
}
