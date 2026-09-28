import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

// A PORTA PÚBLICA DO WEBHOOK DA CLICKSIGN (F1 da fonte única, 28/09/2026, bug 8.8).
//
// ⚠️ O QUE ERA: qualquer um que soubesse a URL gravava o corpo que quisesse em
// `temis_assinatura_eventos` (o evento que não passava no HMAC era guardado INTEIRO), sem teto de
// tamanho. E o conferido guardava CPF, nascimento e geolocalização (201 e 39 de 226 eventos).
// O que se trava aqui:
//   • corpo acima de 128 KB: 413 e NADA é gravado;
//   • HMAC errado: 401 e só o ESQUELETO é gravado (nome do evento, chaves de primeiro nível e tamanho),
//     e nenhuma outra coluna leva texto livre do corpo (evento cortado, ids só com forma de id);
//   • cabeçalhos por LISTA DO QUE GUARDAR: os tokens que a Vercel injeta nunca chegam ao insert;
//   • HMAC certo: o evento vai com o `envelope_id` da NOSSA linha (bug 8.2) e o payload reduzido.

const m = vi.hoisted(() => ({
  depois: [] as Array<() => Promise<void> | void>,
  inserts: [] as Array<{ tabela: string; valores: Record<string, unknown> }>,
}));

vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (tarefa: () => Promise<void> | void) => {
    m.depois.push(tarefa);
  },
}));

vi.mock("@/lib/assinatura/clicksign/cliente", async (original) => ({
  ...(await original<typeof import("@/lib/assinatura/clicksign/cliente")>()),
  lerConfiguracao: () => ({ baseUrl: "https://exemplo.test", token: "t", webhookSecret: "segredo-do-teste" }),
}));

// ⚠️ SÓ A APLICAÇÃO É DUBLÊ: o registro do evento (`registrarEventoDeAssinatura`) roda de verdade,
// porque é nele que moram os recortes que este arquivo prova.
vi.mock("@/lib/assinatura/estado-db", async (original) => ({
  ...(await original<typeof import("@/lib/assinatura/estado-db")>()),
  aplicarEventoDaClicksign: async () => ({
    aplicado: true,
    envelopeIdDoRegistro: "env-x",
    estado: "parcial",
    motivo: "teste",
  }),
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => ({
    from(tabela: string) {
      return {
        insert: async (valores: Record<string, unknown>) => {
          m.inserts.push({ tabela, valores });
          return { data: null, error: null };
        },
      };
    },
  }),
}));

const { POST } = await import("./route");

function pedido(corpo: string, cabecalhos: Record<string, string> = {}): Request {
  return new Request("https://c2x.app.br/api/publico/clicksign/webhook", {
    body: corpo,
    headers: { "content-type": "application/json", ...cabecalhos },
    method: "POST",
  });
}

async function rodarOQueFicouParaDepois(): Promise<void> {
  for (const tarefa of m.depois.splice(0)) await tarefa();
}

