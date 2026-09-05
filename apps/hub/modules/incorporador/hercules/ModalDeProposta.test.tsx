// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// OS TRÊS DEFEITOS DA MODAL DE PROPOSTA, TRAVADOS.
//
// ⚠️ POR QUE UM TESTE DE TELA, E NÃO DE LIB. Os três são de COMPORTAMENTO da modal, e nenhum
// aparece numa função pura: um é a árvore que troca de ramo e mata o simulador, outro é a régua que
// falta antes de a lista de compradores existir, o terceiro é um ouvinte de teclado que dispara no
// meio de um POST. Testar a lib de baixo passaria nos três com o bug em pé.
//
// ⚠️ ESTE É O PRIMEIRO TESTE DE COMPONENTE DO REPO, e por isso ele monta o React na mão. Duas
// ginásticas explicam o que parece firula:
//
//  1. `globalThis.React` — o vitest.config não tem plugin de React, então o esbuild compila o JSX
//     no formato CLÁSSICO (`React.createElement`) e nenhum arquivo do app importa `React` por nome.
//     Publicar o namespace no global é o que faz o componente real renderizar sem tocar na config
//     compartilhada (mexer nela mudaria a compilação de TODOS os testes do hub).
//  2. `IS_REACT_ACT_ENVIRONMENT` — sem ele o `act` avisa a cada render que o ambiente não o suporta.
//
// ⚠️ O SIMULADOR É DUBLÊ, DE PROPÓSITO. O de verdade tem cockpit, planos e composições próprias;
// aqui o que importa é UMA coisa: ele tem estado local, e esse estado tem que sobreviver ao
// "Voltar". O dublê é um campo de texto com `useState` — se a modal desmontar o filho, o campo
// volta vazio, que é exatamente o defeito.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Os dados fixos precisam existir ANTES dos imports, porque a fábrica do `vi.mock` roda na hora em
 * que o módulo mockado é importado — antes do corpo deste arquivo. Sem `vi.hoisted` a constante
 * ainda estaria na zona morta e o dublê explodiria ao montar.
 */
const fixo = vi.hoisted(() => {
  const daqui30Dias = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return {
    condicoes: {
      anuaisQuantidade: 0,
      anuaisValor: 0,
      diaDeVencimento: 10,
      entradaValor: 20_000,
      entradaVezes: 2,
      parcela: 1_000,
      parcelasMensais: 120,
      planoNome: "PRICE 120x",
      primeiraParcelaEm: daqui30Dias,
      valorNegociado: 200_000,
    },
    daqui30Dias,
  };
});

vi.mock("./SimuladorDeProposta", async () => {
  const react = await import("react");
  return {
    SimuladorDeProposta: ({
      aoMudarCondicoes,
    }: {
      aoMudarCondicoes?: (condicoes: unknown) => void;
    }) => {
      const [rascunho, setRascunho] = react.useState("");
      react.useEffect(() => {
        aoMudarCondicoes?.(fixo.condicoes);
      }, [aoMudarCondicoes]);
      return react.createElement("input", {
        "data-teste": "rascunho-do-simulador",
        onChange: (e: { target: { value: string } }) => setRascunho(e.target.value),
        value: rascunho,
      });
    },
  };
});

// ⚠️ SÓ `montarCronograma` É DUBLÊ, E O RESTO DO MÓDULO É O DE VERDADE. Ele é o motor de
// amortização inteiro e tem os próprios testes (`cronograma.test.ts`); aqui só precisa devolver uma
// série qualquer para o botão "Gerar proposta" deixar de ser impossível. O `importOriginal` não é
// capricho: `proposta-na-tela.ts` importa `repartirEmPartesIguais` daqui, e um mock cego derruba a
// divisão de participações — que é justamente o que o portão faz ao adicionar proponente.
vi.mock("@/lib/hercules/cronograma", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  montarCronograma: () => ({
    anuais: [],
    entrada: [
      { numero: 1, total: 2, valor: 10_000, vencimento: fixo.daqui30Dias },
      { numero: 2, total: 2, valor: 10_000, vencimento: fixo.daqui30Dias },
    ],
    mensais: [{ numero: 1, total: 120, valor: 1_000, vencimento: fixo.daqui30Dias }],
    reajustes: [
      {
        ate: fixo.daqui30Dias,
        ciclo: 1,
        de: fixo.daqui30Dias,
        parcelaFinal: 120,
        parcelaInicial: 1,
        temIpca: false,
        valor: 1_000,
      },
    ],
    totais: {
      anuais: 0,
      entrada: 20_000,
      financiado: 180_000,
      geral: 200_000,
      mensais: 180_000,
    },
  }),
}));

