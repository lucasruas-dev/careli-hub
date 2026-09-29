// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A RAZÃO SOCIAL DE PJ NA TELA DE VALIDAÇÃO, E A RODADA DE SALVAMENTO QUE NÃO CAI INTEIRA.
//
// Lucas, 28/09/2026, com o print da tela: *"não conseguimos editar a razão social de PJ"*,
// *"TUDO PRECISA MORAR DENTRO DO PANTEON, não tem mais cadastro vindo do c2x"*, *"TODOS eu poderia
// alterar, atualizar"*. O caso real é a ficha `bda7977b-6f84-4946-a71f-4170821731dd` (prospect PJ,
// CNPJ 55.086.726/0001-80), cujo nome saiu do OCR colado no rótulo do documento:
// "DATA DE CONSTITUIÇÃO\nIGREJA EVANGELICA CBA TEMPLO NOVO 10/05/2024".
//
// O que se trava aqui:
//   1. em modo de edição a RAZÃO SOCIAL tem input, e o que for digitado vai para a rota de
//      IDENTIDADE com o CNPJ e o tipo atuais (a tela não sabe, nem precisa saber, se a ficha tem
//      vínculo com o C2X: quem decidia isso era o 409 da rota, e ele morreu — ver
//      `lib/apolo/identidade-persist.razao-social.test.ts`);
//   2. o CNPJ continua SÓ DE LEITURA nos dois modos: trocar o CNPJ é mudar quem a empresa é, e o
//      Lucas pediu a razão social;
//   3. ⚠️ uma falha da identidade (colisão de documento, que continua sendo um 409 legítimo) NÃO
//      derruba o resto da rodada: o telefone corrigido na mesma edição GRAVA, e a tela conta o que
//      salvou e o que não salvou.
//
// Mesma montagem manual dos outros testes de componente (board-view.mover-cad.comportamento).

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/supabase/client", () => ({
  getHubSupabaseClient: () => null,
  hubSupabaseConfig: { anonKey: "chave-publica", url: "https://projeto.supabase.co" },
}));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: () => Promise.resolve("token-do-hub"),
}));

const { BoardView } = await import("./board-view");

const ID = "bda7977b-6f84-4946-a71f-4170821731dd";
const CNPJ = "55.086.726/0001-80";
const NOME_TORTO = "DATA DE CONSTITUIÇÃO\nIGREJA EVANGELICA CBA TEMPLO NOVO 10/05/2024";
const NOME_CERTO = "IGREJA EVANGELICA CBA TEMPLO NOVO";

const ITEM = {
  analistaId: null,
  corretores: 0,
  criadoEm: "2026-09-28T16:33:53Z",
  documento: CNPJ,
  empreendimentos: ["VALE DO OURO"],
  enterpriseId: "35",
  entidadeStatus: "review",
  etapa: "cadastro",
  id: ID,
  motivo: null,
  nome: NOME_TORTO,
  papel: "prospect",
  prevendaHabilitada: false,
  socios: 0,
};

// ⚠️ A ficha que a rota devolve NÃO diz se a entidade tem vínculo com o C2X — a tela nunca soube
// disso. Por isso o campo liberado aqui vale igual para as 548 PJ espelho e para as 62 que não são.
const FICHA = {
  asana: null,
  cadastro: { nomeFantasia: "CBA NOVO TEMPLO", porte: "ME", telefone: "(37) 99956-9096" },
  conjuge: {},
  contato: { email: "contato@cba.org.br", telefone: "(37) 99956-9096" },
  endereco: null,
  entidade: {
    criadoEm: "2026-09-28T16:33:53Z",
    documento: CNPJ,
    nome: NOME_TORTO,
    nomeFantasia: "CBA NOVO TEMPLO",
    papel: "prospect",
    tipo: "pj",
  },
};

type Chamada = {
  body?: Record<string, unknown>;
  method: string;
  url: string;
};

let raiz: Root;
let hospedeiro: HTMLDivElement;
let chamadas: Chamada[];

