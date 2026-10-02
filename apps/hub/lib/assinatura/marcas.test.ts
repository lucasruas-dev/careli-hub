import { describe, expect, it } from "vitest";

import { lerEventoDoWebhook } from "@/lib/assinatura/clicksign/webhook";
import { lerEventosDoPayload } from "@/lib/temis/trabalhos-db";

import payloadReal from "./__fixtures__/clicksign-sign-com-bounce.json";
import { diarioDoEnvelope, quemAssinou } from "./diario-do-envelope";
import {
  estadoPropostoPeloEvento,
  cabecalhosParaGuardar,
  esqueletoDoPayload,
  fechadoEmDoPayload,
  fechouComTodosNoPayload,
  idComFormaDaClicksign,
  linkDeAssinaturaNoPayload,
  linkDeAssinaturaValido,
  marcasDoPayloadDaClicksign,
  payloadReduzidoDaClicksign,
} from "./marcas";

// ⚠️ O QUE ESTES TESTES PROTEGEM (F1 da fonte única, 28/09/2026). Daqui sai o que a função da 0195
// grava no quadro do envelope: QUEM assinou e QUANDO. Uma marca errada põe a assinatura de uma
// pessoa na linha de outra; um fechamento errado dá por assinado um contrato que venceu no prazo; e
// um payload guardado cheio mantém CPF e geolocalização na nossa tabela (201 e 39 de 226 eventos).
//
// A fixture é o payload REAL de 12/09/2026, anonimizado: Mariana assinou, o convite do Otávio
// quicou (HardBounce), o documento está `running`.

const MARIANA = "22222222-aaaa-4bbb-8ccc-000000000002";
const OTAVIO = "33333333-aaaa-4bbb-8ccc-000000000003";

/** Um payload mínimo no formato da Clicksign, para os casos que a fixture não cobre. */
function payload(documento: {
  events?: Array<{ data?: Record<string, unknown>; name: string; occurred_at?: string }>;
  finished_at?: null | string;
  signers?: Array<{ email: string; key: string }>;
  status?: string;
}): unknown {
  return {
    document: {
      events: documento.events ?? [],
      finished_at: documento.finished_at ?? null,
      key: "doc-1",
      signers: documento.signers ?? [],
      status: documento.status ?? "running",
    },
  };
}

const DOIS = [
  { email: "a@x.com", key: "k-a" },
  { email: "b@x.com", key: "k-b" },
];
const assinou = (key: string, email: string, quando: string) => ({
  data: { signer: { email, key } },
  name: "sign",
  occurred_at: quando,
});

describe("marcasDoPayloadDaClicksign", () => {
  it("o payload real: a assinatura da Mariana e o convite que não chegou ao Otávio", () => {
    const marcas = marcasDoPayloadDaClicksign(payloadReal);

    expect(marcas).toHaveLength(2);
    expect(marcas).toContainEqual({
      assinadoEm: "2026-09-11T23:24:44.972-03:00",
      chave: MARIANA,
      email: "mariana.bandeira@exemplo.test",
      recusadoEm: null,
    });
    expect(marcas).toContainEqual({
      assinadoEm: null,
      chave: OTAVIO,
      conviteFalhouEm: "2026-09-11T23:24:00.891-03:00",
      email: "otavio.lima@exemplo.test",
      recusadoEm: null,
    });
  });

  it("e-mail sai minúsculo e a data sai em -03:00", () => {
    const [marca] = marcasDoPayloadDaClicksign(
      payload({ events: [assinou("k-a", "Fulano@X.COM", "2026-09-12T02:30:00Z")] }),
    );
    expect(marca?.email).toBe("fulano@x.com");
    expect(marca?.assinadoEm).toBe("2026-09-11T23:30:00.000-03:00");
  });

  it("refusal vira recusadoEm", () => {
    const marcas = marcasDoPayloadDaClicksign(
      payload({
        events: [{ data: { signer: { email: "a@x.com", key: "k-a" } }, name: "refusal", occurred_at: "2026-09-20T15:00:00Z" }],
      }),
    );
    expect(marcas).toEqual([
      { assinadoEm: null, chave: "k-a", email: "a@x.com", recusadoEm: "2026-09-20T12:00:00.000-03:00" },
    ]);
  });

  it("⚠️ sign sem occurred_at NÃO vira marca: sem data não há começo de prazo", () => {
    const marcas = marcasDoPayloadDaClicksign(
      payload({ events: [{ data: { signer: { email: "a@x.com", key: "k-a" } }, name: "sign" }] }),
    );
    expect(marcas).toEqual([]);
  });

  it("o signatário que só vem em event.data.signer (0.4 do plano) também vira marca", () => {
    const marcas = marcasDoPayloadDaClicksign({
      event: {
        data: { signer: { email: "a@x.com", key: "k-a" } },
        name: "sign",
        occurred_at: "2026-09-12T10:00:00-03:00",
      },
    });
    expect(marcas).toEqual([
      { assinadoEm: "2026-09-12T10:00:00.000-03:00", chave: "k-a", email: "a@x.com", recusadoEm: null },
    ]);
  });
});

