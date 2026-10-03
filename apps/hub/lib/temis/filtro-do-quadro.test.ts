import { describe, expect, it } from "vitest";

import {
  type CardParaFiltrar,
  empreendimentosDosCards,
  FILTROS_VAZIOS,
  filtrosQueValem,
  lerPreferencias,
  ordenarCards,
  passaNosFiltros,
  pesquisaCasa,
  quantosFiltrosLigados,
  separarUnidade,
  temCompradorPendente,
} from "./filtro-do-quadro";

// PESQUISA, FILTROS E ORDEM DO QUADRO DA TÊMIS (03/10/2026). Lucas: *"preciso de um prompt para tela
// da temis ter ordenação, filtro, pesquisa"*.

/** Sexta, 02/10/2026, meio da tarde em Brasília. */
const AGORA = new Date("2026-10-02T18:00:00Z");

const card = (parcial: Partial<CardParaFiltrar> = {}): CardParaFiltrar => ({
  atividadesFeitas: [],
  clienteCpf: "12345678901",
  clienteNome: "Ândrea Conceição Lima",
  criadoEm: "2026-10-01T12:00:00Z",
  empreendimentoCodigo: "VOL",
  empreendimentoNome: "Vale do Ouro",
  estagio: "analise",
  // Entrou hoje: dentro do prazo.
  estagioDesde: "2026-10-02T17:00:00Z",
  operadoPor: null,
  tipo: "contrato",
  unidade: "Quadra 11 · Lote 02",
  ...parcial,
});

/** Na análise desde 21/09, sem nada marcado: o relógio vermelho. */
const vencido = (parcial: Partial<CardParaFiltrar> = {}) => card({ estagioDesde: "2026-09-21T12:00:00Z", ...parcial });

describe("pesquisaCasa", () => {
  it("vazia, ou só espaço, casa com tudo", () => {
    expect(pesquisaCasa(card(), "")).toBe(true);
    expect(pesquisaCasa(card(), "   ")).toBe(true);
  });

  it("nome sem diferença de acento nem de maiúscula, palavra por palavra", () => {
    expect(pesquisaCasa(card(), "andrea")).toBe(true);
    expect(pesquisaCasa(card(), "ANDREA lima")).toBe(true);
    expect(pesquisaCasa(card(), "conceicao")).toBe(true);
    expect(pesquisaCasa(card(), "andrea souza")).toBe(false);
  });

  it("o acento da pesquisa também não importa", () => {
    expect(pesquisaCasa(card({ clienteNome: "Andrea Lima" }), "Ândrea")).toBe(true);
  });

  it("CPF com e sem pontuação, inteiro ou o começo", () => {
    expect(pesquisaCasa(card(), "123.456.789-01")).toBe(true);
    expect(pesquisaCasa(card(), "12345678901")).toBe(true);
    expect(pesquisaCasa(card(), "123.456")).toBe(true);
    expect(pesquisaCasa(card(), "999.888.777-66")).toBe(false);
  });

  it("o CPF gravado com pontuação também acha", () => {
    expect(pesquisaCasa(card({ clienteCpf: "123.456.789-01" }), "12345678901")).toBe(true);
  });

  it("card sem CPF não quebra", () => {
    expect(pesquisaCasa(card({ clienteCpf: null }), "123456")).toBe(false);
  });

  it("empreendimento pela sigla ou pelo nome", () => {
    expect(pesquisaCasa(card(), "VOL")).toBe(true);
    expect(pesquisaCasa(card(), "vale do ouro")).toBe(true);
    expect(pesquisaCasa(card(), "lagoa")).toBe(false);
  });

  it("a categoria também conta", () => {
    expect(pesquisaCasa(card({ categoriaNome: "Condomínio" }), "condominio")).toBe(true);
  });

  it.each(["q11 l02", "quadra 11 lote 2", "Q11L02", "Quadra 11 · Lote 02", "qd 11 lt 02", "Q 11 L 2"])(
    "a unidade em várias escritas: %s",
    (escrita) => {
      expect(pesquisaCasa(card(), escrita)).toBe(true);
    },
  );

  it("⚠️ o número vale inteiro: Lote 02 não acha Lote 20, nem Quadra 1 acha Quadra 11", () => {
    expect(pesquisaCasa(card({ unidade: "Quadra 11 · Lote 20" }), "q11 l02")).toBe(false);
    expect(pesquisaCasa(card(), "q1")).toBe(false);
  });

  it("quadra com letra: 'Quadra C03' acha por qc3 e por quadra c03", () => {
    const c = card({ unidade: "Quadra C03 · Lote 07" });
    expect(pesquisaCasa(c, "qc3")).toBe(true);
    expect(pesquisaCasa(c, "quadra c03 lote 7")).toBe(true);
    expect(pesquisaCasa(c, "q3")).toBe(false);
  });

  it("unidade e nome juntos se somam", () => {
    expect(pesquisaCasa(card(), "andrea q11")).toBe(true);
    expect(pesquisaCasa(card(), "andrea q12")).toBe(false);
  });

  it("o número solto acha pelo texto da unidade", () => {
    expect(pesquisaCasa(card(), "11")).toBe(true);
  });
});