function instalarFetch(
  identidade: { corpo: unknown; status: number },
  opcoes: { recargaFalha?: boolean } = {},
) {
  chamadas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const metodo = init?.method ?? "GET";
      chamadas.push({
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        method: metodo,
        url,
      });
      const caminho = url.split("?")[0] ?? "";

      // ⚠️ A RECARGA DEPOIS DO SALVAMENTO CAINDO COM HTML. É o caso real: timeout de função na
      // Vercel devolve página de erro, e `await resposta.json()` estoura. Só a leitura POSTERIOR à
      // gravação falha; a carga inicial da ficha tem que passar.
      const jaGravou = chamadas.some((c) => c.method === "POST" || c.method === "PATCH");
      if (
        opcoes.recargaFalha &&
        metodo === "GET" &&
        caminho === `/api/apolo/board/${ID}` &&
        jaGravou
      ) {
        return Promise.resolve(
          new Response("<html><body>An error occurred with this application.</body></html>", {
            headers: { "content-type": "text/html" },
            status: 502,
          }),
        );
      }

      let corpo: unknown = { data: {} };
      let status = 200;

      if (caminho === "/api/apolo/board") {
        corpo = {
          data: {
            analistas: [],
            empreendimentos: ["VALE DO OURO"],
            itens: [ITEM],
            usuarioAtual: { id: "conta", nome: "Nivea" },
          },
        };
      } else if (caminho === "/api/apolo/documentos") {
        corpo = { documents: [] };
      } else if (caminho.endsWith("/identidade")) {
        corpo = identidade.corpo;
        status = identidade.status;
      } else if (caminho === `/api/apolo/board/${ID}`) {
        corpo = { data: FICHA };
      }

      return Promise.resolve(
        new Response(JSON.stringify(corpo), {
          headers: { "content-type": "application/json" },
          status,
        }),
      );
    }),
  );
}

async function esperarPromessas() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

const texto = () => hospedeiro.textContent ?? "";

const botao = (rotulo: string) =>
  Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.trim() === rotulo,
  );

async function clicarEm(elemento: HTMLElement | undefined, nome: string) {
  if (!elemento) throw new Error(`"${nome}" não está na tela.`);
  act(() => {
    elemento.click();
  });
  await esperarPromessas();
}

/** A caixa de um campo da ficha, achada pelo rótulo (o <p> em caixa alta). */
function caixaDoCampo(label: string): HTMLElement {
  const rotulo = Array.from(hospedeiro.querySelectorAll<HTMLParagraphElement>("p")).find(
    (p) => p.textContent?.trim() === label,
  );
  if (!rotulo?.parentElement) throw new Error(`o campo "${label}" não está na tela.`);
  return rotulo.parentElement;
}

