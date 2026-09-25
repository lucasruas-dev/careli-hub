// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A TABELA DA MODAL CONTA A MESMA HISTÓRIA QUE O SERVIDOR VAI GRAVAR.
//
// Nívea (24/09/2026), sobre a proposta 000038 (Vale do Ouro VOC, Quadra 12 · Lote 22, compradora
// TAISA FERNANDA BATISTA): *"Na proposta não está saindo o novo cenário de juros e correção."*
//
// ⚠️ AFIRMAÇÃO EM CAIXA ALTA: A TELA DESMENTIA A ESCOLHA DELA ANTES DO PDF. A tabela "Reajuste da
// parcela" da modal — o painel do print — montava o cronograma com o plano do CADASTRO, e por isso
// mostrava "1 a 12 R$ 2.595,00; 13 a 24 R$ 2.719,84 + IPCA; 25 a 36 R$ 2.964,61 + IPCA; 37 a 48
// R$ 3.231,41 + IPCA" embaixo de um resumo que dizia "sem juros, com poupança anual". Medido no
// banco em 25/09/2026, a proposta 000038 tem exatamente esses quatro degraus gravados em
// `condicoes.reajustes`.
//
// ⚠️ E O R$ 2.595,00 ERA O ÚNICO NÚMERO CERTO: no SACOC o primeiro ciclo é amortização pura, e
// 124.560 ÷ 48 = 2.595,00 com ou sem juros. Do 13º mês em diante os dois cenários se separam — foi
// isso que fez a conferência da corretora passar.
//
// ⚠️ ESTE ARQUIVO MEDE OS DOIS LADOS DA MODAL: o que ela DESENHA (a tabela) e o que ela MANDA (o
// corpo do POST). Um servidor consertado que recebe um corpo sem os valores continua gravando pelo
// cadastro, e uma tela que manda tudo certo e desenha outra coisa é o mesmo defeito espelhado.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixo = vi.hoisted(() => {
  const daqui30Dias = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return {
    /** As condições da 000038, como o simulador as entrega. Cada teste troca o que precisa. */
    condicoes: {
      ajuste: null,
      anuaisQuantidade: 0,
      anuaisValor: 0,
      bensEPermutas: null,
      descontoDoPlanoPercentual: 0,
      diaDeVencimento: 20,
      entradaDatas: null,
      entradaParcelas: null,
      entradaValor: 13_841,
      entradaVezes: 3,
      indiceEscolhido: null as null | string,
      jurosEscolhido: null as null | number,
      parcela: 2_595,
      parcelasMensais: 48,
      premissaAlterada: false,
      planoId: "21b694ed-13d7-47ef-a983-bb09145b79c7",
      planoNome: "NORMAL",
      primeiraParcelaEm: daqui30Dias,
      valorNegociado: 138_401,
    } as Record<string, unknown>,
    daqui30Dias,
  };
});

// ⚠️ O SIMULADOR É DUBLÊ, mas ele RENDERIZA A PRÉVIA — é dentro dela que mora a tabela "Reajuste da
// parcela", e é ela que este teste lê. O que o simulador de VERDADE entrega em `aoMudarCondicoes`
// (incluindo os dois campos novos) é medido em `SimuladorDeProposta.premissa-escolhida`.
vi.mock("./SimuladorDeProposta", async () => {
  const react = await import("react");
  return {
    SimuladorDeProposta: ({
      aoMudarCondicoes,
      previa,
    }: {
      aoMudarCondicoes?: (condicoes: unknown) => void;
      previa?: React.ReactNode;
    }) => {
      react.useEffect(() => {
        aoMudarCondicoes?.(fixo.condicoes);
      }, [aoMudarCondicoes]);
      return react.createElement("div", { "data-teste": "simulador" }, previa);
    },
  };
});

const { ModalDeProposta } = await import("./ModalDeProposta");

const CPF_DO_TITULAR = "52998224725";

/** O plano NORMAL do VOC, como o banco o tem (SELECT de 25/09/2026): 156x, 0,7207% a.m., IPCA anual. */
const NORMAL = {
  entradaPercentual: 10,
  id: "21b694ed-13d7-47ef-a983-bb09145b79c7",
  indiceCorrecao: "IPCA_ANUAL",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "mensal",
  jurosTaxa: 0.7207,
  nome: "NORMAL",
  parcelas: 156,
  sistemaAmortizacao: "sacoc",
  slot: null,
};