beforeEach(() => {
  m.depois.length = 0;
  m.inserts.length = 0;
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

describe("o webhook público da Clicksign", () => {
  it("corpo de 200 KB: 413, e nada é gravado", async () => {
    const enorme = JSON.stringify({ event: { name: "sign" }, lixo: "x".repeat(200 * 1024) });

    const r = await POST(pedido(enorme, { "content-hmac": "qualquer" }));

    expect(r.status).toBe(413);
    await rodarOQueFicouParaDepois();
    expect(m.inserts).toEqual([]);
  });

  it("HMAC errado: 401, e grava SÓ o esqueleto (nada do que o corpo trouxe)", async () => {
    const corpo = JSON.stringify({
      document: { key: "doc-1", signers: [{ documentation: "123.456.789-01", email: "alguem@x.com" }] },
      event: { data: { signer: { email: "alguem@x.com" } }, name: "sign" },
    });

    const r = await POST(pedido(corpo, { "content-hmac": "0".repeat(64) }));

    expect(r.status).toBe(401);
    await rodarOQueFicouParaDepois();
    expect(m.inserts).toHaveLength(1);
    const [gravado] = m.inserts;
    expect(gravado?.tabela).toBe("temis_assinatura_eventos");
    expect(gravado?.valores.assinatura_conferida).toBe(false);
    expect(gravado?.valores.payload).toEqual({
      __esqueleto: true,
      chaves: ["document", "event"],
      evento: "sign",
      tamanho: Buffer.byteLength(corpo, "utf8"),
    });
    const texto = JSON.stringify(gravado?.valores.payload);
    expect(texto).not.toContain("@");
    expect(texto).not.toContain("123.456.789-01");
  });

  it("HMAC errado: nenhuma coluna leva texto livre do corpo, e os cabeçalhos passam pela lista", async () => {
    const corpo = JSON.stringify({
      document: { key: "nao-e-id-" + "y".repeat(500) },
      envelope: { key: "11111111-aaaa-4bbb-8ccc-000000000001" },
      event: { name: "sign" + "z".repeat(5000) },
      ["k".repeat(5 * 1024)]: 1,
    });

    const r = await POST(
      pedido(corpo, {
        "content-hmac": "0".repeat(64),
        "x-cabecalho-inventado": "texto livre",
        "x-real-ip": "203.0.113.9",
        "x-vercel-oidc-token": "eyJ.falso.jwt",
        "x-vercel-sc-headers": '{"Authorization":"Bearer falso"}',
      }),
    );

    expect(r.status).toBe(401);
    await rodarOQueFicouParaDepois();
    const valores = m.inserts[0]?.valores ?? {};
    expect(String(valores.evento).length).toBeLessThanOrEqual(80);
    // O id sem forma de id da Clicksign não é gravado; o que tem forma fica como pista.
    expect(valores.provedor_documento_id).toBeNull();
    expect(valores.envelope_id).toBe("11111111-aaaa-4bbb-8ccc-000000000001");
    // O nome de chave de 5 KB é cortado no esqueleto.
    const esqueleto = valores.payload as { chaves: string[] };
    expect(Math.max(...esqueleto.chaves.map((c) => c.length))).toBeLessThanOrEqual(40);
    const cabecalhos = valores.headers as Record<string, string>;
    expect(Object.keys(cabecalhos).sort()).toEqual(["content-hmac", "content-type", "x-real-ip"]);
    expect(JSON.stringify(cabecalhos)).not.toMatch(/oidc|sc-headers|Bearer|inventado/i);
  });

  it("HMAC certo: grava o envelope_id da NOSSA linha, o payload reduzido e nenhum token da Vercel", async () => {
    const corpo = JSON.stringify({
      document: {
        key: "22222222-aaaa-4bbb-8ccc-000000000002",
        signers: [{ birthday: "1990-01-01", documentation: "123.456.789-01", email: "alguem@x.com", key: "s-1" }],
      },
      event: { name: "sign" },
    });
    const hmac = createHmac("sha256", "segredo-do-teste").update(corpo, "utf8").digest("hex");

    const r = await POST(
      pedido(corpo, {
        "content-hmac": `sha256=${hmac}`,
        "x-real-ip": "203.0.113.9",
        "x-vercel-oidc-token": "eyJ.falso.jwt",
        "x-vercel-proxy-signature": "Bearer falso",
      }),
    );

    expect(r.status).toBe(200);
    await rodarOQueFicouParaDepois();
    expect(m.inserts).toHaveLength(1);
    const valores = m.inserts[0]?.valores ?? {};
    expect(valores.assinatura_conferida).toBe(true);
    // ⚠️ Bug 8.2: o evento de documento não traz o id do envelope; o registro leva o da nossa linha.
    expect(valores.envelope_id).toBe("env-x");
    expect(valores.provedor_documento_id).toBe("22222222-aaaa-4bbb-8ccc-000000000002");
    const texto = JSON.stringify(valores.payload);
    expect(texto).not.toContain("documentation");
    expect(texto).not.toContain("123.456.789-01");
    expect(texto).not.toContain("birthday");
    const cabecalhos = valores.headers as Record<string, string>;
    expect(cabecalhos["content-hmac"]).toBe(`sha256=${hmac}`);
    // No conferido o IP não serve para nada e não é guardado.
    expect(Object.keys(cabecalhos).sort()).toEqual(["content-hmac", "content-type"]);
  });
});
