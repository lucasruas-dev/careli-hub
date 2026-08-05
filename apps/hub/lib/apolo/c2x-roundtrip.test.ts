import { describe, expect, it } from "vitest";

import {
  C2X_ESCOLARIDADE,
  C2X_ESTADO_CIVIL,
  C2X_FAIXA_RENDA,
  C2X_REGIME_BENS,
  C2X_SEXO,
  matchEstadoCivilId,
  matchRegimeBensId,
  matchSexoId,
} from "./c2x-fields";
import { matchEscolaridadeId, matchFaixaRendaId } from "./c2x-match";

// A VIAGEM DE IDA E VOLTA.
//
// O cadastro do Apolo guarda os domínios JÁ COMO ID (`estadoCivilId`, `rendaId`, ...). Antes de
// enviar ao C2X o dado faz id -> RÓTULO (c2x-write-server) -> id (c2x-write). Se a volta não cair
// no mesmo id, o cliente vai para o C2X com o dado ERRADO — e ninguém percebe, porque a API aceita
// qualquer id válido.
//
// Este arquivo prova, domínio por domínio, se a viagem preserva o valor.

function roundtrip(
  lista: readonly { id: number; label: string }[],
  volta: (label: string) => number | string | null,
) {
  return lista.map((item) => ({
    id: item.id,
    label: item.label,
    ok: String(volta(item.label) ?? "") === String(item.id),
    voltou: volta(item.label),
  }));
}

describe("id -> rótulo -> id preserva o valor", () => {
  it("estado civil", () => {
    const r = roundtrip(C2X_ESTADO_CIVIL, (l) => matchEstadoCivilId(l));
    expect(r.filter((x) => !x.ok)).toEqual([]);
  });

  it("sexo", () => {
    const r = roundtrip(C2X_SEXO, (l) => matchSexoId(l));
    expect(r.filter((x) => !x.ok)).toEqual([]);
  });

  it("regime de bens", () => {
    const r = roundtrip(C2X_REGIME_BENS, (l) => matchRegimeBensId(l));
    expect(r.filter((x) => !x.ok)).toEqual([]);
  });

  it("escolaridade", () => {
    const r = roundtrip(C2X_ESCOLARIDADE, (l) => matchEscolaridadeId(l));
    expect(r.filter((x) => !x.ok)).toEqual([]);
  });

  // ⚠️ O suspeito: matchFaixaRendaId trata texto SEM a palavra "salário" como VALOR EM REAIS.
  it("faixa de renda", () => {
    const r = roundtrip(C2X_FAIXA_RENDA, (l) => matchFaixaRendaId(l));
    expect(r.filter((x) => !x.ok)).toEqual([]);
  });
});
