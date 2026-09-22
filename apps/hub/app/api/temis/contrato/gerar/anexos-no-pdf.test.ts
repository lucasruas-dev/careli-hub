import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFStream } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

// OS ANEXOS ATÉ O PAPEL — a revisão do elo inteiro: cadeia → bucket → montador → gaveta.
//
// ⚠️ ESTE ARQUIVO É DE REVISÃO. `route.test.ts` (o de entrega) nunca exercita anexo nenhum: o stub
// dele devolve `{ data: null }` para `temis_anexos` e o Chromium falso devolve os 4 bytes "%PDF",
// que nem PDF são. Ou seja, o caminho que a montagem estreou em 21/09/2026 — baixar as peças,
// costurar e guardar — não tinha teste de ponta a ponta. Aqui o corpo é um PDF DE VERDADE, o
// bucket devolve bytes de verdade e o que se confere é o arquivo que foi para a gaveta.
//
// O que está medido aqui:
//   1. a ordem das páginas do PDF GUARDADO (capa, corpo, anexos) e o que a observação registra;
//   2. o teto de 24MB recusa ANTES do primeiro download, pelo `arquivo_bytes` do cadastro;
//   3. o texto pede `[anexo_2]`, a peça não existe, e a geração PARA em vez de sair calada;
//   4. capa .jfif (o JPEG que o Chrome salva) entra como imagem, e não como PDF quebrado;
//   5. anexo desativado e anexo sumido do bucket, depois do contrato já gerado.

