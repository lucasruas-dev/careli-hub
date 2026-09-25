import { afterEach, describe, expect, it, vi } from "vitest";

import { type Banco, criarBanco, type Linha } from "./banco-em-memoria.para-teste";
import { cancelarReservaNoHercules, soltarLoteDaVendaDesfeita } from "./cancelar-reserva-server";

// A VENDA DESFEITA SOLTA O LOTE — pela trava, e com a prova pela régua.
//
// Lucas, 24/09/2026: *"lembrando que quando tem cancelamento a unidade tem que ficar disponivel, tem
// que ter esse reflexo"*. E a regra de ouro, Lucas 18/09/2026: *"eu não posso vender dois lotes para
// pessoas diferentes"*. Os dois lados estão travados aqui: o lote volta quando o terreno ficou sem
// dono, e NUNCA volta com outro dono vivo, bloqueado, ou com leitura que falhou.
//
// Medido em 24/09/2026: as 9 vendas desfeitas em setembro pela Têmis soltaram o lote (os 3 que hoje
// aparecem ocupados foram reocupados DEPOIS, legitimamente). Hoje funciona nos casos medidos; este
// arquivo é a garantia escrita.
//
// O cadastro é o do Vale do Ouro: o pai VLO (35) aponta por `espelho_de` para a gleba viva, e a VOR
// (38) é a outra gleba do mesmo chão quando o pai aponta para ela (a mesma montagem de
// `trava-do-lote.test.ts`).

const VLO = "35";
const VOC = "37";
const VOR = "38";

const unidade = (id: string, codigo: string, enterpriseId: string, quadra: string, lote: string, extra: Linha = {}): Linha => ({
  atualizado_em: "2026-09-01T00:00:00.000Z",
  codigo,
  enterprise_id: enterpriseId,
  espelho_de: null,
  id,
  lote,
  origem_c2x_id: null,
  quadra,
  situacao: "disponivel",
  workspace_id: "careli",
  ...extra,
});

const bancos: Banco[] = [];

function cadastro(c: { propostas?: Linha[]; reservas?: Linha[]; unidades?: Linha[] } = {}): Banco {
  const b = criarBanco({
    hercules_propostas: [
      { etapa: "cancelado", id: "venda-21", reserva_id: "res-21", unidade_id: "voc-0306", workspace_id: "careli" },
      ...(c.propostas ?? []),
    ],
    hercules_reservas: [
      { id: "res-21", origem: "coordenador", situacao: "proposta", unidade_id: "voc-0306", workspace_id: "careli" },
      ...(c.reservas ?? []),
    ],
    hercules_unidades: [
      unidade("vlo-0306", "VLO0306", VLO, "03", "06", { espelho_de: "voc-0306", origem_c2x_id: 9001 }),
      unidade("vlo-1206", "VLO1206", VLO, "12", "06", { espelho_de: "vor-1206", origem_c2x_id: 9002 }),
      unidade("voc-0306", "VOC0306", VOC, "03", "06", { origem_c2x_id: 9101, situacao: "reservada" }),
      unidade("vor-1206", "VOR1206", VOR, "12", "06", { origem_c2x_id: 9201 }),
      ...(c.unidades ?? []),
    ],
    prometeu_reservas: [],
  });
  bancos.push(b);
  return b;
}

const VENDA = { id: "venda-21", reserva_id: "res-21", unidade_id: "voc-0306" };

afterEach(() => {
  for (const b of bancos) expect(b.problemas).toEqual([]);
  bancos.length = 0;
  vi.restoreAllMocks();
});