describe("separarUnidade", () => {
  it("normaliza as escritas da unidade e devolve o resto", () => {
    expect(separarUnidade("Quadra 03 · Lote 07").pedacos).toEqual(["q3", "l7"]);
    expect(separarUnidade("Bloco B · Apto 101").pedacos).toEqual(["ap101"]);
    expect(separarUnidade("bl 2 ap 0101").pedacos).toEqual(["b2", "ap101"]);
    expect(separarUnidade("maria q11").resto.trim()).toBe("maria");
  });

  it("palavra com l ou q no meio não vira unidade", () => {
    expect(separarUnidade("Lima 2").pedacos).toEqual([]);
    expect(separarUnidade("Marques").pedacos).toEqual([]);
  });
});

describe("filtros", () => {
  it("sem filtro nenhum, tudo passa", () => {
    expect(passaNosFiltros(card(), FILTROS_VAZIOS, AGORA)).toBe(true);
    expect(passaNosFiltros(vencido(), FILTROS_VAZIOS, AGORA)).toBe(true);
  });

  it("empreendimento: só os escolhidos, pela sigla", () => {
    const f = { ...FILTROS_VAZIOS, empreendimentos: ["VOL", "CPA"] };
    expect(passaNosFiltros(card(), f, AGORA)).toBe(true);
    expect(passaNosFiltros(card({ empreendimentoCodigo: "LGB", empreendimentoNome: "Lagoa Bonita" }), f, AGORA)).toBe(false);
  });

  it("prazo vencido: o relógio vermelho do card (situacaoDoPrazo)", () => {
    const f = { ...FILTROS_VAZIOS, prazoVencido: true };
    expect(passaNosFiltros(vencido(), f, AGORA)).toBe(true);
    expect(passaNosFiltros(card(), f, AGORA)).toBe(false);
  });

  it("convite devolvido", () => {
    const f = { ...FILTROS_VAZIOS, conviteDevolvido: true };
    const devolvido = card({ assinaturas: { assinaram: 1, conviteNaoEntregue: true, total: 3 }, estagio: "assinatura" });
    expect(passaNosFiltros(devolvido, f, AGORA)).toBe(true);
    expect(passaNosFiltros(card(), f, AGORA)).toBe(false);
  });

  it("comprador pendente: só em assinatura, com o selo de compradores abaixo do total", () => {
    const comCompradores = (assinaram: number, estagio: CardParaFiltrar["estagio"] = "assinatura") =>
      card({ assinaturas: { assinaram, compradores: { assinaram, total: 2 }, conviteNaoEntregue: false, total: 5 }, estagio });
    expect(temCompradorPendente(comCompradores(1))).toBe(true);
    expect(temCompradorPendente(comCompradores(2))).toBe(false);
    // No pré-faturamento o selo já é o contrato inteiro: não há comprador pendente para mostrar.
    expect(temCompradorPendente(comCompradores(1, "prazo_legal"))).toBe(false);
    // Sem comprador marcado no quadro, nada a esperar.
    expect(temCompradorPendente(card({ assinaturas: { assinaram: 0, conviteNaoEntregue: false, total: 3 }, estagio: "assinatura" }))).toBe(false);
  });

  it("dono: Careli é o card sem incorporador; incorporador é o com", () => {
    const deFora = card({ operadoPor: "0f6d2c1e-3b4a-4c5d-8e9f-a1b2c3d4e5f6" });
    expect(passaNosFiltros(card(), { ...FILTROS_VAZIOS, dono: "careli" }, AGORA)).toBe(true);
    expect(passaNosFiltros(deFora, { ...FILTROS_VAZIOS, dono: "careli" }, AGORA)).toBe(false);
    expect(passaNosFiltros(deFora, { ...FILTROS_VAZIOS, dono: "incorporador" }, AGORA)).toBe(true);
    expect(passaNosFiltros(card(), { ...FILTROS_VAZIOS, dono: "incorporador" }, AGORA)).toBe(false);
  });

  it("os filtros se somam: precisa atender todos os ligados", () => {
    const f = { ...FILTROS_VAZIOS, empreendimentos: ["VOL"], prazoVencido: true };
    expect(passaNosFiltros(vencido(), f, AGORA)).toBe(true);
    expect(passaNosFiltros(card(), f, AGORA)).toBe(false);
    expect(passaNosFiltros(vencido({ empreendimentoCodigo: "LGB" }), f, AGORA)).toBe(false);
  });

  it("conta os ligados, cada empreendimento como um", () => {
    expect(quantosFiltrosLigados(FILTROS_VAZIOS)).toBe(0);
    expect(
      quantosFiltrosLigados({ ...FILTROS_VAZIOS, dono: "careli", empreendimentos: ["VOL", "LGB"], prazoVencido: true }),
    ).toBe(4);
  });

  it("⚠️ o filtro velho sai: empreendimento sem card e dono fora da supervisão", () => {
    const guardado = { ...FILTROS_VAZIOS, dono: "incorporador" as const, empreendimentos: ["VOL", "SUMIU"] };
    expect(filtrosQueValem(guardado, { comDono: false, empreendimentos: ["VOL", "LGB"] })).toEqual({
      ...FILTROS_VAZIOS,
      empreendimentos: ["VOL"],
    });
    expect(filtrosQueValem(guardado, { comDono: true, empreendimentos: ["VOL"] }).dono).toBe("incorporador");
  });

  it("a lista de empreendimentos vem dos cards, pelo nome, sem repetir", () => {
    expect(
      empreendimentosDosCards([
        card(),
        card({ empreendimentoCodigo: "LGB", empreendimentoNome: "Lagoa Bonita" }),
        card(),
        card({ empreendimentoCodigo: "XYZ", empreendimentoNome: " " }),
      ]),
    ).toEqual([
      { chave: "LGB", nome: "Lagoa Bonita" },
      { chave: "VOL", nome: "Vale do Ouro" },
      { chave: "XYZ", nome: "XYZ" },
    ]);
  });
});

