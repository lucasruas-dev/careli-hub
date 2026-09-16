// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

// O CADASTRO DE UNIDADES, TRAVADO NO QUE A PESSOA VÊ E NO QUE VAI PARA A REDE.
//
// ⚠️ A ROTA AQUI É A DE VERDADE (revisão de 16/09/2026). A primeira versão deste teste usava um fetch
// de mentira com o contrato que a tela IMAGINAVA (`acao: "gravar"`, `emp` no corpo, lotes de 50), e
// a tela passava nele enquanto toda chamada à rota real caía em 400. Agora o `fetch` da tela chega ao
// POST de /api/incorporador/produto/unidades/cadastrar, com o cookie de uma sessão assinada, e a
// regra inteira roda (`executarCadastroDeUnidades`). Só o banco é de mentira: o cadastro de produtos
// e `hercules_unidades` em memória, com o índice único do código. Se a tela e a rota voltarem a
// divergir, este arquivo fica vermelho.
//
// O que se prova: o apartamento vai com as chaves do prédio (nunca quadra e lote), nada é gravado
// antes de a ROTA conferir, a planilha vai inteira num envio só (tudo ou nada), e o resumo mostra o
// que o banco releu.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Linha = Record<string, unknown>;

const banco = vi.hoisted(() => ({
  inserts: 0,
  unidades: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/client", () => ({
  getHubSupabaseClient: () => null,
  hubSupabaseConfig: { anonKey: "chave-publica", url: "https://projeto.supabase.co" },
}));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: () => Promise.resolve("token-do-hub"),
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({ catalogoDeEmpreendimentos: async () => [] }));

// A revalidação de quem grava é a do portal que opera sozinho (autorizarPortalQueOperaSozinho →
// autorizarTemisDoPortal): o portal ativo com o mesmo id, a conta ativa e o escopo da conta agora.
vi.mock("@/lib/apolo/incorporador/dados", () => ({
  carregarIncorporadorPorSlug: async () => ({
    ativo: true,
    id: "inc-cecilio",
    slug: "cecilio-rocha",
    tipo: "incorporador",
  }),
  escopoDaConta: async () => ({ enterpriseIds: ["100000", "100002", "100009"] }),
  usuarioIncorporadorSegueAtivo: async () => true,
}));

vi.mock("@/lib/hercules/cadastro", async (original) => {
  const produto = (sobre: Record<string, unknown>) => ({
    cidade: "Ipatinga",
    operadoPor: "inc-cecilio",
    ordem: 0,
    paiId: null,
    uf: "MG",
    vendendo: true,
    ...sobre,
  });
  const linhas = [
    produto({ c2xEnterpriseId: "100000", codigo: "JAD", id: "jad", nome: "Ed. Jade", tipoProduto: "vertical" }),
    produto({ c2xEnterpriseId: "100002", codigo: "SOL", id: "sol", nome: "Vale do Sol", tipoProduto: "loteamento" }),
    // Um produto que a sessão alcança, mas de outro operador.
    produto({ c2xEnterpriseId: "100009", codigo: "OUT", id: "out", nome: "Outro", operadoPor: "inc-outro", tipoProduto: "loteamento" }),
  ];
  return {
    ...(await original<typeof import("@/lib/hercules/cadastro")>()),
    carregarCadastroDeEmpreendimentos: async () => linhas,
    lerCadastroDeEmpreendimentos: async () => ({ com0170: true, linhas }),
  };
});

