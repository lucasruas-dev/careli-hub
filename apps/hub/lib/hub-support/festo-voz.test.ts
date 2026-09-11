import { describe, expect, it } from "vitest";

import { textoParaVoz } from "@/lib/hub-support/festo-voz";

describe("textoParaVoz", () => {
  it("deixa passar o texto comum", () => {
    expect(textoParaVoz("Oi, Lucas! Vou conferir isso agora.")).toBe(
      "Oi, Lucas! Vou conferir isso agora.",
    );
  });

  it("troca o protocolo por uma frase falavel", () => {
    // "HD-0102" sai como "aga-de-zero-cento e dois" na voz. O numero fica na tela.
    expect(textoParaVoz("Abri o chamado HD-0102 para voce.")).toBe(
      "Abri o chamado o número do chamado, que está aqui na tela para voce.",
    );
  });

  it("nao fala link", () => {
    expect(textoParaVoz("Olha em https://c2x.app.br/zeus?ticket=HD-1")).toBe(
      "Olha em o link que está aqui na conversa",
    );
  });

  it("tira o negrito e o marcador de lista", () => {
    expect(textoParaVoz("**Passo 1**\n- abre a tela\n- clica em salvar")).toBe(
      "Passo 1\nabre a tela\nclica em salvar",
    );
  });

  it("nao fala caminho de tela", () => {
    expect(textoParaVoz("A tela /hercules/venda mudou.")).toBe("A tela mudou.");
  });

  it("corta no fim de uma frase quando o texto e longo", () => {
    const frase = "Essa tela mudou na semana passada e o botao trocou de lugar. ";
    const longo = frase.repeat(20);
    const falado = textoParaVoz(longo);

    expect(falado.length).toBeLessThanOrEqual(700);
    // Termina em pontuacao, e nao no meio de uma palavra.
    expect(falado.trimEnd().endsWith(".")).toBe(true);
  });

  it("avisa que tem mais quando nao acha onde cortar", () => {
    const semPonto = "palavra ".repeat(200);
    const falado = textoParaVoz(semPonto);

    expect(falado.endsWith("O resto está escrito aqui na conversa.")).toBe(true);
  });

  it("devolve vazio para texto vazio", () => {
    expect(textoParaVoz("   ")).toBe("");
  });
});