describe("ordenarCards", () => {
  // A ordem de chegada (a do servidor) é a padrão: há mais tempo na etapa primeiro.
  const a = card({ clienteNome: "Carlos", criadoEm: "2026-09-20T12:00:00Z" });
  const b = vencido({ clienteNome: "beatriz", criadoEm: "2026-09-25T12:00:00Z" });
  const c = card({ clienteNome: "Ândrea", criadoEm: "2026-10-01T12:00:00Z" });
  const d = vencido({ clienteNome: "Andrea", criadoEm: "2026-09-25T12:00:00Z" });
  const chegada = [a, b, c, d];

  it("há mais tempo na etapa (a padrão): a ordem do servidor, intacta", () => {
    expect(ordenarCards(chegada, "etapa", AGORA)).toEqual([a, b, c, d]);
  });

  it("enviados mais recentes: pela data de envio, e o empate fica na ordem de chegada", () => {
    expect(ordenarCards(chegada, "recentes", AGORA)).toEqual([c, b, d, a]);
  });

  it("prazo vencido primeiro, cada grupo na ordem de chegada", () => {
    expect(ordenarCards(chegada, "vencidos", AGORA)).toEqual([b, d, a, c]);
  });

  it("nome de A a Z, sem acento nem maiúscula decidir, e o empate na ordem de chegada", () => {
    // "Ândrea" e "Andrea" empatam: fica quem chegou antes (c).
    expect(ordenarCards(chegada, "nome", AGORA)).toEqual([c, d, b, a]);
  });

  it("não mexe na lista que recebe", () => {
    const copia = [...chegada];
    ordenarCards(chegada, "nome", AGORA);
    expect(chegada).toEqual(copia);
  });
});

describe("lerPreferencias", () => {
  it("nada guardado, ou lixo: o padrão", () => {
    const padrao = { filtros: FILTROS_VAZIOS, ordem: "etapa" };
    expect(lerPreferencias(null)).toEqual(padrao);
    expect(lerPreferencias("{não é json")).toEqual(padrao);
    expect(lerPreferencias('"texto"')).toEqual(padrao);
  });

  it("o que veio certo fica, o que veio errado volta ao padrão campo a campo", () => {
    expect(
      lerPreferencias(
        JSON.stringify({
          filtros: { dono: "ninguem", empreendimentos: ["VOL", 3, "VOL", ""], prazoVencido: true },
          ordem: "inventada",
        }),
      ),
    ).toEqual({ filtros: { ...FILTROS_VAZIOS, empreendimentos: ["VOL"], prazoVencido: true }, ordem: "etapa" });
    expect(lerPreferencias(JSON.stringify({ ordem: "nome" })).ordem).toBe("nome");
  });
});
