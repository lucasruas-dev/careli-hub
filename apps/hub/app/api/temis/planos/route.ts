import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { conferirPlano, type EntradaDePlano } from "@/lib/temis/planos";

// PLANOS COMERCIAIS DO EMPREENDIMENTO — Temis.
//
//   GET    → os planos e as categorias de um empreendimento
//   POST   → cria um plano
//   PATCH  → edita um plano
//   DELETE → desativa (não apaga)
//
// ⚠️ DESATIVAR, NUNCA APAGAR. Um plano com venda feita explica um contrato assinado; sumir com ele
// deixaria o contrato sem origem. O banco já impede pelo `on delete restrict`, e aqui a rota nem
// oferece o caminho: DELETE marca `ativo = false`. Índice parcial no banco garante que plano
// desativado libera o slot para outro ocupar.
//
// AUTORIZAÇÃO: leitura no GET, ESCRITA nos demais. O plano decide qual minuta o contrato usa e
// quanto o comprador paga — quem só visualiza não mexe nisso.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** O empreendimento é TEXT porque convive com id numérico e agrupamento (`group:Nome`). */
function empreendimentoDaUrl(request: Request): null | string {
  const valor = new URL(request.url).searchParams.get("enterpriseId")?.trim();
  return valor || null;
}

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const enterpriseId = empreendimentoDaUrl(request);
  if (!enterpriseId) {
    return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  const [planosRes, categoriasRes, minutasRes] = await Promise.all([
    admin
      .from("temis_planos")
      .select(
        "id, nome, parcelas, entrada_percentual, juros_taxa, juros_periodicidade, juros_convencao, indice_correcao, sistema_amortizacao, slot, ativo, ordem, observacao, categoria_id, minuta_id, criado_em",
      )
      .eq("workspace_id", "careli")
      .eq("enterprise_id", enterpriseId)
      .order("ordem", { ascending: true })
      .order("parcelas", { ascending: true }),
    admin
      .from("temis_categorias")
      .select("id, nome, ordem, ativa")
      .eq("workspace_id", "careli")
      .eq("enterprise_id", enterpriseId)
      .order("ordem", { ascending: true }),
    admin
      .from("temis_minutas")
      .select("id, nome, situacao, versao")
      .eq("workspace_id", "careli")
      .eq("enterprise_id", enterpriseId)
      .neq("situacao", "arquivada")
      .order("nome", { ascending: true }),
  ]);

  // ⚠️ FALHA FECHADA. Devolver lista vazia num erro de leitura faria a tela dizer "este
  // empreendimento não tem plano" — uma afirmação de negócio a partir de uma falha técnica, e o
  // operador cadastraria tudo de novo por cima. É o mesmo cuidado da aba de política comercial.
  const erro = planosRes.error ?? categoriasRes.error ?? minutasRes.error;
  if (erro) {
    return NextResponse.json(
      { error: "Não consegui ler os planos deste empreendimento." },
      { status: 502 },
    );
  }

  const categorias = categoriasRes.data ?? [];
  const minutas = minutasRes.data ?? [];
  const porCategoria = new Map(categorias.map((c) => [c.id, c.nome]));
  const porMinuta = new Map(minutas.map((m) => [m.id, m.nome]));
  const planos = planosRes.data ?? [];

  return NextResponse.json({
    data: {
      categorias: categorias.map((c) => ({
        ativa: c.ativa,
        id: c.id,
        nome: c.nome,
        ordem: c.ordem,
        planos: planos.filter((p) => p.categoria_id === c.id).length,
      })),
      minutas: minutas.map((m) => ({
        id: m.id,
        nome: m.nome,
        publicada: m.situacao === "publicada",
        versao: m.versao,
      })),
      planos: planos.map((p) => ({
        ativo: p.ativo,
        categoriaId: p.categoria_id,
        categoriaNome: p.categoria_id ? (porCategoria.get(p.categoria_id) ?? null) : null,
        criadoEm: p.criado_em,
        entradaPercentual: Number(p.entrada_percentual),
        id: p.id,
        indiceCorrecao: p.indice_correcao,
        jurosConvencao: p.juros_convencao,
        jurosPeriodicidade: p.juros_periodicidade,
        jurosTaxa: p.juros_taxa === null ? null : Number(p.juros_taxa),
        minutaId: p.minuta_id,
        minutaNome: p.minuta_id ? (porMinuta.get(p.minuta_id) ?? null) : null,
        nome: p.nome,
        observacao: p.observacao,
        ordem: p.ordem,
        parcelas: p.parcelas,
        sistemaAmortizacao: p.sistema_amortizacao,
        slot: p.slot,
      })),
    },
  });
}

