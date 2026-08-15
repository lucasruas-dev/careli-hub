import { describe, expect, it } from "vitest";

import {
  buildCacaContextoDoTurno,
  buildCacaPersonaEstavel,
  buildCacaSystemPrompt,
} from "./persona";

// O prompt da Cacá é cobrado a cada turno e a cada iteração de ferramenta (até 8 por
// atendimento). O que segura esse custo é o prompt caching, e o cache casa PREFIXO: basta
// um byte diferente no começo pra ele perder tudo, inclusive as 30 ferramentas.
//
// Por isso a persona é dividida em duas: o que é igual pra todo mundo (cacheado) e o que
// muda a cada turno (fora do cache). Estes testes existem pra impedir a regressão mais
// provável do futuro: alguém acrescentar o nome do cliente, a saudação ou um aviso do dia
// dentro do bloco estável, sem perceber que acabou de desligar o cache da operação inteira.

const CONTEXTO_A = {
  avisosOperacionais: [{ texto: "Boletos de agosto saem dia 20.", titulo: "Emissão" }],
  businessHoursOpen: true,
  clientNotes: ["Prefere ser chamada de Dona Zezé."],
  customerName: "Maria Eunice",
  customerProfileLabel: "comprador",
  greeting: "bom dia",
  identityVerified: true,
  imobiliariaName: "Beltrão Imóveis",
};

const CONTEXTO_B = {
  activeCobranca: true,
  businessHoursOpen: false,
  clientNotes: ["Outro cliente, outra anotação."],
  customerName: "João da Silva",
  greeting: "boa noite",
  identidadeLembrada: { displayName: "João da Silva" },
  nextContactLabel: "na segunda-feira",
  voiceMode: true,
};

// O modo assistente é texto FIXO (não tem dado de cliente nenhum), então ele fica no bloco
// estável e ganha cache próprio: são ~2.500 tokens que a direção pagaria em toda iteração
// de ferramenta se ficassem no bloco volátil.
const CONTEXTO_ADMIN = {
  ...CONTEXTO_A,
  assistantMode: true,
};

describe("separação estável x volátil da persona", () => {
  it("o bloco estável é idêntico entre dois atendimentos completamente diferentes", () => {
    // Esta é a garantia do cache. Se falhar, o prefixo mudou e o cache parou de acertar.
    expect(buildCacaPersonaEstavel(CONTEXTO_A)).toBe(
      buildCacaPersonaEstavel(CONTEXTO_B),
    );
  });

  it("o modo assistente tem o próprio bloco estável, também cacheável", () => {
    const admin = buildCacaPersonaEstavel(CONTEXTO_ADMIN);

    // Duas conversas diferentes da direção compartilham o mesmo prefixo.
    expect(admin).toBe(
      buildCacaPersonaEstavel({ ...CONTEXTO_B, assistantMode: true }),
    );
    expect(admin).toContain("MODO ASSISTENTE INTERNO");
    // E o bloco da direção não vaza pro atendimento de cliente.
    expect(buildCacaPersonaEstavel(CONTEXTO_A)).not.toContain(
      "MODO ASSISTENTE INTERNO",
    );
  });

  it("o bloco estável não carrega nada de um atendimento específico", () => {
    const estavel = buildCacaPersonaEstavel(CONTEXTO_A);

    for (const vazamento of [
      "Maria Eunice",
      "bom dia",
      "Beltrão Imóveis",
      "Dona Zezé",
      "Boletos de agosto",
      "MODO ASSISTENTE",
      "Horário de atendimento humano",
      "identidade do titular ainda não foi confirmada",
    ]) {
      expect(estavel).not.toContain(vazamento);
    }
  });

  it("o bloco estável mantém os guardrails que não podem sumir", () => {
    const estavel = buildCacaPersonaEstavel();

    expect(estavel).toContain("ATRASO É HIPÓTESE, NUNCA ACUSAÇÃO");
    expect(estavel).toContain("NUNCA dispara cobrança nativa do Asaas");
    expect(estavel).toContain("Nunca revele dados internos");
    expect(estavel).toContain("Escopo e correção");
  });

  it("o contexto do turno carrega o que muda, e só ele", () => {
    const volatil = buildCacaContextoDoTurno(CONTEXTO_A);

    expect(volatil).toContain("Maria Eunice");
    expect(volatil).toContain("bom dia");
    expect(volatil).toContain("Beltrão Imóveis");
    expect(volatil).toContain("Boletos de agosto");
    expect(volatil).toContain("comprador");
    // Guardrail permanente não se repete aqui: pagaríamos duas vezes pelo mesmo texto.
    expect(volatil).not.toContain("ATRASO É HIPÓTESE");
  });

  it("o que depende da hora ou do modo do turno entra pelo contexto", () => {
    const volatil = buildCacaContextoDoTurno(CONTEXTO_B);

    expect(volatil).toContain("VAI VIRAR ÁUDIO");
    expect(volatil).toContain("contato ativo de cobrança");
    expect(volatil).toContain("FORA do horário");
  });

  it("o tratamento da Nívea fica no contexto, porque carrega a saudação da hora", () => {
    const volatil = buildCacaContextoDoTurno({
      ...CONTEXTO_ADMIN,
      assistantIsOwner: true,
    });

    expect(volatil).toContain("Estimada");
    expect(volatil).toContain("bom dia");
  });

  it("o prompt completo continua sendo a soma das duas partes", () => {
    const completo = buildCacaSystemPrompt(CONTEXTO_A);

    expect(completo).toContain(buildCacaPersonaEstavel(CONTEXTO_A));
    expect(completo).toContain(buildCacaContextoDoTurno(CONTEXTO_A));
  });

  it("sem contexto nenhum, o turno não vira um bloco de sujeira", () => {
    const volatil = buildCacaContextoDoTurno();

    // Só o essencial: título, identidade não confirmada e o horário de atendimento.
    expect(volatil.split("\n").length).toBeLessThanOrEqual(5);
    expect(volatil).not.toContain("undefined");
    expect(volatil).not.toContain("null");
  });
});
