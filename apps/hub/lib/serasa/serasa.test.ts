import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { limparCacheToken, obterToken } from "./auth";
import { consultarPF, consultarPJ } from "./client";
import { ambienteConfere, lerConfigSerasa, type ConfigSerasa } from "./config";
import exemploPj from "./exemplo-resposta-pj.json";
import { resumirRelatorio } from "./resumo";

const CONFIG_TESTE: ConfigSerasa = {
  ambiente: "homologacao",
  authUrl: "https://uat-api.serasaexperian.com.br/security/iam/v1/client-identities/login",
  clientId: "id-de-teste",
  clientSecret: "segredo-de-teste",
  costCenter: null,
  pfUrl: "https://uat-api.serasaexperian.com.br/credit-services/person-information-report/v1/creditreport",
  pjUrl: "https://uat-api.serasaexperian.com.br/credit-services/business-information-report/v1/reports",
  retailerDocumentId: "00000000000000",
};

describe("lerConfigSerasa", () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });

  // Config pela metade é pior que config ausente: a consulta sai, falha no meio, e o erro só
  // aparece depois. Melhor recusar antes com a lista do que falta.
  it("recusa e diz exatamente o que falta", () => {
    for (const k of [
      "SERASA_AUTH_URL",
      "SERASA_CLIENT_ID",
      "SERASA_CLIENT_SECRET",
      "SERASA_PF_URL",
      "SERASA_PJ_URL",
      "SERASA_RETAILER_DOCUMENT_ID",
    ]) {
      delete process.env[k];
    }
    const r = lerConfigSerasa();
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.faltando).toContain("SERASA_CLIENT_ID");
      expect(r.faltando.length).toBe(6);
    }
  });

  // O default seguro é o ambiente que NÃO cobra.
  it("trata qualquer coisa que não seja 'producao' como homologação", () => {
    process.env.SERASA_AUTH_URL = "https://uat-api.x/login";
    process.env.SERASA_CLIENT_ID = "a";
    process.env.SERASA_CLIENT_SECRET = "b";
    process.env.SERASA_PF_URL = "https://uat-api.x/pf";
    process.env.SERASA_PJ_URL = "https://uat-api.x/pj";
    process.env.SERASA_RETAILER_DOCUMENT_ID = "1";
    process.env.SERASA_AMBIENTE = "qualquer-coisa";

    const r = lerConfigSerasa();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.ambiente).toBe("homologacao");
  });
});

describe("ambienteConfere", () => {
  // O cenário caro: URLs de produção com o rótulo de homologação. A tela diria "teste" e cada
  // clique seria consulta cobrada.
  it("acusa produção disfarçada de homologação", () => {
    const r = ambienteConfere({
      ...CONFIG_TESTE,
      authUrl: "https://api.serasaexperian.com.br/security/iam/v1/client-identities/login",
      pfUrl: "https://api.serasaexperian.com.br/credit-services/person-information-report/v1/creditreport",
      pjUrl: "https://api.serasaexperian.com.br/credit-services/business-information-report/v1/reports",
    });
    expect(r.ok).toBe(false);
    expect(r.erro).toContain("cobrada");
  });

  it("acusa homologação rotulada como produção", () => {
    const r = ambienteConfere({ ...CONFIG_TESTE, ambiente: "producao" });
    expect(r.ok).toBe(false);
  });

  it("aceita a combinação coerente", () => {
    expect(ambienteConfere(CONFIG_TESTE).ok).toBe(true);
  });
});

