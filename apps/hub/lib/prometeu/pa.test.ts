import { describe, expect, it } from "vitest";

import { lerPa, podeAtenderRemoto } from "./pa";

// A PA e' a folha A4 com a proposta feita no salao. Ela nao trava o bip (regra do Lucas: no dia
// a internet cai e a fila nao pode parar), mas SEM ela o cliente nao pode ir para o atendimento
// REMOTO — quem atende de fora nao tem o papel na mao.
//
// O risco que estes testes cobrem e' o mesmo que deixou 20 anexos orfaos no Zeus: o CAMINHO do
// arquivo se perder e a tela mostrar um link que nao abre. Aqui, PA sem caminho = PA pendente.

describe("lerPa", () => {
  it("le a PA registrada", () => {
    const pa = lerPa({
      pa: {
        path: "evento-1/cred-1/foto.jpg",
        registradaEm: "2026-08-01T12:00:00Z",
        registradaPor: "operador-1",
      },
    });

    expect(pa?.path).toBe("evento-1/cred-1/foto.jpg");
    expect(pa?.registradaPor).toBe("operador-1");
  });

  // O CASO QUE IMPORTA: linha existe, mas sem caminho. No Zeus isso virou anexo invisivel; aqui
  // tem que virar "pendente", nunca um link quebrado na mao do atendente remoto.
  it("PA sem caminho e' PENDENTE, nao PA", () => {
    expect(lerPa({ pa: { path: "" } })).toBeNull();
    expect(lerPa({ pa: { path: "   " } })).toBeNull();
    expect(lerPa({ pa: { registradaEm: "2026-08-01T12:00:00Z" } })).toBeNull();
  });

  it("metadata sem PA nao inventa nada", () => {
    expect(lerPa({})).toBeNull();
    expect(lerPa({ provider: "evolution" })).toBeNull();
    expect(lerPa(null)).toBeNull();
    expect(lerPa(undefined)).toBeNull();
  });

  it("metadata torto nao quebra", () => {
    expect(lerPa("texto solto")).toBeNull();
    expect(lerPa(42)).toBeNull();
    expect(lerPa([{ pa: { path: "x" } }])).toBeNull();
    expect(lerPa({ pa: "so-um-texto" })).toBeNull();
    expect(lerPa({ pa: ["array"] })).toBeNull();
  });

  it("aceita PA sem os campos opcionais", () => {
    const pa = lerPa({ pa: { path: "evento/cred/foto.jpg" } });

    expect(pa?.path).toBe("evento/cred/foto.jpg");
    expect(pa?.registradaPor).toBeNull();
    expect(pa?.registradaEm).toBe("");
  });
});

describe("podeAtenderRemoto", () => {
  // A regra de negocio: o REMOTO exige a PA; o presencial nao passa por aqui.
  it("libera o remoto so com a PA registrada", () => {
    expect(podeAtenderRemoto({ pa: { path: "evento/cred/foto.jpg" } })).toBe(true);
  });

  it("bloqueia o remoto sem PA", () => {
    expect(podeAtenderRemoto({})).toBe(false);
    expect(podeAtenderRemoto({ pa: { path: "" } })).toBe(false);
    expect(podeAtenderRemoto(null)).toBe(false);
  });
});
