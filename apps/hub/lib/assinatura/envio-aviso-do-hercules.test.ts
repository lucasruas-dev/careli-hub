import { afterEach, describe, expect, it, vi } from "vitest";

import { type Banco, criarBanco, type Linha } from "@/lib/hercules/banco-em-memoria.para-teste";

import { fecharEnvioNoQuadro } from "./envio-db";

// O ENVIO RESPONDE ok COM O AVISO DO HÉRCULES QUANDO A VENDA NÃO ACOMPANHA O CARD.
//
// ⚠️ A REVISÃO DE 24/09/2026 ACHOU A GARANTIA DE PAPEL. `reflexo-na-venda.varredura.test.ts` só
// procurava a palavra `avisoDoHercules` em envio-db.ts: apagar o spread do retorno não derrubava
// teste nenhum. Aqui roda o fim do envio de verdade (o card anda, o reflexo lê e escreve a venda no
// banco em memória) e se confere a RESPOSTA.
//
// ⚠️ É AVISO, NÃO ERRO: o envelope já está ativo na Clicksign. Trocar o `ok` mandaria alguém clicar
// de novo num envio que não se repete.

const bancos: Banco[] = [];
afterEach(() => {
  for (const b of bancos) expect(b.problemas).toEqual([]);
  bancos.length = 0;
  vi.restoreAllMocks();
});

function banco(venda: Linha): Banco {
  const b = criarBanco({
    hercules_proposta_etapas: [],
    hercules_propostas: [
      { etapa: "contrato", etapa_desde: "2026-09-20T12:00:00.000Z", id: "venda-1", workspace_id: "careli", ...venda },
    ],
    temis_trabalho_etapas: [],
    temis_trabalhos: [
      {
        estagio: "contrato",
        estagio_desde: "2026-09-22T12:00:00.000Z",
        id: "card-1",
        proposta_id: "venda-1",
        tipo: "contrato",
        workspace_id: "careli",
      },
    ],
  });
  bancos.push(b);
  return b;
}

const fechar = (b: Banco) =>
  fecharEnvioNoQuadro(b.cliente, {
    comecouEm: "2026-09-23T14:00:00.000Z",
    envelopeId: "env-1",
    nome: "Contrato v1.pdf",
    propostaId: "venda-1",
    registroId: "reg-1",
    signatarios: [],
    usuarioId: "u-nivea",
    usuarioNome: "Nivea",
  });

describe("o fim do envio para assinatura", () => {
  it("a venda acompanha: ok, sem aviso, e a venda foi para assinatura", async () => {
    const b = banco({});
    const r = await fechar(b);
    expect(r).toEqual({ envelopeId: "env-1", nome: "Contrato v1.pdf", ok: true, registroId: "reg-1", signatarios: [] });
    expect(b.linha("temis_trabalhos", "card-1")?.estagio).toBe("assinatura");
    expect(b.linha("hercules_propostas", "venda-1")?.etapa).toBe("assinatura");
  });

  it("a venda NÃO acompanha (voltou a quem vendeu): ok continua true e a resposta leva avisoDoHercules", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const b = banco({ etapa: "proposta" });
    const r = await fechar(b);
    expect(r.ok).toBe(true);
    expect(r.envelopeId).toBe("env-1");
    expect(r.avisoDoHercules).toContain("a venda no Hércules não acompanhou");
    expect(r.avisoDoHercules).toContain('continua em "proposta"');
    expect(b.linha("temis_trabalhos", "card-1")?.estagio).toBe("assinatura");
    expect(b.linha("hercules_propostas", "venda-1")?.etapa).toBe("proposta");
  });

  it("a leitura da venda falha: ok continua true e a resposta leva avisoDoHercules", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const b = banco({});
    b.falhar((c) => c.tabela === "hercules_propostas");
    const r = await fechar(b);
    expect(r.ok).toBe(true);
    expect(r.avisoDoHercules).toContain("não deu para ler a venda");
  });
});