describe("fechouComTodosNoPayload", () => {
  it("o payload real está running e o Otávio não assinou: não fechou", () => {
    expect(fechouComTodosNoPayload(payloadReal)).toBe(false);
  });

  it("closed e todos com sign: fechou", () => {
    const p = payload({
      events: [assinou("k-a", "a@x.com", "2026-09-12T10:00:00Z"), assinou("k-b", "b@x.com", "2026-09-12T11:00:00Z")],
      signers: DOIS,
      status: "closed",
    });
    expect(fechouComTodosNoPayload(p)).toBe(true);
  });

  it("sem lista de signatários (o upload): não se sabe", () => {
    expect(fechouComTodosNoPayload(payload({ status: "closed" }))).toBeNull();
  });
});

describe("estadoPropostoPeloEvento (bug 8.7)", () => {
  const todos = [assinou("k-a", "a@x.com", "2026-09-12T10:00:00Z"), assinou("k-b", "b@x.com", "2026-09-12T11:00:00Z")];

  it("o sign da ÚLTIMA pessoa com o documento closed e todos assinados: assinado", () => {
    expect(estadoPropostoPeloEvento("sign", payload({ events: todos, signers: DOIS, status: "closed" }))).toBe(
      "assinado",
    );
  });

  it("close com todos assinados: assinado", () => {
    expect(estadoPropostoPeloEvento("close", payload({ events: todos, signers: DOIS, status: "closed" }))).toBe(
      "assinado",
    );
  });

  it("⚠️ close SEM todos: expirado, nunca assinado (o prazo fechou com as assinaturas que tinha)", () => {
    const p = payload({ events: [todos[0]!], signers: DOIS, status: "closed" });
    expect(estadoPropostoPeloEvento("close", p)).toBe("expirado");
    expect(estadoPropostoPeloEvento("auto_close", p)).toBe("expirado");
  });

  it("close sem lista de signatários: não propõe terminal nenhum", () => {
    expect(estadoPropostoPeloEvento("close", payload({ status: "closed" }))).toBeNull();
  });

  it("o resto segue o catálogo: sign de uma pessoa é parcial, signature_started é aguardando", () => {
    expect(estadoPropostoPeloEvento("sign", payloadReal)).toBe("parcial");
    expect(estadoPropostoPeloEvento("signature_started", payloadReal)).toBe("aguardando");
    expect(estadoPropostoPeloEvento("add_signer", payloadReal)).toBeNull();
  });
});

describe("fechadoEmDoPayload: nunca agora", () => {
  it("finished_at do documento vence, em -03:00", () => {
    expect(fechadoEmDoPayload(payload({ finished_at: "2026-09-12T14:00:00Z" }))).toBe(
      "2026-09-12T11:00:00.000-03:00",
    );
  });

  it("sem finished_at, o occurred_at do evento de fechamento", () => {
    const p = payload({ events: [{ data: {}, name: "auto_close", occurred_at: "2026-09-12T14:00:00Z" }] });
    expect(fechadoEmDoPayload(p)).toBe("2026-09-12T11:00:00.000-03:00");
  });

  it("sem nenhum dos dois: nulo (o payload real ainda está correndo)", () => {
    expect(fechadoEmDoPayload(payloadReal)).toBeNull();
  });
});

