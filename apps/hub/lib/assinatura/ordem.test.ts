import { describe, expect, it } from "vitest";

import { descreverRegra, lerRegraDeOrdem, ordenarSignatarios, ORDEM_PADRAO } from "./ordem";
import { rotuloDoPapel, type Signatario } from "./tipos";

// ⚠️ O QUE ESTES TESTES PROTEGEM. A ordem de assinatura é feita HOJE na mão, contrato a contrato
// (Lucas, 07/09/2026: *"isso hoje traz um trabalho enorme para gente, pois fazemos isso de forma
// manual"*). Errar aqui não trava nada — o contrato sai, o cliente assina antes da vendedora, e só
// se descobre quando o jurídico confere. É o tipo de defeito que precisa de teste, não de revisão.

const pessoa = (papel: Signatario["papel"], nome: string): Omit<Signatario, "ordem"> => ({
  email: `${nome.toLowerCase()}@exemplo.com.br`,
  nome,
  papel,
});

describe("a ordem padrão", () => {
  // ⚠️ NASCE DESLIGADA. Ligar a ordem na carteira inteira mudaria o comportamento de contratos que
  // hoje saem em paralelo, sem ninguém ter pedido — e o sintoma seria contrato "parado" esperando
  // alguém que antes assinava a qualquer hora.
  it("deixa todos assinando ao mesmo tempo", () => {
    const saida = ordenarSignatarios([
      pessoa("comprador", "João"),
      pessoa("vendedora", "Praia"),
      pessoa("testemunha", "Valério"),
    ]);
    expect(saida.map((s) => s.ordem)).toEqual([0, 0, 0]);
  });

  it("descreve isso em português", () => {
    expect(descreverRegra(ORDEM_PADRAO, rotuloDoPapel)).toBe("Todos assinam ao mesmo tempo.");
  });
});

describe("a ordem por papel", () => {
  const regra = { ...ORDEM_PADRAO, ordenada: true };

  it("põe o comprador antes da vendedora e a testemunha por último", () => {
    const saida = ordenarSignatarios(
      [pessoa("testemunha", "Valério"), pessoa("vendedora", "Praia"), pessoa("comprador", "João")],
      regra,
    );
    const por = Object.fromEntries(saida.map((s) => [s.nome, s.ordem]));
    expect(por.João).toBeLessThan(por.Praia as number);
    expect(por.Praia).toBeLessThan(por.Valério as number);
  });

  // ⚠️ TRÊS COMPRADORES NÃO FAZEM FILA ENTRE SI. Pôr um para esperar o outro transforma uma venda de
  // casal numa fila de dois dias. Número repetido = "ao mesmo tempo" nos dois provedores.
  it("dá o mesmo número a quem tem o mesmo papel", () => {
    const saida = ordenarSignatarios(
      [pessoa("comprador", "João"), pessoa("comprador", "Maria"), pessoa("comprador", "Ana")],
      regra,
    );
    expect(new Set(saida.map((s) => s.ordem)).size).toBe(1);
  });

  it("o cônjuge assina junto com o comprador? não — mas logo depois, e antes da vendedora", () => {
    const saida = ordenarSignatarios(
      [pessoa("vendedora", "Praia"), pessoa("conjuge", "Maria"), pessoa("comprador", "João")],
      regra,
    );
    const por = Object.fromEntries(saida.map((s) => [s.nome, s.ordem]));
    expect(por.João).toBeLessThan(por.Maria as number);
    expect(por.Maria).toBeLessThan(por.Praia as number);
  });

  // ⚠️ SEM BURACOS NA NUMERAÇÃO. A Clicksign aceita 1, 3, 6; o D4Sign se confunde, e a tela mostraria
  // degraus que não significam nada.
  it("compacta os números quando faltam papéis", () => {
    const saida = ordenarSignatarios(
      [pessoa("comprador", "João"), pessoa("testemunha", "Valério")],
      regra,
    );
    expect(saida.map((s) => s.ordem).sort()).toEqual([1, 2]);
  });

  it("um signatário só recebe ordem 1, não 0", () => {
    expect(ordenarSignatarios([pessoa("comprador", "João")], regra)[0]?.ordem).toBe(1);
  });

  it("escreve a regra em uma linha", () => {
    expect(descreverRegra({ ordenada: true, papeis: ["comprador", "vendedora"] }, rotuloDoPapel)).toBe(
      "Comprador → Vendedora",
    );
  });

  // Os dois papéis que o contrato de CORRETAGEM traz, e que não existiam antes de 08/09/2026.
  it("conhece a coordenadora de vendas e o corretor", () => {
    const saida = ordenarSignatarios(
      [pessoa("corretor", "Imobiliária"), pessoa("coordenadora", "Careli"), pessoa("comprador", "João")],
      regra,
    );
    const por = Object.fromEntries(saida.map((s) => [s.nome, s.ordem]));
    expect(por.João).toBeLessThan(por.Careli as number);
    expect(por.Careli).toBeLessThan(por.Imobiliária as number);
  });
});

describe("ler a regra gravada", () => {
  it("nulo e lixo caem no padrão", () => {
    expect(lerRegraDeOrdem(null)).toEqual(ORDEM_PADRAO);
    expect(lerRegraDeOrdem("qualquer coisa")).toEqual(ORDEM_PADRAO);
    expect(lerRegraDeOrdem(42)).toEqual(ORDEM_PADRAO);
  });

  it("respeita a ordem que foi gravada", () => {
    const r = lerRegraDeOrdem({ ordenada: true, papeis: ["vendedora", "comprador"] });
    expect(r.ordenada).toBe(true);
    expect(r.papeis.slice(0, 2)).toEqual(["vendedora", "comprador"]);
  });

  // ⚠️ JSONB SUJO NÃO DERRUBA A REGRA. Um papel renomeado no código continuaria gravado no banco;
  // recusar a regra inteira faria o contrato voltar ao paralelo em silêncio — que é justamente o
  // trabalho manual que isto veio eliminar.
  it("descarta papel que não existe mais e completa o que falta", () => {
    const r = lerRegraDeOrdem({ ordenada: true, papeis: ["comprador", "avalista", "vendedora"] });
    expect(r.papeis).not.toContain("avalista");
    expect(r.papeis.slice(0, 2)).toEqual(["comprador", "vendedora"]);
    // Os que não foram listados continuam existindo, no fim, na ordem canônica.
    expect(r.papeis).toContain("testemunha");
  });

  it("não repete papel listado duas vezes", () => {
    const r = lerRegraDeOrdem({ ordenada: true, papeis: ["comprador", "comprador"] });
    expect(r.papeis.filter((p) => p === "comprador")).toHaveLength(1);
  });

  it("ordenada só é true quando é true de verdade", () => {
    expect(lerRegraDeOrdem({ ordenada: "sim", papeis: [] }).ordenada).toBe(false);
    expect(lerRegraDeOrdem({ papeis: ["comprador"] }).ordenada).toBe(false);
  });
});
