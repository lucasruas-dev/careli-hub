import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  type GuardianMotorClient,
  listGuardianCompromissoStages,
  todayDateOnly,
} from "./compromissos";

// A FIAÇÃO DA ETAPA — a regra tem teste próprio em `etapa-do-compromisso.test.ts`; aqui o que se
// prova é que ela está LIGADA.
//
// ⚠️ SEM ISTO, DESFAZER O CONSERTO PASSAVA VERDE. Tirar `promised_date` do `.select()` deixa a peça
// pura recebendo `undefined`, e a promessa vencida do Vitorino Energy volta a dizer "Promessa de
// pagamento / Aguardar a data prometida" na fila — com a suíte inteira verde e o `tsc` limpo, porque
// o campo é opcional em `LinhaDaEtapa`. Medido em 24/09/2026: nenhum teste do repositório citava
// `listGuardianCompromissoStages` ou `deriveStageFromRows`.

const FONTE = readFileSync(join(__dirname, "compromissos.ts"), "utf8");

describe("o select da etapa, lido como texto", () => {
  it("traz promised_date e approved_at, que são a metade do conserto de 24/09/2026", () => {
    // A coluna é o fato: sem a data prometida no select, a etapa não tem como saber que venceu.
    expect(FONTE).toContain(
      '"client_c2x_id,kind,status,approval_status,approved_at,promised_date,created_at,created_by_user_id,metadata"',
    );
  });

  it("a regra não voltou a morar aqui: quem decide é a peça pura", () => {
    expect(FONTE).toContain('from "@/lib/guardian/etapa-do-compromisso"');
    expect(FONTE).toContain("etapaDoCompromisso(");
  });

  it("hoje vem da régua única da casa, e não de um toISOString local", () => {
    expect(FONTE).toContain('from "@/lib/guardian/hoje-na-casa"');
    expect(FONTE).toContain("return hojeNaCasa(now);");
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
// O comportamento, com o motor mockado.

type LinhaDoMotor = Record<string, unknown>;

function clienteFalso(linhas: LinhaDoMotor[]): GuardianMotorClient {
  const compromissos = {
    limit: () => compromissos,
    order: () => compromissos,
    returns: async () => ({ data: linhas, error: null }),
    select: () => compromissos,
  };
  const usuarios = {
    in: () => usuarios,
    returns: async () => ({ data: [], error: null }),
    select: () => usuarios,
  };

  return {
    from: (tabela: string) => (tabela === "guardian_compromissos" ? compromissos : usuarios),
  } as unknown as GuardianMotorClient;
}

// PR-000015, cliente 3954 = Vitorino Energy Ltda (Veredas do Ouro), prometeu 18/09 e foi aprovado
// em 14/09 11:15 UTC. Medido em 24/09/2026 em `guardian_compromissos`.
const VITORINO: LinhaDoMotor = {
  approval_status: "aprovado",
  approved_at: "2026-09-14T11:15:31.175Z",
  client_c2x_id: 3954,
  created_at: "2026-09-14T11:00:00.000Z",
  created_by_user_id: null,
  kind: "promessa",
  metadata: { submitted_by_name: "Nívea" },
  promised_date: "2026-09-18",
  status: "ativo",
};

describe("listGuardianCompromissoStages", () => {
  it("a promessa vencida do Vitorino chega na fila como A acionar", async () => {
    const etapas = await listGuardianCompromissoStages(clienteFalso([VITORINO]));

    expect(etapas).toHaveLength(1);
    expect(etapas[0]?.clientC2xId).toBe(3954);
    expect(etapas[0]?.stage).toBe("A acionar");
    expect(etapas[0]?.nextAction).toContain("18/09");
    expect(etapas[0]?.nextAction).not.toContain("Aguardar a data prometida");
  });

  it("promessa com data à frente continua segurando a etapa", async () => {
    const etapas = await listGuardianCompromissoStages(
      clienteFalso([{ ...VITORINO, promised_date: "2099-01-01" }]),
    );

    expect(etapas[0]?.stage).toBe("Promessa de pagamento");
  });

  it("o operador vem do submitted_by_name da proposta mais recente", async () => {
    const etapas = await listGuardianCompromissoStages(clienteFalso([VITORINO]));

    expect(etapas[0]?.operator).toBe("Nívea");
  });
});

describe("todayDateOnly", () => {
  it("às 23h30 de Brasília ainda é o dia de Brasília", () => {
    // ⚠️ A PARCELA QUE VENCE HOJE SUMIA DA PREVISIBILIDADE das 21h à meia-noite, porque o dia era
    // calculado em UTC. Pendência escrita no changelog em 24/09/2026 e fechada aqui.
    expect(todayDateOnly(new Date("2026-09-25T02:30:00.000Z"))).toBe("2026-09-24");
  });
});
