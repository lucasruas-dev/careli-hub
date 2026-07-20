import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { consultarPF, consultarPJ } from "@/lib/serasa/client";
import { ambienteConfere, lerConfigSerasa } from "@/lib/serasa/config";
import { resumirRelatorio } from "@/lib/serasa/resumo";

// CONSULTA DE CRÉDITO no Serasa — o caminho que gasta dinheiro.
//
// GET  = SITUAÇÃO, custo zero: diz se está configurado, em que ambiente, se já existe consulta
//        recente do mesmo documento e quantas chamadas já saíram hoje.
// POST = CONSULTA de verdade. Exige `confirmado`.
//
// Mesma disciplina da MOST: orçamento e confirmação antes de qualquer chamada paga.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Homologação bloqueia o IP acima de 200 chamadas/dia. Paramos antes, com folga, porque o
// bloqueio é por IP e derrubaria outros serviços que saem pelo mesmo endereço.
const TETO_DIARIO_HOMOLOGACAO = 150;

// Consulta do mesmo documento dentro deste prazo é reaproveitada em vez de cobrada de novo.
// 30 dias é o palpite conservador enquanto o Serasa não responde se existe janela comercial.
const DIAS_REAPROVEITAMENTO = 30;

type Corpo = {
  confirmado?: boolean;
  entityId?: string;
  finalidade?: string;
  forcar?: boolean;
  optionalFeatures?: string[];
  reportName?: string;
};

async function situacao(client: NonNullable<ReturnType<typeof createApoloAdminClient>>, documento: string) {
  const desde = new Date(Date.now() - DIAS_REAPROVEITAMENTO * 24 * 3600 * 1000).toISOString();

  const [{ data: recente }, { count: hoje }] = await Promise.all([
    client
      .from("serasa_consultas")
      .select("id, created_at, ambiente, resumo, report_name")
      .eq("documento", documento)
      .eq("status", "sucesso")
      .gte("created_at", desde)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from("serasa_consultas")
      .select("id", { count: "exact", head: true })
      .gte("created_at", new Date().toISOString().slice(0, 10)),
  ]);

  return { consultasHoje: hoje ?? 0, recente: recente ?? null };
}

