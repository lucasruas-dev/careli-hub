import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// A MIGRATION 0202, LIDA COMO TEXTO.
//
// ⚠️ O MESMO CONTRA-VENENO DA 0165 (`posse.test.ts`): o typecheck não alcança o banco. O resultado é
// uma coluna TEXT com CHECK, e o código da rota e do termo fala `sem_corretagem` / `com_corretagem`.
// Renomear um lado e esquecer o outro compila, passa em toda a suíte e só falha em produção, com um
// 23514 na cara da coordenação no momento de gravar.
const SQL = readFileSync(
  join(__dirname, "..", "..", "..", "..", "packages", "database", "migrations", "0202_conferencia_da_corretagem.sql"),
  "utf8",
);

/** O SQL sem os comentários de linha, para as asserções olharem o que o banco executa. */
const COMANDOS = SQL.split("\n")
  .filter((linha) => !/^\s*--/.test(linha))
  .join("\n");

describe("a migration 0202", () => {
  it("é a 0202, e cria a tabela de forma idempotente", () => {
    expect(COMANDOS).toContain("create table if not exists public.hercules_conferencia_corretagem");
  });

  it("tem as colunas combinadas", () => {
    expect(COMANDOS).toContain("id uuid primary key default gen_random_uuid()");
    expect(COMANDOS).toContain("workspace_id text not null default 'careli'");
    expect(COMANDOS).toContain("contrato_c2x_id bigint not null");
    expect(COMANDOS).toContain("resultado text not null");
    expect(COMANDOS).toContain("valor_em_reais numeric(12,2)");
    expect(COMANDOS).toContain("observacao text not null");
    expect(COMANDOS).toContain("conferido_por uuid");
    expect(COMANDOS).toContain("conferido_por_nome text");
    expect(COMANDOS).toContain("conferido_em timestamptz not null default now()");
  });

  it("os resultados do banco são os do código", () => {
    expect(COMANDOS).toContain("resultado in ('sem_corretagem', 'com_corretagem')");
    const rota = readFileSync(
      join(__dirname, "..", "..", "app", "api", "apolo", "rescisao", "conferencia-corretagem", "route.ts"),
      "utf8",
    );
    expect(rota).toContain('["sem_corretagem", "com_corretagem"]');
  });

  it("a observação não pode ser vazia", () => {
    expect(COMANDOS).toContain("length(trim(observacao)) > 0");
  });

  it("o valor é coerente com o resultado (sem = nulo, com = positivo)", () => {
    expect(COMANDOS).toContain("resultado = 'sem_corretagem' and valor_em_reais is null");
    expect(COMANDOS).toContain("resultado = 'com_corretagem' and valor_em_reais > 0");
  });

  // ⚠️ HISTÓRICO (01/10/2026): sem unique por contrato. Cada registro é uma linha nova e vale a mais
  // recente; um unique aqui obrigaria o app a regravar por cima e apagaria o rastro das correções.
  it("é histórico: nenhuma unicidade por contrato", () => {
    expect(COMANDOS).not.toMatch(/\bunique\b/i);
    expect(COMANDOS).not.toMatch(/primary key \(/i);
  });

  it("tem o índice que serve 'a mais recente' e o histórico", () => {
    expect(COMANDOS).toContain("create index if not exists hercules_conferencia_corretagem_por_contrato");
    expect(COMANDOS).toContain("(workspace_id, contrato_c2x_id, conferido_em desc)");
  });

  it("a observação tem teto de 1000 caracteres, o mesmo da rota e do painel", () => {
    expect(COMANDOS).toContain("length(observacao) <= 1000");
  });

  it("RLS ligada, sem policy, e o acesso revogado de anon e authenticated", () => {
    expect(COMANDOS).toContain("alter table public.hercules_conferencia_corretagem enable row level security");
    expect(COMANDOS).not.toMatch(/create policy/i);
    expect(COMANDOS).toContain("revoke all on table public.hercules_conferencia_corretagem from anon");
    expect(COMANDOS).toContain("revoke all on table public.hercules_conferencia_corretagem from authenticated");
  });

  it("documenta a tabela e as colunas", () => {
    expect(COMANDOS).toContain("comment on table public.hercules_conferencia_corretagem");
    expect(COMANDOS).toContain("comment on column public.hercules_conferencia_corretagem.resultado");
    expect(COMANDOS).toContain("comment on column public.hercules_conferencia_corretagem.valor_em_reais");
  });

  it("nada de drop nem de escrita de dados", () => {
    expect(COMANDOS).not.toMatch(/\b(drop|delete|truncate|insert|update)\b/i);
  });
});
