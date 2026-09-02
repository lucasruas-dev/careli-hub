import { describe, expect, it } from "vitest";

import { podeSerAMesmaPessoa } from "./mesma-pessoa";

// Os pares reais da carteira em 02/09/2026, todos com o MESMO CPF cadastrado.
describe("podeSerAMesmaPessoa", () => {
  it("aceita a mesma pessoa escrita de outro jeito", () => {
    const pares: [string, string][] = [
      ["SERGIO ANTÔNIO DE SOUSA", "SÉRGIO ANTÔNIO DE SOUZA"],
      ["SIDMAR SOUSA SOARES", "SIDMAR SOUZA SOARES"],
      ["LUIS HENRIQUE SANTIAGO SANTOS RANGEL", "LUIZ HENRIQUE SANTIAGO SANTOS RANGEL"],
      ["RAFAEL ASSUNCAO ABREU", "RAFAEL ASSUNÇÃO ABREU"],
      ["WOLMERT MARCUS OLIVEIRA BORGES", "WOLMERT MARCUS OLIVEIRA BORGES."],
      ["MARCIO JOSE DE ALMEIDA", "Marcio José de Almeida"],
      ["ÂNGELA MARIA DE OLIVEIRA", "ANGELA MARIA DE OLIVEIRA EUFRAZIO MACIEL"],
      ["JULIANA FERREIRA TEIXEIRA ARANTES", "JULIANA FERREIRA E ANDRÉ LUIS"],
      ["VAGNER HENRIQUE DAS MERCÊS", "VAGNER MERCES/BRUNA MAIA"],
      ["VAGNER HENRIQUE DAS MERCÊS", "VAGNER E BRUNA"],
      ["EVANDRO (CONTADOR) EOS PARTICIPAÇÕES E EMPREENDIMENTOS LTDA", "EVANDRO DE OLIVEIRA SILVA (EOS PARTICIPAÇÕES)"],
    ];
    for (const [a, b] of pares) {
      expect(podeSerAMesmaPessoa(a, b), `${a} ↔ ${b}`).toBe(true);
      expect(podeSerAMesmaPessoa(b, a), `${b} ↔ ${a}`).toBe(true);
    }
  });

  // ⚠️ O CASO QUE O AVISO EXISTE PARA PEGAR: CPF de pessoa física numa empresa, nomes sem relação.
  it("acusa quando são gente diferente", () => {
    expect(podeSerAMesmaPessoa("ATHOS FIORAVANTE BARROS BARBOSA", "JFB EMPREEDIMENTOS LTDA")).toBe(false);
    expect(podeSerAMesmaPessoa("HENRIQUE GAUDÊNCIO", "PAULO SÉRGIO MAIA")).toBe(false);
    expect(podeSerAMesmaPessoa("PAULO SÉRGIO MAIA", "VICTOR LIMA CAMPOS")).toBe(false);
    // Primeiro nome diferente com dois sobrenomes em comum: sobrenome é herdado, não identifica.
    expect(podeSerAMesmaPessoa("CASSIO ALVES DOS SANTOS", "GETULIO ALVES SANTOS ROSA")).toBe(false);
  });

  it("na dúvida, não acusa", () => {
    expect(podeSerAMesmaPessoa("", "QUALQUER UM")).toBe(true);
    expect(podeSerAMesmaPessoa("MARCELO", "MARCELO SALDANHA NUNES")).toBe(true);
  });
});