vi.mock("@/lib/apolo/server", () => {
  function consulta(tabela: string) {
    const filtros: Array<[string, string, unknown]> = [];
    let operacao: "insert" | "select" = "select";
    let payload: Linha[] = [];
    let faixa: [number, number] | null = null;

    const casa = (l: Linha) =>
      filtros.every(([tipo, coluna, valor]) =>
        tipo === "eq" ? String(l[coluna]) === String(valor) : (valor as unknown[]).map(String).includes(String(l[coluna])),
      );

    const executar = () => {
      if (tabela !== "hercules_unidades") return { data: [], error: null };
      if (operacao === "insert") {
        const chaves = new Set(banco.unidades.map((u) => `${u.enterprise_id}|${u.codigo}`));
        for (const l of payload) {
          if (chaves.has(`${l.enterprise_id}|${l.codigo}`)) {
            return { data: null, error: { code: "23505", message: "duplicate key hercules_unidades_codigo_unico" } };
          }
        }
        banco.inserts += 1;
        payload.forEach((l, i) => banco.unidades.push({ ...l, id: `unidade-${banco.unidades.length + i}` }));
        return { data: null, error: null };
      }
      let data = banco.unidades.filter(casa);
      if (faixa) data = data.slice(faixa[0], faixa[1] + 1);
      return { data: data.map((l) => ({ ...l })), error: null };
    };

    const q = {
      eq: (coluna: string, valor: unknown) => {
        filtros.push(["eq", coluna, valor]);
        return q;
      },
      in: (coluna: string, valor: unknown[]) => {
        filtros.push(["in", coluna, valor]);
        return q;
      },
      insert: (linhas: Linha[]) => {
        operacao = "insert";
        payload = linhas;
        return q;
      },
      limit: () => q,
      maybeSingle: async () => {
        const r = executar();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      },
      not: () => q,
      order: () => q,
      range: (de: number, ate: number) => {
        faixa = [de, ate];
        return q;
      },
      select: () => q,
      then: (ok: (v: unknown) => unknown, falhou?: (e: unknown) => unknown) => Promise.resolve(executar()).then(ok, falhou),
    };
    return q;
  }
  return { createApoloAdminClient: () => ({ from: consulta }) };
});

const { CadastroDeUnidades, JanelaDeCadastroDeUnidades } = await import("./CadastroDeUnidades");
const { POST } = await import("@/app/api/incorporador/produto/unidades/cadastrar/route");
const { criarSessaoIncorporador, INCORPORADOR_COOKIE } = await import("@/lib/apolo/incorporador/sessao");

type Corpo = { acao: string; enterpriseId?: string; linhas?: Linha[]; unidade?: Linha };
type Chamada = { body: Corpo; url: string };

let raiz: Root;
let hospedeiro: HTMLDivElement;
let chamadas: Chamada[];
/**
 * As chamadas à rota ainda em voo.
 *
 * ⚠️ POR QUE ESPERAR A REDE, E NÃO UM NÚMERO FIXO DE VOLTAS (revisão do conjunto, 16/09/2026). A rota
 * real passou a revalidar a sessão por `autorizarPortalQueOperaSozinho`, que faz um `import()` da
 * Têmis. Com a suíte inteira rodando, esse import demora mais que as voltas fixas: a asserção corria
 * antes do insert, e o insert terminava DENTRO do teste seguinte (inserts 1 onde se esperava 0).
 */
let emVoo: Promise<unknown>[] = [];

/** Espera todas as chamadas em voo (e as que elas dispararem) terminarem e a tela reagir. */
async function esperarRede() {
  for (let rodada = 0; rodada < 20 && emVoo.length > 0; rodada += 1) {
    const agora = emVoo;
    emVoo = [];
    await act(async () => {
      await Promise.allSettled(agora);
    });
    await esperarPromessas(3);
  }
}

function cookieDaSessao(): string {
  vi.stubEnv("SESSAO_INCORPORADOR_SECRET", "segredo-de-teste");
  const token = criarSessaoIncorporador(
    {
      enterpriseIds: ["100000", "100002", "100009"],
      enterpriseIdsComCarteira: [],
      incorporadorId: "inc-cecilio",
      incorporadorNome: "Cecílio Rocha",
      slug: "cecilio-rocha",
      tipo: "incorporador",
      usuarioId: "22222222-2222-4222-8222-222222222222",
      usuarioNome: "Time Cecílio",
    },
    Date.now(),
  );
  return `${INCORPORADOR_COOKIE}=${token}`;
}

/** O `fetch` da tela chega à rota de verdade, com o cookie que o navegador mandaria. */
function instalarRota(antes?: (chamada: Chamada) => Promise<void> | void) {
  chamadas = [];
  const cookie = cookieDaSessao();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const resposta = (async () => {
        const chamada = { body: JSON.parse(String(init?.body)) as Corpo, url };
        chamadas.push(chamada);
        await antes?.(chamada);
        return POST(
          new Request(new URL(url, "https://c2x.app.br"), {
            body: String(init?.body),
            headers: { ...(init?.headers as Record<string, string>), cookie },
            method: "POST",
          }),
        );
      })();
      emVoo.push(resposta);
      return resposta;
    }),
  );
}

