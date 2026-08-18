import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  carregarCatalogoD4Sign,
  catalogoEstaQuente,
  consultarDocumentoD4Sign,
  consultarDocumentosD4Sign,
  documentoParaTela,
  estadoDoCacheD4Sign,
  interpretarStatusD4Sign,
  lerDocumentoDaResposta,
  lerSignatariosDaResposta,
  limparCacheD4Sign,
  signatarioParaTela,
  situacaoEhTerminal,
} from "./d4sign-consulta";

// As fixturas são a FORMA REAL das respostas colhidas na sondagem de 18/08/2026 (documento do
// Vista Alegre e catálogo do cofre `sistema_c2x`): array de um item, `statusId` como STRING,
// `signed` como `"1"`/`"0"`, `sign_info` AUSENTE em quem não assinou, e `date_signed_atom` com
// fuso. Nome, e-mail, CPF, IP e geolocalização estão trocados por valores de teste — o que a
// fixtura precisa preservar é o FORMATO, e a sondagem já mascarava isso na origem.
const RESPOSTA_FINALIZADO = [
  {
    list: [
      {
        assinatura_presencial: "0",
        auth_pix: "0",
        certificadoicpbr: "0",
        date: "2024-05-27 09:12:31",
        date_trigger: "2024-05-27 09:12:40",
        docauth: "0",
        docauthandselfie: "0",
        email: "Comprador@Exemplo.com.br",
        email_sent: "1",
        email_sent_message: null,
        email_sent_status: "Delivery",
        embed_methodauth: "email",
        embed_smsnumber: null,
        foreign: "0",
        key_signer: "KEY-COMPRADOR",
        nomenclatura: "Assinar como parte",
        password_code: null,
        sign_info: {
          date_signed: "2024-05-27 15:48:06",
          date_signed_atom: "2024-05-27T15:48:06-03:00",
          geolocation: { latitude: "-16.68", longitude: "-49.25" },
          ip: "200.0.0.1",
          ip_reverser: "host.exemplo",
          user_agent: "Mozilla/5.0 (iPhone)",
        },
        signed: "1",
        type: "4",
        upload_allowed: "0",
        user_document: "12345678901",
        user_name: "JOSÉ  DA SILVA",
      },
      {
        date: "2024-05-27 09:12:31",
        date_trigger: "2024-05-27 09:12:40",
        email: "backoffice@careli.adm.br",
        email_sent: "1",
        email_sent_status: "Delivery",
        key_signer: "KEY-BACKOFFICE",
        nomenclatura: "Assinar como parte",
        signed: "0",
        type: "5",
        user_document: "98765432100",
        user_name: "Nivea Exemplo",
      },
    ],
    nameDoc: "VISTA ALEGRE-0101-CONTRATO.pdf",
    pages: "27",
    safeName: "sistema_c2x",
    size: "4638322",
    statusComment: null,
    statusId: "4",
    statusName: "Finalizado",
    type: "application/pdf",
    uuidDoc: "5b797156-c96f-4699-9415-733bfbfe2648",
    uuidSafe: "f1911d72-516e-429c-a0c9-fe00d670984d",
    whoCanceled: null,
  },
];

const RESPOSTA_CANCELADO = [
  {
    list: [],
    nameDoc: "VALE DO OURO-0311-CONTRATO.pdf",
    pages: "27",
    safeName: "sistema_c2x",
    statusId: "6",
    statusName: "Cancelado",
    uuidDoc: "cancelado-0001",
    uuidSafe: "f1911d72-516e-429c-a0c9-fe00d670984d",
    // A sondagem achou um caso REAL com o e-mail do operador da Careli aqui.
    whoCanceled: "operador@careli.adm.br",
  },
];

/** O que a API devolve para um uuid que ela não conhece: HTTP 200 sem documento. */
const RESPOSTA_DESCONHECIDO = { message: "Document not found" };

function respostaOk(payload: unknown): Response {
  return { json: async () => payload, ok: true, status: 200 } as unknown as Response;
}

