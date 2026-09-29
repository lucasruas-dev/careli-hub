import { beforeEach, describe, expect, it, vi } from "vitest";

import { criarBanco, type Linha } from "@/lib/hercules/banco-em-memoria.para-teste";

import { lerContratosDoPanteon } from "./contratos-do-panteon";

// A LEITURA ÚNICA CONTRA O BANCO EM MEMÓRIA (F4 da fonte única). O dublê confere os NOMES de coluna
// (as views da 0195 entram pelo `create view` da migration): um `select` com coluna que não existe
// vira `problemas`. O filtro das views é do SQL; aqui se semeia só o que a view devolveria.

const AGORA = new Date("2026-09-28T15:00:00-03:00");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function contrato(n: number, p: Linha = {}): Linha {
  return {
    ar_c2x_id: null,
    cliente_nome: "Cliente",
    criado_em: "2026-09-20T10:00:00+00:00",
    empreendimento_codigo: "VOC",
    enterprise_id: "37",
    etapa: "assinatura",
    gerado_em: "2026-09-24T10:00:00+00:00",
    lote: String(n).padStart(2, "0"),
    origem: "panteon",
    preco_tabela: 100000,
    proposta_id: uuid(n),
    quadra: "01",
    unidade_c2x_id: 5000 + n,
    unidade_codigo: `VOC01${String(n).padStart(2, "0")}`,
    unidade_id: uuid(10_000 + n),
    workspace_id: "careli",
    ...p,
  };
}

function envelope(n: number, p: Linha = {}): Linha {
  return {
    criado_em: "2026-09-25T12:00:00+00:00",
    envelope_id: `env-${n}`,
    enviado_em: "2026-09-25T12:05:00+00:00",
    estado: "aguardando",
    id: uuid(20_000 + n),
    ordenada: true,
    origem: "panteon",
    provedor: "clicksign",
    provedor_documento_id: `doc-${n}`,
    signatarios: [{ chave: "k1", email: "comprador@exemplo.com", nome: "Comprador", ordem: 1, papel: "comprador" }],
    workspace_id: "careli",
    ...p,
  };
}

function unidade(n: number, p: Linha = {}): Linha {
  return {
    codigo: `GDN01${n}`,
    enterprise_id: "39",
    espelho_de: null,
    id: uuid(30_000 + n),
    lote: String(n),
    origem_c2x_id: 9000 + n,
    preco_tabela: 200000,
    quadra: "01",
    workspace_id: "careli",
    ...p,
  };
}

