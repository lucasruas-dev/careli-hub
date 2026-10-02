import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Banco, criarBanco, type Linha } from "@/lib/hercules/banco-em-memoria.para-teste";

// MARCAR ATIVIDADE: O CARD ANDA E A VENDA VAI JUNTO — e o PEDIDO nunca chega a Concluído por aqui.
//
// Lucas, 24/09/2026: *"preciso garantir que tudo que acontece na temis reflete no hercules"* e
// *"lembrando que quando tem cancelamento a unidade tem que ficar disponivel, tem que ter esse
// reflexo"*.
//
// ⚠️ DUAS COISAS TRAVADAS AQUI:
//   1. a última atividade do Pré-faturamento leva o card a Faturado e a venda de `assinatura` para
//      `faturado`, SEM tocar no cadastro da unidade nem em `data_faturamento` (decisão pendente do
//      Lucas: `data_faturamento` é previsão no legado, e `vendida` prenderia o lote num distrato);
//   2. o card de cancelamento ou de distrato NÃO chega a Concluído pela marcação: o Concluído dele
//      é o botão Concluir, que derruba a venda e solta o lote. Pela marcação, o quadro diria
//      "Concluído" com a venda viva e o lote preso.

const estado = vi.hoisted(() => ({ banco: null as null | { cliente: unknown } }));

// ⚠️ A BARRA DA CAD (26/09/2026) É DUBLADA AQUI COMO "APROVADA". Lucas: *"faz uma barra, para enviar
// para contrato precisa da cad validada"*. Este arquivo mede o REFLEXO na venda, não o credenciamento;
// sem o dublê, o fixture (que não tem esteira nenhuma) faria toda marcação de card de contrato recusar
// e os testes passariam a medir a barra por acidente. Ela é provada em
// `lib/temis/trabalhos-db-cad-aprovada.test.ts` e em `lib/hercules/cad-para-contrato.test.ts`.
vi.mock("@/lib/hercules/cad-para-contrato", () => ({
  recusaDaCadDaProposta: async () => null,
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => estado.banco?.cliente ?? null,
}));

vi.mock("./contrato-guardado-db", () => ({
  contratosDasPropostas: async () => new Map(),
}));

const { marcarAtividade } = await import("./trabalhos-db");
const { ATIVIDADES } = await import("./trabalhos");

let banco: Banco;

function montar(card: Linha, venda: Linha = {}): Banco {
  banco = criarBanco({
    hercules_proposta_etapas: [],
    hercules_propostas: [
      {
        data_assinatura: "2026-09-10",
        data_faturamento: null,
        etapa: "assinatura",
        id: "venda-1",
        unidade_id: "uni-1",
        workspace_id: "careli",
        ...venda,
      },
    ],
    hercules_unidades: [{ codigo: "VOL0101", enterprise_id: "40", id: "uni-1", situacao: "reservada", workspace_id: "careli" }],
    temis_trabalho_etapas: [],
    temis_trabalhos: [
      {
        atividades_feitas: [],
        canal: "hercules",
        cliente_nome: "VITORIA",
        criado_em: "2026-09-01T12:00:00.000Z",
        enterprise_codigo: "VOL",
        enterprise_id: "40",
        enterprise_nome: "Vale do Ouro Lagoa",
        estagio: "prazo_legal",
        estagio_desde: "2026-09-12T12:00:00.000Z",
        id: "card-1",
        proposta_id: "venda-1",
        tipo: "contrato",
        unidade: "Quadra 01 · Lote 01",
        workspace_id: "careli",
        ...card,
      },
    ],
  });
  estado.banco = banco;
  return banco;
}

/** As atividades de um estágio: todas menos a última, e a última (a que faz o card andar). */
function doEstagio(tipo: keyof typeof ATIVIDADES, estagio: string): { antes: string[]; ultima: string } {
  const textos = ATIVIDADES[tipo].filter((a) => a.estagio === estagio).map((a) => a.texto);
  return { antes: textos.slice(0, -1), ultima: textos[textos.length - 1] ?? "" };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  expect(banco.problemas).toEqual([]);
  vi.restoreAllMocks();
});