describe("interpretarStatusD4Sign", () => {
  it("traduz os quatro statusId observados no catálogo inteiro", () => {
    // 3.923 documentos em 18/08/2026: 2.489 finalizados, 1.161 cancelados, 269 aguardando
    // assinaturas, 4 aguardando signatários.
    expect(interpretarStatusD4Sign("4")).toBe("finalizado");
    expect(interpretarStatusD4Sign("6")).toBe("cancelado");
    expect(interpretarStatusD4Sign("3")).toBe("aguardando-assinaturas");
    expect(interpretarStatusD4Sign("2")).toBe("aguardando-signatarios");
  });

  it("aceita número além de string, porque o JSON não tem contrato", () => {
    expect(interpretarStatusD4Sign(4)).toBe("finalizado");
  });

  it("não chuta: código fora da tabela, vazio e nulo viram desconhecida", () => {
    expect(interpretarStatusD4Sign("99")).toBe("desconhecida");
    expect(interpretarStatusD4Sign("")).toBe("desconhecida");
    expect(interpretarStatusD4Sign(null)).toBe("desconhecida");
    expect(interpretarStatusD4Sign(undefined)).toBe("desconhecida");
    expect(interpretarStatusD4Sign("abc")).toBe("desconhecida");
  });

  it("só finalizado e cancelado são terminais (é o que autoriza o TTL de 12h)", () => {
    expect(situacaoEhTerminal("finalizado")).toBe(true);
    expect(situacaoEhTerminal("cancelado")).toBe(true);
    expect(situacaoEhTerminal("aguardando-assinaturas")).toBe(false);
    expect(situacaoEhTerminal("aguardando-signatarios")).toBe(false);
    expect(situacaoEhTerminal("desconhecida")).toBe(false);
  });
});

describe("leitura da resposta", () => {
  it("lê o documento do array de um item", () => {
    const documento = lerDocumentoDaResposta(RESPOSTA_FINALIZADO);
    expect(documento).not.toBeNull();
    expect(documento?.uuidDoc).toBe("5b797156-c96f-4699-9415-733bfbfe2648");
    expect(documento?.situacao).toBe("finalizado");
    expect(documento?.statusId).toBe(4);
    expect(documento?.paginas).toBe(27);
  });

  it("devolve nulo quando a resposta é o {message} de uuid desconhecido", () => {
    expect(lerDocumentoDaResposta(RESPOSTA_DESCONHECIDO)).toBeNull();
    expect(lerDocumentoDaResposta(null)).toBeNull();
    expect(lerDocumentoDaResposta([])).toBeNull();
  });

  it("lê assinou pela string signed e a data pelo date_signed_atom", () => {
    const [assinou, pendente] = lerSignatariosDaResposta(RESPOSTA_FINALIZADO);
    expect(assinou?.assinou).toBe(true);
    expect(assinou?.assinadoEm).toBe("2024-05-27T15:48:06-03:00");
    expect(pendente?.assinou).toBe(false);
    // Sem sign_info não há data — e não pode aparecer data nenhuma inventada.
    expect(pendente?.assinadoEm).toBeNull();
  });

  it("não dá por assinado quem tem signed=1 sem sign_info (os dois têm que concordar)", () => {
    const torto = [{ list: [{ key_signer: "K", signed: "1", user_name: "Fulano" }], statusId: "3", uuidDoc: "x" }];
    expect(lerSignatariosDaResposta(torto)[0]?.assinou).toBe(false);
  });

  it("normaliza o e-mail para minúsculas, que é o que casa com a linha do C2X", () => {
    expect(lerSignatariosDaResposta(RESPOSTA_FINALIZADO)[0]?.email).toBe("comprador@exemplo.com.br");
  });

  it("lista vazia quando não há list", () => {
    expect(lerSignatariosDaResposta(RESPOSTA_CANCELADO)).toEqual([]);
    expect(lerSignatariosDaResposta({ message: "nada" })).toEqual([]);
  });
});

describe("allowlist de saída", () => {
  it("o assinante que sai para a tela NÃO tem CPF, e-mail, IP, geo nem user-agent", () => {
    const interno = lerSignatariosDaResposta(RESPOSTA_FINALIZADO)[0];
    expect(interno).toBeDefined();
    if (!interno) return;

    const publico = signatarioParaTela(interno);
    expect(Object.keys(publico).sort()).toEqual(["assinadoEm", "assinou", "nome", "papel"]);

    // A prova pelo conteúdo, não só pelas chaves: nada do que é sensível pode aparecer em lugar
    // nenhum do objeto, nem aninhado.
    const serializado = JSON.stringify(publico);
    expect(serializado).not.toContain("12345678901");
    expect(serializado).not.toContain("comprador@exemplo.com.br");
    expect(serializado).not.toContain("200.0.0.1");
    expect(serializado).not.toContain("-16.68");
    expect(serializado).not.toContain("Mozilla");
  });

  it("o documento que sai para a tela NÃO tem quem cancelou nem o nome do arquivo", () => {
    const documento = lerDocumentoDaResposta(RESPOSTA_CANCELADO);
    expect(documento?.canceladoPor).toBe("operador@careli.adm.br");
    if (!documento) return;

    const publico = documentoParaTela(documento);
    expect(Object.keys(publico).sort()).toEqual(["rotulo", "situacao"]);
    expect(JSON.stringify(publico)).not.toContain("careli.adm.br");
    expect(JSON.stringify(publico)).not.toContain("VALE DO OURO");
    expect(publico.rotulo).toBe("Cancelado");
  });
});

