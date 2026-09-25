// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O LÁPIS E A LIXEIRA EM TODA LINHA DO QUADRO — e o cadeado que saiu.
//
// Lucas (25/09/2026), depois de a tela do VOR mostrar o Fabricio na linha 1 sem ele ir no contrato:
// *"todas assinaturas eu tenho que conseguir excluir e editar, esse cadeado esta errado"*. Até esta
// data o cartão mostrava o representante legal da ficha como linha sem id, com um cadeado "do
// cadastro", e as linhas gravadas só tinham lixeira: corrigir um e-mail era excluir e incluir de
// novo, e a Linha de uma pessoa não mudava depois de gravada.
//
// ⚠️ O QUE ESTE ARQUIVO TRAVA:
//   • toda linha tem lápis e lixeira, tem id, e nenhuma tem cadeado;
//   • o lápis abre a linha no lugar, com os dados dela, e Salvar manda o PATCH com o id; Cancelar
//     (ou Esc) fecha sem gravar, Enter salva;
//   • a recusa do servidor (a linha ocupada) aparece no bloco, com a linha ainda aberta;
//   • nos termos o lápis não oferece Linha nem Assina em, e o PATCH não os manda;
//   • o CPF mascarado do portal volta como veio, para o servidor manter o gravado;
//   • o texto visível não promete herança e não tem travessão.
//
// Mesma montagem manual dos testes vizinhos (`quadro-de-assinatura.*.comportamento.test.tsx`): o
// hub não tem @testing-library, e os dois vizinhos montam com `createRoot` e `act`.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/supabase/client", () => ({
  getHubSupabaseClient: () => null,
  hubSupabaseConfig: { anonKey: "chave-publica", url: "https://projeto.supabase.co" },
}));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: async () => "token-do-hub",
}));

const { QuadroDeAssinaturaCard } = await import(
  "@/modules/apolo/blocks/empreendimentos/quadro-de-assinatura-card"
);

type LinhaDaTela = {
  cpf: null | string;
  email: null | string;
  id: string;
  nome: string;
  ordemAssinatura: null | number;
  origem: null | string;
  papel: string;
  posicao: number;
};

type Chamada = { corpo: null | Record<string, unknown>; method: string; url: string };

const linhaDaTela = (
  id: string,
  papel: string,
  posicao: number,
  nome: string,
  extra: Partial<LinhaDaTela> = {},
): LinhaDaTela => ({
  cpf: null,
  email: `${id.slice(-2)}@exemplo.test`,
  id,
  nome,
  ordemAssinatura: null,
  origem: null,
  papel,
  posicao,
  ...extra,
});

/** O VOR depois da 0191 e do deploy: tudo gravado, a linha 1 do coordenador livre. */
const NIVEA = linhaDaTela("aaaaaaaa-0000-4000-8000-000000000002", "coordenador", 2, "NIVEA EXEMPLO CARELI");
const HUBER = linhaDaTela("aaaaaaaa-0000-4000-8000-000000000003", "coordenador", 3, "HUBER EXEMPLO GURGEL");
const FABRICIO = linhaDaTela(
  "aaaaaaaa-0000-4000-8000-000000000004",
  "coordenador",
  4,
  "FABRICIO EXEMPLO GURGEL",
  { cpf: "529.982.247-25", email: "contrato@fgurgel.com.br", origem: "backfill_heranca_0191" },
);
const VENDEDORA = linhaDaTela("bbbbbbbb-0000-4000-8000-000000000001", "vendedora", 1, "SOCIA EXEMPLO ADMINISTRADORA");
const TESTEMUNHA = linhaDaTela("cccccccc-0000-4000-8000-000000000001", "testemunha", 1, "TESTEMUNHA EXEMPLO SILVA", {
  ordemAssinatura: 9,
});
const APONTADO = linhaDaTela("dddddddd-0000-4000-8000-000000000001", "termos_vendedora", 1, "ANALISTA EXEMPLO JURIDICO");

let assinantes: LinhaDaTela[] = [];
/** A recusa do servidor para a próxima escrita, ou `null` para gravar. */
let recusa: null | { error: string; status: number } = null;
let chamadas: Chamada[];
let raiz: Root;
let hospedeiro: HTMLDivElement;

