import { NextResponse } from "next/server";

import { authorizeApoloAdmin } from "@/lib/apolo/auth";
import { configIntegracao, resolverHostSonda } from "@/lib/apolo/c2x-integracao";

// DESCOBRE o payload de `POST /api/v1/integrations/panteon/enterprise_units` — SEM CRIAR UNIDADE.
//
// O suporte do C2X mandou as três consultas para montar os selects (enterprise_id, sale_status_id,
// enterprise_unity_type_id), mas não o corpo do POST. Em vez de adivinhar, perguntamos à própria
// API em camadas, como fizemos com o cadastro de cliente.
//
// GARANTIA DE NÃO CRIAR: todas as camadas vão com `enterprise_id: 999999`, que não existe. A API
// recusa por causa dele de qualquer forma; o que interessa é a LISTA do que mais ela reclama, que
// é a lista de campos obrigatórios.
//
// A tabela por baixo é `enterprise_unities` (lida no MySQL, read-only): block, lot, area, price,
// registration, registration_number, registration_book_number, sale_status_id,
// enterprise_unity_type_id, secured_lot, sale_blocked, name. Os nomes abaixo partem dela — a sonda
// existe justamente para confirmar se o corpo da API usa os mesmos.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const CAMINHO_UNIDADES = "/api/v1/integrations/panteon/enterprise_units";

// Empreendimento que NÃO existe: é o que impede qualquer camada de criar unidade de verdade.
const EMPREENDIMENTO_INEXISTENTE = 999999;

const CAMADAS: { nome: string; payload: Record<string, unknown> }[] = [
  { nome: "1. corpo vazio", payload: {} },
  {
    nome: "2. só o empreendimento (inexistente)",
    payload: { enterprise_id: EMPREENDIMENTO_INEXISTENTE },
  },
  {
    nome: "3. + quadra e lote",
    payload: { block: "P1", enterprise_id: EMPREENDIMENTO_INEXISTENTE, lot: "1" },
  },
  {
    nome: "4. + nome, área e preço",
    payload: {
      area: 360.5,
      block: "P1",
      enterprise_id: EMPREENDIMENTO_INEXISTENTE,
      lot: "1",
      name: "VLOP101",
      price: 150000,
    },
  },
  {
    nome: "5. + matrícula (os três campos de registro)",
    payload: {
      area: 360.5,
      block: "P1",
      enterprise_id: EMPREENDIMENTO_INEXISTENTE,
      lot: "1",
      name: "VLOP101",
      price: 150000,
      registration: "49911000",
      registration_book_number: "",
      registration_number: "49911000",
    },
  },
  {
    nome: "6. + situação de venda e tipo da unidade",
    payload: {
      area: 360.5,
      block: "P1",
      enterprise_id: EMPREENDIMENTO_INEXISTENTE,
      enterprise_unity_type_id: 1,
      lot: "1",
      name: "VLOP101",
      price: 150000,
      registration: "49911000",
      registration_number: "49911000",
      sale_status_id: 1,
      sale_blocked: false,
      secured_lot: false,
    },
  },
];

export async function POST(request: Request) {
  const auth = await authorizeApoloAdmin(request);
  if (!auth.ok) return auth.response;

  const cfg = configIntegracao();
  if (!cfg) {
    return NextResponse.json(
      { error: "C2X_WRITE_API_URL/C2X_WRITE_API_TOKEN não configuradas." },
      { status: 503 },
    );
  }

  // ⚠️ VAZAMENTO DE CREDENCIAL: o fetch abaixo leva o TOKEN DE ESCRITA do C2X nos headers, então o
  // destino NÃO pode ser um host livre vindo do corpo (era assim até 05/08/2026). Só a allowlist de
  // lib/apolo/c2x-integracao.ts decide para onde o token vai; qualquer outro host morre aqui, com
  // 400 e SEM nenhum fetch.
  const corpo = (await request.json().catch(() => ({}))) as { host?: string };
  const alvo = resolverHostSonda(corpo.host, cfg.base);
  if (!alvo.ok) return NextResponse.json({ error: alvo.erro }, { status: 400 });
  const base = alvo.base;
  const url = `${base}${CAMINHO_UNIDADES}`;

  const resultados: {
    camada: string;
    criou: boolean;
    http: number | null;
    ms: number;
    pediu: string[];
    resposta: string;
  }[] = [];

  for (const camada of CAMADAS) {
    const inicio = Date.now();
    try {
      const abort = new AbortController();
      const t = setTimeout(() => abort.abort(), 20_000);
      const resp = await fetch(url, {
        body: JSON.stringify(camada.payload),
        cache: "no-store",
        headers: {
          Accept: "application/json",
          access_token: cfg.token,
          Authorization: cfg.token,
          "Content-Type": "application/json",
        },
        method: "POST",
        signal: abort.signal,
      }).finally(() => clearTimeout(t));

      const texto = await resp.text();
      const ms = Date.now() - inicio;
      let json: Record<string, unknown> = {};
      try {
        json = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
      } catch {
        /* resposta não-JSON: fica só o texto cru */
      }
      const errs = (json.errors ?? {}) as Record<string, string[]>;

      resultados.push({
        camada: camada.nome,
        // Com empreendimento inexistente nada deveria ser criado. Se vier 201 de sucesso, é alerta.
        criou: (resp.status === 201 || resp.status === 200) && json.status === "success",
        http: resp.status,
        ms,
        pediu: Object.entries(errs).map(
          ([campo, msgs]) => `${campo}: ${(Array.isArray(msgs) ? msgs : [String(msgs)]).join("; ")}`,
        ),
        resposta: texto.slice(0, 400),
      });
    } catch (erro) {
      resultados.push({
        camada: camada.nome,
        criou: false,
        http: null,
        ms: Date.now() - inicio,
        pediu: [],
        resposta: erro instanceof Error ? erro.message : String(erro),
      });
    }
  }

  const ultima = resultados[resultados.length - 1];

  return NextResponse.json(
    {
      data: {
        // O que a camada MAIS COMPLETA ainda reclama, tirando o empreendimento (que é falso de
        // propósito): é a lista do que falta descobrir.
        aindaPede: (ultima?.pediu ?? []).filter((p) => !p.startsWith("enterprise_id")),
        caminho: CAMINHO_UNIDADES,
        host: new URL(base).host,
        nenhumCriado: resultados.every((r) => !r.criou),
        resultados,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
