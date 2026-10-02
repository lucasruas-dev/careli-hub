import { afterEach, describe, expect, it } from "vitest";

import { type Banco, criarBanco, type Linha } from "@/lib/hercules/banco-em-memoria.para-teste";

import { diarioDoQuadroDaD4Sign, quadroDaD4SignDaProposta, quadroDaD4SignParaOPortal } from "./quadro-da-d4sign-db";
import { ACOES_DA_D4SIGN_FICAM_NO_C2X } from "./recusa-de-reenvio";

// O QUADRO DA D4SIGN NO PAINEL DA TÊMIS. Lucas, 02/10/2026: *"os card que estao pelo c2x nao tem nada
// na tela de assinatura"*. A fonte é só o quadro do espelho, uma linha por item (a chave `c2x:`), nunca
// juntando por e-mail; a testemunha vem da marca do C2X e a fila em degraus só com a marca de ordem.
// Pessoas, e-mails e documentos fictícios.

type Item = Record<string, unknown>;

function item(chave: string, patch: Item = {}): Item {
  return { chave, email: `${chave.replace(":", "")}@exemplo.test`, nome: chave, ordem: 0, papel: null, perfil: "Comprador", testemunha: false, ...patch };
}

function linha(patch: Partial<Record<string, unknown>> & { id: string }): {
  atualizado_em: null | string;
  conferido_em: null | string;
  criado_em: string;
  documento_id: null | string;
  enviado_em: null | string;
  envelope_id: null | string;
  estado: string;
  estado_cru: null | string;
  falha: null | string;
  id: string;
  ordenada: boolean | null;
  provedor: string;
  provedor_documento_id: null | string;
  signatarios: unknown;
} {
  return {
    atualizado_em: "2026-10-02T17:00:00Z",
    conferido_em: "2026-10-02T20:08:05Z",
    criado_em: "2026-09-23T17:50:21Z",
    documento_id: null,
    enviado_em: "2026-09-23T17:50:21Z",
    envelope_id: `doc-${patch.id}`,
    estado: "parcial",
    estado_cru: "d4sign:3",
    falha: null,
    ordenada: false,
    provedor: "d4sign",
    provedor_documento_id: `doc-${patch.id}`,
    signatarios: [],
    ...patch,
  } as never;
}

