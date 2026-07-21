import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { avaliarCredito } from "@/lib/serasa/avaliacao";
import { consultarPF, consultarPJ } from "@/lib/serasa/client";
import { ambienteConfere, lerConfigSerasa } from "@/lib/serasa/config";
import { resumirRelatorio } from "@/lib/serasa/resumo";

// PREVIEW de validacao do Serasa — tela para o Lucas conferir O QUE a consulta traz antes de
// cravar o que vai pro cadastro. Consulta de verdade (UAT), grava para entrar no teto e no
// historico, e devolve TUDO: o resumo processado E o retorno cru.
//
// So difere da rota /consultar em dois pontos: nao exige entityId (e uma tela solta de validacao,
// nao esta amarrada a um CAD) e devolve o corpo cru para inspecao.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Mesmo teto da rota real: em homologacao, estourar 200/dia BLOQUEIA o IP compartilhado.
const TETO_DIARIO_HOMOLOGACAO = 150;

// PF autorizado na nossa credencial (testado 21/jul). O basico da 412 USER-NOT-AUTHORIZED.
const REPORT_PF = "RELATORIO_AVANCADO_TOP_SCORE_PF_PME";
const REPORT_PJ = "RELATORIO_BASICO_PJ_PME";

function soDigitos(v: string): string {
  return String(v ?? "").replace(/\D/g, "");
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });

  const cfg = lerConfigSerasa();
  if (!cfg.ok) {
    return NextResponse.json(
      { error: `Faltam variaveis do Serasa: ${cfg.faltando.join(", ")}.` },
      { status: 503 },
    );
  }
  const coerente = ambienteConfere(cfg.config);
  if (!coerente.ok) {
    return NextResponse.json({ error: coerente.erro }, { status: 409 });
  }

  const corpo = (await request.json().catch(() => ({}))) as {
    documento?: string;
    // Limite de restrições do empreendimento (Vale do Ouro = R$ 1.000). Default na avaliação.
    limiteRestricao?: number;
    reportName?: string;
  };
  const documento = soDigitos(corpo.documento ?? "");
  const ehPj = documento.length === 14;
  if (documento.length !== 11 && documento.length !== 14) {
    return NextResponse.json(
      { error: "Informe um CPF (11 digitos) ou CNPJ (14 digitos)." },
      { status: 400 },
    );
  }

  // Teto do dia (conta as consultas ja feitas, inclusive as de preview).
  const { count: hoje } = await client
    .from("serasa_consultas")
    .select("id", { count: "exact", head: true })
    .gte("created_at", new Date().toISOString().slice(0, 10));
  if (cfg.config.ambiente === "homologacao" && (hoje ?? 0) >= TETO_DIARIO_HOMOLOGACAO) {
    return NextResponse.json(
      { error: `Teto diario de homologacao atingido (${hoje}). Tente amanha.` },
      { status: 429 },
    );
  }

  const reportName = corpo.reportName?.trim() || (ehPj ? REPORT_PJ : REPORT_PF);
  const entrada = { documento, reportName };
  const resposta = ehPj
    ? await consultarPJ(cfg.config, entrada)
    : await consultarPF(cfg.config, entrada);

  const resumo = resposta.ok ? resumirRelatorio(resposta.corpo) : {};

  // Grava (inclusive erro): a chamada pode ter sido cobrada mesmo falhando.
  await client.from("serasa_consultas").insert({
    ambiente: cfg.config.ambiente,
    cost_center: cfg.config.costCenter,
    documento,
    erro: resposta.ok ? null : resposta.erro,
    finalidade: "preview-validacao",
    http_status: resposta.httpStatus,
    report_name: reportName,
    resposta: resposta.ok ? resposta.corpo : null,
    resumo,
    solicitado_por: /^[0-9a-f-]{36}$/i.test(auth.userId) ? auth.userId : null,
    status: resposta.ok ? "sucesso" : "erro",
    tipo_pessoa: ehPj ? "pj" : "pf",
  });

  if (!resposta.ok) {
    return NextResponse.json(
      { error: resposta.erro, httpStatus: resposta.httpStatus, reportName },
      { status: resposta.httpStatus ?? 502 },
    );
  }

  const veredito = avaliarCredito(
    resposta.corpo,
    typeof corpo.limiteRestricao === "number" && corpo.limiteRestricao > 0
      ? corpo.limiteRestricao
      : undefined,
  );

  return NextResponse.json({
    data: { cru: resposta.corpo, reportName, resumo, tipo: ehPj ? "pj" : "pf", veredito },
  });
}
