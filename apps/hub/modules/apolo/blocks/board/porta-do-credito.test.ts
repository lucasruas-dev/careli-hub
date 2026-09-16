import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  API_DO_CREDITO_NO_HUB,
  BASE_DO_BOARD_NO_HUB,
  ehPortaDoPortal,
  rotasDoCredito,
  rotuloDaColuna,
  vocabularioDoCredito,
} from "./porta-do-credito";

// A ANÁLISE DE CRÉDITO DO BOARD POR PORTA (16/09/2026). Decisão do Lucas: *"A Cecílio, no portal"* faz
// o crédito dos clientes dela. O que se trava aqui: o hub chama exatamente as URLs de antes e fala
// como sempre falou; o portal troca só a base (com o `emp` e a ficha no endereço).

const PORTAL = { base: "/api/incorporador/board", query: "emp=pai%3Agarden", semToken: true };

describe("rotasDoCredito", () => {
  it("hub: as URLs de sempre (o GET com ?entityId=, os POSTs sem query)", () => {
    const rotas = rotasDoCredito(API_DO_CREDITO_NO_HUB);
    expect(rotas.situacao("e 1")).toBe("/api/apolo/serasa/consultar?entityId=e%201");
    expect(rotas.consultar("e 1")).toBe("/api/apolo/serasa/consultar");
    expect(rotas.aprovarRestricao("e 1")).toBe("/api/apolo/serasa/aprovar-restricao");
  });

  it("portal: a ficha no endereço e o emp em toda chamada", () => {
    const rotas = rotasDoCredito(PORTAL);
    expect(rotas.situacao("e/1")).toBe(
      "/api/incorporador/board/e%2F1/serasa/consultar?emp=pai%3Agarden",
    );
    expect(rotas.consultar("e/1")).toBe(
      "/api/incorporador/board/e%2F1/serasa/consultar?emp=pai%3Agarden",
    );
    expect(rotas.aprovarRestricao("e/1")).toBe(
      "/api/incorporador/board/e%2F1/serasa/aprovar-restricao?emp=pai%3Agarden",
    );
  });

  it("portal sem query: a rota sem interrogação sobrando", () => {
    expect(rotasDoCredito({ ...PORTAL, query: undefined }).consultar("e1")).toBe(
      "/api/incorporador/board/e1/serasa/consultar",
    );
  });

  it("a porta é a do portal por qualquer base que não seja a do hub", () => {
    expect(ehPortaDoPortal(API_DO_CREDITO_NO_HUB)).toBe(false);
    expect(ehPortaDoPortal({ base: BASE_DO_BOARD_NO_HUB, semToken: true })).toBe(false);
    expect(ehPortaDoPortal(PORTAL)).toBe(true);
  });
});

describe("vocabularioDoCredito e rotuloDaColuna", () => {
  it("hub e comercial: as palavras de sempre, com a coordenação", () => {
    const v = vocabularioDoCredito(false);
    expect(v.indeferido).toBe("Crédito indeferido");
    expect(v.aguardandoDecisao).toBe("Aguardando o coordenador");
    expect(v.aprovarComRestricao).toBe("Aprovar com restrição (coordenação)");
    expect(v.eventoAprovadoComRestricao).toBe("Crédito aprovado com restrição pela coordenação");
    expect(v.indeferirTitulo).toBe("Indeferir crédito");
    expect(v.reprovadoAguardando).toBe("Crédito reprovado: aguardando a coordenação");
  });

  it("portal que opera sozinho: sem a coordenação da Careli, e a CAD é quem é indeferida", () => {
    const v = vocabularioDoCredito(true);
    expect(v.indeferido).toBe("CAD indeferida");
    expect(Object.values(v).join(" ")).not.toMatch(/coordena/i);
  });

  it("nenhum texto usa travessão", () => {
    for (const v of [vocabularioDoCredito(false), vocabularioDoCredito(true)]) {
      expect(Object.values(v).join(" ")).not.toMatch(/[—–]/);
    }
  });

  it("a coluna indeferido da CAD muda por porta; a da imobiliária e as outras não", () => {
    const indeferido = { id: "indeferido", label: "Crédito indeferido" };
    expect(rotuloDaColuna(indeferido, { imob: false, operaSozinho: false })).toBe("Crédito indeferido");
    expect(rotuloDaColuna(indeferido, { imob: false, operaSozinho: true })).toBe("CAD indeferida");
    expect(
      rotuloDaColuna({ id: "indeferido", label: "Recusada" }, { imob: true, operaSozinho: true }),
    ).toBe("Recusada");
    expect(
      rotuloDaColuna({ id: "revisao", label: "Crédito em revisão" }, { imob: false, operaSozinho: true }),
    ).toBe("Crédito em revisão");
  });
});

// AS AMARRAS NA TELA. A régua acima só vale se o Board e o painel do Serasa passarem por ela: uma
// URL fixa de volta no componente mandaria o portal para a rota do hub (401 sem Bearer) ou, pior, o
// hub para a do portal.
describe("as amarras no board-view e no credito-serasa", () => {
  const ler = (arquivo: string) => readFileSync(join(__dirname, arquivo), "utf8");

  it("nenhum dos dois chama consultar ou aprovar-restricao por URL fixa", () => {
    for (const arquivo of ["board-view.tsx", "credito-serasa.tsx"]) {
      const texto = ler(arquivo);
      expect(texto).not.toMatch(/["'`]\/api\/apolo\/serasa\/consultar/);
      expect(texto).not.toMatch(/["'`]\/api\/apolo\/serasa\/aprovar-restricao/);
    }
  });

  it("a aprovação com restrição vai pela base e pelos cabeçalhos da porta", () => {
    const board = ler("board-view.tsx");
    const trecho = board.slice(board.indexOf("const aprovarComRestricao = async"));
    const fim = trecho.indexOf("const carregarFila");
    const corpo = trecho.slice(0, fim);
    expect(corpo).toMatch(/fetch\(rotasDoCredito\(porta\.api\)\.aprovarRestricao\(itemId\)/);
    expect(corpo).toMatch(/headers: await cabecalhosDoBoard\(porta\.api,/);
    expect(corpo).not.toMatch(/getApoloAccessToken/);
  });

  // (revisão de 16/09/2026) E remonta por ficha (`key`): o detalhe não remonta no Anterior/Próximo, e
  // sem a chave o recado e o erro da ficha anterior ficavam na tela da seguinte.
  it("o painel do Serasa recebe a porta do Board e remonta a cada ficha", () => {
    expect(ler("board-view.tsx")).toMatch(
      /<CreditoSerasa api=\{api\} entityId=\{entityId\} key=\{entityId\} onResultado=\{onCreditoResultado\} \/>/,
    );
  });

  it("a base do hub é uma só: o board-view usa a da régua", () => {
    expect(ler("board-view.tsx")).toMatch(
      /const API_PADRAO: BoardApi = \{ base: BASE_DO_BOARD_NO_HUB, semToken: false \};/,
    );
  });
});