describe("diarioDoQuadroDaD4Sign", () => {
  it("escolhe o envelope VIGENTE (o assinado vence o vivo mais novo; o cancelado não vale)", () => {
    const assinado = linha({ criado_em: "2026-09-01T10:00:00Z", estado: "assinado", id: "velho", signatarios: [item("c2x:1")] });
    const vivo = linha({ criado_em: "2026-09-20T10:00:00Z", id: "novo", signatarios: [item("c2x:2"), item("c2x:3")] });
    const cancelado = linha({ criado_em: "2026-09-25T10:00:00Z", estado: "cancelado", id: "morto", signatarios: [item("c2x:4")] });

    expect(diarioDoQuadroDaD4Sign([vivo, cancelado])?.envelope.id).toBe("novo");
    expect(diarioDoQuadroDaD4Sign([assinado, vivo, cancelado])?.envelope.id).toBe("velho");
    expect(diarioDoQuadroDaD4Sign([cancelado])).toBeNull();
    // "0 de 0" não é quadro: sem pessoas, a tela diz que não há o que mostrar.
    expect(diarioDoQuadroDaD4Sign([linha({ id: "vazio", signatarios: [] })])).toBeNull();
  });

  it("conta como o selo: assinado conta todos; senão, quem tem assinado_em no quadro", () => {
    const quadro = [item("c2x:1", { assinado_em: "2026-09-24T10:00:00-03:00" }), item("c2x:2"), item("c2x:3")];
    const parcial = diarioDoQuadroDaD4Sign([linha({ id: "p", signatarios: quadro })]);
    expect([parcial?.assinaram, parcial?.total]).toEqual([1, 3]);
    const fechado = diarioDoQuadroDaD4Sign([linha({ estado: "assinado", id: "a", signatarios: quadro })]);
    expect([fechado?.assinaram, fechado?.total]).toEqual([3, 3]);
  });

  it("e-mail repetido NÃO junta pessoas: cada item do quadro é uma linha, com a chave e a assinatura dele", () => {
    const quadro = [
      item("c2x:31", { email: "corretor@exemplo.test", nome: "Caio Corretor" }),
      item("c2x:32", { assinado_em: "2026-09-24T10:00:00-03:00", email: "corretor@exemplo.test", nome: "Caio Corretor Filho" }),
    ];
    const diario = diarioDoQuadroDaD4Sign([linha({ id: "x", signatarios: quadro })]);
    expect(diario?.total).toBe(2);
    expect(diario?.envelope.signatarios.map((s) => [s.chave, s.assinouEm])).toEqual([
      ["c2x:31", null],
      ["c2x:32", "2026-09-24T10:00:00-03:00"],
    ]);
  });

  it("com a marca de ordem do C2X (ordenada), vira fila em degraus pelo after_position", () => {
    const quadro = [
      item("c2x:1", { nome: "Zeca", ordem: 2 }),
      item("c2x:2", { nome: "Bia", ordem: 1 }),
      item("c2x:3", { nome: "Ana", ordem: 2 }),
    ];
    const diario = diarioDoQuadroDaD4Sign([linha({ id: "o", ordenada: true, signatarios: quadro })]);
    expect(diario?.envelope.signatarios.map((s) => [s.nome, s.posicao])).toEqual([
      ["Bia", 1],
      ["Ana", 2],
      ["Zeca", 2],
    ]);
  });

  it("sem a marca de ordem, um grupo só (nenhum degrau), em ordem alfabética, mesmo com after_position no quadro", () => {
    const quadro = [item("c2x:1", { nome: "Zeca", ordem: 1 }), item("c2x:2", { nome: "bia", ordem: 3 }), item("c2x:3", { nome: "Ana" })];
    const diario = diarioDoQuadroDaD4Sign([linha({ id: "s", ordenada: false, signatarios: quadro })]);
    expect(diario?.envelope.signatarios.map((s) => [s.nome, s.posicao])).toEqual([
      ["Ana", null],
      ["bia", null],
      ["Zeca", null],
    ]);
  });

  it("a testemunha marcada pelo C2X sai com o papel testemunha; o perfil vem pela régua de sempre", () => {
    const quadro = [
      item("c2x:1", { email: "rh@careli.adm.br", nome: "Ana Testemunha", perfil: "Backoffice", testemunha: true }),
      item("c2x:2", { email: "time@careli.adm.br", nome: "Bia Sem Perfil", perfil: undefined }),
      item("c2x:3", { nome: "Caio Comprador" }),
    ];
    const diario = diarioDoQuadroDaD4Sign([linha({ id: "t", signatarios: quadro })]);
    expect(diario?.envelope.signatarios.map((s) => [s.nome, s.papel, s.perfil])).toEqual([
      ["Ana Testemunha", "testemunha", "Backoffice"],
      ["Bia Sem Perfil", null, "Backoffice"],
      ["Caio Comprador", null, "Comprador"],
    ]);
  });

  it("nenhum gesto da Clicksign: envelopeId nulo, sem log, sem troca; a conferência e o provedor vão juntos", () => {
    const diario = diarioDoQuadroDaD4Sign([linha({ id: "g", signatarios: [item("c2x:1"), item("c2x:2")] })]);
    expect(diario?.envelope).toMatchObject({
      conferidoEm: "2026-10-02T20:08:05Z",
      envelopeId: null,
      provedor: "d4sign",
      provedorDocumentoId: "doc-g",
      venceEm: null,
    });
    expect(diario?.diario).toEqual([]);
    for (const s of diario?.envelope.signatarios ?? []) {
      expect(s.trocaVaiParaOFim).toBeNull();
      expect(s.reenvioIndisponivel).toEqual({ frase: ACOES_DA_D4SIGN_FICAM_NO_C2X, motivo: "sem_id_na_clicksign" });
      expect(s.convite).toBe("sem_noticia");
    }
  });
});