const estado = vi.hoisted(() => ({
  anexos: [] as Array<{
    arquivo_bytes: null | number;
    ativo: boolean;
    categoria_id: null | string;
    enterprise_id: null | string;
    id: string;
    nome: string;
    posicao: number;
    storage_path: string;
    unidade_id: null | string;
  }>,
  /** Cada objeto do bucket: caminho → bytes. */
  arquivos: new Map<string, Uint8Array>(),
  baixados: [] as string[],
  bytesBaixados: 0,
  capaNome: null as null | string,
  capaPath: null as null | string,
  /** Os nós da minuta publicada. */
  conteudo: [] as unknown[],
  /** O PDF que o Chromium devolveria. */
  corpo: new Uint8Array() as Uint8Array,
  guardados: [] as Array<{ bytes: Uint8Array; caminho: string }>,
  inseridos: [] as Record<string, unknown>[],
  jaGuardados: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/apolo/auth", () => {
  const portao = () => async () => ({ nome: "Zeus", ok: true, userId: "user-1" });
  return { authorizeApoloCoordenacao: portao(), authorizeApoloRead: portao() };
});

vi.mock("@/lib/temis/html-para-pdf", () => ({
  gerarPdfDoHtml: async () => estado.corpo,
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => cliente(),
  hashIdentifier: (tipo: string, valor: string) => `${tipo}:${valor}`,
}));

vi.mock("@/lib/temis/dados-do-contrato", () => ({
  dadosDaProposta: async () => ({
    avisos: [],
    dados: {
      compradores: [{ ehPessoaFisica: true, temConjuge: false, valores: { nome_cliente: "Henrique" } }],
      gerais: {
        __empreendimento_id: "9001",
        __unidade_enterprise_id: "9001",
        __unidade_id: "uni-1",
        empreendimento_codigo: "TST",
        empreendimento_nome: "LOTEAMENTO TESTE",
        numero_lote: "05",
        numero_quadra: "01",
      },
    },
  }),
}));

// ── O STUB DO SUPABASE, COM FILTROS DE VERDADE ──────────────────────────────

function valorDoFiltro(filtros: unknown[][], metodo: string, coluna: string): unknown {
  return filtros.find((f) => f[0] === metodo && f[1] === coluna)?.[2];
}

function consulta(tabela: string) {
  const filtros: unknown[][] = [];
  const ctx = { op: "select", payload: undefined as unknown, unico: false };

  const responder = (): { data: unknown; error: null | { code?: string; message: string } } => {
    if (tabela === "temis_minutas") {
      const linha = {
        capa_nome: estado.capaNome,
        capa_path: estado.capaPath,
        conteudo: estado.conteudo,
        enterprise_id: "9001",
        id: "minuta-1",
        nome: "Minuta de Teste",
        situacao: "publicada",
        tipo: "contrato",
        versao: 6,
      };
      return ctx.unico ? { data: linha, error: null } : { data: [linha], error: null };
    }

    if (tabela === "hercules_propostas") {
      return {
        data: {
          cliente_documento: "12345678901",
          cliente_entity_id: "ent-1",
          empreendimento_codigo: "TST",
          protocolo_numero: 7,
          unidade_id: "uni-1",
        },
        error: null,
      };
    }

    if (tabela === "hercules_empreendimentos") {
      return {
        data: [{ c2x_enterprise_id: "9001", id: "uuid-tst", nome: "LOTEAMENTO TESTE", pai_id: null }],
        error: null,
      };
    }

    if (tabela === "temis_anexos") {
      // O `.or()` chega como "unidade_id.eq.uni-1,enterprise_id.eq.9001".
      const alvos = new Set(
        (filtros.find((f) => f[0] === "or")?.[1] as string | undefined)
          ?.split(",")
          .map((p) => p.split(".eq.")[1] ?? "") ?? [],
      );
      // ⚠️ O `ativo = true` É RESPEITADO AQUI: é o que faz o anexo desativado sumir da v2.
      const soAtivos = valorDoFiltro(filtros, "eq", "ativo") === true;
      return {
        data: estado.anexos.filter(
          (a) =>
            (!soAtivos || a.ativo) &&
            alvos.has(String(a.unidade_id ?? a.categoria_id ?? a.enterprise_id ?? "")),
        ),
        error: null,
      };
    }

    if (tabela === "hercules_documentos") {
      if (ctx.op === "insert") {
        estado.inseridos.push(ctx.payload as Record<string, unknown>);
        return { data: { id: `doc-${estado.inseridos.length}` }, error: null };
      }
      if (ctx.op === "update") return { data: null, error: null };
      return ctx.unico ? { data: null, error: null } : { data: estado.jaGuardados, error: null };
    }

    return { data: ctx.unico ? null : [], error: null };
  };

  const proprios: Record<string, unknown> = {
    insert: (payload: unknown) => {
      ctx.op = "insert";
      ctx.payload = payload;
      return construtor;
    },
    maybeSingle: async () => {
      ctx.unico = true;
      return responder();
    },
    single: async () => {
      ctx.unico = true;
      return responder();
    },
    then: (aceitar: (v: unknown) => unknown, recusar?: (e: unknown) => unknown) =>
      Promise.resolve(responder()).then(aceitar, recusar),
    update: (payload: unknown) => {
      ctx.op = "update";
      ctx.payload = payload;
      return construtor;
    },
  };

  const construtor: Record<string, unknown> = new Proxy(proprios, {
    get(alvo, prop) {
      if (prop in alvo) return alvo[prop as string];
      return (...args: unknown[]) => {
        filtros.push([prop as string, ...args]);
        return construtor;
      };
    },
  });

  return construtor;
}

function cliente() {
  return {
    from: (tabela: string) => consulta(tabela),
    storage: {
      from: () => ({
        createSignedUrl: async (caminho: string) => ({
          data: { signedUrl: `https://x/sign/${caminho}` },
          error: null,
        }),
        download: async (caminho: string) => {
          const bytes = estado.arquivos.get(caminho);
          estado.baixados.push(caminho);
          if (!bytes) return { data: null, error: { message: "not found" } };
          estado.bytesBaixados += bytes.byteLength;
          return {
            data: {
              arrayBuffer: async () =>
                bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
            },
            error: null,
          };
        },
        remove: async () => ({ data: null, error: null }),
        upload: async (caminho: string, bytes: Uint8Array) => {
          estado.guardados.push({ bytes, caminho });
          return { data: { path: caminho }, error: null };
        },
      }),
    },
  } as never;
}

import { POST } from "@/app/api/temis/contrato/gerar/route";

const PROPOSTA = "641f22ac-6c4a-4133-afec-49fa7b7e1765";
const CABECALHO = { authorization: "Bearer tok", "content-type": "application/json" };

function gerar() {
  return POST(
    new Request("https://x/api/temis/contrato/gerar", {
      body: JSON.stringify({ propostaId: PROPOSTA }),
      headers: CABECALHO,
      method: "POST",
    }),
  );
}

async function pdfComTamanhos(
  tamanhos: readonly (readonly [number, number])[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  // O risco dá conteúdo à página: folha sem `/Contents` entra como branco e não carrega marca.
  for (const [largura, altura] of tamanhos) {
    doc.addPage([largura, altura]).drawRectangle({ height: 1, width: 1, x: 0, y: 0 });
  }
  return doc.save();
}

async function tamanhosDoPdf(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPages().map((p) => `${Math.round(p.getWidth())}x${Math.round(p.getHeight())}`);
}

/**
 * De que PEÇA veio cada página — a marca é o tamanho ORIGINAL, preservado na BBox do XObject.
 *
 * ⚠️ DESDE 22/09/2026 TODA PÁGINA DO CONTRATO SAI NO PAPEL DO CORPO (a capa do Vale do Ouro vinha
 * no dobro do A4 e o documento saía desproporcional). Então o tamanho da página deixou de
 * identificar a peça, e quem identifica agora é a arte embutida. Página copiada, sem XObject, é o
 * corpo. Ver `montar-pdf-do-contrato.revisao.test.ts`, onde a mesma leitura está explicada.
 */
async function origensDoPdf(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPages().map((pagina) => {
    const xobjects = pagina.node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict);
    const primeiro = xobjects ? [...xobjects.entries()][0] : undefined;
    if (!primeiro) return "corpo";
    const forma = doc.context.lookupMaybe(primeiro[1], PDFStream);
    const bbox = forma?.dict.lookupMaybe(PDFName.of("BBox"), PDFArray);
    if (!bbox) return "imagem";
    const n = (i: number) => bbox.lookupMaybe(i, PDFNumber)?.asNumber() ?? 0;
    return `${Math.round(n(2) - n(0))}x${Math.round(n(3) - n(1))}`;
  });
}

/** O parágrafo simples da minuta. `variaveis` vira um nó de variável para cada nome. */
function paragrafo(texto: string, ...variaveis: string[]): unknown {
  return {
    children: [
      { text: texto },
      ...variaveis.map((nome) => ({ children: [{ text: "" }], nome, type: "variavel" })),
    ],
    type: "p",
  };
}

function anexo(campos: {
  ativo?: boolean;
  bytes?: number;
  id: string;
  nome: string;
  posicao: number;
}) {
  return {
    arquivo_bytes: campos.bytes ?? 1000,
    ativo: campos.ativo ?? true,
    categoria_id: null,
    enterprise_id: "9001",
    id: campos.id,
    nome: campos.nome,
    posicao: campos.posicao,
    storage_path: `temis-anexos/empreendimento/9001/${campos.id}.pdf`,
    unidade_id: null,
  };
}

beforeEach(async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  estado.anexos = [];
  estado.arquivos = new Map();
  estado.baixados = [];
  estado.bytesBaixados = 0;
  estado.capaNome = null;
  estado.capaPath = null;
  estado.conteudo = [paragrafo("Comprador: ", "nome_cliente")];
  estado.corpo = await pdfComTamanhos([[595, 842], [595, 842]]);
  estado.guardados = [];
  estado.inseridos = [];
  estado.jaGuardados = [];
});