export async function GET(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });

  // Recebe a FICHA, não o documento: o CPF sai do cadastro, nunca da query string (não vaza
  // em log de proxy, e ninguém consulta um documento arbitrário por esta rota).
  const url = new URL(request.url);
  const entityId = url.searchParams.get("entityId") ?? "";

  let documento = "";
  if (entityId) {
    const { data: entidade } = await client
      .from("apolo_entities")
      .select("document_masked")
      .eq("id", entityId)
      .maybeSingle<{ document_masked: string | null }>();
    documento = (entidade?.document_masked ?? "").replace(/\D/g, "");
  }

  const cfg = lerConfigSerasa();
  if (!cfg.ok) {
    return NextResponse.json({
      data: { configurado: false, faltando: cfg.faltando },
    });
  }

  const coerente = ambienteConfere(cfg.config);
  const { consultasHoje, recente } = documento
    ? await situacao(client, documento)
    : { consultasHoje: 0, recente: null };

  return NextResponse.json(
    {
      data: {
        ambiente: cfg.config.ambiente,
        avisoAmbiente: coerente.ok ? null : coerente.erro,
        configurado: true,
        consultasHoje,
        // Em homologação a conta é contra o teto do IP; em produção, informativa.
        tetoDiario: cfg.config.ambiente === "homologacao" ? TETO_DIARIO_HOMOLOGACAO : null,
        ultimaConsulta: recente,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });

  const corpo = (await request.json().catch(() => ({}))) as Corpo;

  if (!corpo.confirmado) {
    return NextResponse.json(
      { error: "Esta acao CONSULTA O SERASA e pode ser cobrada. Confirme na tela." },
      { status: 428 },
    );
  }
  if (!corpo.entityId || !corpo.reportName) {
    return NextResponse.json({ error: "Informe a ficha e o relatorio." }, { status: 400 });
  }

  const cfg = lerConfigSerasa();
  if (!cfg.ok) {
    return NextResponse.json(
      { error: `Integracao nao configurada. Falta: ${cfg.faltando.join(", ")}.` },
      { status: 503 },
    );
  }

  const coerente = ambienteConfere(cfg.config);
  if (!coerente.ok) {
    return NextResponse.json({ error: coerente.erro }, { status: 409 });
  }

  // De quem é a consulta: o documento vem da ficha, nunca do corpo da requisição — assim
  // ninguém consulta um CPF arbitrário por esta rota.
  const { data: entidade } = await client
    .from("apolo_entities")
    .select("id, display_name, document_masked, entity_kind")
    .eq("id", corpo.entityId)
    .maybeSingle<{
      display_name: string;
      document_masked: string | null;
      entity_kind: string;
      id: string;
    }>();

  if (!entidade) return NextResponse.json({ error: "Ficha nao encontrada." }, { status: 404 });

  const documento = (entidade.document_masked ?? "").replace(/\D/g, "");
  const ehPj = entidade.entity_kind === "pj";
  const tamanhoEsperado = ehPj ? 14 : 11;

  if (documento.length !== tamanhoEsperado) {
    return NextResponse.json(
      {
        error:
          `A ficha nao tem ${ehPj ? "CNPJ" : "CPF"} completo para consultar ` +
          `(${documento.length} digitos). Complete o cadastro antes.`,
      },
      { status: 412 },
    );
  }

  const { consultasHoje, recente } = await situacao(client, documento);

  // Trava de duplicidade: consulta recente do mesmo documento é reaproveitada, a não ser que
  // se peça explicitamente uma nova (e aí a tela já avisou que gera cobrança).
  if (recente && !corpo.forcar) {
    return NextResponse.json({
      data: { consultaAnterior: recente, reaproveitada: true },
    });
  }

  // Teto diário: em homologação, estourar bloqueia o IP e a liberação exige formalização.
  if (cfg.config.ambiente === "homologacao" && consultasHoje >= TETO_DIARIO_HOMOLOGACAO) {
    return NextResponse.json(
      {
        error:
          `Teto diario de homologacao atingido (${consultasHoje}). O Serasa bloqueia o IP ` +
          `acima de 200 chamadas por dia. Tente amanha.`,
      },
      { status: 429 },
    );
  }

  const entrada = {
    documento,
    optionalFeatures: corpo.optionalFeatures ?? [],
    reportName: corpo.reportName,
  };

  const resposta = ehPj
    ? await consultarPJ(cfg.config, entrada)
    : await consultarPF(cfg.config, entrada);

  // Grava SEMPRE, inclusive o erro: a chamada pode ter sido cobrada mesmo falhando, e sem
  // registro ninguém consegue reconciliar a fatura depois.
  const registro = {
    ambiente: cfg.config.ambiente,
    cost_center: cfg.config.costCenter,
    documento,
    entity_id: entidade.id,
    erro: resposta.ok ? null : resposta.erro,
    finalidade: corpo.finalidade?.trim() || "analise-credito-cad",
    http_status: resposta.httpStatus,
    optional_features: entrada.optionalFeatures,
    report_name: entrada.reportName,
    resposta: resposta.ok ? resposta.corpo : null,
    resumo: resposta.ok ? resumirRelatorio(resposta.corpo) : {},
    solicitado_por: /^[0-9a-f-]{36}$/i.test(auth.userId) ? auth.userId : null,
    status: resposta.ok ? "sucesso" : "erro",
    tipo_pessoa: ehPj ? "pj" : "pf",
  };

  const { data: gravada } = await client
    .from("serasa_consultas")
    .insert(registro)
    .select("id, created_at, resumo, ambiente")
    .maybeSingle();

  if (!resposta.ok) {
    return NextResponse.json(
      { error: resposta.erro, registroId: (gravada as { id: string } | null)?.id ?? null },
      { status: resposta.httpStatus ?? 502 },
    );
  }

  return NextResponse.json({ data: { consulta: gravada, reaproveitada: false } });
}
