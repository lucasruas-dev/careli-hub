import { describe, expect, it } from "vitest";

import { buildCacaContextoDoTurno, buildCacaPersonaEstavel } from "./persona";

// A REGRA DE VALOR DE PARCELA — versão de 27/08/2026 (Lucas).
//
// HISTÓRICO: de 21/08 a 27/08 a CACÁ NÃO podia dizer o valor de parcela sem boleto. O motivo era
// real: o reajuste da carteira é aplicado à mão, e quem não tinha boleto carregava valor
// contratual cru (medido: 20,4% abaixo no contrato 455). Em 26/08 o reajuste foi aplicado em massa
// no Lavra do Ouro (768 parcelas, até a competência 12/2026), que é o grosso da carteira, e o
// Lucas liberou: "com as ações de ontem ela tem os valores corretos até dezembro".
//
// O QUE SOBROU DE TRAVA, e é o que estes testes guardam: ela diz o número que a FERRAMENTA
// devolveu, e não um que ela mesma calculou (estimativa por outra parcela, projeção de reajuste,
// juros de atraso de cabeça). Essa parte não pode se perder numa reescrita do prompt.

describe("a regra de valor está no prompt estável", () => {
  const prompt = buildCacaPersonaEstavel({
    canalNome: "WhatsApp",
    centralNome: "Atendimento",
  } as never);

  it("libera o valor da parcela, inclusive futura", () => {
    expect(prompt).toMatch(/Diga o valor que a ferramenta te devolver/);
    expect(prompt).not.toContain("PARCELA FUTURA SEM BOLETO EMITIDO");
    expect(prompt).not.toMatch(/NUNCA diga o valor/);
  });

  it("mantém a trava que importa: o número vem da ferramenta, não da cabeça dela", () => {
    expect(prompt).toMatch(/nunca um que você calculou/);
    expect(prompt).toMatch(/Não estime pelo valor de outra parcela/);
  });

  it("não deixa ela projetar reajuste nem simular saldo por conta própria", () => {
    expect(prompt).toMatch(/não calcule: encaminhe para o time/);
  });

  it("é honesta sobre o que o valor de uma parcela distante significa", () => {
    expect(prompt).toMatch(/ainda passa pelo reajuste anual/);
  });

  it("não sobrou no prompt a marca da trava antiga", () => {
    expect(prompt).not.toContain("valor sob atualização");
    expect(prompt).not.toMatch(/valor dela é fechado quando o boleto é emitido/);
  });

  it("o modo VOZ continua sem ser porta lateral para número inventado", () => {
    // ⚠️ O bloco de voz vive no CONTEXTO DO TURNO e reescreve as regras de formato ("esqueça as
    // regras de TEXTO que leu acima"), então precisa reafirmar o que continua valendo — senão
    // "diga os valores por extenso" soa como permissão para inventar o número.
    const voz = buildCacaContextoDoTurno({ voiceMode: true } as never);
    expect(voz).toMatch(/NÃO libera número que você não tem/);
  });
});
