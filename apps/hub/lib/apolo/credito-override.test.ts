import { describe, expect, it } from "vitest";

import { registrarOverrideCredito } from "./credito-override";

// A ORIGEM DO OVERRIDE NA AUDITORIA (16/09/2026).
//
// O portal que opera sozinho (Cecílio) aprova crédito com restrição pelo mesmo registro do hub. Com o
// carimbo fixo "override-coordenacao", a decisão do time do incorporador aparecia como se fosse da
// coordenação da Careli. O parâmetro é opcional: quem não manda (o hub, o seguir-pelo-cônjuge) grava
// exatamente o que gravava.

type Insert = { linha: Record<string, unknown>; tabela: string };

function clienteFalso() {
  const inserts: Insert[] = [];
  const client = {
    from(tabela: string) {
      return {
        insert: (linha: Record<string, unknown>) => {
          inserts.push({ linha, tabela });
          return Promise.resolve({ error: null });
        },
      };
    },
  } as unknown as Parameters<typeof registrarOverrideCredito>[0]["adminClient"];
  return { client, inserts };
}

const base = {
  aprovadoPor: "7b1d2c3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
  aprovadoPorNome: "Maria",
  destino: "credenciado" as const,
  enterpriseId: "39",
  entityId: "11111111-2222-4333-8444-555555555555",
  evidenciaDocId: "doc-1",
  motivo: "Fiador aceito",
};

const origemDaAuditoria = (inserts: Insert[]) =>
  (inserts.find((i) => i.tabela === "apolo_audit_events")?.linha.metadata as Record<string, unknown>)
    ?.origem;

describe("registrarOverrideCredito: a origem", () => {
  it("sem o parâmetro: 'override-coordenacao', como sempre", async () => {
    const { client, inserts } = clienteFalso();
    const r = await registrarOverrideCredito({ ...base, adminClient: client });
    expect(r).toEqual({ auditoria: true, erro: null, estruturado: true });
    expect(origemDaAuditoria(inserts)).toBe("override-coordenacao");
  });

  it("do portal: 'override-portal' na auditoria, e o registro estruturado não muda", async () => {
    const { client, inserts } = clienteFalso();
    await registrarOverrideCredito({ ...base, adminClient: client, origem: "override-portal" });
    expect(origemDaAuditoria(inserts)).toBe("override-portal");
    const estruturado = inserts.find((i) => i.tabela === "apolo_credito_overrides")?.linha;
    expect(estruturado).not.toHaveProperty("origem");
  });
});