describe("obterToken", () => {
  beforeEach(() => limparCacheToken());
  afterEach(() => vi.unstubAllGlobals());

  it("autentica com Basic e devolve o accessToken", async () => {
    const chamadas: { headers: Record<string, string>; url: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      chamadas.push({ headers: init.headers as Record<string, string>, url });
      return new Response(JSON.stringify({ accessToken: "token-123" }), { status: 200 });
    });

    const r = await obterToken(CONFIG_TESTE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.token).toBe("token-123");

    const basicEsperado = Buffer.from("id-de-teste:segredo-de-teste").toString("base64");
    expect(chamadas[0]?.headers.Authorization).toBe(`Basic ${basicEsperado}`);
  });

  // O token vale 60 min e a documentação pede reuso. Em homologação há teto de 200
  // chamadas/dia por IP: autenticar a cada consulta queimaria o teto à toa.
  it("reaproveita o token em vez de autenticar de novo", async () => {
    let vezes = 0;
    vi.stubGlobal("fetch", async () => {
      vezes += 1;
      return new Response(JSON.stringify({ accessToken: "token-123" }), { status: 200 });
    });

    await obterToken(CONFIG_TESTE);
    await obterToken(CONFIG_TESTE);
    await obterToken(CONFIG_TESTE);
    expect(vezes).toBe(1);
  });

  it("força novo token quando pedido", async () => {
    let vezes = 0;
    vi.stubGlobal("fetch", async () => {
      vezes += 1;
      return new Response(JSON.stringify({ accessToken: `t-${vezes}` }), { status: 200 });
    });

    await obterToken(CONFIG_TESTE);
    const r = await obterToken(CONFIG_TESTE, { forcarNovo: true });
    expect(vezes).toBe(2);
    if (r.ok) expect(r.token).toBe("t-2");
  });

  // Só `accessToken` está confirmado na doc; os outros nomes entram como tolerância para a
  // integração não quebrar calada se o corpo vier diferente.
  it("aceita access_token e token como alternativas", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ access_token: "alternativo" }), { status: 200 }),
    );
    const r = await obterToken(CONFIG_TESTE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.token).toBe("alternativo");
  });

  it("explica o erro de credencial trocada entre ambientes", async () => {
    vi.stubGlobal("fetch", async () => new Response("ambiente incorreto", { status: 401 }));
    const r = await obterToken(CONFIG_TESTE);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(401);
      expect(r.erro).toContain("ambiente");
    }
  });

  it("não guarda cache quando a resposta vem sem token", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ oi: 1 }), { status: 200 }));
    const r = await obterToken(CONFIG_TESTE);
    expect(r.ok).toBe(false);

    let vezes = 0;
    vi.stubGlobal("fetch", async () => {
      vezes += 1;
      return new Response(JSON.stringify({ accessToken: "agora-vai" }), { status: 200 });
    });
    const segunda = await obterToken(CONFIG_TESTE);
    expect(vezes).toBe(1);
    expect(segunda.ok).toBe(true);
  });
});

describe("consultarPF / consultarPJ", () => {
  beforeEach(() => limparCacheToken());
  afterEach(() => vi.unstubAllGlobals());

  const comToken = (respostaConsulta: () => Response) => {
    let primeira = true;
    vi.stubGlobal("fetch", async () => {
      if (primeira) {
        primeira = false;
        return new Response(JSON.stringify({ accessToken: "t" }), { status: 200 });
      }
      return respostaConsulta();
    });
  };

  it("manda o documento em HEADER, nunca na URL", async () => {
    const vistas: { headers: Record<string, string>; url: string }[] = [];
    let primeira = true;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (primeira) {
        primeira = false;
        return new Response(JSON.stringify({ accessToken: "t" }), { status: 200 });
      }
      vistas.push({ headers: init.headers as Record<string, string>, url });
      return new Response(JSON.stringify({ reports: [] }), { status: 200 });
    });

    await consultarPF(CONFIG_TESTE, {
      documento: "139.544.576-10",
      reportName: "RELATORIO_BASICO_PF_PME",
    });

    // CPF em query string vazaria em log de proxy e CDN.
    expect(vistas[0]?.url).not.toContain("13954457610");
    expect(vistas[0]?.headers["X-Document-Id"]).toBe("13954457610");
  });

  // Sem este header a documentação diz que a cobrança vai para o "cliente distribuidor".
  it("sempre envia o CNPJ de quem consulta", async () => {
    const vistas: Record<string, string>[] = [];
    let primeira = true;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      if (primeira) {
        primeira = false;
        return new Response(JSON.stringify({ accessToken: "t" }), { status: 200 });
      }
      vistas.push(init.headers as Record<string, string>);
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await consultarPF(CONFIG_TESTE, { documento: "13954457610", reportName: "X" });
    expect(vistas[0]?.["X-Retailer-Document-Id"]).toBe("00000000000000");
  });

  it("concatena features com vírgula sem espaço e codifica parâmetros em base64", async () => {
    let capturada = "";
    let primeira = true;
    vi.stubGlobal("fetch", async (url: string) => {
      if (primeira) {
        primeira = false;
        return new Response(JSON.stringify({ accessToken: "t" }), { status: 200 });
      }
      capturada = url;
      return new Response(JSON.stringify({}), { status: 200 });
    });

    await consultarPF(CONFIG_TESTE, {
      documento: "13954457610",
      optionalFeatures: ["SCORE_POSITIVO", "RENDA_ESTIMADA_PF"],
      reportName: "X",
      reportParameters: [{ name: "VAR_1", value: "V1" }],
    });

    expect(capturada).toContain("optionalFeatures=SCORE_POSITIVO%2CRENDA_ESTIMADA_PF");
    const base64 = new URL(capturada).searchParams.get("reportParameters") ?? "";
    expect(JSON.parse(Buffer.from(base64, "base64").toString())).toEqual({
      reportParameters: [{ name: "VAR_1", value: "V1" }],
    });
  });

  it("recusa CPF com tamanho errado ANTES de gastar chamada", async () => {
    let chamou = false;
    vi.stubGlobal("fetch", async () => {
      chamou = true;
      return new Response("{}", { status: 200 });
    });

    const r = await consultarPF(CONFIG_TESTE, { documento: "123", reportName: "X" });
    expect(r.ok).toBe(false);
    expect(chamou).toBe(false);
  });

  it("PJ exige 14 dígitos", async () => {
    const r = await consultarPJ(CONFIG_TESTE, { documento: "13954457610", reportName: "X" });
    expect(r.ok).toBe(false);
  });

  // 429 em homologação significa que o IP está prestes a ser bloqueado.
  it("manda PARAR quando bate no limite", async () => {
    comToken(() => new Response("limite", { status: 429 }));
    const r = await consultarPF(CONFIG_TESTE, { documento: "13954457610", reportName: "X" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toContain("PARE");
  });

  it("não consulta com ambiente incoerente", async () => {
    let chamou = false;
    vi.stubGlobal("fetch", async () => {
      chamou = true;
      return new Response("{}", { status: 200 });
    });

    const r = await consultarPF(
      { ...CONFIG_TESTE, ambiente: "producao" },
      { documento: "13954457610", reportName: "X" },
    );
    expect(r.ok).toBe(false);
    expect(chamou).toBe(false);
  });
});

