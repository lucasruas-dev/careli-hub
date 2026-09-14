import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  carimboAoCriar,
  COLUNAS_DA_TRAVA,
  podeDispararLembrete,
  precisaDeAprovacao,
} from "./aprovacao-da-proposta";

const AGORA = "2026-09-14T12:00:00.000Z";

describe("precisaDeAprovacao", () => {
  // A regra do Lucas, em uma linha.
  it("acordo precisa, promessa nao", () => {
    expect(precisaDeAprovacao("acordo")).toBe(true);
    expect(precisaDeAprovacao("promessa")).toBe(false);
  });

  // ⚠️ NA DUVIDA, EXIGE APROVACAO. Um kind novo que entrasse calado na fila e um
  // aborrecimento; um kind novo que passasse direto e dinheiro saindo sem ninguem ver.
  it("tipo desconhecido cai no lado seguro: precisa", () => {
    expect(precisaDeAprovacao("renegociacao")).toBe(true);
    expect(precisaDeAprovacao("")).toBe(true);
  });

  it("nao se perde com caixa ou espaco", () => {
    expect(precisaDeAprovacao(" Promessa ")).toBe(false);
    expect(precisaDeAprovacao("ACORDO")).toBe(true);
  });
});

describe("carimboAoCriar", () => {
  it("acordo nasce pendente e submetido, sem decisao", () => {
    expect(carimboAoCriar("acordo", AGORA)).toEqual({
      approval_status: "pendente",
      approved_at: null,
      approved_by_user_id: null,
      submitted_at: AGORA,
    });
  });

  // ⚠️ APROVADA, MAS POR NINGUEM. `approved_at` nulo e o que separa "nao precisava de
  // aprovacao" de "alguem olhou e aprovou" — e e nisso que a regua se apoia para nao
  // disparar sozinha.
  it("promessa nasce aprovada, sem decisao humana e sem submissao", () => {
    expect(carimboAoCriar("promessa", AGORA)).toEqual({
      approval_status: "aprovado",
      approved_at: null,
      approved_by_user_id: null,
      submitted_at: null,
    });
  });

  it("tipo desconhecido segue o acordo", () => {
    expect(carimboAoCriar("renegociacao", AGORA).approval_status).toBe("pendente");
  });
});

describe("podeDispararLembrete", () => {
  // O comportamento de hoje, preservado: so dispara o que alguem aprovou de fato.
  it("libera o que foi aprovado por gente", () => {
    expect(
      podeDispararLembrete({ approval_status: "aprovado", approved_at: AGORA }).pode,
    ).toBe(true);
  });

  // ⚠️ O CASO QUE ESTE CONSERTO CRIOU: promessa nasce 'aprovado' e, sem esta trava,
  // passaria a mandar WhatsApp para o cliente sem ninguem ter conferido.
  it("segura a promessa que nasceu aprovada sem ninguem decidir", () => {
    const veredito = podeDispararLembrete({
      approval_status: "aprovado",
      approved_at: null,
    });

    expect(veredito.pode).toBe(false);
    expect(veredito.motivo).toContain("decis");
  });

  it("segura o que ainda esta pendente", () => {
    expect(
      podeDispararLembrete({ approval_status: "pendente", approved_at: null }).pode,
    ).toBe(false);
  });

  it("segura o reprovado", () => {
    expect(
      podeDispararLembrete({ approval_status: "reprovado", approved_at: AGORA }).pode,
    ).toBe(false);
  });

  it("segura o que nao tem status nenhum", () => {
    expect(podeDispararLembrete({}).pode).toBe(false);
    expect(podeDispararLembrete({ approval_status: null, approved_at: null }).pode).toBe(
      false,
    );
  });

  // ⚠️ ESTE TESTE EXISTE POR CAUSA DE UM ERRO MEU: liguei a trava na regua e esqueci de
  // acrescentar `approved_at` ao select. O typecheck passou limpo, a suite passou limpa, e a
  // regua teria parado de disparar TUDO — em silencio. So apareceu porque fui conferir o
  // select na mao. O teste amarra o contrato entre a lib e quem consulta o banco.
  it("a regua carrega TODAS as colunas que a trava le", () => {
    const regua = readFileSync(join(__dirname, "regua-cron.ts"), "utf8");
    const select = /\.select\(\s*["'`]([^"'`]*guardian_compromissos[^"'`]*|[^"'`]*approval_status[^"'`]*)["'`]/.exec(
      regua,
    );

    expect(select, "nao achei o select do compromisso na regua").not.toBeNull();

    for (const coluna of COLUNAS_DA_TRAVA) {
      expect(select?.[1], `select da regua sem a coluna ${coluna}`).toContain(coluna);
    }
  });

  it("diz o motivo, para o log da regua nao ficar mudo", () => {
    expect(podeDispararLembrete({ approval_status: "pendente" }).motivo.length)
      .toBeGreaterThan(0);
    expect(podeDispararLembrete({ approval_status: "reprovado" }).motivo).toContain(
      "reprovad",
    );
  });
});