describe("quadroDaD4SignParaOPortal", () => {
  it("sai sem e-mail, sem a chave c2x: e sem o uuid do documento do C2X", () => {
    const diario = diarioDoQuadroDaD4Sign([
      linha({
        id: "portal",
        provedor_documento_id: "8cef4efb-db35-4f6d-b252-3baec8f5be83",
        signatarios: [
          item("c2x:45386", { email: "rh@careli.adm.br", nome: "Zilda Testemunha", perfil: "Backoffice", testemunha: true }),
          item("c2x:45387", { nome: "Ana Compradora" }),
        ],
      }),
    ]);
    expect(diario).not.toBeNull();
    const portal = quadroDaD4SignParaOPortal(diario as NonNullable<typeof diario>);
    const texto = JSON.stringify(portal);
    expect(texto).not.toMatch(/@/);
    expect(texto).not.toMatch(/c2x:/);
    expect(texto).not.toContain("8cef4efb");
    expect(portal.envelope.signatarios.map((s) => [s.chave, s.email, s.nome, s.papel, s.perfil])).toEqual([
      ["pessoa-1", null, "Ana Compradora", null, "Comprador"],
      ["pessoa-2", null, "Zilda Testemunha", "testemunha", "Backoffice"],
    ]);
    expect(portal.envelope).toMatchObject({ envelopeId: null, estadoCru: null, provedor: "d4sign", provedorDocumentoId: null });
    expect([portal.assinaram, portal.total]).toEqual([0, 2]);
  });
});

describe("quadroDaD4SignDaProposta", () => {
  const bancos: Banco[] = [];
  afterEach(() => {
    const problemas = bancos.flatMap((b) => b.problemas);
    bancos.length = 0;
    expect(problemas).toEqual([]);
  });

  const envelope = (patch: Linha): Linha => ({
    ...linha({ id: String(patch.id) }),
    finalidade: "contrato",
    proposta_id: "p-1",
    workspace_id: "careli",
    ...patch,
  });

  it("lê só a D4Sign de CONTRATO desta proposta (a Clicksign e a finalidade nula ficam de fora)", async () => {
    const banco = criarBanco({
      temis_envelopes: [
        envelope({ id: "d4-contrato", signatarios: [item("c2x:1"), item("c2x:2", { assinado_em: "2026-09-24T10:00:00-03:00" })] }),
        envelope({ criado_em: "2026-09-30T10:00:00Z", finalidade: null, id: "d4-outro", signatarios: [item("c2x:9")] }),
        envelope({ criado_em: "2026-09-30T10:00:00Z", id: "cs", provedor: "clicksign", signatarios: [item("k1")] }),
        envelope({ id: "outra-venda", proposta_id: "p-2", signatarios: [item("c2x:7")] }),
      ],
    });
    bancos.push(banco);
    const diario = await quadroDaD4SignDaProposta(banco.cliente, "p-1");
    expect(diario?.envelope.id).toBe("d4-contrato");
    expect([diario?.assinaram, diario?.total]).toEqual([1, 2]);
  });

  it("sem envelope da D4Sign, ou com a leitura que falha, devolve nulo e não lança", async () => {
    const banco = criarBanco({ temis_envelopes: [] });
    bancos.push(banco);
    expect(await quadroDaD4SignDaProposta(banco.cliente, "p-1")).toBeNull();
    banco.falhar((c) => c.tabela === "temis_envelopes");
    expect(await quadroDaD4SignDaProposta(banco.cliente, "p-1")).toBeNull();
    expect(await quadroDaD4SignDaProposta(banco.cliente, "")).toBeNull();
  });
});