// ── 1. O PAPEL QUE FOI PARA A GAVETA ────────────────────────────────────────

describe("o PDF guardado", () => {
  it("leva capa, corpo e anexos NESTA ordem, e o registro diz quais peças foram", async () => {
    estado.capaNome = "Capa VOL";
    estado.capaPath = "temis-capas/empreendimento/9001/capa.pdf";
    estado.arquivos.set(estado.capaPath, await pdfComTamanhos([[111, 111]]));
    estado.anexos = [
      anexo({ id: "a2", nome: "Memorial descritivo", posicao: 2 }),
      anexo({ id: "a1", nome: "Convenção de condomínio", posicao: 1 }),
    ];
    estado.arquivos.set(estado.anexos[0]!.storage_path, await pdfComTamanhos([[333, 333]]));
    estado.arquivos.set(estado.anexos[1]!.storage_path, await pdfComTamanhos([[222, 222]]));

    const r = await gerar();
    expect(r.status).toBe(200);

    // ⚠️ A ORDEM É CONFERIDA NO ARQUIVO, e cada peça carrega um tamanho próprio para poder ser
    // reconhecida. A posição 1 (Convenção, 222x222) vem antes da posição 2 (Memorial, 333x333),
    // mesmo tendo sido cadastrada depois.
    expect(estado.guardados).toHaveLength(1);
    expect(await origensDoPdf(estado.guardados[0]!.bytes)).toEqual([
      "111x111",
      "corpo",
      "corpo",
      "222x222",
      "333x333",
    ]);
    // E o papel é um só do começo ao fim.
    expect(await tamanhosDoPdf(estado.guardados[0]!.bytes)).toEqual(
      Array.from({ length: 5 }, () => "595x842"),
    );

    const linha = estado.inseridos[0] as Record<string, unknown>;
    expect(String(linha.observacao)).toContain("Convenção de condomínio");
    expect(String(linha.observacao)).toContain("Memorial descritivo");
    expect(linha.tamanho_bytes).toBe(estado.guardados[0]!.bytes.byteLength);
  });

  it("sem anexo e sem capa, o corpo do Chromium vai INTOCADO para o bucket", async () => {
    const r = await gerar();
    expect(r.status).toBe(200);
    expect(estado.guardados[0]!.bytes).toBe(estado.corpo);
    expect(estado.baixados).toEqual([]);
  });
});

