import { describe, expect, it } from "vitest";

import { MOTIVOS_DO_TERMO } from "@/lib/hades/dossie/termo-de-acordo-gate";

import { type AcordoParaOGate, motivoParaNaoEnviarParaAssinatura } from "./envio-gate";

// ────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ A REGRA DO LUCAS (20/09/2026): *"o acordo so pode ficar disponivel para envio depois da
// aprovacao"*. Estes testes são a prova dela, e cobrem os três casos que ele pediu: sem aprovação,
// reprovado e aprovado.
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ O QUE ISTO PROTEGE É UMA CONTA DE PRODUÇÃO. Cada envelope da Clicksign custa e, depois de
// ativado, NÃO se apaga — só se cancela, e o cancelado fica na lista para sempre. Um acordo
// reprovado que escapa por aqui vira um termo na mão do cliente, em nome da Careli, com condições
// que o gestor recusou.

const acordo = (patch: Partial<AcordoParaOGate> = {}): AcordoParaOGate => ({
  acquisitionRequestC2xId: 9001,
  approvalStatus: "aprovado",
  kind: "acordo",
  metadata: {},
  parcelas: [{}],
  status: "ativo",
  ...patch,
});

describe("só acordo aprovado vai para assinatura", () => {
  it("o acordo APROVADO passa", () => {
    expect(motivoParaNaoEnviarParaAssinatura(acordo())).toBeNull();
  });

  // ⚠️ SEM APROVAÇÃO É DOIS ESTADOS, NÃO UM, e as frases são diferentes de propósito: em elaboração
  // quem age é o operador (falta ENVIAR para o gestor); pendente quem age é o gestor. Uma frase só
  // mandaria metade das pessoas esperar por si mesmas.
  it("o acordo EM ELABORAÇÃO não passa, e a frase manda enviar ao gestor", () => {
    const motivo = motivoParaNaoEnviarParaAssinatura(acordo({ approvalStatus: "em_elaboracao" }));

    expect(motivo).toBe(MOTIVOS_DO_TERMO.elaboracao);
    expect(motivo).toContain("enviado e aprovado pelo gestor");
  });

  it("o acordo PENDENTE não passa, e a frase diz de quem se espera", () => {
    const motivo = motivoParaNaoEnviarParaAssinatura(acordo({ approvalStatus: "pendente" }));

    expect(motivo).toBe(MOTIVOS_DO_TERMO.pendente);
    expect(motivo).toContain("gestor aprovar");
  });

  it("o acordo REPROVADO não passa", () => {
    const motivo = motivoParaNaoEnviarParaAssinatura(acordo({ approvalStatus: "reprovado" }));

    expect(motivo).toBe(MOTIVOS_DO_TERMO.reprovado);
    expect(motivo).toContain("reprovado pelo gestor");
  });

  // ⚠️ O REGISTRO ANTIGO GUARDA A APROVAÇÃO NO `metadata`, e a coluna só chegou na migration 0037.
  // Ler só a coluna faria um acordo aprovado da fase 1 aparecer como pendente — e ninguém
  // conseguiria mandá-lo.
  it("aprovação antiga, gravada no metadata, também passa", () => {
    expect(
      motivoParaNaoEnviarParaAssinatura(
        acordo({ approvalStatus: undefined, metadata: { approval_status: "aprovado" } }),
      ),
    ).toBeNull();
  });

  // ⚠️ AUSÊNCIA NÃO É APROVAÇÃO. Registro sem coluna e sem metadata cai em "pendente", e não em
  // "pode mandar": o silêncio do cadastro nunca autoriza um documento a sair em nome da casa.
  it("acordo sem nenhuma marca de aprovação cai em pendente", () => {
    expect(
      motivoParaNaoEnviarParaAssinatura(acordo({ approvalStatus: undefined, metadata: {} })),
    ).toBe(MOTIVOS_DO_TERMO.pendente);
  });
});

describe("o que mais impede o envio", () => {
  it("promessa de pagamento não tem termo para mandar", () => {
    expect(motivoParaNaoEnviarParaAssinatura(acordo({ kind: "promessa" }))).toBe(
      MOTIVOS_DO_TERMO.promessa,
    );
  });

  it("acordo cancelado não vai para assinatura nenhuma", () => {
    expect(motivoParaNaoEnviarParaAssinatura(acordo({ status: "cancelado" }))).toBe(
      MOTIVOS_DO_TERMO.cancelado,
    );
  });

  // Os dois defeitos de registro: sem unidade o termo não tem objeto, sem parcelas não tem o que
  // parcelar. Medido em 20/09/2026: 2 dos 40 acordos não têm unidade, e os dois estão reprovados.
  it("acordo sem unidade e acordo sem parcelas não vão", () => {
    expect(motivoParaNaoEnviarParaAssinatura(acordo({ acquisitionRequestC2xId: null }))).toBe(
      MOTIVOS_DO_TERMO.semUnidade,
    );
    expect(motivoParaNaoEnviarParaAssinatura(acordo({ parcelas: [] }))).toBe(
      MOTIVOS_DO_TERMO.semParcelas,
    );
  });
});

// ⚠️ UMA RÉGUA SÓ, E É ISTO QUE ESTE TESTE PRENDE. Se o envio ganhasse uma segunda leitura de
// `approval_status`, o botão de enviar acenderia para um acordo que a rota do termo recusa (ou o
// contrário), e o operador clicaria num botão que mente. As duas respostas TÊM de ser a mesma
// string.
describe("a régua do envio é a MESMA do termo", () => {
  it.each(["aprovado", "em_elaboracao", "pendente", "reprovado"] as const)(
    "com aprovação %s, envio e emissão dizem a mesma coisa",
    async (aprovacao) => {
      const { motivoParaNaoEmitirOTermo } = await import(
        "@/lib/hades/dossie/termo-de-acordo-gate"
      );
      const caso = acordo({ approvalStatus: aprovacao });

      expect(motivoParaNaoEnviarParaAssinatura(caso)).toBe(motivoParaNaoEmitirOTermo(caso));
    },
  );
});