describe("cache, deduplicação e disjuntor", () => {
  const fetchOriginal = globalThis.fetch;

  beforeEach(() => {
    limparCacheD4Sign();
    process.env.D4SIGN_TOKEN_API = "token-de-teste";
    process.env.D4SIGN_CRYPT_KEY = "chave-de-teste";
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    limparCacheD4Sign();
    vi.restoreAllMocks();
  });

  it("a segunda consulta do mesmo documento não toca na rede", async () => {
    const espiao = vi.fn(async () => respostaOk(RESPOSTA_FINALIZADO));
    globalThis.fetch = espiao as unknown as typeof fetch;

    await consultarDocumentoD4Sign("doc-1");
    await consultarDocumentoD4Sign("doc-1");

    expect(espiao).toHaveBeenCalledTimes(1);
  });

  it("dez cargas simultâneas do mesmo documento viram UMA chamada", async () => {
    // É a janela que o cache sozinho não cobre: 1,4 s entre pedir e voltar. Sem deduplicação,
    // dez abas abertas no mesmo instante são dez chamadas idênticas.
    let liberar: (() => void) | undefined;
    const espera = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    const espiao = vi.fn(async () => {
      await espera;
      return respostaOk(RESPOSTA_FINALIZADO);
    });
    globalThis.fetch = espiao as unknown as typeof fetch;

    const cargas = Array.from({ length: 10 }, () => consultarDocumentoD4Sign("doc-2"));
    expect(estadoDoCacheD4Sign().emVoo).toBe(1);
    liberar?.();
    const resultados = await Promise.all(cargas);

    expect(espiao).toHaveBeenCalledTimes(1);
    expect(resultados.every((r) => r.ok)).toBe(true);
  });

  it("não cacheia indisponibilidade: a D4Sign voltando, a próxima carga já pega o dado", async () => {
    const espiao = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(respostaOk(RESPOSTA_FINALIZADO));
    globalThis.fetch = espiao as unknown as typeof fetch;

    const primeira = await consultarDocumentoD4Sign("doc-3");
    expect(primeira).toEqual({ motivo: "indisponivel", ok: false });

    const segunda = await consultarDocumentoD4Sign("doc-3");
    expect(segunda.ok).toBe(true);
  });

  it("cacheia o documento que a D4Sign não conhece: reperguntar custa 1,4s pelo mesmo 'não existe'", async () => {
    const espiao = vi.fn(async () => respostaOk(RESPOSTA_DESCONHECIDO));
    globalThis.fetch = espiao as unknown as typeof fetch;

    expect(await consultarDocumentoD4Sign("doc-4")).toEqual({
      motivo: "documento-desconhecido",
      ok: false,
    });
    await consultarDocumentoD4Sign("doc-4");

    expect(espiao).toHaveBeenCalledTimes(1);
  });

  it("sem credencial no ambiente, nem tenta a rede — e o motivo é outro", async () => {
    delete process.env.D4SIGN_TOKEN_API;
    const espiao = vi.fn(async () => respostaOk(RESPOSTA_FINALIZADO));
    globalThis.fetch = espiao as unknown as typeof fetch;

    expect(await consultarDocumentoD4Sign("doc-5")).toEqual({
      motivo: "credencial-ausente",
      ok: false,
    });
    expect(espiao).not.toHaveBeenCalled();
  });

  it("depois de 3 falhas seguidas o disjuntor abre e o resto do lote nem sai", async () => {
    // É o que impede uma D4Sign fora do ar de virar 467 timeouts de 6 s numa carga de tela.
    const espiao = vi.fn(async () => {
      throw new Error("fora do ar");
    });
    globalThis.fetch = espiao as unknown as typeof fetch;
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const resultado = await consultarDocumentosD4Sign(
      ["a", "b", "c", "d", "e", "f"],
      { concorrencia: 1 },
    );

    expect(espiao).toHaveBeenCalledTimes(3);
    expect(estadoDoCacheD4Sign().disjuntorAberto).toBe(true);
    expect([...resultado.values()].every((r) => !r.ok)).toBe(true);
  });

  it("o lote não repete uuid duplicado e devolve um resultado por documento", async () => {
    const espiao = vi.fn(async () => respostaOk(RESPOSTA_FINALIZADO));
    globalThis.fetch = espiao as unknown as typeof fetch;

    const resultado = await consultarDocumentosD4Sign(["doc-6", "doc-6", " doc-7 ", ""]);

    expect(espiao).toHaveBeenCalledTimes(2);
    expect([...resultado.keys()].sort()).toEqual(["doc-6", "doc-7"]);
  });

  it("orçamento estourado devolve indisponível sem chamar — é o que aciona o fallback", async () => {
    const espiao = vi.fn(async () => respostaOk(RESPOSTA_FINALIZADO));
    globalThis.fetch = espiao as unknown as typeof fetch;

    const resultado = await consultarDocumentosD4Sign(["doc-8", "doc-9"], { orcamentoMs: 0 });

    expect(espiao).not.toHaveBeenCalled();
    expect(resultado.get("doc-8")).toEqual({ motivo: "indisponivel", ok: false });
  });

  it("a credencial NUNCA aparece na URL logada nem no resultado", async () => {
    const chamadas: string[] = [];
    globalThis.fetch = (async (url: string) => {
      chamadas.push(String(url));
      return respostaOk(RESPOSTA_FINALIZADO);
    }) as unknown as typeof fetch;

    const resultado = await consultarDocumentoD4Sign("doc-10");

    // Ela VAI na query string (é como a API autentica) …
    expect(chamadas[0]).toContain("token-de-teste");
    // … e não pode voltar em nada que o servidor devolva.
    expect(JSON.stringify(resultado)).not.toContain("token-de-teste");
    expect(JSON.stringify(resultado)).not.toContain("chave-de-teste");
  });
});

