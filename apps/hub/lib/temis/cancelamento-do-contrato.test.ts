import { describe, expect, it } from "vitest";

import {
  AVISO_DO_ENVELOPE_NO_CANCELAMENTO,
  avisoDoCancelamentoDoContrato,
  conferirMotivoDoCancelamento,
  podeCancelarOContrato,
} from "./cancelamento-do-contrato";

// A RÉGUA PURA DO BOTÃO DE CANCELAR CONTRATO — o que a tela e o servidor leem do mesmo lugar.
//
// Lucas (23/09/2026): *"coloca por favor um botão de cancelamento de contrato na temis"*.

describe("onde o botão aparece", () => {
  it("nas três etapas em que hoje só havia o Voltar para análise", () => {
    expect(podeCancelarOContrato("contrato", "contrato")).toBe(true);
    expect(podeCancelarOContrato("contrato", "assinatura")).toBe(true);
    expect(podeCancelarOContrato("contrato", "prazo_legal")).toBe(true);
  });

  // ⚠️ NA ANÁLISE O INDEFERIR JÁ RESOLVE: ele devolve a venda de `contrato` para `proposta`, e o
  // corretor cancela a proposta no Hércules com um clique. Gastar um cancelamento de contrato ali
  // seria usar o instrumento mais caro quando o mais barato existe.
  it("não aparece na Análise, nem no Concluído, nem no Indeferido", () => {
    expect(podeCancelarOContrato("contrato", "analise")).toBe(false);
    expect(podeCancelarOContrato("contrato", "faturado")).toBe(false);
    expect(podeCancelarOContrato("contrato", "indeferido")).toBe(false);
  });

  // ⚠️ NO CARD DE CANCELAMENTO QUEM DESFAZ A VENDA É O "CONCLUIR", que já existe. Dois botões com o
  // mesmo efeito na mesma tela é como a casa acaba com duas réguas para a mesma pergunta.
  it("não aparece em card que não é de contrato", () => {
    expect(podeCancelarOContrato("cancelamento", "assinatura")).toBe(false);
    expect(podeCancelarOContrato("distrato", "contrato")).toBe(false);
    expect(podeCancelarOContrato("cessao", "assinatura")).toBe(false);
  });
});

describe("o motivo escrito", () => {
  it("vazio, em branco e curto são recusados", () => {
    for (const bruto of [undefined, null, "", "   ", "ab", " a "]) {
      expect(conferirMotivoDoCancelamento(bruto).ok).toBe(false);
    }
  });

  it("o motivo aceito volta aparado", () => {
    const r = conferirMotivoDoCancelamento("  Cliente desistiu  ");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.motivo).toBe("Cliente desistiu");
  });
});

describe("o aviso antes do clique", () => {
  it("diz ENCERRA e nega o parentesco com o voltar para análise", () => {
    const frase = avisoDoCancelamentoDoContrato({ codigo: "COD 000021", envelopeVivo: null });
    expect(frase).toContain("COD 000021");
    expect(frase).toContain("ENCERRA");
    expect(frase).toContain("Voltar para análise");
  });

  // ⚠️ O CASO DA MAURA: 1 de 11 assinado. Sem esta frase, quem clica não lê que os outros 10 perdem
  // o acesso e que quem já assinou assinou um contrato que não vale mais.
  it("com envelope vivo, o preço do envelope vem inteiro", () => {
    const frase = avisoDoCancelamentoDoContrato({
      codigo: null,
      envelopeVivo: { conferido: true, estado: "parcial" },
    });
    expect(frase).toContain(AVISO_DO_ENVELOPE_NO_CANCELAMENTO);
  });

  // ⚠️ LEITURA QUE FALHOU AVISA PELO PIOR CASO, como na volta para análise: `conferido: false` é
  // "não deu para perguntar", e pode haver envelope vivo do lado de lá.
  it("envelope que não deu para conferir também avisa", () => {
    const frase = avisoDoCancelamentoDoContrato({
      codigo: null,
      envelopeVivo: { conferido: false, estado: "desconhecido" },
    });
    expect(frase).toContain(AVISO_DO_ENVELOPE_NO_CANCELAMENTO);
  });

  // Assinatura não se desfaz: ali o envelope fica como está, e prometer o cancelamento dele seria
  // ensinar a ler o aviso como enfeite.
  it("contrato assinado por todos: o aviso não promete cancelar o envelope", () => {
    const frase = avisoDoCancelamentoDoContrato({
      codigo: null,
      envelopeVivo: { conferido: true, estado: "assinado" },
    });
    expect(frase).not.toContain(AVISO_DO_ENVELOPE_NO_CANCELAMENTO);
  });
});
