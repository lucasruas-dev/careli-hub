import { describe, expect, it } from "vitest";

import { buildCacaContextoDoTurno, buildCacaPersonaEstavel } from "./persona";

// A REGRA DE VALOR DE PARCELA (Lucas, 21/08/2026).
//
// O reajuste da carteira é MANUAL: ele é aplicado a mão, sobrescrevendo o valor, no momento em que
// a parcela recebe boleto. Quem ainda não tem boleto carrega o valor contratual cru, defasado —
// medido no contrato 455, a parcela 34 (com boleto) vale R$ 535,72 e a 35 (sem boleto) R$ 426,81,
// 20,4% a menos. Dizer esse número ao cliente é prometer uma cobrança que não vai acontecer.
//
// Estes testes cobrem os dois lados da trava: o PROMPT (que impede o modelo de compensar a
// ausência do número inventando um) e a formatação (coberta em executors, via describeInstallment).

describe("a regra de valor está no prompt estável", () => {
  const prompt = buildCacaPersonaEstavel({
    canalNome: "WhatsApp",
    centralNome: "Atendimento",
  } as never);

  it("diz explicitamente que parcela futura sem boleto não tem valor", () => {
    expect(prompt).toContain("PARCELA FUTURA SEM BOLETO EMITIDO");
    expect(prompt).toMatch(/NUNCA diga o valor/);
  });

  it("libera valor para parcela paga e para parcela com boleto", () => {
    expect(prompt).toContain("PARCELA JÁ PAGA");
    expect(prompt).toContain("PARCELA COM BOLETO EMITIDO");
  });

  it("explica o PORQUÊ — sem isso o modelo trata a regra como capricho e contorna", () => {
    expect(prompt).toMatch(/não passaram pela atualização de valor/);
  });

  it("proíbe estimar a partir de outra parcela, que é a saída óbvia do modelo", () => {
    expect(prompt).toMatch(/não vá buscar o valor de outra parcela/);
  });

  it("dá a frase pronta, para a recusa não soar como esconder informação", () => {
    expect(prompt).toMatch(/valor dela é fechado quando o boleto é emitido/);
  });

  it("o exemplo de transferência NÃO ensina a dizer valor de parcela sem link", () => {
    // Este exemplo citava "no valor de R$ 824,83" para uma parcela cujo boleto não estava
    // disponível — ou seja, ensinava pelo exemplo exatamente o que a regra proíbe.
    const trecho = prompt.slice(
      prompt.indexOf("Exemplo de TAMANHO"),
      prompt.indexOf("Exemplo de TAMANHO") + 400,
    );
    expect(trecho).not.toMatch(/R\$ 824,83/);
  });

  it("o modo VOZ não é uma porta lateral para o valor proibido", () => {
    // ⚠️ O bloco de voz vive no CONTEXTO DO TURNO, não na persona estável — ele muda por
    // atendimento. Ele reescreve as regras de formato ("esqueça as regras de TEXTO que leu
    // acima"), então precisa reafirmar a trava de valor: sem isso, "diga os valores por extenso"
    // soaria como permissão para falar o número que o texto não pode escrever.
    const voz = buildCacaContextoDoTurno({ voiceMode: true } as never);
    expect(voz).toMatch(/Falar por extenso NÃO libera valor/);
  });
});