describe("a marcação que leva o card de contrato adiante leva a venda junto", () => {
  it("última atividade do Pré-faturamento: card em Faturado e venda de assinatura para faturado, sem tocar no cadastro nem em data_faturamento", async () => {
    const { antes, ultima } = doEstagio("contrato", "prazo_legal");
    montar({ atividades_feitas: antes });

    const r = await marcarAtividade({ atividade: ultima, feita: true, id: "card-1", quem: "u-nivea", quemNome: "Nivea" });

    expect(r).toMatchObject({ andou: true, estagio: "faturado", ok: true });
    expect(banco.linha("hercules_propostas", "venda-1")).toMatchObject({
      data_faturamento: null,
      etapa: "faturado",
      etapa_por: "Nivea",
    });
    expect(banco.linhas("hercules_proposta_etapas")).toEqual([
      expect.objectContaining({ autor_nome: "Nivea", de: "assinatura", motivo: "Contrato faturado na Têmis", para: "faturado" }),
    ]);
    expect(banco.linha("hercules_unidades", "uni-1")?.situacao).toBe("reservada");
    expect(banco.consultas.some((c) => c.tabela === "hercules_unidades")).toBe(false);
  });

  it("contrato para assinatura pela marcação (sem envelope): a venda vai de contrato para assinatura", async () => {
    const { antes, ultima } = doEstagio("contrato", "contrato");
    montar({ atividades_feitas: antes, estagio: "contrato" }, { etapa: "contrato" });

    const r = await marcarAtividade({ atividade: ultima, feita: true, id: "card-1", quemNome: "Nivea" });

    expect(r).toMatchObject({ estagio: "assinatura", ok: true });
    expect(banco.linha("hercules_propostas", "venda-1")?.etapa).toBe("assinatura");
  });

  it("venda ainda em contrato com card faturando: o card anda, a venda NÃO pula duas etapas", async () => {
    const { antes, ultima } = doEstagio("contrato", "prazo_legal");
    montar({ atividades_feitas: antes }, { etapa: "contrato" });

    const r = await marcarAtividade({ atividade: ultima, feita: true, id: "card-1" });

    expect(r).toMatchObject({ estagio: "faturado", ok: true });
    expect(banco.linha("hercules_propostas", "venda-1")?.etapa).toBe("contrato");
  });

  it("marcar sem fechar o estágio não lê a venda para refletir nem escreve nela", async () => {
    const { antes } = doEstagio("contrato", "prazo_legal");
    montar({ atividades_feitas: [] });

    await marcarAtividade({ atividade: antes[0] ?? "", feita: true, id: "card-1" });

    expect(banco.consultas.some((c) => c.tabela === "hercules_propostas" && c.operacao === "update")).toBe(false);
    expect(banco.linhas("hercules_proposta_etapas")).toEqual([]);
  });
});

describe("o pedido de cancelamento ou de distrato não chega a Concluído pela marcação", () => {
  it.each([
    ["cancelamento", "contrato"],
    ["distrato", "assinatura"],
  ] as const)("card de %s no último estágio antes do fim: a última atividade é RECUSADA, com o recado de usar Concluir", async (tipo, estagio) => {
    const { antes, ultima } = doEstagio(tipo, estagio);
    montar({ atividades_feitas: antes, estagio, tipo }, { etapa: "contrato" });

    const r = await marcarAtividade({ atividade: ultima, feita: true, id: "card-1" });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("Concluir");
    // Nada gravado: nem o estágio, nem a atividade, nem a venda.
    expect(banco.linha("temis_trabalhos", "card-1")?.estagio).toBe(estagio);
    expect(banco.consultas.filter((c) => c.operacao !== "select")).toEqual([]);
  });

  it("marcar ou desmarcar atividade do pedido SEM avançar continua livre", async () => {
    const { antes } = doEstagio("distrato", "contrato");
    montar({ atividades_feitas: [], estagio: "contrato", tipo: "distrato" }, { etapa: "contrato" });

    const r = await marcarAtividade({ atividade: antes[0] ?? "", feita: true, id: "card-1" });

    expect(r).toMatchObject({ andou: false, ok: true });
  });

  it("o pedido anda de Análise para Contrato pela marcação, como sempre (não é o fim)", async () => {
    const { antes, ultima } = doEstagio("cancelamento", "analise");
    montar({ atividades_feitas: antes, estagio: "analise", tipo: "cancelamento" }, { etapa: "contrato" });

    const r = await marcarAtividade({ atividade: ultima, feita: true, id: "card-1" });

    expect(r).toMatchObject({ andou: true, estagio: "contrato", ok: true });
    // E a venda não se mexe: o pedido nunca reflete (a marca do pedido é quem pinta em_cancelamento).
    expect(banco.linha("hercules_propostas", "venda-1")?.etapa).toBe("contrato");
  });
});