function instalarFetch() {
  chamadas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      chamadas.push({
        corpo: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
        method,
        url,
      });
      if (method !== "GET" && recusa) {
        const { error, status } = recusa;
        return Promise.resolve(
          new Response(JSON.stringify({ error }), {
            headers: { "content-type": "application/json" },
            status,
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(method === "GET" ? { assinantes } : { ok: true }), {
          headers: { "content-type": "application/json" },
          status: 200,
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

async function montar(comTermos = false) {
  act(() => {
    raiz.render(
      <QuadroDeAssinaturaCard comAssinantesDeTermos={comTermos} enterpriseId="41" />,
    );
  });
  await esperarPromessas();
}

function secao(titulo: string): HTMLElement {
  const achada = Array.from(hospedeiro.querySelectorAll("section")).find(
    (s) => s.querySelector("p")?.textContent?.trim() === titulo,
  );
  expect(achada, `seção "${titulo}" não está na tela`).toBeTruthy();
  return achada as HTMLElement;
}

function botao(dentro: HTMLElement, rotulo: string): HTMLButtonElement | undefined {
  return Array.from(dentro.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.getAttribute("aria-label") === rotulo,
  );
}

async function clicar(alvo: HTMLButtonElement | undefined) {
  expect(alvo).toBeTruthy();
  await act(async () => {
    alvo?.click();
  });
  await esperarPromessas();
}

/** O campo da linha aberta no lápis, pelo `aria-label`. */
function campoDaEdicao(dentro: HTMLElement, rotulo: string): HTMLInputElement | null {
  return dentro.querySelector<HTMLInputElement>(`[data-assinante] input[aria-label="${rotulo}"]`);
}

async function digitar(campo: HTMLInputElement | null, valor: string) {
  expect(campo).toBeTruthy();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(campo, valor);
    campo?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function tecla(campo: HTMLInputElement | null, key: string) {
  expect(campo).toBeTruthy();
  await act(async () => {
    campo?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }));
  });
  await esperarPromessas();
}

const escritas = () => chamadas.filter((c) => c.method !== "GET");

beforeEach(() => {
  assinantes = [VENDEDORA, NIVEA, HUBER, FABRICIO, TESTEMUNHA];
  recusa = null;
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  instalarFetch();
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("toda linha se edita e se exclui", () => {
  it("⚠️ lápis e lixeira em toda linha, e nenhum cadeado", async () => {
    assinantes = [...assinantes, APONTADO];
    await montar(true);

    for (const pessoa of assinantes) {
      expect(hospedeiro.querySelector(`[data-assinante="${pessoa.id}"]`), pessoa.nome).toBeTruthy();
      const rotulos = Array.from(hospedeiro.querySelectorAll("button")).map(
        (b) => b.getAttribute("aria-label") ?? "",
      );
      expect(rotulos).toContain(`Editar ${pessoa.nome}`);
      expect(rotulos).toContain(`Remover ${pessoa.nome}`);
    }
    expect(hospedeiro.querySelector("svg.lucide-lock")).toBeNull();
    expect(hospedeiro.textContent).not.toContain("do cadastro");
  });

  it("nenhuma linha sem id: toda linha da tela carrega o id que o PATCH e o DELETE usam", async () => {
    await montar();

    const linhas = Array.from(hospedeiro.querySelectorAll<HTMLElement>("[data-assinante]"));
    expect(linhas).toHaveLength(assinantes.length);
    expect(linhas.every((l) => (l.dataset.assinante ?? "").length > 0)).toBe(true);
  });

  it("a lixeira manda o DELETE com o id daquela linha", async () => {
    await montar();

    await clicar(botao(secao("Coordenador de Vendas"), `Remover ${HUBER.nome}`));

    expect(escritas()).toEqual([
      { corpo: null, method: "DELETE", url: `/api/temis/assinantes?id=${HUBER.id}` },
    ]);
  });
});

describe("o lápis", () => {
  it("⚠️ abre a linha com os dados dela, e Salvar manda o PATCH com o id (o Fabricio para a linha 1)", async () => {
    await montar();
    const coordenador = secao("Coordenador de Vendas");

    await clicar(botao(coordenador, `Editar ${FABRICIO.nome}`));
    expect(campoDaEdicao(coordenador, "Nome completo")?.value).toBe(FABRICIO.nome);
    expect(campoDaEdicao(coordenador, "E-mail")?.value).toBe("contrato@fgurgel.com.br");
    expect(campoDaEdicao(coordenador, "CPF")?.value).toBe("529.982.247-25");
    expect(campoDaEdicao(coordenador, "Linha")?.value).toBe("4");
    expect(campoDaEdicao(coordenador, "Assina em")?.value).toBe("");

    await digitar(campoDaEdicao(coordenador, "Linha"), "1");
    // O servidor responde e a tela relê: o quadro já vem com o Fabricio na linha 1.
    assinantes = [VENDEDORA, { ...FABRICIO, posicao: 1 }, NIVEA, HUBER, TESTEMUNHA];
    await clicar(botao(coordenador, `Salvar ${FABRICIO.nome}`));

    expect(escritas()).toEqual([
      {
        corpo: {
          cpf: "529.982.247-25",
          email: "contrato@fgurgel.com.br",
          nome: FABRICIO.nome,
          ordemAssinatura: "",
          posicao: "1",
        },
        method: "PATCH",
        url: `/api/temis/assinantes?id=${FABRICIO.id}`,
      },
    ]);
    // Fechou e releu.
    expect(campoDaEdicao(secao("Coordenador de Vendas"), "Linha")).toBeNull();
    expect(chamadas.filter((c) => c.method === "GET")).toHaveLength(2);
    const fabricio = hospedeiro.querySelector(`[data-assinante="${FABRICIO.id}"]`);
    expect(fabricio?.querySelector("span")?.textContent).toBe("1");
  });

  it("Cancelar fecha sem gravar", async () => {
    await montar();
    const coordenador = secao("Coordenador de Vendas");

    await clicar(botao(coordenador, `Editar ${NIVEA.nome}`));
    await digitar(campoDaEdicao(coordenador, "E-mail"), "outro@exemplo.test");
    await clicar(botao(coordenador, "Cancelar edição"));

    expect(escritas()).toEqual([]);
    expect(campoDaEdicao(coordenador, "E-mail")).toBeNull();
    expect(coordenador.textContent).toContain(NIVEA.email);
  });

  it("Enter salva e Esc cancela", async () => {
    await montar();
    const testemunhas = secao("Testemunhas");

    await clicar(botao(testemunhas, `Editar ${TESTEMUNHA.nome}`));
    await tecla(campoDaEdicao(testemunhas, "E-mail"), "Escape");
    expect(campoDaEdicao(testemunhas, "E-mail")).toBeNull();
    expect(escritas()).toEqual([]);

    await clicar(botao(testemunhas, `Editar ${TESTEMUNHA.nome}`));
    await digitar(campoDaEdicao(testemunhas, "Assina em"), "");
    await tecla(campoDaEdicao(testemunhas, "Assina em"), "Enter");

    expect(escritas()).toHaveLength(1);
    expect(escritas()[0]).toMatchObject({
      corpo: { ordemAssinatura: "", posicao: "1" },
      method: "PATCH",
      url: `/api/temis/assinantes?id=${TESTEMUNHA.id}`,
    });
  });

  it("a linha ocupada: a recusa aparece no bloco e a linha continua aberta", async () => {
    recusa = {
      error:
        "A linha 2 de Coordenador de Vendas ja e de NIVEA EXEMPLO CARELI. Cabem varias pessoas neste papel: use outra linha, ou deixe o campo Linha em branco que o quadro numera sozinho.",
      status: 409,
    };
    await montar();
    const coordenador = secao("Coordenador de Vendas");

    await clicar(botao(coordenador, `Editar ${FABRICIO.nome}`));
    await digitar(campoDaEdicao(coordenador, "Linha"), "2");
    await clicar(botao(coordenador, `Salvar ${FABRICIO.nome}`));

    expect(secao("Coordenador de Vendas").textContent).toContain("ja e de NIVEA EXEMPLO CARELI");
    expect(campoDaEdicao(secao("Coordenador de Vendas"), "Linha")?.value).toBe("2");
    // E só o bloco que foi clicado mostra a frase.
    expect(secao("Testemunhas").textContent).not.toContain("NIVEA");
  });
});

describe("o lápis na caixa dos termos", () => {
  it("não oferece Linha nem Assina em, e o PATCH não os manda", async () => {
    assinantes = [...assinantes, APONTADO];
    await montar(true);
    const termos = secao("Assinatura de termos (vendedora)");

    await clicar(botao(termos, `Editar ${APONTADO.nome}`));
    expect(campoDaEdicao(termos, "Linha")).toBeNull();
    expect(campoDaEdicao(termos, "Assina em")).toBeNull();

    await digitar(campoDaEdicao(termos, "E-mail"), "juridico@exemplo.test");
    await clicar(botao(termos, `Salvar ${APONTADO.nome}`));

    expect(escritas()).toEqual([
      {
        corpo: { cpf: "", email: "juridico@exemplo.test", nome: APONTADO.nome },
        method: "PATCH",
        url: `/api/temis/assinantes?id=${APONTADO.id}`,
      },
    ]);
  });
});

describe("o portal", () => {
  // ⚠️ O GET DO PORTAL ENTREGA O CPF MASCARADO. A tela devolve o que mostrou, e o servidor lê o `*`
  // como "manter o gravado" (`editarAssinante`). Se a tela limpasse o campo, o CPF seria apagado.
  it("o CPF mascarado volta como veio quando o operador não mexe nele", async () => {
    assinantes = [{ ...FABRICIO, cpf: "***.***.***-25" }];
    await montar();
    const coordenador = secao("Coordenador de Vendas");

    await clicar(botao(coordenador, `Editar ${FABRICIO.nome}`));
    await digitar(campoDaEdicao(coordenador, "Nome completo"), "FABRICIO EXEMPLO GURGEL NETO");
    await clicar(botao(coordenador, "Salvar FABRICIO EXEMPLO GURGEL"));

    expect(escritas()[0]?.corpo).toMatchObject({
      cpf: "***.***.***-25",
      nome: "FABRICIO EXEMPLO GURGEL NETO",
    });
  });
});

describe("o texto", () => {
  it("não promete herança da ficha e não tem travessão", async () => {
    assinantes = [];
    await montar(true);

    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toContain("já vem preenchido");
    expect(texto).not.toContain("representante legal cadastrado na empresa");
    expect(texto).not.toContain("—");
    expect(secao("Vendedora").textContent).toContain("Quem assina pela empresa vendedora");
  });
});