/** Todas as chaves de um valor, em qualquer profundidade. */
function todasAsChaves(valor: unknown, saida = new Set<string>()): Set<string> {
  if (Array.isArray(valor)) for (const item of valor) todasAsChaves(item, saida);
  else if (valor && typeof valor === "object") {
    for (const [chave, filho] of Object.entries(valor as Record<string, unknown>)) {
      saida.add(chave);
      todasAsChaves(filho, saida);
    }
  }
  return saida;
}

/**
 * Onze dígitos SOLTOS (CPF ou celular sem máscara) ou um CPF com máscara. ⚠️ Solto porque os ids
 * anonimizados da fixture (`...-000000000002`) têm doze dígitos dentro de um uuid, e isso não é dado
 * de pessoa.
 */
const DOCUMENTO_OU_TELEFONE = /(?<![0-9a-f-])\d{11}(?![0-9a-f-])|\d{3}\.\d{3}\.\d{3}-\d{2}/i;

const PROIBIDAS = ["documentation", "birthday", "latitude", "longitude", "ip", "user_agent", "address", "phone_number", "downloads"];

describe("payloadReduzidoDaClicksign (bug 8.8)", () => {
  it("o payload real reduzido não guarda CPF, nascimento, geolocalização, IP nem user-agent", () => {
    const reduzido = payloadReduzidoDaClicksign(payloadReal);
    const chaves = todasAsChaves(reduzido);
    for (const proibida of PROIBIDAS) expect(chaves.has(proibida), proibida).toBe(false);
    expect(JSON.stringify(reduzido)).not.toMatch(DOCUMENTO_OU_TELEFONE);
  });

  it("um CPF, um telefone e um IP de verdade no corpo não sobrevivem", () => {
    const cheio = {
      event: {
        data: {
          signer: {
            address: "203.0.113.42",
            birthday: "1980-01-01",
            documentation: "123.456.789-01",
            email: "a@x.com",
            ip: "203.0.113.42",
            key: "k-a",
            latitude: -19.9,
            longitude: -43.9,
            name: "Fulano",
            phone_number: "31999998888",
            user_agent: "Mozilla/5.0",
          },
        },
        name: "sign",
        occurred_at: "2026-09-12T10:00:00-03:00",
      },
    };
    const reduzido = payloadReduzidoDaClicksign(cheio);
    const texto = JSON.stringify(reduzido);
    expect(texto).not.toContain("123.456.789-01");
    expect(texto).not.toContain("31999998888");
    expect(texto).not.toContain("203.0.113.42");
    expect(texto).not.toContain("Mozilla");
    expect(texto).not.toMatch(DOCUMENTO_OU_TELEFONE);
    // O que a casa lê continua lá.
    expect(reduzido).toEqual({
      event: {
        data: { signer: { email: "a@x.com", key: "k-a", name: "Fulano" } },
        name: "sign",
        occurred_at: "2026-09-12T10:00:00-03:00",
      },
    });
  });

  it("o diário, o contador do card, as marcas e o leitor do webhook leem do reduzido o mesmo que do cheio", () => {
    const reduzido = payloadReduzidoDaClicksign(payloadReal);

    expect(diarioDoEnvelope(reduzido)).toEqual(diarioDoEnvelope(payloadReal));
    expect(quemAssinou(reduzido)).toEqual(quemAssinou(payloadReal));
    expect(lerEventosDoPayload(reduzido)).toEqual(lerEventosDoPayload(payloadReal));
    expect(marcasDoPayloadDaClicksign(reduzido)).toEqual(marcasDoPayloadDaClicksign(payloadReal));
    expect(fechouComTodosNoPayload(reduzido)).toBe(fechouComTodosNoPayload(payloadReal));
    expect(lerEventoDoWebhook(JSON.stringify(reduzido))).toEqual(
      lerEventoDoWebhook(JSON.stringify(payloadReal)),
    );
  });
});