// ── O FATURADO NÃO SAI COM O CONTRATO AINDA POR ASSINAR (02/10/2026) ──────────────────────────────
//
// Lucas: *"vamos mudar esse 3/11 eu preciso ver somente dos compradores"*. O card passou a entrar no
// Pré-faturamento quando os COMPRADORES assinam, com a vendedora ou a testemunha ainda por assinar. A
// marcação levava o card a Faturado sem olhar envelope nenhum; agora o envelope de contrato vivo segura.

/** O envelope de contrato da venda: a compradora assinou, a testemunha não. */
function envelopeDoContrato(patch: Linha = {}): Linha {
  return {
    criado_em: "2026-09-20T12:00:00.000Z",
    enviado_em: "2026-09-20T12:01:00.000Z",
    envelope_id: "env-1",
    estado: "parcial",
    falha: null,
    finalidade: "contrato",
    id: "reg-1",
    proposta_id: "venda-1",
    provedor: "clicksign",
    signatarios: [
      { assinado_em: "2026-09-26T10:00:00.000-03:00", chave: "k1", email: "c@x.com", nome: "C", ordem: 1, papel: "comprador" },
      { chave: "k2", email: "t@x.com", nome: "T", ordem: 2, papel: "testemunha" },
    ],
    workspace_id: "careli",
    ...patch,
  };
}

describe("a última atividade do Pré-faturamento confere o envelope do contrato", () => {
  it("⚠️ envelope de contrato vivo (1 de 2 assinaram): RECUSADO com 409, a conta na frase, e nada escrito", async () => {
    const { antes, ultima } = doEstagio("contrato", "prazo_legal");
    montar({ atividades_feitas: antes });
    banco.semear("temis_envelopes", envelopeDoContrato());

    const r = await marcarAtividade({ atividade: ultima, feita: true, id: "card-1", quemNome: "Nivea" });

    expect(r).toMatchObject({ ok: false, status: 409 });
    if (r.ok) return;
    expect(r.erro).toContain("faltam assinaturas no contrato: 1 de 2 assinaram");
    // A frase dá a conta, e não os nomes nem os e-mails de quem falta.
    expect(r.erro).not.toMatch(/@|\bT\b/);
    expect(banco.linha("temis_trabalhos", "card-1")?.estagio).toBe("prazo_legal");
    expect(banco.linha("hercules_propostas", "venda-1")?.etapa).toBe("assinatura");
    expect(banco.consultas.filter((c) => c.operacao !== "select")).toEqual([]);
  });

  it("envelope de contrato assinado: o card vai a Faturado como sempre", async () => {
    const { antes, ultima } = doEstagio("contrato", "prazo_legal");
    montar({ atividades_feitas: antes });
    banco.semear("temis_envelopes", envelopeDoContrato({ estado: "assinado", fechado_em: "2026-09-27T09:00:00.000-03:00" }));

    const r = await marcarAtividade({ atividade: ultima, feita: true, id: "card-1" });

    expect(r).toMatchObject({ andou: true, estagio: "faturado", ok: true });
  });

  it("o assinado vence o vivo mais novo (a régua do vigente): passa", async () => {
    const { antes, ultima } = doEstagio("contrato", "prazo_legal");
    montar({ atividades_feitas: antes });
    banco.semear("temis_envelopes", envelopeDoContrato({ estado: "assinado", fechado_em: "2026-09-27T09:00:00.000-03:00" }));
    banco.semear(
      "temis_envelopes",
      envelopeDoContrato({ criado_em: "2026-09-28T12:00:00.000Z", envelope_id: "env-2", id: "reg-2" }),
    );

    const r = await marcarAtividade({ atividade: ultima, feita: true, id: "card-1" });

    expect(r).toMatchObject({ estagio: "faturado", ok: true });
  });

  it("sem envelope (o card antigo, a marcação humana): passa, a regra nova não alcança o passado", async () => {
    const { antes, ultima } = doEstagio("contrato", "prazo_legal");
    montar({ atividades_feitas: antes });
    // Um envelope de OUTRA finalidade (o distrato) na mesma venda não é o contrato.
    banco.semear("temis_envelopes", envelopeDoContrato({ finalidade: "distrato" }));

    const r = await marcarAtividade({ atividade: ultima, feita: true, id: "card-1" });

    expect(r).toMatchObject({ estagio: "faturado", ok: true });
  });

  it("a leitura do envelope falhou: RECUSADO com 503 (não consegui perguntar não é 'assinado')", async () => {
    const { antes, ultima } = doEstagio("contrato", "prazo_legal");
    montar({ atividades_feitas: antes });
    banco.falhar((c) => c.tabela === "temis_envelopes");

    const r = await marcarAtividade({ atividade: ultima, feita: true, id: "card-1" });

    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(banco.linha("temis_trabalhos", "card-1")?.estagio).toBe("prazo_legal");
  });

  it("marcar uma atividade do Pré-faturamento SEM fechar a etapa não confere envelope nenhum", async () => {
    const { antes } = doEstagio("contrato", "prazo_legal");
    montar({ atividades_feitas: [] });
    banco.semear("temis_envelopes", envelopeDoContrato());

    const r = await marcarAtividade({ atividade: antes[0] ?? "", feita: true, id: "card-1" });

    expect(r).toMatchObject({ andou: false, ok: true });
    expect(banco.consultas.some((c) => c.tabela === "temis_envelopes")).toBe(false);
  });
});

