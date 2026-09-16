import { describe, expect, it } from "vitest";

import {
  type AcordoParaOGate,
  MOTIVOS_DO_TERMO,
  motivoParaNaoEmitirOTermo,
  situacaoDaAprovacao,
} from "./termo-de-acordo-gate";

// ⚠️ O QUE ESTA SUÍTE PROTEGE É A FRASE, E NÃO SÓ O "PODE / NÃO PODE". A lição de 15/09/2026:
// botão apagado sem dizer por quê é defeito. Um gate que voltasse `false` passaria em qualquer
// teste de booleano e deixaria a tela muda — então cada caso aqui confere o TEXTO que a pessoa lê.

const APROVADO: AcordoParaOGate = {
  acquisitionRequestC2xId: 467,
  approvalStatus: "aprovado",
  kind: "acordo",
  metadata: {},
  parcelas: [{}, {}],
  status: "ativo",
};

describe("a situação de aprovação é a mesma do selo do card", () => {
  it("lê a coluna real primeiro", () => {
    expect(situacaoDaAprovacao("aprovado", { approval_status: "pendente" })).toBe("aprovado");
    expect(situacaoDaAprovacao("reprovado", {})).toBe("reprovado");
  });

  it("cai no metadata da fase 1 só quando a coluna vem indefinida", () => {
    expect(situacaoDaAprovacao(undefined, { approval_status: "aprovado" })).toBe("aprovado");
    expect(situacaoDaAprovacao(null, { approval_status: "reprovado" })).toBe("reprovado");
  });

  it("normaliza em_elaboracao e trata o desconhecido como pendente", () => {
    expect(situacaoDaAprovacao("em_elaboracao", {})).toBe("elaboracao");
    expect(situacaoDaAprovacao(undefined, {})).toBe("pendente");
  });
});

describe("quando o termo de acordo pode sair", () => {
  it("acordo aprovado, com unidade e parcelas: sai (null)", () => {
    expect(motivoParaNaoEmitirOTermo(APROVADO)).toBeNull();
  });

  // ⚠️ É O ESTADO DE 14 DOS 18 ACORDOS DE PRODUÇÃO (medido em 16/09/2026). A frase é o que a pessoa
  // vai ler quase sempre, então ela precisa dizer o que falta, e não só "indisponível".
  it("pendente: diz que sai depois da aprovação do gestor", () => {
    const motivo = motivoParaNaoEmitirOTermo({ ...APROVADO, approvalStatus: "pendente" });
    expect(motivo).toBe(MOTIVOS_DO_TERMO.pendente);
    expect(motivo).toContain("depois que o gestor aprovar");
  });

  it("em elaboração: diz que falta enviar e aprovar", () => {
    expect(motivoParaNaoEmitirOTermo({ ...APROVADO, approvalStatus: "em_elaboracao" })).toBe(
      "O termo sai depois que o acordo for enviado e aprovado pelo gestor.",
    );
  });

  it("reprovado: diz que não há termo a emitir", () => {
    expect(motivoParaNaoEmitirOTermo({ ...APROVADO, approvalStatus: "reprovado" })).toBe(
      "Este acordo foi reprovado pelo gestor, então não há termo a emitir.",
    );
  });

  it("cancelado vence a aprovação: um acordo cancelado não tem termo nem se estiver aprovado", () => {
    expect(motivoParaNaoEmitirOTermo({ ...APROVADO, status: "cancelado" })).toBe(
      MOTIVOS_DO_TERMO.cancelado,
    );
  });

  it("quebrado e cumprido continuam emitindo: o termo é o registro do que foi combinado", () => {
    expect(motivoParaNaoEmitirOTermo({ ...APROVADO, status: "quebrado" })).toBeNull();
    expect(motivoParaNaoEmitirOTermo({ ...APROVADO, status: "cumprido" })).toBeNull();
  });

  it("promessa não tem termo", () => {
    expect(motivoParaNaoEmitirOTermo({ ...APROVADO, kind: "promessa" })).toBe(
      "Promessa de pagamento não tem termo de acordo.",
    );
  });

  // ⚠️ AC-000012 e AC-000014 são assim em produção: nasceram juntando dois contratos.
  it("aprovado sem unidade: diz para refazer o acordo por unidade", () => {
    const motivo = motivoParaNaoEmitirOTermo({ ...APROVADO, acquisitionRequestC2xId: null });
    expect(motivo).toBe(MOTIVOS_DO_TERMO.semUnidade);
    expect(motivo).toContain("refaça o acordo por unidade");
  });

  it("aprovado sem parcelas: diz que o termo precisa delas", () => {
    expect(motivoParaNaoEmitirOTermo({ ...APROVADO, parcelas: [] })).toBe(
      MOTIVOS_DO_TERMO.semParcelas,
    );
  });

  it("a aprovação é perguntada antes do defeito do registro", () => {
    // Pendente E sem unidade: o que o operador pode resolver primeiro é esperar o gestor.
    expect(
      motivoParaNaoEmitirOTermo({
        ...APROVADO,
        acquisitionRequestC2xId: null,
        approvalStatus: "pendente",
      }),
    ).toBe(MOTIVOS_DO_TERMO.pendente);
  });

  it("toda recusa é uma frase terminada em ponto, nunca um código", () => {
    for (const frase of Object.values(MOTIVOS_DO_TERMO)) {
      expect(frase).toMatch(/^[A-ZÁÉÍÓÚ].+\.$/);
      expect(frase).not.toMatch(/approval|status|null|_/);
    }
  });
});