// ── 2. O TETO DE 24MB ───────────────────────────────────────────────────────

describe("a soma que passa do teto", () => {
  it("recusa ANTES do primeiro download, com o `arquivo_bytes` que o cadastro já tinha", async () => {
    // ⚠️ O BANCO JÁ SABIA O TAMANHO. `temis_anexos.arquivo_bytes` é gravado por `gravarAnexo` com o
    // tamanho REAL do objeto (estrutura-servico.ts), `somarAnexosDaCadeia` traz a coluna e
    // `AnexoDaVenda.arquivoBytes` chega inteiro a `contrato-servico.ts` — que até 21/09/2026 não o
    // usava: `baixarPecasDoContrato` baixava peça por peça e só então `montarPdfDoContrato`
    // comparava a SOMA com o teto, ou seja, a conta era feita com o dano já na RAM da função.
    //
    // Medido naquela data com três anexos de 9MB (o limite por anexo é 20MB, então três peças
    // legítimas já passam do teto): a rota recusava com 409 citando "24MB" DEPOIS de transferir
    // 28.311.552 bytes — 27MB — para dentro da função serverless. Com 20MB por peça, 60MB.
    const noveMegas = 9 * 1024 * 1024;
    estado.anexos = [
      anexo({ bytes: noveMegas, id: "a1", nome: "Levantamento topográfico", posicao: 1 }),
      anexo({ bytes: noveMegas, id: "a2", nome: "Matrícula digitalizada", posicao: 2 }),
      anexo({ bytes: noveMegas, id: "a3", nome: "Memorial digitalizado", posicao: 3 }),
    ];
    for (const a of estado.anexos) estado.arquivos.set(a.storage_path, new Uint8Array(noveMegas));

    const r = await gerar();
    const corpo = (await r.json()) as { erro?: string };

    expect(r.status).toBe(409);
    expect(corpo.erro).toContain("24MB");
    expect(estado.guardados).toEqual([]);

    // A soma de `arquivo_bytes` recusa ANTES do primeiro download: nada foi transferido.
    expect(estado.bytesBaixados).toBe(0);
  });
});

// ── 3. O TEXTO PROMETE UMA PEÇA QUE NÃO EXISTE ──────────────────────────────

describe("o marcador de montagem sem peça no cadastro", () => {
  it("a minuta cita [anexo_2], não há anexo 2, e a geração PARA nomeando a posição", async () => {
    // ⚠️ `[anexo_N]` NÃO É BLOCO CONDICIONAL. `[inicio_tem_anexo_2]` some de propósito quando a peça
    // não existe — é o que o par significa. `[anexo_2]` é o LUGAR ONDE A PÁGINA ENTRA: uma promessa
    // escrita em cláusula. Até 21/09/2026 ele saa do texto, ficava registrado em `marcadores`, e
    // ninguém lia `marcadores` (zero ocorrências em `modules/`; na geração o campo nem era
    // devolvido). Resultado medido naquele dia: 200, PDF guardado com as 2 páginas do corpo e nada
    // mais, `anexos: []`, `avisos: []` — o contrato prometia um anexo e saa sem ele, calado.
    //
    // Agora o marcador órfão cai em `semValor` (`preencher-contrato.ts`) e `podeGerarContrato`
    // recusa com frase própria, que fala de PEÇA e não de campo em branco no cadastro do comprador.
    estado.conteudo = [
      paragrafo("Comprador: ", "nome_cliente"),
      paragrafo("Faz parte deste instrumento o anexo: ", "anexo_2"),
    ];

    const r = await gerar();
    const corpo = (await r.json()) as { erro?: string; semValor?: string[] };

    expect(r.status).toBe(409);
    // A frase diz QUAL posição o texto pede e onde cadastrar a peça.
    expect(corpo.erro).toContain("[anexo_2]");
    expect(corpo.erro).toMatch(/categoria/i);
    expect(corpo.semValor).toEqual(["anexo_2"]);
    // E nada foi para a gaveta: contrato que promete peça inexistente não vira arquivo.
    expect(estado.guardados).toEqual([]);
  });
});