function banco(extra: Record<string, Linha[]> = {}) {
  return criarBanco({
    hercules_empreendimentos: [
      { c2x_enterprise_id: "37", codigo: "VOC", workspace_id: "careli" },
      { c2x_enterprise_id: "39", codigo: "GDN", workspace_id: "careli" },
    ],
    temis_espelho_d4sign: [{ id: 1, ultima_rodada_ok_em: "2026-09-28T14:37:00-03:00" }],
    ...extra,
  });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("lerContratosDoPanteon", () => {
  it("⚠️ lê as vendas do recorte, os envelopes delas e o envelope sem venda do recorte (e só dele)", async () => {
    const b = banco({
      temis_contratos_do_panteon: [contrato(1), contrato(2, { enterprise_id: "36", empreendimento_codigo: "VOL" })],
      temis_envelopes_de_contrato: [
        envelope(1, { proposta_id: uuid(1) }),
        // Sem venda, numa unidade do Garden (39): recorte 39.
        envelope(2, { origem: "c2x", provedor: "d4sign", proposta_id: null, unidade_id: uuid(30_001), c2x_contract_signature_id: 4001 }),
        // Sem venda, noutra unidade do recorte 37.
        envelope(3, { origem: "c2x", provedor: "d4sign", proposta_id: null, unidade_id: uuid(30_002), c2x_contract_signature_id: 4002 }),
      ],
      hercules_unidades: [unidade(1), unidade(2, { codigo: "VOC0199", enterprise_id: "37" })],
    });
    const leitura = await lerContratosDoPanteon({ admin: b.cliente, agora: AGORA, escopo: { enterpriseIds: ["37"] } });
    expect(b.problemas).toEqual([]);
    expect(leitura.ok).toBe(true);
    if (!leitura.ok) return;
    expect(leitura.ultimaRodadaOkEm).toBe("2026-09-28T14:37:00-03:00");
    const codigos = leitura.contratos.map((c) => c.unidade.codigo).sort();
    expect(codigos).toEqual(["VOC0101", "VOC0199"]);
    const semVenda = leitura.contratos.find((c) => c.unidade.codigo === "VOC0199");
    expect(semVenda).toMatchObject({ avisos: ["envelope_sem_venda"], proposta: null });
    expect(semVenda?.unidade.empreendimento).toBe("VOC");
    // O jsonb (com e-mail) só é lido para os envelopes que viram linha: nunca o do Garden.
    const inteiros = b.consultas.filter((c) => c.tabela === "temis_envelopes_de_contrato" && c.filtros.some((f) => f.startsWith("in:id=")));
    expect(inteiros.flatMap((c) => c.filtros).join(" ")).not.toContain(uuid(20_002));
  });

  it("⚠️ contrato de venda desfeita vem, marcado (a tela interna mostra; o portal tira)", async () => {
    const b = banco({
      temis_contratos_do_panteon: [],
      temis_envelopes_de_contrato: [
        envelope(1, { c2x_contract_signature_id: 5, origem: "c2x", proposta_id: uuid(9), provedor: "d4sign", unidade_id: uuid(30_003) }),
      ],
      hercules_propostas: [{ cancelada_em: "2026-09-10T10:00:00+00:00", etapa: "cancelado", id: uuid(9), origem: "c2x", unidade_id: uuid(30_003), workspace_id: "careli" }],
      hercules_unidades: [unidade(3, { codigo: "VOC0303", enterprise_id: "37" })],
    });
    const leitura = await lerContratosDoPanteon({ admin: b.cliente, agora: AGORA, escopo: { enterpriseIds: ["37"] } });
    expect(b.problemas).toEqual([]);
    expect(leitura.ok && leitura.contratos.map((c) => [c.avisos[0], c.noPortal])).toEqual([["contrato_de_venda_desfeita", false]]);
  });

  it("⚠️ falha na view é ok:false (a rota responde 503), nunca lista vazia", async () => {
    const b = banco({ temis_contratos_do_panteon: [contrato(1)] });
    b.falhar((c) => c.tabela === "temis_contratos_do_panteon");
    const leitura = await lerContratosDoPanteon({ admin: b.cliente, agora: AGORA, escopo: { enterpriseIds: ["37"] } });
    expect(leitura).toEqual({ erro: "Não foi possível ler as assinaturas agora.", ok: false });
  });

  it("a campainha fora do ar degrada para nulo (e a tela avisa se o recorte tem D4Sign)", async () => {
    const b = banco({ temis_contratos_do_panteon: [contrato(1)] });
    b.falhar((c) => c.tabela === "temis_espelho_d4sign");
    const leitura = await lerContratosDoPanteon({ admin: b.cliente, agora: AGORA, escopo: { enterpriseIds: ["37"] } });
    expect(leitura.ok && leitura.ultimaRodadaOkEm).toBeNull();
    expect(leitura.ok && leitura.contratos).toHaveLength(1);
  });

  it("⚠️ pagina com ORDEM e manda o `.in()` em lotes de 100 (2.500 vendas)", async () => {
    const vendas = Array.from({ length: 2500 }, (_, i) => contrato(i + 1, { enterprise_id: String(100 + (i % 150)) }));
    const b = banco({ temis_contratos_do_panteon: vendas });
    const ids = Array.from({ length: 150 }, (_, i) => String(100 + i));
    const leitura = await lerContratosDoPanteon({ admin: b.cliente, agora: AGORA, escopo: { enterpriseIds: ids } });
    expect(b.problemas).toEqual([]);
    expect(leitura.ok && leitura.contratos).toHaveLength(2500);
    for (const c of b.consultas) {
      for (const f of c.filtros.filter((f) => f.startsWith("in:"))) {
        expect(f.split("=")[1]?.split(",").length ?? 0).toBeLessThanOrEqual(100);
      }
      // Toda consulta paginada tem ORDEM (sem ela a paginação perde linha com o total batendo).
      if (c.paginada) expect(c.ordem, `${c.tabela} paginada sem ordem`).toBeTruthy();
    }
    expect(b.consultas.filter((c) => c.paginada).length).toBeGreaterThan(0);
  });

  it("⚠️ o recorte vem ANTES do leque: 2.500 envelopes de outros empreendimentos não viram leitura de proposta, unidade nem família", async () => {
    const deFora = Array.from({ length: 2500 }, (_, i) =>
      envelope(100 + i, {
        c2x_contract_signature_id: 10_000 + i,
        origem: "c2x",
        proposta_id: i % 2 === 0 ? null : uuid(50_000 + i),
        provedor: "d4sign",
        unidade_id: uuid(60_000 + i),
      }),
    );
    const b = banco({
      temis_contratos_do_panteon: [contrato(1)],
      temis_envelopes_de_contrato: [
        envelope(1, { proposta_id: uuid(1) }),
        ...deFora,
        // O único solto do recorte: sem venda, numa unidade do 37.
        envelope(3, { origem: "c2x", provedor: "d4sign", proposta_id: null, unidade_id: uuid(30_002), c2x_contract_signature_id: 4002 }),
      ],
      hercules_unidades: [
        unidade(2, { codigo: "VOC0199", enterprise_id: "37" }),
        ...deFora.map((e, i) => unidade(1000 + i, { enterprise_id: "36", id: String(e.unidade_id) })),
      ],
    });
    const leitura = await lerContratosDoPanteon({ admin: b.cliente, agora: AGORA, escopo: { enterpriseIds: ["37"] } });
    expect(b.problemas).toEqual([]);
    expect(leitura.ok && leitura.contratos.map((c) => c.unidade.codigo).sort()).toEqual(["VOC0101", "VOC0199"]);
    // Nenhuma proposta nem unidade de fora é pedida pelo id.
    const pedidasPeloId = b.consultas
      .filter((c) => c.tabela === "hercules_propostas" || (c.tabela === "hercules_unidades" && c.filtros.some((f) => f.startsWith("in:id=") || f.startsWith("in:espelho_de="))))
      .flatMap((c) => c.filtros)
      .join(" ");
    expect(pedidasPeloId).not.toContain(uuid(60_000));
    expect(pedidasPeloId).not.toContain(uuid(50_001));
    // O custo não segue o acervo: poucas idas ao banco, e não uma por lote de 100 soltos de fora.
    expect(b.consultas.length).toBeLessThanOrEqual(15);
  });

  it("⚠️ recorte vazio responde na hora, sem ler nada", async () => {
    const b = banco({ temis_contratos_do_panteon: [contrato(1)], temis_envelopes_de_contrato: [envelope(1, { proposta_id: uuid(1) })] });
    const leitura = await lerContratosDoPanteon({ admin: b.cliente, agora: AGORA, escopo: { enterpriseIds: [] } });
    expect(leitura).toMatchObject({ contratos: [], ok: true });
    expect(b.consultas).toEqual([]);
  });

  it("⚠️ o envelope da venda viva de OUTRO recorte não vira linha sem venda neste", async () => {
    const b = banco({
      temis_contratos_do_panteon: [contrato(1, { enterprise_id: "36" })],
      temis_envelopes_de_contrato: [envelope(1, { proposta_id: uuid(1), unidade_id: uuid(30_004) })],
      hercules_propostas: [{ etapa: "assinatura", id: uuid(1), origem: "panteon", unidade_id: uuid(10_001), workspace_id: "careli" }],
      hercules_unidades: [unidade(4, { enterprise_id: "37" })],
    });
    const leitura = await lerContratosDoPanteon({ admin: b.cliente, agora: AGORA, escopo: { enterpriseIds: ["37"] } });
    expect(leitura.ok && leitura.contratos).toEqual([]);
  });
});
