import { beforeEach, describe, expect, it, vi } from "vitest";

// REVISÃO DA ONDA (21/09/2026) — A PORTA ANTIGA FOI FECHADA.
//
// Ela continuava no ar e aceitava o ataque: um lote do Vale do Ouro (VOC 37) recebia com 200 a
// categoria cadastrada no Lagoa Bonita (31), porque `vincularUnidadesACategoria` só conferia que a
// categoria EXISTE (`.eq("id", categoriaId)`, sem filtro de empreendimento). Desde a cadeia do
// contrato isso escolhe a MINUTA do lote, e o teto de 500 por chamada fazia disso 500 contratos
// errados num pedido só. O PATCH passou a responder 410 apontando a porta nova; o GET continua.
//
// Cadastro medido em produção (bxgukywoxgivlrhjkwjx) em 21/09/2026: Lagoa Bonita pai = 31, com as
// duas únicas categorias cadastradas do sistema; Vale do Ouro pai = 35, VOC = 37.

const CATEGORIA_DA_LAGOA = "44444444-4444-4444-8444-444444444444";
const LOTE_DO_VALE = "55555555-5555-4555-8555-555555555555";

const estado = vi.hoisted(() => ({ banco: null as unknown }));

vi.mock("@/lib/apolo/server", async () => {
  const { clienteEmMemoria } = await import("@/lib/temis/fixtures/supabase-em-memoria");
  return {
    createApoloAdminClient: () =>
      clienteEmMemoria(estado.banco as Parameters<typeof clienteEmMemoria>[0]),
  };
});

vi.mock("@/lib/apolo/auth", () => {
  // O papel `operator` (analista) passa em `authorizeApoloWrite`: é o gate real desta rota.
  const autorizar = async () => ({ nome: "Analista", ok: true, userId: "user-1" });
  return { authorizeApoloRead: autorizar, authorizeApoloWrite: autorizar };
});

import * as rotaAntiga from "@/app/api/temis/categorias/unidades/route";
import {
  type EstadoDoBanco,
  novoEstado,
} from "@/lib/temis/fixtures/supabase-em-memoria";

const banco = () => estado.banco as EstadoDoBanco;

beforeEach(() => {
  estado.banco = novoEstado();
  const t = banco().tabelas;
  t.hercules_empreendimentos = [
    { c2x_enterprise_id: "31", codigo: "LAB", id: "emp-lab", nome: "Lagoa Bonita", pai_id: null, workspace_id: "careli" },
    { c2x_enterprise_id: "35", codigo: "VLO", id: "emp-vlo", nome: "Vale do Ouro", pai_id: null, workspace_id: "careli" },
    { c2x_enterprise_id: "37", codigo: "VOC", id: "emp-voc", nome: "Vale do Ouro · VOC", pai_id: "emp-vlo", workspace_id: "careli" },
  ];
  // A categoria mora no Lagoa Bonita (31). O lote é do Vale do Ouro (VOC, 37). Famílias diferentes.
  t.temis_categorias = [
    { ativa: true, enterprise_id: "31", id: CATEGORIA_DA_LAGOA, nome: "Condomínio", workspace_id: "careli" },
  ];
  t.hercules_unidades = [
    {
      apartamento: null,
      categoria_id: null,
      codigo: "VOC0101",
      enterprise_id: "37",
      espelho_de: null,
      id: LOTE_DO_VALE,
      lote: "01",
      quadra: "01",
      situacao: "disponivel",
      torre: null,
      workspace_id: "careli",
    },
  ];
});

function pedir(corpo: unknown): Request {
  return new Request("http://localhost/api/temis/categorias/unidades", {
    body: JSON.stringify(corpo),
    headers: { authorization: "Bearer x", "content-type": "application/json" },
    method: "PATCH",
  });
}

describe("a porta antiga do vínculo de categoria", () => {
  it("o PATCH responde 410 apontando a porta nova, e não toca no banco", async () => {
    const r = await rotaAntiga.PATCH(
      pedir({ categoriaId: CATEGORIA_DA_LAGOA, unidadeIds: [LOTE_DO_VALE] }),
    );

    expect(r.status).toBe(410);
    const corpo = (await r.json()) as { error: string; porta: string };
    expect(corpo.porta).toBe("/api/apolo/empreendimentos/unidades/vinculo");
    expect(corpo.error).toContain("aposentada");

    // O lote da OUTRA família continua sem categoria, e nada foi consultado: a recusa é antes de
    // qualquer leitura. Este era o ataque que passava com 200.
    expect(
      (banco().tabelas.hercules_unidades ?? []).find((l) => l.id === LOTE_DO_VALE)?.categoria_id,
    ).toBeNull();
    expect(banco().consultas).toHaveLength(0);
  });
});
