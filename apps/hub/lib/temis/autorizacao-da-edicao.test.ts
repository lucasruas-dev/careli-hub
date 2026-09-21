import { beforeEach, describe, expect, it, vi } from "vitest";

// QUEM ALTERA O CONTRATO À MÃO — a lista nominal, e não o papel.
//
// Lucas, 21/09/2026: *"quem pode editar é a Nivea Careli e Northon Nascimento"*.
//
// ⚠️ PAPEL NÃO RECORTA ESSAS DUAS PESSOAS. Medido no mesmo dia: a Nívea é `admin` e o Northon é
// `leader`; qualquer corte por papel ou deixa o Northon de fora (só admin) ou arrasta mais cinco
// junto (admin + leader). Por isso a régua é uma PERMISSÃO CONCEDIDA, do mesmo mecanismo que a
// migration 0164 já usou para a Raiane no Setup.
//
// ⚠️ E ELA É SÓ DA EDIÇÃO. `autorizarEmissaoDeContrato` guarda outras seis portas (gerar o PDF,
// mandar assinar, trocar signatário, mexer no card, escrever na conversa e o `podeEmitir` que a
// tela recebe). Estreitar aquela função fecharia tudo isso para duas pessoas — muito além do que
// foi pedido, e deixaria quem emite sem ver o texto que o PDF vai imprimir.

const estado = vi.hoisted(() => ({
  concessao: null as null | { permission_id: string },
  erroDaConcessao: null as null | { message: string },
  papel: "leader",
  status: "active",
  tabelasLidas: [] as string[],
}));

vi.mock("@/lib/apolo/server", () => {
  const cliente = {
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
    },
    from: (tabela: string) => {
      estado.tabelasLidas.push(tabela);
      const resposta =
        tabela === "hub_user_permissions"
          ? { data: estado.concessao, error: estado.erroDaConcessao }
          : { data: { id: "user-1", role: estado.papel, status: estado.status }, error: null };
      const proprios: Record<string, unknown> = { maybeSingle: async () => resposta };
      const builder: Record<string, unknown> = new Proxy(proprios, {
        get: (alvo, prop) => (prop in alvo ? alvo[prop as string] : () => builder),
      });
      return builder;
    },
  };

  return { createApoloAdminClient: () => cliente, createApoloUserClient: () => cliente };
});

import { autorizarAlteracaoManualDoContrato } from "@/lib/temis/autorizacao";

function comSessao() {
  return new Request("https://x/api/temis/contrato/edicao", {
    headers: { authorization: "Bearer tok" },
    method: "PUT",
  });
}

beforeEach(() => {
  estado.concessao = null;
  estado.erroDaConcessao = null;
  estado.papel = "leader";
  estado.status = "active";
  estado.tabelasLidas = [];
});

describe("alterar o contrato à mão", () => {
  it("quem recebeu a permissão passa", async () => {
    estado.concessao = { permission_id: "temis-contrato-editar" };

    const resultado = await autorizarAlteracaoManualDoContrato(comSessao());

    expect(resultado.ok).toBe(true);
    expect(estado.tabelasLidas).toContain("hub_user_permissions");
  });

  // ⚠️ SER ADMIN NÃO BASTA, e é isso que a decisão do Lucas quer dizer. Hoje são 3 admins ativos
  // (ele, a Nívea e a Raiane) e 4 leaders; sem esta linha a régua nova nasceria larga de novo.
  it("admin sem a permissão NÃO passa", async () => {
    estado.papel = "admin";

    const resultado = await autorizarAlteracaoManualDoContrato(comSessao());

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.response.status).toBe(403);
  });

  it("leader sem a permissão também não passa", async () => {
    const resultado = await autorizarAlteracaoManualDoContrato(comSessao());
    expect(resultado.ok).toBe(false);
  });

  it("a recusa diz, em português, a quem pedir", async () => {
    const resultado = await autorizarAlteracaoManualDoContrato(comSessao());
    if (resultado.ok) throw new Error("devia ter recusado");

    const corpo = (await resultado.response.json()) as { erro?: string };
    expect(corpo.erro ?? "").toMatch(/contrato/i);
  });

  // ⚠️ QUEM NÃO ESTÁ NO HUB NÃO CHEGA AQUI COM PERMISSÃO DE NINGUÉM. Sessão inválida ou pessoa
  // desativada param antes da consulta — e a consulta nem acontece.
  it("desativado não passa, e a permissão nem é consultada", async () => {
    estado.status = "disabled";
    estado.concessao = { permission_id: "temis-contrato-editar" };

    const resultado = await autorizarAlteracaoManualDoContrato(comSessao());

    expect(resultado.ok).toBe(false);
    expect(estado.tabelasLidas).not.toContain("hub_user_permissions");
  });

  // ⚠️ BANCO FORA DO AR NÃO É "PODE": quem não consegue conferir o acesso responde 503, e não
  // deixa passar por omissão. É a mesma escolha de `respostaDoAlcance` para "indisponível".
  it("falha de leitura recusa com 503, não libera", async () => {
    estado.erroDaConcessao = { message: "timeout" };

    const resultado = await autorizarAlteracaoManualDoContrato(comSessao());

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.response.status).toBe(503);
  });
});