describe("esqueletoDoPayload: o não conferido não guarda conteúdo", () => {
  it("guarda o nome do evento, as chaves de primeiro nível e o tamanho, e nada de dentro", () => {
    const esqueleto = esqueletoDoPayload(payloadReal, 10_716);
    expect(esqueleto).toEqual({
      __esqueleto: true,
      chaves: ["event", "document"],
      evento: "sign",
      tamanho: 10_716,
    });
    expect(JSON.stringify(esqueleto)).not.toContain("@");
  });

  // ⚠️ Revisão da F1: limitar só a QUANTIDADE de chaves deixava o NOME delas virar o lugar de
  // escrever texto arbitrário (40 chaves de ~3 KB, até ~128 KB por POST forjado).
  it("corta o nome de cada chave: uma chave de 5 KB vira 40 caracteres", () => {
    const esqueleto = esqueletoDoPayload({ ["a".repeat(5 * 1024)]: 1, event: { name: "sign" } }, 5_200) as {
      chaves: string[];
    };
    expect(esqueleto.chaves).toEqual(["a".repeat(40), "event"]);
    expect(JSON.stringify(esqueleto).length).toBeLessThan(200);
  });
});

describe("o que mais o não conferido pode guardar", () => {
  it("idComFormaDaClicksign: só UUID passa", () => {
    expect(idComFormaDaClicksign("22222222-aaaa-4bbb-8ccc-000000000002")).toBe(
      "22222222-aaaa-4bbb-8ccc-000000000002",
    );
    expect(idComFormaDaClicksign("doc-1")).toBeNull();
    expect(idComFormaDaClicksign("x".repeat(5000))).toBeNull();
    expect(idComFormaDaClicksign(null)).toBeNull();
  });

  it("cabecalhosParaGuardar: lista do que guardar; tokens da Vercel nunca passam", () => {
    const cabecalhos = {
      "content-hmac": "sha256=abc",
      "content-type": "application/json",
      forwarded: "for=203.0.113.9",
      "x-real-ip": "203.0.113.9",
      "x-vercel-ip-city": "Goiania",
      "x-vercel-oidc-token": "eyJ.falso.jwt",
      "x-vercel-proxy-signature": "Bearer falso",
      "x-vercel-sc-headers": '{"Authorization":"Bearer falso"}',
    };
    expect(cabecalhosParaGuardar(cabecalhos, true)).toEqual({
      "content-hmac": "sha256=abc",
      "content-type": "application/json",
    });
    // No não conferido fica também o IP que a Vercel viu: a pista de quem forjou.
    expect(cabecalhosParaGuardar(cabecalhos, false)).toEqual({
      "content-hmac": "sha256=abc",
      "content-type": "application/json",
      "x-real-ip": "203.0.113.9",
    });
    // E aceita o `Headers` do pedido direto, com o valor cortado.
    const doPedido = new Headers({ "User-Agent": "u".repeat(2000) });
    expect(cabecalhosParaGuardar(doPedido, true)["user-agent"]).toHaveLength(512);
  });
});