async function esperarPromessas(voltas = 1) {
  for (let v = 0; v < voltas; v += 1) {
    await act(async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function montar(elemento: React.ReactElement) {
  act(() => {
    raiz.render(elemento);
  });
  await esperarPromessas();
}

const botao = (rotulo: string) =>
  Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === rotulo || b.getAttribute("aria-label") === rotulo,
  );
const campo = <T extends HTMLElement = HTMLInputElement>(nome: string) =>
  document.querySelector<T>(`[data-campo="${nome}"]`);
const texto = () => document.body.textContent ?? "";
const estados = () =>
  Array.from(document.querySelectorAll(".inc-und-tabela tbody tr .inc-und-selo")).map((s) => s.textContent);

function digitar(el: HTMLInputElement | HTMLSelectElement | null, valor: string) {
  if (!el) throw new Error("campo não encontrado");
  act(() => {
    const prototipo = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototipo, "value")?.set?.call(el, valor);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

async function clicar(el: HTMLElement | undefined | null, voltas = 3) {
  if (!el) throw new Error("botão não encontrado");
  await act(async () => {
    el.click();
  });
  await esperarPromessas(voltas);
  await esperarRede();
}

async function escolherArquivo(conteudo: string, nome = "unidades.csv") {
  const entrada = document.querySelector<HTMLInputElement>('input[type="file"]');
  const arquivo = new File([conteudo], nome, { type: "text/csv" });
  await act(async () => {
    Object.defineProperty(entrada, "files", { configurable: true, value: [arquivo] });
    entrada?.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await esperarPromessas(5);
}

function lote(quadra: string, loteNumero: string, enterprise = "100002", prefixo = "SOL"): Linha {
  return {
    area: 300,
    codigo: `${prefixo}${quadra}${loteNumero}`,
    enterprise_id: enterprise,
    espelho_de: null,
    lote: loteNumero,
    origem_c2x_id: null,
    preco_tabela: 100000,
    quadra,
    situacao: "disponivel",
    workspace_id: "careli",
  };
}

beforeEach(() => {
  emVoo = [];
  banco.inserts = 0;
  banco.unidades = [lote("01", "01"), lote("01", "07")];
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  // Nada do teste pode terminar dentro do próximo (ver `emVoo`).
  await esperarRede();
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("CadastroDeUnidades · uma unidade", () => {
  it("prédio: campos do vertical, grava pela rota real com as chaves do prédio e segura a torre", async () => {
    instalarRota();
    const aoConcluir = vi.fn();
    await montar(<CadastroDeUnidades aoConcluir={aoConcluir} emp="100000" prefixo="JAD" tipoProduto="vertical" />);

    expect(campo("quadra")).toBeNull();
    expect(campo("lote")).toBeNull();
    expect(texto()).toContain("JAD-A-304");

    digitar(campo("torre"), "a");
    digitar(campo("andar"), "3");
    digitar(campo("apartamento"), "0304");
    digitar(campo("areaPrivativa"), "68,45");
    expect(texto()).toContain("Vai entrar como Torre A · Apto 304 · código JAD-A-304");
    // Sem preço: o aviso diz que ela entra bloqueada.
    expect(texto()).toContain("a unidade entra bloqueada");

    await clicar(botao("Cadastrar unidade"));

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]?.url).toBe("/api/incorporador/produto/unidades/cadastrar?emp=100000");
    expect(chamadas[0]?.body).toEqual({
      acao: "criar",
      enterpriseId: "100000",
      unidade: { andar: "3", apartamento: "0304", areaPrivativa: "68,45", situacao: "Disponível", torre: "a" },
    });
    // O que o banco recebeu: apartamento, sem quadra e lote, bloqueado por falta de preço.
    expect(banco.unidades.at(-1)).toMatchObject({
      andar: 3,
      apartamento: "304",
      bloqueio_motivo: "Sem preço de tabela",
      codigo: "JAD-A-304",
      lote: null,
      quadra: null,
      situacao: "bloqueada",
      torre: "A",
    });
    expect(texto()).toContain("Torre A · Apto 304 cadastrada (JAD-A-304).");
    expect(aoConcluir).toHaveBeenCalledTimes(1);
    expect(campo("torre")?.value).toBe("a");
    expect(campo("apartamento")?.value).toBe("");
    expect(document.activeElement).toBe(campo("apartamento"));
  });

  it("loteamento: não envia sem o obrigatório; o 'já cadastrada' da rota aparece sem chamar aoConcluir", async () => {
    instalarRota();
    const aoConcluir = vi.fn();
    await montar(<CadastroDeUnidades aoConcluir={aoConcluir} emp="100002" prefixo="SOL" tipoProduto="loteamento" />);

    await clicar(botao("Cadastrar unidade"));
    expect(chamadas).toHaveLength(0);
    expect(texto()).toContain("Informe a quadra.");
    expect(document.activeElement).toBe(campo("quadra"));

    digitar(campo("quadra"), "1");
    digitar(campo("lote"), "7");
    digitar(campo("area"), "300");
    digitar(campo("preco"), "140.401,00");
    digitar(campo("matricula"), "25.862");
    digitar(campo<HTMLSelectElement>("situacao"), "Bloqueada");
    digitar(campo("motivoDoBloqueio"), "Permuta");
    await clicar(botao("Cadastrar unidade"));

    expect(chamadas[0]?.body.unidade).toEqual({
      area: "300",
      lote: "7",
      matricula: "25.862",
      motivoDoBloqueio: "Permuta",
      preco: "140.401,00",
      quadra: "1",
      situacao: "Bloqueada",
    });
    expect(texto()).toContain("Quadra 01 · Lote 07 já está cadastrada neste produto (SOL0107).");
    expect(banco.inserts).toBe(0);
    expect(aoConcluir).not.toHaveBeenCalled();
  });
});

describe("CadastroDeUnidades · planilha", () => {
  it("⚠️ confere na rota; com uma linha que não entra, NADA é gravado (a planilha entra inteira ou não entra)", async () => {
    instalarRota();
    await montar(<CadastroDeUnidades aoConcluir={() => {}} emp="100002" prefixo="SOL" tipoProduto="loteamento" />);

    await clicar(botao("Importar planilha"));
    await escolherArquivo(
      [
        "Quadra *;Lote *;Área (m²) *;Valor (R$);Matrícula",
        "1;1;300,00;100.000,00;10", // já existe no produto: só a rota sabe
        "1;2;300,00;;11", // entra com aviso (sem preço, bloqueada)
        "1;3;;100.000,00;12", // sem área: não entra
        "1;4;300,00;100.000,00;13", // entra
      ].join("\n"),
    );

    expect(chamadas.map((c) => [c.url, c.body.acao])).toEqual([["/api/incorporador/produto/unidades/cadastrar?emp=100002", "conferir"]]);
    expect(chamadas[0]?.body.linhas).toHaveLength(4);
    expect(estados()).toEqual(["Não entra", "Entra com aviso", "Não entra", "Entra"]);
    expect(texto()).toContain("já está cadastrada neste produto");
    expect(texto()).toContain("No produto hoje");
    expect(texto()).toContain("A planilha entra inteira ou não entra");

    await clicar(botao("Não entram (2)"));
    expect(document.querySelectorAll(".inc-und-tabela tbody tr")).toHaveLength(2);

    expect(botao("Cadastrar 2 unidades")?.disabled).toBe(true);
    expect(banco.inserts).toBe(0);
  });

  it("planilha limpa: a planilha INTEIRA vai num envio só, e o resumo é o que o banco releu", async () => {
    instalarRota();
    const aoConcluir = vi.fn();
    await montar(<CadastroDeUnidades aoConcluir={aoConcluir} emp="100002" prefixo="SOL" tipoProduto="loteamento" />);

    await clicar(botao("Importar planilha"));
    const csv = ["Quadra;Lote;Área (m²);Valor (R$);Matrícula"];
    for (let i = 1; i <= 60; i += 1) csv.push(`2;${i};300,00;100.000,00;${i}`);
    await escolherArquivo(csv.join("\r\n"));

    await clicar(botao("Cadastrar 60 unidades"), 6);

    const importacoes = chamadas.filter((c) => c.body.acao === "importar");
    expect(importacoes.map((c) => c.body.linhas?.length)).toEqual([60]);
    expect(banco.inserts).toBe(1);
    expect(banco.unidades.filter((u) => String(u.codigo).startsWith("SOL02"))).toHaveLength(60);
    expect(texto()).toContain("60 unidades conferidas no cadastro depois da gravação.");
    expect(aoConcluir).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Resultado do cadastro");
  });

  it("⚠️ alguém cadastra a mesma unidade entre a conferência e o clique: nada entra e a tabela mostra por quê", async () => {
    instalarRota((chamada) => {
      if (chamada.body.acao === "importar") banco.unidades.push(lote("03", "02"));
    });
    const aoConcluir = vi.fn();
    await montar(<CadastroDeUnidades aoConcluir={aoConcluir} emp="100002" prefixo="SOL" tipoProduto="loteamento" />);

    await clicar(botao("Importar planilha"));
    await escolherArquivo("Quadra;Lote;Área (m²);Valor (R$);Matrícula\n3;1;300;1000;1\n3;2;300;1000;2\n");
    await clicar(botao("Cadastrar 2 unidades"), 6);

    expect(banco.inserts).toBe(0);
    expect(estados()).toEqual(["Entra", "Não entra"]);
    expect(texto()).toContain("1 linha tem problema, e nada foi gravado.");
    expect(botao("Cadastrar 1 unidade")?.disabled).toBe(true);
    expect(aoConcluir).not.toHaveBeenCalled();
  });

  it("acima de 500 linhas a tela recusa ANTES de chamar a rota", async () => {
    instalarRota();
    await montar(<CadastroDeUnidades aoConcluir={() => {}} emp="100002" prefixo="SOL" tipoProduto="loteamento" />);
    await clicar(botao("Importar planilha"));
    const csv = ["Quadra;Lote;Área (m²)"];
    for (let i = 1; i <= 501; i += 1) csv.push(`${Math.ceil(i / 40)};${i};300`);
    await escolherArquivo(csv.join("\n"));

    expect(chamadas).toHaveLength(0);
    expect(texto()).toContain("A planilha tem 501 linhas. Envie no máximo 500 por vez");
  });

  it("sem a conferência da rota nada grava (produto de outro operador: o mesmo 404 de inexistente)", async () => {
    instalarRota();
    await montar(<CadastroDeUnidades aoConcluir={() => {}} emp="100009" prefixo="OUT" tipoProduto="loteamento" />);

    await clicar(botao("Importar planilha"));
    await escolherArquivo("Quadra,Lote,Area,Valor\n1,1,300,1000\n");

    expect(texto()).toContain("Produto não encontrado. Sem a conferência com o cadastro, nada é gravado.");
    expect(document.querySelectorAll(".inc-und-tabela tbody tr")).toHaveLength(1);
    expect(botao("Cadastrar 1 unidade")?.disabled).toBe(true);
  });

  it("formato fora de .xlsx e .csv é recusado sem chamar a rota", async () => {
    instalarRota();
    await montar(<CadastroDeUnidades aoConcluir={() => {}} emp="100002" prefixo="SOL" tipoProduto="loteamento" />);
    await clicar(botao("Importar planilha"));
    await escolherArquivo("x", "unidades.xls");
    expect(texto()).toContain("Formato não aceito");
    expect(chamadas).toHaveLength(0);
  });
});

describe("CadastroDeUnidades · Excel", () => {
  it("o modelo baixado tem as colunas do tipo, e o mesmo arquivo preenchido volta pela importação", async () => {
    const ExcelJS = (await import("exceljs")).default;
    instalarRota();
    let baixado: Blob | null = null;
    // O jsdom não gera endereço de blob: o teste pega o arquivo no caminho (e tira o remendo no fim).
    const urlDoJsdom = URL as unknown as Record<string, unknown>;
    urlDoJsdom.createObjectURL = (blob: Blob) => {
      baixado = blob;
      return "blob:modelo";
    };
    urlDoJsdom.revokeObjectURL = () => {};
    onTestFinished(() => {
      delete urlDoJsdom.createObjectURL;
      delete urlDoJsdom.revokeObjectURL;
    });
    const cliques: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      cliques.push(this.download);
    });

    await montar(<CadastroDeUnidades aoConcluir={() => {}} emp="100000" nomeDoProduto="Ed. Jade" prefixo="JAD" tipoProduto="vertical" />);
    await clicar(botao("Planilha modelo"), 20);
    for (let i = 0; i < 40 && !baixado; i += 1) await esperarPromessas();

    expect(cliques).toEqual(["modelo-unidades-jad-predio.xlsx"]);
    const livro = new ExcelJS.Workbook();
    await livro.xlsx.load(await (baixado as unknown as Blob).arrayBuffer());
    expect(livro.worksheets.map((w) => w.name)).toEqual(["Unidades", "Como preencher"]);
    const aba = livro.getWorksheet("Unidades");
    const cabecalho: string[] = [];
    aba?.getRow(1).eachCell((c) => cabecalho.push(String(c.value)));
    expect(cabecalho).toEqual([
      "Torre",
      "Andar *",
      "Apartamento *",
      "Tipologia",
      "Vagas",
      "Área privativa (m²) *",
      "Valor (R$)",
      "Matrícula",
      "Situação",
      "Motivo do bloqueio",
    ]);
    // A aba das unidades sai SEM linha de exemplo: ela viraria uma unidade de verdade.
    expect(aba?.rowCount).toBe(1);

    // Preenche o próprio modelo como o Excel faria: número como número, texto rico, fórmula.
    aba?.addRow(["A", 3, "0304", { richText: [{ text: "2 quartos" }] }, 1, 68.45, { formula: "150000*2", result: 300000 }, "25.862"]);
    aba?.addRow([]);
    aba?.addRow(["B", "Térreo", "1", "", 0, "70,10"]);
    const arquivo = new File([await livro.xlsx.writeBuffer()], "jade.xlsx");

    await clicar(botao("Importar planilha"));
    const entrada = document.querySelector<HTMLInputElement>('input[type="file"]');
    await act(async () => {
      Object.defineProperty(entrada, "files", { configurable: true, value: [arquivo] });
      entrada?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    for (let i = 0; i < 40 && chamadas.length === 0; i += 1) await esperarPromessas();
    await esperarPromessas(4);

    expect(chamadas[0]?.body.linhas).toEqual([
      { andar: 3, apartamento: "0304", areaPrivativa: 68.45, matricula: "25.862", preco: "300000", tipologia: "2 quartos", torre: "A", vagas: 1 },
      // A célula de texto vazio existe no arquivo e vem vazia; a régua a lê como ausente.
      { andar: "Térreo", apartamento: "1", areaPrivativa: "70,10", tipologia: "", torre: "B", vagas: 0 },
    ]);
    expect(estados()).toEqual(["Entra", "Entra com aviso"]);
  });
});

describe("JanelaDeCadastroDeUnidades", () => {
  it("abre como diálogo com o produto no subtítulo e não fecha enquanto grava", async () => {
    let liberar: () => void = () => {};
    instalarRota(() => new Promise<void>((resolve) => (liberar = resolve)));
    const aoFechar = vi.fn();
    await montar(
      <JanelaDeCadastroDeUnidades
        aberto
        aoConcluir={() => {}}
        aoFechar={aoFechar}
        emp="100000"
        nomeDoProduto="Ed. Jade"
        prefixo="JAD"
        tipoProduto="vertical"
      />,
    );

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(texto()).toContain("Ed. Jade · JAD");

    // O Tab dá a volta dentro da janela, sem parar na aba escondida (a planilha).
    const cadastrar = botao("Cadastrar unidade");
    act(() => cadastrar?.focus());
    act(() => {
      cadastrar?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }));
    });
    expect(document.activeElement).toBe(botao("Fechar"));

    digitar(campo("andar"), "1");
    digitar(campo("apartamento"), "101");
    digitar(campo("areaPrivativa"), "50");
    await act(async () => {
      botao("Cadastrar unidade")?.click();
    });
    await esperarPromessas();
    expect(botao("Fechar")?.disabled).toBe(true);
    act(() => {
      document.querySelector('[role="dialog"]')?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(aoFechar).not.toHaveBeenCalled();

    await act(async () => {
      liberar();
    });
    await esperarPromessas(4);
    expect(botao("Fechar")?.disabled).toBe(false);
    expect(texto()).toContain("Apto 101 cadastrada (JAD-101).");
  });
});