describe("o lote volta quando o terreno ficou sem dono", () => {
  it("VOC0306 cancelado: a reserva ligada cai, o cadastro volta a disponível e a régua confirma", async () => {
    const b = cadastro();

    const r = await soltarLoteDaVendaDesfeita(b.cliente, { aceitos: ["reservada"], venda: VENDA });

    expect(r).toMatchObject({ desfecho: { devolvida: true }, ok: true });
    expect(b.linha("hercules_reservas", "res-21")).toMatchObject({ cancelada_em: null, situacao: "cancelada" });
    expect(b.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
  });

  it("a reserva cai ANTES do lote, e a reserva que não cai PARA antes de soltar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const b = cadastro();
    b.falhar((c) => c.tabela === "hercules_reservas" && c.operacao === "update");

    const r = await soltarLoteDaVendaDesfeita(b.cliente, { aceitos: ["reservada"], venda: VENDA });

    expect(r).toEqual({ ok: false, porque: "reserva_nao_caiu" });
    expect(b.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
    const escritas = b.consultas.filter((c) => c.operacao !== "select").map((c) => c.tabela);
    expect(escritas).toEqual(["hercules_reservas"]);
  });

  it("distrato com cadastro `vendida` volta quando o chamador aceita `vendida`", async () => {
    const b = cadastro({ unidades: [] });
    b.linha("hercules_unidades", "voc-0306")!.situacao = "vendida";
    const r = await soltarLoteDaVendaDesfeita(b.cliente, { aceitos: ["reservada", "vendida"], venda: VENDA });
    expect(r).toMatchObject({ desfecho: { devolvida: true }, ok: true });
    expect(b.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
  });
});

// ⚠️ A VENDA HERDADA DO C2X NÃO TEM RESERVA NENHUMA, E A SOLTURA JÁ AGUENTA ISSO.
//
// Lucas, 25/09/2026: *"essas reservas tem que comportar iguais as outras"*. Medido em 25/09/2026
// (projeto bxgukywoxgivlrhjkwjx, só SELECT): nas 13 propostas herdadas vivas em `reservado` ou
// `proposta`, `hercules_propostas.reserva_id` é NULO em 13/13 e não existe NENHUMA linha em
// `hercules_reservas` para essas unidades. A carga trouxe a PROPOSTA e nunca criou a RESERVA.
//
// ⚠️ E POR ISSO NÃO SE FABRICA RESERVA PARA ELAS. O passo 1 já é condicional (`venda.reserva_id`),
// o passo 2 não acha reserva esquecida, e o passo 3 chama a trava como sempre: é este teste que
// autoriza a porta do cancelamento a mandar a herdada por aqui, sem escrita nova em produção.
describe("a venda HERDADA do C2X: reserva_id nulo e nenhuma linha em hercules_reservas", () => {
  const HERDADA = { id: "venda-c2x", reserva_id: null, unidade_id: "vor-1206" };

  const comHerdada = (situacao: string) => {
    const b = cadastro({
      propostas: [
        {
          etapa: "cancelado",
          id: "venda-c2x",
          origem: "c2x",
          origem_c2x_id: 4234,
          reserva_id: null,
          unidade_id: "vor-1206",
          workspace_id: "careli",
        },
      ],
    });
    b.linha("hercules_unidades", "vor-1206")!.situacao = situacao;
    return b;
  };

  it("cadastro `reservada`: a soltura pula o passo 1, a trava não acha dono e o lote volta", async () => {
    const b = comHerdada("reservada");

    const r = await soltarLoteDaVendaDesfeita(b.cliente, { aceitos: ["reservada"], venda: HERDADA });

    expect(r).toMatchObject({ desfecho: { devolvida: true }, ok: true, reservasCaidas: [] });
    expect(b.linha("hercules_unidades", "vor-1206")?.situacao).toBe("disponivel");
    // Nenhuma escrita em `hercules_reservas`: não há reserva para derrubar nem para inventar.
    expect(b.consultas.filter((c) => c.operacao === "update").map((c) => c.tabela)).toEqual([
      "hercules_unidades",
    ]);
  });

  it("outra herdada VIVA na linha do mesmo chão continua prendendo: a regra de ouro não muda", async () => {
    const b = comHerdada("reservada");
    b.semear("hercules_propostas", {
      etapa: "reservado",
      id: "venda-c2x-irma",
      origem: "c2x",
      origem_c2x_id: 4235,
      reserva_id: null,
      unidade_id: "vor-1206",
      workspace_id: "careli",
    });

    const r = await soltarLoteDaVendaDesfeita(b.cliente, { aceitos: ["reservada"], venda: HERDADA });

    expect(r).toMatchObject({ desfecho: { devolvida: false, porque: "outro_dono" }, ok: true });
    expect(b.linha("hercules_unidades", "vor-1206")?.situacao).toBe("reservada");
  });

  it("cadastro `vendida` (como a carga marcou 2 das 13) só volta quando o chamador aceita `vendida`", async () => {
    const preso = comHerdada("vendida");
    expect(
      await soltarLoteDaVendaDesfeita(preso.cliente, { aceitos: ["reservada"], venda: HERDADA }),
    ).toMatchObject({ desfecho: { devolvida: false, porque: "cadastro", situacao: "vendida" } });
    expect(preso.linha("hercules_unidades", "vor-1206")?.situacao).toBe("vendida");

    const solto = comHerdada("vendida");
    expect(
      await soltarLoteDaVendaDesfeita(solto.cliente, { aceitos: ["reservada", "vendida"], venda: HERDADA }),
    ).toMatchObject({ desfecho: { devolvida: true } });
    expect(solto.linha("hercules_unidades", "vor-1206")?.situacao).toBe("disponivel");
  });
});

describe("a reserva esquecida em `proposta` (a armadilha registrada)", () => {
  // ⚠️ O TESTE ANTIGO PASSAVA PELO PASSO 1 (revisão de 24/09/2026). Ele mandava
  // `venda: { ...VENDA, reserva_id: "res-orfa" }`, e a reserva órfã caía como reserva LIGADA, no
  // passo 1: apagar o passo 2 inteiro não o derrubava. Aqui o chamador traz a reserva VELHA (já
  // cancelada), e a linha da venda no banco aponta outra: só o passo 2 alcança essa.
  it("a linha da venda aponta OUTRA reserva que o chamador leu: o passo 2 a derruba, e o lote volta", async () => {
    const b = cadastro({
      propostas: [{ etapa: "cancelado", id: "venda-antiga", reserva_id: "res-orfa", unidade_id: "vlo-0306", workspace_id: "careli" }],
      reservas: [{ id: "res-orfa", origem: "coordenador", situacao: "proposta", unidade_id: "vlo-0306", workspace_id: "careli" }],
    });
    b.linha("hercules_propostas", "venda-21")!.reserva_id = "res-orfa";
    b.linha("hercules_reservas", "res-21")!.situacao = "cancelada";

    // O chamador ainda tem `res-21` na mão: o passo 1 não casa linha nenhuma.
    const r = await soltarLoteDaVendaDesfeita(b.cliente, { aceitos: ["reservada"], venda: VENDA });

    expect(r).toMatchObject({ desfecho: { devolvida: true }, ok: true });
    expect(b.linha("hercules_reservas", "res-orfa")?.situacao).toBe("cancelada");
    expect(b.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
  });

  // ⚠️ E A RESERVA SEM PROPOSTA NENHUMA NÃO É TOCADA: não há como provar que ela é desta venda, e
  // soltar por engano é a regra de ouro quebrada. Ela segura o lote, e o desfecho diz por quê.
  it("reserva em `proposta` sem proposta ligada nenhuma: não cai, e segura o lote", async () => {
    const b = cadastro({
      reservas: [{ id: "res-sem-dono", origem: "coordenador", situacao: "proposta", unidade_id: "vlo-0306", workspace_id: "careli" }],
    });

    const r = await soltarLoteDaVendaDesfeita(b.cliente, { aceitos: ["reservada"], venda: VENDA });

    expect(b.linha("hercules_reservas", "res-sem-dono")?.situacao).toBe("proposta");
    expect(r.ok && r.desfecho.devolvida).toBe(false);
  });

  it("reserva em `proposta` de OUTRA venda viva no terreno: não cai, e o lote não volta", async () => {
    const b = cadastro({
      propostas: [{ etapa: "proposta", id: "venda-outra", origem: "panteon", reserva_id: "res-outra", unidade_id: "vlo-0306", workspace_id: "careli" }],
      reservas: [{ id: "res-outra", origem: "coordenador", situacao: "proposta", unidade_id: "vlo-0306", workspace_id: "careli" }],
    });

    const r = await soltarLoteDaVendaDesfeita(b.cliente, { aceitos: ["reservada"], venda: VENDA });

    expect(r.ok && r.desfecho.devolvida).toBe(false);
    expect(b.linha("hercules_reservas", "res-outra")?.situacao).toBe("proposta");
    expect(b.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
  });

  it("reserva em `proposta` com propostas mortas que NÃO incluem esta venda: não é nossa, não cai, e segura o lote", async () => {
    const b = cadastro({
      propostas: [{ etapa: "cancelado", id: "venda-de-outro", reserva_id: "res-de-outro", unidade_id: "vlo-0306", workspace_id: "careli" }],
      reservas: [{ id: "res-de-outro", origem: "coordenador", situacao: "proposta", unidade_id: "vlo-0306", workspace_id: "careli" }],
    });

    const r = await soltarLoteDaVendaDesfeita(b.cliente, { aceitos: ["reservada"], venda: VENDA });

    expect(b.linha("hercules_reservas", "res-de-outro")?.situacao).toBe("proposta");
    expect(r.ok && r.desfecho.devolvida).toBe(false);
    expect(b.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
  });
});

describe("o lote NÃO volta, e diz por quê", () => {
  it("reserva ATIVA de outra pessoa no pai: outro dono", async () => {
    const b = cadastro({
      reservas: [{ id: "res-nova", origem: "coordenador", situacao: "ativa", unidade_id: "vlo-0306", workspace_id: "careli" }],
    });
    const r = await soltarLoteDaVendaDesfeita(b.cliente, { aceitos: ["reservada"], venda: VENDA });
    expect(r).toMatchObject({ desfecho: { devolvida: false, porque: "outro_dono" }, ok: true });
    expect(b.linha("hercules_reservas", "res-nova")?.situacao).toBe("ativa");
  });

  it("bloqueada fica bloqueada", async () => {
    const b = cadastro();
    b.linha("hercules_unidades", "voc-0306")!.situacao = "bloqueada";
    const r = await soltarLoteDaVendaDesfeita(b.cliente, { aceitos: ["reservada", "vendida"], venda: VENDA });
    expect(r).toMatchObject({ desfecho: { devolvida: false, porque: "bloqueada" }, ok: true });
    expect(b.linha("hercules_unidades", "voc-0306")?.situacao).toBe("bloqueada");
  });

  it("irmã de outra gleba com cadastro vendida: o cadastro da venda volta, mas a régua segura, e o desfecho diz qual irmã", async () => {
    const b = cadastro({ unidades: [unidade("vor-0306", "VOR0306", VOR, "03", "06", { origem_c2x_id: 9202, situacao: "vendida" })] });

    const r = await soltarLoteDaVendaDesfeita(b.cliente, { aceitos: ["reservada"], venda: VENDA });

    expect(r).toMatchObject({ desfecho: { devolvida: false, irma: "VOR0306", porque: "irma_com_dono" }, ok: true });
    // A irmã NÃO é soltada: decisão pendente do Lucas.
    expect(b.linha("hercules_unidades", "vor-0306")?.situacao).toBe("vendida");
  });

  it("leitura do terreno que falha: não solta", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const b = cadastro();
    b.falhar((c) => c.tabela === "hercules_unidades" && c.operacao === "select");
    const r = await soltarLoteDaVendaDesfeita(b.cliente, { aceitos: ["reservada"], venda: VENDA });
    expect(r.ok && r.desfecho.devolvida).toBe(false);
    expect(b.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
  });

  it("venda sem unidade: nada a soltar, e ninguém inventa lote", async () => {
    const b = cadastro();
    const r = await soltarLoteDaVendaDesfeita(b.cliente, { aceitos: ["reservada"], venda: { ...VENDA, unidade_id: null } });
    expect(r).toMatchObject({ desfecho: { devolvida: false, porque: "leitura_falhou" }, ok: true });
  });
});

// ── OS CAMINHOS DE RESERVA (sem venda): devolverCadastroSeNaoHaOutroDono, SEM MUDANÇA ─────────────
//
// O cupom do salão (Prometeu) e o PATCH de cancelar reserva da tela Venda usam a mesma devolução. Ela
// já faz certo; o teste trava.

describe("cancelar reserva ativa (cupom do salão, via cancelarReservaNoHercules)", () => {
  const comReservaAtiva = (extra: { propostas?: Linha[] } = {}) => {
    const b = cadastro(extra);
    b.linha("hercules_reservas", "res-21")!.situacao = "ativa";
    b.linha("hercules_propostas", "venda-21")!.reserva_id = null;
    return b;
  };

  it("sem outro dono: a reserva cai e o cadastro volta a disponível", async () => {
    const b = comReservaAtiva();
    const r = await cancelarReservaNoHercules(b.cliente, {
      canceladoPor: null,
      canceladoPorNome: "Salão",
      motivo: "Cliente desistiu",
      reservaId: "res-21",
    });
    expect(r).toMatchObject({ cancelada: true, liberada: true, ok: true });
    expect(b.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
  });

  it("com proposta viva de outra venda no terreno: a reserva cai, o lote NÃO solta", async () => {
    const b = comReservaAtiva({
      propostas: [{ etapa: "contrato", id: "venda-viva", origem: "panteon", unidade_id: "vlo-0306", workspace_id: "careli" }],
    });
    const r = await cancelarReservaNoHercules(b.cliente, {
      canceladoPor: null,
      canceladoPorNome: "Salão",
      motivo: "Cliente desistiu",
      reservaId: "res-21",
    });
    expect(r).toMatchObject({ cancelada: true, liberada: false, ok: true });
    expect(b.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
  });
});