/** Traduz a entrada da tela para as colunas do banco. Um lugar só, para não divergir. */
function paraColunas(entrada: EntradaDePlano, enterpriseId: string) {
  return {
    ativo: entrada.ativo ?? true,
    categoria_id: entrada.categoriaId ?? null,
    entrada_percentual: entrada.entradaPercentual,
    enterprise_id: enterpriseId,
    indice_correcao: entrada.indiceCorrecao,
    juros_convencao: entrada.jurosConvencao ?? "equivalente",
    juros_periodicidade: entrada.jurosPeriodicidade ?? "anual",
    juros_taxa: entrada.jurosTaxa,
    minuta_id: entrada.minutaId ?? null,
    nome: entrada.nome.trim(),
    observacao: entrada.observacao ?? null,
    ordem: entrada.ordem ?? 0,
    parcelas: entrada.parcelas,
    sistema_amortizacao: entrada.sistemaAmortizacao,
    slot: entrada.slot ?? null,
    workspace_id: "careli",
  };
}

/**
 * Traduz o erro do Postgres para o que o operador precisa fazer.
 *
 * ⚠️ Sem isto, o slot duplicado devolveria "duplicate key value violates unique constraint
 * temis_planos_slot_unico_por_empreendimento" na cara de quem só queria cadastrar um plano.
 */
function explicarErro(codigo: string, mensagem: string): string {
  if (codigo === "23505" && mensagem.includes("slot")) {
    return "Já existe um plano ativo nessa posição da proposta. Troque a posição ou desative o outro.";
  }
  if (codigo === "23505") return "Já existe um plano com esse nome neste empreendimento.";
  if (codigo === "23514" && mensagem.includes("entrada")) {
    return "A entrada é um percentual de 0 a 100 — 20 significa 20%.";
  }
  if (codigo === "23514") return "Algum valor está fora do permitido. Confira parcelas, juros e entrada.";
  return "Não consegui gravar o plano.";
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const enterpriseId = empreendimentoDaUrl(request);
  if (!enterpriseId) return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });

  const entrada = (await request.json().catch(() => null)) as EntradaDePlano | null;
  if (!entrada) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });

  const problemas = conferirPlano(entrada);
  if (problemas.length) return NextResponse.json({ error: problemas.join(" ") }, { status: 400 });

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  const { data, error } = await admin
    .from("temis_planos")
    .insert(paraColunas(entrada, enterpriseId))
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: explicarErro(error.code ?? "", error.message ?? "") }, { status: 400 });
  }
  return NextResponse.json({ data: { id: data.id } });
}

export async function PATCH(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const enterpriseId = empreendimentoDaUrl(request);
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!enterpriseId || !id) {
    return NextResponse.json({ error: "Informe o empreendimento e o plano." }, { status: 400 });
  }

  const entrada = (await request.json().catch(() => null)) as EntradaDePlano | null;
  if (!entrada) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });

  const problemas = conferirPlano(entrada);
  if (problemas.length) return NextResponse.json({ error: problemas.join(" ") }, { status: 400 });

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  const { error } = await admin
    .from("temis_planos")
    .update({ ...paraColunas(entrada, enterpriseId), atualizado_em: new Date().toISOString() })
    .eq("workspace_id", "careli")
    .eq("enterprise_id", enterpriseId)
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: explicarErro(error.code ?? "", error.message ?? "") }, { status: 400 });
  }
  return NextResponse.json({ data: { id } });
}

export async function DELETE(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const enterpriseId = empreendimentoDaUrl(request);
  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!enterpriseId || !id) {
    return NextResponse.json({ error: "Informe o empreendimento e o plano." }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  // Desativa. Ver a nota do topo: plano com venda explica um contrato assinado.
  const { error } = await admin
    .from("temis_planos")
    .update({ ativo: false, atualizado_em: new Date().toISOString() })
    .eq("workspace_id", "careli")
    .eq("enterprise_id", enterpriseId)
    .eq("id", id);

  if (error) return NextResponse.json({ error: "Não consegui desativar o plano." }, { status: 400 });
  return NextResponse.json({ data: { id } });
}