// ── 4. A CAPA QUE NÃO TERMINA EM .PNG ───────────────────────────────────────

describe("a capa exportada como .jfif", () => {
  it("JPEG salvo pelo Chrome como .jfif entra como IMAGEM, e não como PDF quebrado", async () => {
    // ⚠️ O MIME DA CAPA ERA ADIVINHADO PELA EXTENSÃO até 21/09/2026. `mimeDoCaminho` só conhecia
    // `.png`, `.jpg` e `.jpeg` e devolvia `application/pdf` para todo o resto — e `.jfif` é a
    // extensão que o Chrome dá a um JPEG salvo pela área de trabalho. O upload tinha aceitado o
    // arquivo porque o navegador declarou `image/jpeg` (`TIPOS_DA_CAPA`); o caminho no Storage
    // guarda o NOME, não o tipo. Resultado medido: 409 para TODO contrato daquele empreendimento,
    // com a frase mandando tirar a proteção por senha de uma imagem que nunca teve senha.
    //
    // A função de adivinhar foi apagada: quem responde agora é `formatoDosBytes`, que lê os
    // primeiros bytes do arquivo.
    const jpeg = Uint8Array.from(
      Buffer.from(
        "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
        "base64",
      ),
    );
    estado.capaNome = "Capa do Canva";
    estado.capaPath = "temis-capas/empreendimento/9001/2f1c-capa-final.jfif";
    estado.arquivos.set(estado.capaPath, jpeg);

    const r = await gerar();
    const corpo = (await r.json()) as { erro?: string };

    expect(corpo.erro).toBeUndefined();
    expect(r.status).toBe(200);
    // A capa vira a PRIMEIRA página, encaixada no papel do corpo (o JPEG mínimo tem 1x1 px).
    expect(await tamanhosDoPdf(estado.guardados[0]!.bytes)).toEqual(["595x842", "595x842", "595x842"]);
    expect((await origensDoPdf(estado.guardados[0]!.bytes))[0]).toBe("imagem");
  });
});

// ── 5. A PEÇA QUE SOME DEPOIS DO CONTRATO PRONTO ────────────────────────────

describe("o anexo apagado depois de o contrato já ter saído", () => {
  it("desativar tira a peça da v2 — e o registro da v1 continua dizendo o que ela levava", async () => {
    // ⚠️ DESATIVAR NÃO APAGA O OBJETO (estrutura-servico.ts: *"o arquivo continua no bucket"*), e o
    // PDF da v1 já está gravado: ele não muda. O que muda é a v2, que sai sem a peça. A única
    // testemunha é a `observacao` de cada linha — por isso ela é conferida aqui.
    estado.anexos = [anexo({ id: "a1", nome: "Convenção de condomínio", posicao: 1 })];
    estado.arquivos.set(estado.anexos[0]!.storage_path, await pdfComTamanhos([[222, 222]]));

    const primeira = await gerar();
    expect(primeira.status).toBe(200);
    expect(await origensDoPdf(estado.guardados[0]!.bytes)).toEqual(["corpo", "corpo", "222x222"]);

    estado.anexos[0]!.ativo = false;
    estado.jaGuardados = [{ criado_em: "2026-09-21T10:00:00Z", id: "doc-1", nome: "v1" }];

    const segunda = await gerar();
    expect(segunda.status).toBe(200);
    expect(await tamanhosDoPdf(estado.guardados[1]!.bytes)).toEqual(["595x842", "595x842"]);

    expect(String(estado.inseridos[0]!.observacao)).toContain("Convenção de condomínio");
    expect(String(estado.inseridos[1]!.observacao)).not.toContain("Convenção de condomínio");
  });

  it("objeto sumido do bucket RECUSA a geração nomeando a peça, em vez de emitir sem ela", async () => {
    estado.anexos = [anexo({ id: "a1", nome: "Convenção de condomínio", posicao: 1 })];
    // A linha continua ativa; o arquivo não está mais no bucket.

    const r = await gerar();
    const corpo = (await r.json()) as { erro?: string };
    expect(r.status).toBe(409);
    expect(corpo.erro).toContain("Convenção de condomínio");
    expect(estado.guardados).toEqual([]);
  });
});