/** Digita num input como o navegador faria (o setter nativo, senão o React não vê a mudança). */
async function digitar(label: string, valor: string) {
  const input = caixaDoCampo(label).querySelector("input");
  if (!input) throw new Error(`o campo "${label}" não tem input: continua só de leitura.`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await esperarPromessas();
}

async function abrirEdicaoDaFicha() {
  act(() => {
    raiz.render(<BoardView />);
  });
  await esperarPromessas();

  const card = Array.from(hospedeiro.querySelectorAll<HTMLElement>('article[role="button"]')).find(
    (el) => /igreja evangelica/i.test(el.textContent ?? ""),
  );
  await clicarEm(card, "card da igreja");
  await clicarEm(botao("Editar ficha"), "Editar ficha");
}

const OK = { corpo: { data: { ok: true } }, status: 200 };
const COLISAO = {
  corpo: {
    error: "Este documento ja pertence a outra ficha (OUTRA IGREJA LTDA).",
    motivo: "colisao",
  },
  status: 409,
};

const pedidoDaIdentidade = () => chamadas.find((c) => c.method === "POST" && c.url.endsWith("/identidade"));
const patchDaFicha = () => chamadas.find((c) => c.method === "PATCH");

describe("Validação · razão social de PJ", () => {
  it("em edição a razão social tem input e o CNPJ continua só de leitura", async () => {
    instalarFetch(OK);
    await abrirEdicaoDaFicha();

    expect(caixaDoCampo("Razão social").querySelector("input")).not.toBeNull();
    // ⚠️ O CNPJ FICA. Trocar o CNPJ de uma empresa é mudar quem ela é.
    expect(caixaDoCampo("CNPJ").querySelector("input")).toBeNull();
    expect(caixaDoCampo("CNPJ").textContent).toContain(CNPJ);
  });

  it("a razão social corrigida vai para a rota de identidade com o CNPJ e o tipo atuais", async () => {
    instalarFetch(OK);
    await abrirEdicaoDaFicha();

    await digitar("Razão social", NOME_CERTO);
    await clicarEm(botao("Salvar alterações"), "Salvar alterações");

    expect(pedidoDaIdentidade()?.body).toMatchObject({ nome: NOME_CERTO, tipo: "pj" });
    // Nome fantasia intocado nesta rodada: não vai no corpo, e a rota não mexe em `trade_name`.
    expect(pedidoDaIdentidade()?.body?.nomeFantasia).toBeUndefined();
    // ⚠️ E O DOCUMENTO TAMBÉM NÃO VAI. Mandar o atual "por segurança" fazia a rota revalidar dígito e
    // coerência de um campo que a tela nem abre para PJ: a ficha PJ com "Documento em revisao" ou com
    // CNPJ torto recusava a correção do NOME com 400 falando do documento, sem saída pela tela.
    expect(pedidoDaIdentidade()?.body).not.toHaveProperty("documento");
  });

  it("⚠️ o NOME FANTASIA editado sozinho também passa pela rota de identidade (`trade_name`)", async () => {
    instalarFetch(OK);
    await abrirEdicaoDaFicha();

    await digitar("Nome fantasia", "CBA TEMPLO NOVO");
    await clicarEm(botao("Salvar alterações"), "Salvar alterações");

    // `trade_name` mora em `apolo_entities` e é DE LÁ que o contrato lê o nome fantasia
    // (`nome_fantasia_cliente` vem de `ENTIDADE("trade_name")`). Enquanto o fantasia só viajava
    // junto com nome/documento/tipo, corrigi-lo sozinho gravava apenas o jsonb do cadastro e
    // deixava `trade_name` velho — e a tela escondia, porque ela exibe o cadastro na frente.
    expect(pedidoDaIdentidade()?.body).toMatchObject({
      nome: NOME_TORTO,
      nomeFantasia: "CBA TEMPLO NOVO",
    });
  });

  it("⚠️ 409 da identidade NÃO derruba a rodada: o telefone grava e a tela conta os dois", async () => {
    instalarFetch(COLISAO);
    await abrirEdicaoDaFicha();

    await digitar("Razão social", NOME_CERTO);
    await digitar("Telefone", "(37) 98888-7777");
    await clicarEm(botao("Salvar alterações"), "Salvar alterações");

    // O que o Lucas perdia antes: o PATCH da ficha nem era enviado.
    expect(patchDaFicha()?.body).toMatchObject({ campos: { telefone: "(37) 98888-7777" } });
    // E a tela diz as DUAS coisas, sem travessão.
    expect(texto()).toContain("O resto da ficha foi salvo. A identidade não:");
    expect(texto()).toContain("Este documento ja pertence a outra ficha");
    // Continua em edição, com a razão social recusada ainda no campo para o operador decidir.
    expect(botao("Salvar alterações")).toBeDefined();
    expect(caixaDoCampo("Razão social").querySelector("input")?.value).toBe(NOME_CERTO);
  });

  it("⚠️ depois de um 409, o NOME FANTASIA continua no rascunho e vai na segunda tentativa", async () => {
    instalarFetch(COLISAO);
    await abrirEdicaoDaFicha();

    await digitar("Razão social", NOME_CERTO);
    await digitar("Nome fantasia", "CBA TEMPLO NOVO");
    await clicarEm(botao("Salvar alterações"), "Salvar alterações");

    // `nomeFantasia` viaja nas DUAS metades. Podá-lo junto com o resto da ficha congelava
    // `trade_name` no valor antigo para sempre, sem nada na tela dizendo isso.
    expect(caixaDoCampo("Nome fantasia").querySelector("input")?.value).toBe("CBA TEMPLO NOVO");

    chamadas.length = 0;
    await clicarEm(botao("Salvar alterações"), "Salvar alterações");

    expect(pedidoDaIdentidade()?.body).toMatchObject({
      nome: NOME_CERTO,
      nomeFantasia: "CBA TEMPLO NOVO",
    });
  });

  it("⚠️ a RECARGA caindo com HTML não apaga o relato: a tela ainda diz que o telefone salvou", async () => {
    instalarFetch(COLISAO, { recargaFalha: true });
    await abrirEdicaoDaFicha();

    await digitar("Razão social", NOME_CERTO);
    await digitar("Telefone", "(37) 98888-7777");
    await clicarEm(botao("Salvar alterações"), "Salvar alterações");

    // Antes, o `catch` do fim sobrescrevia TUDO com o erro de JSON ("Unexpected token '<'") e o
    // operador não sabia nem que a identidade foi recusada nem que o telefone gravou.
    expect(patchDaFicha()?.body).toMatchObject({ campos: { telefone: "(37) 98888-7777" } });
    expect(texto()).toContain("O resto da ficha foi salvo. A identidade não:");
    expect(texto()).toContain("Este documento ja pertence a outra ficha");
    expect(texto()).toContain("Não foi possível recarregar a ficha");
    expect(texto()).not.toContain("Unexpected token");
  });

  it("⚠️ falha DEPOIS da ficha gravada (motivo `parcial`) não vira \"Nada foi salvo\"", async () => {
    instalarFetch({
      corpo: {
        error: "Identidade gravada, mas o indice de busca falhou: null value in column \"status\"",
        motivo: "parcial",
      },
      status: 500,
    });
    await abrirEdicaoDaFicha();

    await digitar("Razão social", NOME_CERTO);
    await clicarEm(botao("Salvar alterações"), "Salvar alterações");

    // A rota grava `apolo_entities` no passo 5 e só depois pode falhar: "não foi salva" seria o
    // contrário do que a própria mensagem diz.
    expect(texto()).toContain("A identidade não foi confirmada:");
    expect(texto()).toContain("Identidade gravada, mas o indice de busca falhou");
    expect(texto()).not.toContain("Nada foi salvo");
    expect(texto()).not.toContain("A identidade não foi salva");
  });
});