// ── A TELA NÃO PODE ESPERAR A D4SIGN ────────────────────────────────────────
//
// O QUE ESTE BLOCO PROTEGE: a carga de tela não faz chamada BLOQUEANTE nenhuma. A conta que
// motivou isso foi medida em 18/08/2026 (`scripts/apolo/medir-catalogo-real.mjs`): catálogo frio
// 4,4 s mais 7,0 s dos 20 detalhes do teto, contra 0,1 s do SQL que traz a mesma lista. Como o
// cache é da INSTÂNCIA e a Vercel recicla instância o tempo todo, essa espera reaparecia várias
// vezes ao dia — foi o que o dono sentiu ("está demorando muito para carregar as páginas").
//
// ⚠️ É FÁCIL DESFAZER SEM PERCEBER: basta alguém achar que `semEsperar` é "só um detalhe do
// catálogo" e deixar o caminho documento a documento seguir. Aí a tela volta a levar 12 s e o
// sintoma não aponta para a mudança.
describe("semEsperar: a carga de tela não bloqueia", () => {
  const fetchOriginal = globalThis.fetch;

  beforeEach(() => {
    limparCacheD4Sign();
    process.env.D4SIGN_TOKEN_API = "token-de-teste";
    process.env.D4SIGN_CRYPT_KEY = "chave-de-teste";
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    limparCacheD4Sign();
    vi.restoreAllMocks();
  });

  it("com o cache frio, NÃO sai nenhuma chamada — e o que falta cai no fallback", async () => {
    const chamadas: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      chamadas.push(String(url));
      return { json: async () => [], ok: true, status: 200 };
    }) as unknown as typeof fetch;

    const resultado = await consultarDocumentosD4Sign(["uuid-a", "uuid-b", "uuid-c"], {
      semEsperar: true,
    });

    // Nada de rede: nem catálogo, nem /list. É esta linha que segura o ganho.
    expect(chamadas).toEqual([]);

    // ⚠️ E O QUE NÃO FOI CONFIRMADO VOLTA MARCADO, não some. A diferença importa: entrada ausente
    // seria lida como "documento que não existe", enquanto `ok: false` é "não sei agora" — que é
    // o que faz o chamador manter a linha do C2X e acender o aviso da fonte. Nenhuma das três
    // pode voltar como confirmada, senão a tela mostraria como conferido o que ninguém conferiu.
    expect(resultado.size).toBe(3);
    expect([...resultado.values()].every((consulta) => consulta.ok === false)).toBe(true);
  });

  it("sem a opção, o comportamento antigo continua: a consulta vai à rede", async () => {
    const chamadas: string[] = [];
    globalThis.fetch = (async (url: unknown) => {
      chamadas.push(String(url));
      return { json: async () => [], ok: true, status: 200 };
    }) as unknown as typeof fetch;

    await consultarDocumentosD4Sign(["uuid-a"], {});

    expect(chamadas.length).toBeGreaterThan(0);
  });

  it("catalogoEstaQuente só diz sim depois que o catálogo entrou em memória", async () => {
    expect(catalogoEstaQuente()).toBe(false);

    globalThis.fetch = (async () => ({
      json: async () => [{ total_pages: 1 }, { uuidDoc: "uuid-a", statusId: "4" }],
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;

    await carregarCatalogoD4Sign();

    expect(catalogoEstaQuente()).toBe(true);
  });
});
