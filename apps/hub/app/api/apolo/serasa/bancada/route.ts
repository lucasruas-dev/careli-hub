import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { lerConfigSerasa } from "@/lib/serasa/config";

// BANCADA DE TESTE do Serasa — descobrir na tentativa e erro o que a documentação não responde.
//
// Existe porque a documentação do Serasa publica DOIS caminhos de token
// (`client-identities/login` e `user-identities/login?clientId=`) e TRÊS hosts (`uat-api`,
// `sandbox-api`, `api`), sem dizer qual vale para a nossa credencial. São poucas combinações:
// dá para descobrir com menos de dez chamadas, bem abaixo do teto diário.
//
// ⚠️ REGRAS QUE ESTA ROTA IMPÕE, e o motivo:
//   · UMA chamada por clique. Sem retry, sem lote, sem loop. O perigo não é a tentativa
//     consciente, é o laço que dispara cem chamadas em segundos: em homologação, passar de 200
//     por dia BLOQUEIA O IP, e a liberação exige formalização com o Serasa.
//   · Teto próprio bem abaixo do deles.
//   · Só autenticação. Consulta de documento vai pela rota normal, que registra e cobra regra.
//   · A resposta CRUA volta inteira, porque o objetivo é justamente descobrir o formato.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

// Bem abaixo dos 200/dia do Serasa: a bancada é para experimentar, não para volume.
const TETO_BANCADA_DIA = 40;

type Corpo = {
  authUrl?: string;
  // Alguns exemplos da documentação mandam o clientId na query, outros não.
  clientIdNaQuery?: boolean;
};

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });

  const cfg = lerConfigSerasa();
  if (!cfg.ok) {
    return NextResponse.json(
      { error: `Faltam variaveis: ${cfg.faltando.join(", ")}.` },
      { status: 503 },
    );
  }

  // A bancada NUNCA fala com produção. Mesmo que alguém aponte as URLs para lá, aqui para.
  if (cfg.config.ambiente !== "homologacao") {
    return NextResponse.json(
      { error: "A bancada so roda em homologacao. Ambiente atual: producao." },
      { status: 409 },
    );
  }

  const corpo = (await request.json().catch(() => ({}))) as Corpo;

  // Conta as tentativas do dia, incluindo as da bancada.
  const { count } = await client
    .from("serasa_consultas")
    .select("id", { count: "exact", head: true })
    .gte("created_at", new Date().toISOString().slice(0, 10));

  if ((count ?? 0) >= TETO_BANCADA_DIA) {
    return NextResponse.json(
      {
        error:
          `Teto da bancada atingido (${count} tentativas hoje). O Serasa bloqueia o IP acima ` +
          `de 200/dia; paramos bem antes de proposito.`,
      },
      { status: 429 },
    );
  }

  // URL a testar: a informada na tela, ou a configurada por padrão.
  const base = corpo.authUrl?.trim() || cfg.config.authUrl;
  const url = new URL(base);
  if (corpo.clientIdNaQuery) url.searchParams.set("clientId", cfg.config.clientId);

  const basic = Buffer.from(`${cfg.config.clientId}:${cfg.config.clientSecret}`).toString(
    "base64",
  );

  const inicio = Date.now();
  let status: number | null = null;
  let corpoResposta = "";
  let erroRede: string | null = null;

  try {
    const resposta = await fetch(url.toString(), {
      cache: "no-store",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
      method: "POST",
    });
    status = resposta.status;
    // Texto cru: o formato é justamente o que estamos tentando descobrir.
    corpoResposta = (await resposta.text().catch(() => "")).slice(0, 4000);
  } catch (e) {
    erroRede = (e as Error).message;
  }

  // Registra a tentativa: entra na conta do teto e deixa histórico do que já foi testado.
  await client.from("serasa_consultas").insert({
    ambiente: "homologacao",
    documento: "bancada",
    erro: erroRede ?? (status && status >= 400 ? corpoResposta.slice(0, 500) : null),
    finalidade: "bancada-descoberta-endpoint",
    http_status: status,
    report_name: "AUTH_TESTE",
    resumo: { authUrl: url.toString().replace(/clientId=[^&]+/, "clientId=***") },
    solicitado_por: /^[0-9a-f-]{36}$/i.test(auth.userId) ? auth.userId : null,
    status: status && status < 400 ? "sucesso" : "erro",
    tipo_pessoa: "pf",
  });

  // O corpo pode conter o token. Ele NÃO volta para a tela: o que interessa é a ESTRUTURA.
  let estrutura: string[] = [];
  let temToken = false;
  try {
    const json = JSON.parse(corpoResposta) as Record<string, unknown>;
    estrutura = Object.keys(json);
    temToken = estrutura.some((k) => /token/i.test(k));
  } catch {
    estrutura = [];
  }

  return NextResponse.json({
    data: {
      // URL sem o clientId, para não vazar credencial no histórico da tela.
      chamou: url.toString().replace(/clientId=[^&]+/, "clientId=***"),
      camposDaResposta: estrutura,
      erroRede,
      httpStatus: status,
      msDecorridos: Date.now() - inicio,
      // Em caso de ERRO mostra o corpo (é o diagnóstico); em caso de sucesso, só a estrutura,
      // porque o corpo carrega o token.
      respostaCrua: status && status >= 400 ? corpoResposta : null,
      sucesso: Boolean(status && status < 400),
      temToken,
      tentativasHoje: (count ?? 0) + 1,
    },
  });
}
