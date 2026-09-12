import { describe, expect, it } from "vitest";

import { type EnvelopeDaProposta, envelopeQueSegura } from "./envio-db";

// ⚠️ O QUE ESTES TESTES PROTEGEM: a conta da Clicksign, que é de PRODUÇÃO. Envelope custa e, depois
// de ativado, NÃO se apaga — só se cancela, e o cancelado fica na lista para sempre. Esta régua é a
// única coisa entre um segundo clique e o segundo envelope do mesmo contrato; errar para o outro
// lado (segurar demais) trava uma venda que tinha direito de ser reenviada, então os dois sentidos
// estão cobertos aqui.
//
// Os valores vêm do arquivo e da migration 0149: `estado` é `EstadoDaAssinatura`, `envelope_id` só
// nasce quando SOBROU algo na conta (`clicksign/envelope.ts`: `rascunhoApagado ? null : envelopeId`)
// e `falha` guarda o texto da recusa.

/** Uma linha de `temis_envelopes`, com o que a régua lê. */
function linha(patch: Partial<EnvelopeDaProposta>): EnvelopeDaProposta {
  return {
    criado_em: "2026-09-11T12:00:00.000Z",
    envelope_id: null,
    estado: "aguardando",
    falha: null,
    id: "reg-1",
    provedor: "clicksign",
    ...patch,
  };
}

describe("o que LIBERA o reenvio", () => {
  // O caso de uso de verdade: o envelope foi cancelado na Clicksign, o webhook gravou `cancelado`
  // aqui, e alguém precisa mandar o contrato de novo.
  it.each(["cancelado", "expirado", "recusado"])("%s não segura, mesmo com envelope_id", (estado) => {
    expect(envelopeQueSegura([linha({ envelope_id: "env-9", estado })])).toBeNull();
  });

  // ⚠️ `falha` COM `envelope_id` NULO QUER DIZER "NADA FICOU LÁ", com todas as letras: no passo 1 o
  // envelope nem chegou a existir, e nos passos seguintes o rascunho foi apagado e o id voltou nulo
  // de propósito. Segurar aqui travaria toda venda cujo primeiro envio falhou cedo.
  it("a tentativa que falhou sem deixar envelope não segura", () => {
    expect(envelopeQueSegura([linha({ falha: "A Clicksign recusou no passo criar" })])).toBeNull();
  });

  it("proposta sem envelope nenhum não segura", () => {
    expect(envelopeQueSegura([])).toBeNull();
  });
});

describe("o que SEGURA o envio", () => {
  it("envelope aguardando assinatura segura", () => {
    const vivo = envelopeQueSegura([linha({ envelope_id: "env-1", estado: "aguardando" })]);
    expect(vivo?.envelope_id).toBe("env-1");
  });

  // ⚠️ O PIOR CASO, E O MAIS PROVÁVEL: falha no passo `notificar` deixa o envelope ATIVO e gravado
  // com `envelope_id` + `aguardando`. Um segundo envio aqui põe DOIS envelopes running cobrando.
  it("a falha do notificar segura, porque ela grava o id do envelope que ficou ativo", () => {
    const vivo = envelopeQueSegura([
      linha({ envelope_id: "env-2", estado: "aguardando", falha: "notificar: 500" }),
    ]);
    expect(vivo?.envelope_id).toBe("env-2");
  });

  // ⚠️ A LINHA AMBÍGUA: começou e ninguém sabe como terminou (a função morreu, o timeout da Vercel,
  // o `carimbarFalha` que não gravou). Recusar é a escolha da casa — e é ela que também segura o
  // duplo clique, porque durante o envio normal a linha vive exatamente nesse estado.
  it("o envio que começou e não terminou segura", () => {
    const vivo = envelopeQueSegura([linha({ envelope_id: null, estado: "rascunho", falha: null })]);
    expect(vivo?.id).toBe("reg-1");
  });

  it("contrato já assinado segura", () => {
    const vivo = envelopeQueSegura([linha({ envelope_id: "env-3", estado: "assinado" })]);
    expect(vivo?.estado).toBe("assinado");
  });

  // Estado que o código não conhece não é permissão: só os três da lista liberam.
  it("estado desconhecido com envelope na conta segura", () => {
    expect(envelopeQueSegura([linha({ envelope_id: "env-4", estado: "sei_la" })])).not.toBeNull();
  });
});

describe("com mais de uma linha", () => {
  // A consulta pede `criado_em desc`: a primeira que segura é a mais recente, e é o id dela que a
  // frase da recusa manda conferir. Mandar conferir o envelope mais velho é mandar procurar o errado.
  it("devolve a linha que segura, na ordem em que vieram", () => {
    const vivo = envelopeQueSegura([
      linha({ criado_em: "2026-09-11T15:00:00.000Z", envelope_id: "env-novo", estado: "aguardando" }),
      linha({ criado_em: "2026-09-10T09:00:00.000Z", envelope_id: "env-velho", estado: "aguardando" }),
    ]);
    expect(vivo?.envelope_id).toBe("env-novo");
  });

  // ⚠️ UM CANCELADO NÃO PERDOA O VIVO. O histórico de uma venda reenviada tem as duas linhas, e
  // achar o cancelado primeiro não pode virar "pode mandar".
  it("o cancelado antigo não libera o vivo de hoje", () => {
    const vivo = envelopeQueSegura([
      linha({ envelope_id: "env-cancelado", estado: "cancelado" }),
      linha({ envelope_id: "env-vivo", estado: "aguardando" }),
    ]);
    expect(vivo?.envelope_id).toBe("env-vivo");
  });

  it("só linhas liberadas não seguram nada", () => {
    const nenhum = envelopeQueSegura([
      linha({ envelope_id: "env-cancelado", estado: "cancelado" }),
      linha({ envelope_id: "env-recusado", estado: "recusado" }),
      linha({ falha: "não deu", id: "reg-2" }),
    ]);
    expect(nenhum).toBeNull();
  });
});