const { ModalDeProposta } = await import("./ModalDeProposta");

/** O CPF do titular, cru como o GET entrega. Válido de verdade — `cpfValido` confere o dígito. */
const CPF_DO_TITULAR = "52998224725";
/** Outro CPF válido, o da esposa que o coordenador deveria ter digitado. */
const CPF_DA_ESPOSA = "11144477735";

const portao = {
  credenciamento: { credenciado: true, desde: "2026-01-10", etapa: null, motivo: null },
  entradaMinimaPercentual: 10,
  planos: [
    {
      entradaPercentual: 10,
      indiceCorrecao: "IPCA",
      jurosConvencao: "nominal",
      jurosPeriodicidade: "mensal",
      jurosTaxa: 0.008,
      nome: "PRICE 120x",
      parcelas: 120,
      sistemaAmortizacao: "PRICE",
      slot: null,
    },
  ],
  reserva: {
    codigo: "RES-0001",
    corretor: { id: "c1", nome: "Corretor Teste" },
    criadoEm: "2026-09-01T12:00:00.000Z",
    id: "reserva-1",
    imobiliaria: { id: "i1", nome: "Imobiliária Teste" },
    titular: { cpf: CPF_DO_TITULAR, nome: "João da Silva", telefone: "62999990000" },
    validadeEm: null,
  },
  unidade: {
    enterpriseId: "emp-1",
    id: "unidade-1",
    nome: "Q1 L2",
    preco: 200_000,
    produto: "Garden",
  },
};

const unidade = { id: "unidade-1", nome: "Q1 L2", produto: "Garden" };

let alvo: HTMLDivElement;
let raiz: Root;

/** Responde ao GET do portão; o POST cada teste arma como precisa. */
function fetchDoPortao(aoPostar?: () => Promise<{ corpo: string; ok: boolean }>) {
  return vi.fn(async (_url: string, opcoes?: { method?: string }) => {
    if (opcoes?.method === "POST") {
      const r = aoPostar
        ? await aoPostar()
        : { corpo: JSON.stringify({ data: { avisos: [], codigo: "PRP-1" } }), ok: true };
      return { ok: r.ok, text: async () => r.corpo };
    }
    return { ok: true, text: async () => JSON.stringify({ data: portao }) };
  });
}