// ── O ENVELOPE QUE MORREU DEPOIS DOS COMPRADORES (revisão de 02/10/2026) ─────────────────────────
//
// ⚠️ O CARD ENTRA NO PRÉ-FATURAMENTO COM O ENVELOPE ABERTO, E O ENVELOPE PODE MORRER DEPOIS: a
// vendedora recusa, o prazo vence (o envio manda `canceled` no vencimento parcial) ou alguém cancela.
// A régua do vigente não vê envelope morto, e a trava lia isso como "sem envelope" e deixava faturar.
describe("a trava do Faturado com o envelope do contrato morto", () => {
  for (const estado of ["recusado", "expirado", "cancelado"] as const) {
    it(`envelope ${estado} depois dos compradores: RECUSADO com 409, e nada escrito`, async () => {
      const { antes, ultima } = doEstagio("contrato", "prazo_legal");
      montar({ atividades_feitas: antes });
      banco.semear("temis_envelopes", envelopeDoContrato({ estado }));

      const r = await marcarAtividade({ atividade: ultima, feita: true, id: "card-1" });

      expect(r).toMatchObject({ ok: false, status: 409 });
      if (r.ok) return;
      expect(r.erro).toContain("cancelado, recusado ou venceu antes de todos assinarem");
      expect(banco.linha("temis_trabalhos", "card-1")?.estagio).toBe("prazo_legal");
      expect(banco.consultas.filter((c) => c.operacao !== "select")).toEqual([]);
    });
  }

  it("um cancelado antigo e um assinado novo: passa, o contrato que vale está assinado", async () => {
    const { antes, ultima } = doEstagio("contrato", "prazo_legal");
    montar({ atividades_feitas: antes });
    banco.semear("temis_envelopes", envelopeDoContrato({ estado: "cancelado" }));
    banco.semear(
      "temis_envelopes",
      envelopeDoContrato({
        criado_em: "2026-09-28T12:00:00.000Z",
        envelope_id: "env-2",
        estado: "assinado",
        fechado_em: "2026-09-29T09:00:00.000-03:00",
        id: "reg-2",
      }),
    );

    const r = await marcarAtividade({ atividade: ultima, feita: true, id: "card-1" });

    expect(r).toMatchObject({ estagio: "faturado", ok: true });
  });

  it("na D4Sign, a frase não manda olhar o painel que a tela não mostra", async () => {
    const { antes, ultima } = doEstagio("contrato", "prazo_legal");
    montar({ atividades_feitas: antes });
    banco.semear("temis_envelopes", envelopeDoContrato({ provedor: "d4sign" }));

    const r = await marcarAtividade({ atividade: ultima, feita: true, id: "card-1" });

    expect(r).toMatchObject({ ok: false, status: 409 });
    if (r.ok) return;
    expect(r.erro).toContain("faltam assinaturas no contrato");
    expect(r.erro).not.toContain("painel");
  });
});