describe("resumirRelatorio", () => {
  // ⚠️ FIXTURE REAL: resposta capturada da homologação do Serasa em 21/jul (CNPJ público
  // 00000000000191, RELATORIO_BASICO_PJ_PME). Antes destes dados o parser era um chute que
  // varria a árvore procurando chaves plausíveis. Se o Serasa mudar o schema, é aqui que
  // aparece primeiro.
  it("lê a resposta REAL de PJ da homologação", () => {
    const r = resumirRelatorio(exemploPj);

    expect(r.nome).toBe("SKUFX SI NICPWL G/K");
    expect(r.situacao).toContain("ATIVA");
    // `billing` é a própria API dizendo se ESTA consulta foi cobrada.
    expect(r.cobrado).toBe(false);
    // Quando o Serasa não consegue calcular, vem a mensagem em vez do número.
    expect(r.score).toBeUndefined();
    expect(r.mensagemScore).toContain("SCORE NAO CALCULADO");
    // Negativações contadas em pefin + refin + collectionRecords + check.
    expect(r.negativacoes).toBeGreaterThan(0);
    // Cartório traz contagem pronta, não lista.
    expect(r.protestos).toBe(0);
    expect(r.consultasAnteriores).toBe(0);
  });

  it("lê o score quando o Serasa consegue calcular", () => {
    const r = resumirRelatorio({
      reports: [{ score: { billing: true, score: 742, scoreModel: "H4PJ" } }],
    });
    expect(r.score).toBe(742);
    expect(r.cobrado).toBe(true);
    expect(r.origemScore).toContain("reports[0].score");
  });

  // O schema de PF ainda NÃO foi capturado (a base de homologação não devolveu CPF nosso).
  // A varredura fica como rede de segurança até vermos uma resposta de PF de verdade.
  it("ainda acha score em estrutura desconhecida (rede de segurança para PF)", () => {
    const r = resumirRelatorio({ resultado: { credito: { score: 615 } } });
    expect(r.score).toBe(615);
  });

  it("devolve vazio em vez de inventar, e não quebra", () => {
    expect(resumirRelatorio(null)).toEqual({});
    expect(resumirRelatorio("texto")).toEqual({});
    const circular: Record<string, unknown> = { reports: [] };
    circular.eu = circular;
    expect(() => resumirRelatorio(circular)).not.toThrow();
  });
});