// ── O LINK DE ASSINATURA (02/10/2026) ───────────────────────────────────────
//
// ⚠️ ELE VAI PARA O CLIENTE PELA MÃO DO NOSSO ATENDIMENTO. Lucas: *"quero ter esse link para mandar
// para o cliente, tem hora que ele não acha o link no e-mail"*. Por isso a régua do que entra é
// estreita, e o link só sai da `key` da pessoa, nunca do e-mail.
describe("o link de assinatura", () => {
  const LINK = (id: string) => `https://app.clicksign.com/notarial/widget/signatures/${id}/redirect`;

  it("só aceita link da Clicksign, no caminho da assinatura", () => {
    expect(linkDeAssinaturaValido(LINK(MARIANA))).toBe(LINK(MARIANA));
    expect(linkDeAssinaturaValido("https://app.clicksign.com/sign/abc-123")).toBe("https://app.clicksign.com/sign/abc-123");
    for (const ruim of [
      `http://app.clicksign.com/notarial/widget/signatures/${MARIANA}/redirect`,
      `https://app.clicksign.com.golpe.com/notarial/widget/signatures/${MARIANA}/redirect`,
      `https://golpe.com/notarial/widget/signatures/${MARIANA}/redirect`,
      `https://x:y@app.clicksign.com/notarial/widget/signatures/${MARIANA}/redirect`,
      `https://app.clicksign.com:8443/notarial/widget/signatures/${MARIANA}/redirect`,
      `${LINK(MARIANA)}?next=https://golpe.com`,
      "https://app.clicksign.com",
      "https://app.clicksign.com/accounts/download/arquivo.pdf",
      "javascript:alert(1)",
      `https://app.clicksign.com/sign/${"a".repeat(400)}`,
      "",
      null,
      42,
    ]) {
      expect(linkDeAssinaturaValido(ruim), String(ruim)).toBeNull();
    }
  });

  it("o redutor guarda o link de cada pessoa, e deixa de fora o endereço do site deles", () => {
    const reduzido = payloadReduzidoDaClicksign(payloadReal) as { event: { data: Record<string, unknown> } };

    expect(reduzido.event.data.url).toBeUndefined();
    expect((reduzido.event.data.signer as { url?: string }).url).toBe(LINK(MARIANA));
    expect(linkDeAssinaturaNoPayload(reduzido, MARIANA)).toBe(LINK(MARIANA));
    expect(linkDeAssinaturaNoPayload(reduzido, OTAVIO)).toBe(LINK(OTAVIO));
  });

  it("link de outro endereço não sobrevive ao redutor", () => {
    const forjado = {
      event: {
        data: { signer: { email: "a@x.com", key: "k-a", url: "https://golpe.com/assinar" } },
        name: "sign",
        occurred_at: "2026-09-12T10:00:00-03:00",
      },
    };
    expect(JSON.stringify(payloadReduzidoDaClicksign(forjado))).not.toContain("golpe.com");
  });

  const evento = (name: string, quando: string, signers: Array<Record<string, unknown>>) => ({
    data: { signers },
    name,
    occurred_at: quando,
  });

  it("quem foi recadastrado tem o link NOVO, e não o da primeira vez", () => {
    const payload = {
      document: {
        events: [
          evento("add_signer", "2026-10-02T09:16:43-03:00", [{ key: "k-a", url: LINK("bbbb-2") }]),
          evento("add_signer", "2026-09-23T03:04:10-03:00", [{ key: "k-a", url: LINK("aaaa-1") }]),
        ],
      },
    };
    expect(linkDeAssinaturaNoPayload(payload, "k-a")).toBe(LINK("bbbb-2"));
  });

  it("quem saiu do envelope não tem link, porque o antigo abre um convite morto", () => {
    const payload = {
      document: {
        events: [
          evento("remove_signer", "2026-10-02T09:16:42-03:00", [{ key: "k-a", url: LINK("aaaa-1") }]),
          evento("add_signer", "2026-09-23T03:04:10-03:00", [{ key: "k-a", url: LINK("aaaa-1") }]),
        ],
      },
    };
    expect(linkDeAssinaturaNoPayload(payload, "k-a")).toBeNull();
  });

  it("casa só pela key: outra pessoa, key vazia ou payload sem link devolvem nada", () => {
    const payload = {
      document: { events: [evento("add_signer", "2026-09-23T03:04:10-03:00", [{ email: "a@x.com", key: "k-a", url: LINK("aaaa-1") }])] },
    };
    expect(linkDeAssinaturaNoPayload(payload, "k-b")).toBeNull();
    expect(linkDeAssinaturaNoPayload(payload, "a@x.com")).toBeNull();
    expect(linkDeAssinaturaNoPayload(payload, "  ")).toBeNull();
    expect(linkDeAssinaturaNoPayload(null, "k-a")).toBeNull();
  });
});