/** A faixa de 1 a 24 do VOC: juros zero e sem correção, cadastro aprovado pela diretoria. */
const FAIXA_CURTA = {
  defineEntrada: true,
  defineIndice: true,
  defineJuros: true,
  entradaPercentual: 10,
  indiceCorrecao: "SEM_CORRECAO",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "mensal",
  jurosTaxa: 0,
  parcelaMaxima: 24,
  parcelaMinima: 1,
};

let faixasDoPortao: Array<Record<string, unknown>> = [];

const portao = () => ({
  credenciamento: { credenciado: true, desde: "2026-01-10", etapa: null, motivo: null },
  entradaMinimaPercentual: 10,
  faixasDePrazo: faixasDoPortao,
  planos: [NORMAL],
  reserva: {
    codigo: "RES-0038",
    corretor: { id: "c1", nome: "Corretor Teste" },
    criadoEm: "2026-09-20T12:00:00.000Z",
    id: "reserva-1",
    imobiliaria: { id: "i1", nome: "Imobiliária Teste" },
    titular: { cpf: CPF_DO_TITULAR, nome: "TAISA FERNANDA BATISTA", telefone: "37991234567" },
    validadeEm: null,
  },
  unidade: {
    enterpriseId: "37",
    id: "unidade-1",
    nome: "Quadra 12 · Lote 22",
    preco: 148_401,
    produto: "Vale do Ouro",
  },
});

const unidade = { id: "unidade-1", nome: "Quadra 12 · Lote 22", produto: "Vale do Ouro" };

let alvo: HTMLDivElement;
let raiz: Root;
/** O corpo cru de cada POST que a modal disparou. */
let enviados: string[] = [];

function clicar(elemento: Element) {
  act(() => {
    elemento.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function botao(texto: string): HTMLButtonElement {
  const achado = [...alvo.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto);
  if (!achado) throw new Error(`Botão "${texto}" não está na tela.`);
  return achado;
}

function digitar(campo: HTMLTextAreaElement, texto: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      campo,
      texto,
    );
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function abrirNasCondicoes() {
  await act(async () => {
    raiz.render(<ModalDeProposta onFechar={vi.fn()} onGerada={vi.fn()} unidade={unidade} />);
  });
  clicar(botao("Montar as condições"));
  await act(async () => {
    await Promise.resolve();
  });
}

/** As linhas da tabela de reajuste, como "1 a 12 · R$ 2.595,00 + IPCA anual". */
function linhasDoReajuste(): string[] {
  // ⚠️ A TABELA DO REAJUSTE, E NÃO A PRIMEIRA DA PRÉVIA: a primeira é a da ENTRADA ("1 de 3 ·
  // 25/10/2026 · R$ 4.613,68"). A do reajuste é a que tem a coluna "Período".
  const tabela = [...alvo.querySelectorAll("table")].find((t) =>
    t.querySelector("thead")?.textContent?.includes("Período"),
  );
  if (!tabela) throw new Error('A tabela de reajuste não está na tela.');
  return [...tabela.querySelectorAll("tbody tr")].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => td.textContent?.trim() ?? "").join(" · "),
  );
}

beforeEach(() => {
  alvo = document.createElement("div");
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
  enviados = [];
  faixasDoPortao = [];
  fixo.condicoes.indiceEscolhido = null;
  fixo.condicoes.jurosEscolhido = null;
  fixo.condicoes.premissaAlterada = false;
  fixo.condicoes.parcelasMensais = 48;
  fixo.condicoes.entradaValor = 13_841;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, opcoes?: { body?: string; method?: string }) => {
      if (opcoes?.method === "POST") {
        enviados.push(String(opcoes.body ?? ""));
        return { ok: true, text: async () => JSON.stringify({ data: { avisos: [], codigo: "PRP-38" } }) };
      }
      return { ok: true, text: async () => JSON.stringify({ data: portao() }) };
    }),
  );
});

afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
  vi.unstubAllGlobals();
});