/** O clique como o React o recebe: evento borbulhando até a raiz, dentro de `act`. */
function clicar(elemento: Element) {
  act(() => {
    elemento.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/**
 * Digitar num `input` controlado do React.
 *
 * ⚠️ O `value` VAI PELO SETTER NATIVO. Atribuir `input.value = "x"` direto faz o React não perceber
 * a mudança (ele guarda o último valor no nó) e o `onChange` roda com o texto velho.
 */
function digitar(input: HTMLInputElement, valor: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  act(() => {
    setter?.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function botao(texto: string): HTMLButtonElement {
  const achado = [...alvo.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  );
  if (!achado) throw new Error(`Botão "${texto}" não está na tela.`);
  return achado;
}

function campoDoSimulador(): HTMLInputElement | null {
  return alvo.querySelector<HTMLInputElement>('[data-teste="rascunho-do-simulador"]');
}

/** Monta a modal e espera o GET do portão pousar. */
async function abrir(aoFechar = vi.fn(), aoGerar = vi.fn()) {
  await act(async () => {
    raiz.render(<ModalDeProposta onFechar={aoFechar} onGerada={aoGerar} unidade={unidade} />);
  });
  return { aoFechar, aoGerar };
}

beforeEach(() => {
  alvo = document.createElement("div");
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
  vi.stubGlobal("fetch", fetchDoPortao());
});

afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
  vi.unstubAllGlobals();
});

describe("voltar ao portão", () => {
  it("guarda a montagem: o simulador não é desmontado, é escondido", async () => {
    await abrir();

    clicar(botao("Montar as condições"));
    const campo = campoDoSimulador();
    expect(campo).not.toBeNull();
    digitar(campo as HTMLInputElement, "condição montada em dez minutos");

    clicar(botao("Voltar"));

    // ⚠️ O NÓ TEM QUE SER O MESMO. Se a modal trocasse de ramo, aqui viria `null` (desmontado) ou
    // um `<input>` novo e vazio — e com ele iriam plano, valor negociado, entrada, vezes, prazo,
    // reforços, dia de vencimento e a data da primeira parcela.
    expect(campoDoSimulador()).toBe(campo);
    expect((campo as HTMLInputElement).value).toBe("condição montada em dez minutos");
    // Escondido, e não removido: o portão é quem está à vista.
    expect(alvo.textContent).toContain("O cliente da reserva");

    clicar(botao("Montar as condições"));
    expect(campoDoSimulador()).toBe(campo);
    expect((campo as HTMLInputElement).value).toBe("condição montada em dez minutos");
  });

  it("não monta o simulador antes de o portão liberar", async () => {
    await abrir();

    // Antes do primeiro "Montar as condições" ele nem existe — nada de rodar os efeitos do
    // simulador por trás de um portão que ainda pode recusar a CAD.
    expect(campoDoSimulador()).toBeNull();
  });
});

describe("adicionar proponente", () => {
  async function preencherProponente(nome: string, cpf: string) {
    const nomeInput = alvo.querySelector<HTMLInputElement>('input[placeholder="Nome completo"]');
    const cpfInput = alvo.querySelector<HTMLInputElement>('input[placeholder="CPF"]');
    digitar(nomeInput as HTMLInputElement, nome);
    digitar(cpfInput as HTMLInputElement, cpf);
    clicar(botao("Adicionar"));
  }

  it("recusa o CPF que já está na lista, mesmo formatado diferente", async () => {
    await abrir();

    // O cenário real: a reserva é do João, o coordenador vai adicionar a esposa e cola o CPF do
    // próprio João — formatado, porque o campo formata enquanto ele digita.
    await preencherProponente("Maria da Silva", "529.982.247-25");

    expect(alvo.textContent).toContain("Este CPF já está entre os compradores.");
    // Sem a régua, a lista ficaria "João 50% / João 50%", somando 100% redondos, e o PDF sairia
    // com o mesmo comprador duas vezes.
    expect(alvo.textContent).not.toContain("Maria da Silva");
    expect(alvo.textContent).toContain("100%");
  });

  it("recusa CPF que não passa no dígito verificador", async () => {
    await abrir();

    await preencherProponente("Maria da Silva", "111.111.111-11");

    expect(alvo.textContent).toContain("CPF inválido. Confira os números antes de adicionar.");
    expect(alvo.textContent).not.toContain("Maria da Silva");
  });

  it("aceita o proponente novo com CPF válido e divide a participação", async () => {
    await abrir();

    await preencherProponente("Maria de Souza", CPF_DA_ESPOSA);

    expect(alvo.textContent).toContain("Maria de Souza");
    expect(alvo.textContent).toContain("Soma 100%");
  });
});

describe("enquanto a proposta está sendo enviada", () => {
  it("o Escape não fecha a modal", async () => {
    let soltarOPost: (() => void) | null = null;
    const post = new Promise<{ corpo: string; ok: boolean }>((resolva) => {
      soltarOPost = () =>
        resolva({
          corpo: JSON.stringify({
            data: { avisos: [{ ok: true, para: "coordenador" }], codigo: "PRP-77" },
          }),
          ok: true,
        });
    });
    vi.stubGlobal("fetch", fetchDoPortao(() => post));

    const { aoFechar, aoGerar } = await abrir();
    clicar(botao("Montar as condições"));
    clicar(botao("Gerar proposta"));

    // O POST está no ar: a tela avisa, e o Esc não vale.
    expect(alvo.textContent).toContain("Não feche esta janela");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    // ⚠️ FECHAR AQUI ERA O ESTRAGO: o POST não é cancelado, a proposta grava, a reserva vira
    // proposta e os três WhatsApps saem — mas `onGerada` nunca roda, ninguém avisa o coordenador,
    // e ele clica de novo.
    expect(aoFechar).not.toHaveBeenCalled();
    expect(botao("Fechar").disabled).toBe(true);

    await act(async () => {
      soltarOPost?.();
      await post;
    });

    expect(aoGerar).toHaveBeenCalledTimes(1);
    expect(aoGerar.mock.calls[0]?.[0]).toContain("PRP-77");

    // Terminado o envio, a tecla volta a valer.
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(aoFechar).toHaveBeenCalledTimes(1);
  });
});