describe("a tabela de reajuste segue a premissa escolhida", () => {
  // ⚠️ A REGRESSÃO A PROTEGER, E ELA É O PRINT DA NÍVEA: sem alteração nenhuma, a tabela continua
  // exatamente como está hoje — quatro degraus, com o IPCA do cadastro.
  it("sem alteração, a tabela continua mostrando os quatro degraus com IPCA", async () => {
    await abrirNasCondicoes();

    expect(alvo.textContent).toContain("Reajuste da parcela");
    expect(linhasDoReajuste()).toEqual([
      "1º ano · 1 a 12 · R$ 2.595,00",
      "2º ano · 13 a 24 · R$ 2.719,84 + IPCA anual",
      "3º ano · 25 a 36 · R$ 2.964,61 + IPCA anual",
      "4º ano · 37 a 48 · R$ 3.231,41 + IPCA anual",
    ]);
  });

  // ⚠️ O CENÁRIO DA 000038. Com os juros zerados não há degrau nenhum: a parcela é a mesma do
  // primeiro ao último mês, e a tabela tem de dizer isso em UMA linha.
  it("⚠️ juros zerado: uma faixa só, para todo o contrato, e sem sufixo de índice", async () => {
    fixo.condicoes.jurosEscolhido = 0;
    fixo.condicoes.premissaAlterada = true;
    await abrirNasCondicoes();

    expect(linhasDoReajuste()).toEqual(["Todo o contrato · 1 a 48 · R$ 2.595,00"]);
    expect(alvo.textContent).not.toContain("IPCA");
  });

  // ⚠️ E O ÍNDICE É O ESCOLHIDO, NÃO O DO CADASTRO. Trocar só a correção mantém os degraus (os juros
  // continuam), e o sufixo passa a dizer poupança.
  it("⚠️ correção trocada para poupança: o sufixo diz poupança, e não IPCA", async () => {
    fixo.condicoes.indiceEscolhido = "POUPANCA";
    fixo.condicoes.premissaAlterada = true;
    await abrirNasCondicoes();

    const linhas = linhasDoReajuste();
    expect(linhas).toHaveLength(4);
    expect(linhas[1]).toContain("poupança anual");
    expect(alvo.textContent).not.toContain("IPCA");
  });

  // ⚠️ A FAIXA DE PRAZO TAMBÉM CHEGA À MODAL, e com os MESMOS argumentos que a rota usa. Duas
  // composições diferentes para a mesma venda é exatamente como este defeito começou.
  it("⚠️ a faixa de 1 a 24 do VOC isenta os juros, e a tabela mostra a isenção", async () => {
    faixasDoPortao = [FAIXA_CURTA];
    fixo.condicoes.parcelasMensais = 24;
    fixo.condicoes.entradaValor = 13_841;
    await abrirNasCondicoes();

    expect(linhasDoReajuste()).toEqual(["Todo o contrato · 1 a 24 · R$ 5.190,00"]);
    expect(alvo.textContent).not.toContain("IPCA");
  });
});

describe("o corpo do POST leva a premissa escolhida", () => {
  it("⚠️ com condição alterada, os dois valores viajam", async () => {
    fixo.condicoes.indiceEscolhido = "POUPANCA";
    fixo.condicoes.jurosEscolhido = 0;
    fixo.condicoes.premissaAlterada = true;
    await abrirNasCondicoes();
    // Premissa alterada PEDE a nota — é o preço de poder mexer (Lucas, 13/09/2026).
    digitar(
      alvo.querySelector<HTMLTextAreaElement>("#nota-do-ajuste") as HTMLTextAreaElement,
      "Sem juros e poupança, combinado com o Loteador.",
    );
    await act(async () => {
      clicar(botao("Gerar proposta"));
    });

    const corpo = JSON.parse(enviados[0] ?? "{}") as Record<string, unknown>;
    expect(corpo.jurosEscolhido).toBe(0);
    expect(corpo.indiceEscolhido).toBe("POUPANCA");
  });

  // ⚠️ SEM ALTERAÇÃO, NENHUM DOS DOIS APARECE — e a ausência é o que o servidor lê como "não mexi".
  // Mandar `jurosEscolhido: null` em toda proposta seria pedir ao servidor para distinguir nulo de
  // ausente em cada leitura futura, e é assim que "sem juros" vira o padrão de alguém distraído.
  it("sem alteração, nenhum dos dois campos entra no corpo", async () => {
    await abrirNasCondicoes();
    await act(async () => {
      clicar(botao("Gerar proposta"));
    });

    const corpo = JSON.parse(enviados[0] ?? "{}") as Record<string, unknown>;
    expect("jurosEscolhido" in corpo).toBe(false);
    expect("indiceEscolhido" in corpo).toBe(false);
  });
});
