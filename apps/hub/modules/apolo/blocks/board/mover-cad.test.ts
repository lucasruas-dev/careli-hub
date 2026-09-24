import { afterEach, describe, expect, it, vi } from "vitest";

// AS RÉGUAS DO "MOVER CAD" NA TELA, SEM MONTAR O BOARD (revisão de 24/09/2026).
//
// O comportamento com o Board inteiro está em board-view.mover-cad.comportamento.test.tsx. Aqui ficam
// as funções puras e a chamada, cada uma travada no achado da revisão que a mudou:
//   • o destino some da lista pelo id de MERCADO da CAD (CAD 36 -> 35 -> "Vale do Ouro" não é destino);
//   • `incompleto` não é check verde (o tom vira `atencao`), e o aviso é texto, não hover;
//   • 5xx sem o corpo da rota (timeout da Vercel em HTML) e queda de rede são INCERTOS: a CAD pode ter
//     sido movida, e a tela manda conferir em vez de afirmar que falhou.
// E a terceira rodada (24/09/2026):
//   • lista de destinos vazia é falha de carga, não "nenhum destino";
//   • aviso SEM `incompleto` é informativo: não vira alerta (o tom fica `ok`);
//   • aviso repetido pela rota aparece uma vez só;
//   • 503 do portão e 409 da cobrança de pré-venda chegam à tela com a frase da rota.

const m = vi.hoisted(() => ({ token: vi.fn() }));

vi.mock("../../data/apolo-operations", () => ({ getApoloAccessToken: m.token }));

import {
  avisosDaMudanca,
  destinosParaEscolher,
  FRASE_SEM_CONFIRMACAO,
  FRASE_SEM_DESTINOS,
  FRASE_SEM_OUTRO_DESTINO,
  moverCadDeEmpreendimento,
  type ResultadoDaMudanca,
  rotuloDoSeletor,
  tomDoResultado,
} from "./mover-cad";

const DESTINOS = [
  { id: "group:Lagoa Bonita", nome: "LAGOA BONITA" },
  { id: "35", nome: "VALE DO OURO" },
  { id: "19", nome: "VEREDAS DO OURO" },
];

const resultado = (over: Partial<ResultadoDaMudanca> = {}): ResultadoDaMudanca => ({
  credito: { avaliado: false, motivo: null, passou: null },
  de: "19",
  empreendimentoNovo: "VALE DO OURO",
  etapaAnterior: "credenciado",
  etapaNova: "credito",
  para: "35",
  ...over,
});

describe("destinosParaEscolher", () => {
  it("⚠️ CAD na divisão 36 (mercado 35): o Vale do Ouro não é destino", () => {
    expect(destinosParaEscolher(DESTINOS, "36", "35").map((d) => d.id)).toEqual([
      "group:Lagoa Bonita",
      "19",
    ]);
  });

  it("CAD na divisão 27 do Lagoa Bonita (mercado group:Lagoa Bonita): o Lagoa Bonita não é destino", () => {
    expect(destinosParaEscolher(DESTINOS, "27", "group:Lagoa Bonita").map((d) => d.id)).toEqual([
      "35",
      "19",
    ]);
  });

  it("sem o id de mercado (servidor antigo), ainda tira o id cru", () => {
    expect(destinosParaEscolher(DESTINOS, "19").map((d) => d.id)).toEqual(["group:Lagoa Bonita", "35"]);
    expect(destinosParaEscolher(DESTINOS, "19", null).map((d) => d.id)).toEqual([
      "group:Lagoa Bonita",
      "35",
    ]);
  });
});

describe("rotuloDoSeletor", () => {
  it("com opção: \"Destino\"", () => {
    expect(rotuloDoSeletor(DESTINOS, destinosParaEscolher(DESTINOS, "19"))).toBe("Destino");
  });

  it("⚠️ lista do servidor vazia (catálogo ou portão fora do ar): não carregou, e não \"nenhum destino\"", () => {
    expect(rotuloDoSeletor([], [])).toBe("Não foi possível carregar os empreendimentos agora.");
    expect(FRASE_SEM_DESTINOS).toBe("Não foi possível carregar os empreendimentos agora.");
    expect(rotuloDoSeletor([], [])).not.toMatch(/Nenhum destino/);
  });

  it("a lista veio, mas o único destino é o próprio produto da CAD", () => {
    const soOProprio = [{ id: "35", nome: "VALE DO OURO" }];
    expect(rotuloDoSeletor(soOProprio, destinosParaEscolher(soOProprio, "36", "35"))).toBe(
      FRASE_SEM_OUTRO_DESTINO,
    );
  });
});

describe("tomDoResultado e avisosDaMudanca", () => {
  it("sem aviso e sem reprovação: ok", () => {
    expect(tomDoResultado(resultado())).toBe("ok");
    expect(tomDoResultado(resultado({ avisos: [] }))).toBe("ok");
    expect(tomDoResultado(resultado({ avisos: ["  "] }))).toBe("ok");
  });

  it("⚠️ passou no limite, mas um passo não saiu (`incompleto`): atencao (nunca o check verde)", () => {
    const r = resultado({
      avisos: ["A etapa não foi atualizada."],
      credito: { avaliado: true, motivo: null, passou: true },
      incompleto: true,
    });
    expect(tomDoResultado(r)).toBe("atencao");
    expect(avisosDaMudanca(r)).toEqual(["A etapa não foi atualizada."]);
  });

  it("⚠️ aviso SEM `incompleto` é informativo: o tom fica ok, e o aviso continua escrito", () => {
    // O caso medido: todo Mover para o Lagoa Bonita traz "sem coordenador de vendas no C2X", que não é
    // passo falho e não se resolve reenviando. Em âmbar, virava ruído em todo Mover para lá.
    const r = resultado({
      avisos: ["O Lagoa Bonita está sem coordenador de vendas no C2X. Confira o cadastro do empreendimento."],
      incompleto: false,
    });
    expect(tomDoResultado(r)).toBe("ok");
    expect(tomDoResultado({ ...r, incompleto: undefined })).toBe("ok");
    expect(avisosDaMudanca(r)).toHaveLength(1);
  });

  it("⚠️ aviso repetido pela rota aparece uma vez só", () => {
    // O passo dos vínculos empurra a mesma frase para cada vínculo da origem que falha (35 e 37).
    const r = resultado({
      avisos: [
        "O vínculo com o empreendimento anterior não foi arquivado.",
        "O vínculo com o empreendimento anterior não foi arquivado. ",
        "O PDF da CAD não foi regenerado agora; sai na próxima troca de etapa.",
      ],
      incompleto: true,
    });
    expect(avisosDaMudanca(r)).toEqual([
      "O vínculo com o empreendimento anterior não foi arquivado.",
      "O PDF da CAD não foi regenerado agora; sai na próxima troca de etapa.",
    ]);
  });

  it("`incompleto` sem aviso: atencao, com uma frase que explica", () => {
    const r = resultado({ incompleto: true });
    expect(tomDoResultado(r)).toBe("atencao");
    expect(avisosDaMudanca(r)).toEqual(["A troca não terminou. Confira a etapa da CAD no Board."]);
  });

  it("reprovado vence o aviso (a notícia mais grave), e o aviso continua escrito", () => {
    const r = resultado({
      avisos: ["O PDF da CAD não foi regenerado agora; sai na próxima troca de etapa."],
      credito: { avaliado: true, motivo: "Acima do limite.", passou: false },
    });
    expect(tomDoResultado(r)).toBe("reprovado");
    expect(avisosDaMudanca(r)).toHaveLength(1);
  });

  it("nenhuma frase da tela tem travessão", () => {
    expect(FRASE_SEM_CONFIRMACAO).not.toMatch(/[–—]/);
    expect(FRASE_SEM_DESTINOS).not.toMatch(/[–—]/);
    expect(FRASE_SEM_OUTRO_DESTINO).not.toMatch(/[–—]/);
    expect(avisosDaMudanca(resultado({ incompleto: true })).join(" ")).not.toMatch(/[–—]/);
  });
});

describe("moverCadDeEmpreendimento", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    m.token.mockReset();
  });

  const responder = (resposta: Response | Error) => {
    m.token.mockResolvedValue("token-do-hub");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => (resposta instanceof Error ? Promise.reject(resposta) : Promise.resolve(resposta))),
    );
  };
  const entrada = { de: "19", entityId: "e1", para: "35" };

  it("⚠️ 504 em HTML: incerto, com a frase de conferir", async () => {
    responder(new Response("<html>An error occurred</html>", { status: 504 }));
    expect(await moverCadDeEmpreendimento(entrada)).toEqual({
      error: FRASE_SEM_CONFIRMACAO,
      incerto: true,
      ok: false,
    });
  });

  it("queda de rede: incerto", async () => {
    responder(new TypeError("Failed to fetch"));
    expect(await moverCadDeEmpreendimento(entrada)).toEqual({
      error: FRASE_SEM_CONFIRMACAO,
      incerto: true,
      ok: false,
    });
  });

  it("5xx com a frase da rota: a frase dela, e NÃO é incerto (a rota sai antes de escrever)", async () => {
    responder(Response.json({ error: "Supabase indisponível." }, { status: 503 }));
    expect(await moverCadDeEmpreendimento(entrada)).toEqual({
      error: "Supabase indisponível.",
      incerto: false,
      ok: false,
    });
  });

  it("503 do portão de CAD (leitura que falhou): a frase da rota, sem incerteza", async () => {
    const frase =
      "Não foi possível conferir os empreendimentos que recebem CAD agora. Nada foi alterado.";
    responder(Response.json({ error: frase }, { status: 503 }));
    expect(await moverCadDeEmpreendimento(entrada)).toEqual({ error: frase, incerto: false, ok: false });
  });

  it("409 da cobrança de pré-venda: a frase da rota como veio", async () => {
    // A frase literal da rota (lib/apolo/mover-cad.ts, a recusa da CAD com `pagamento_ref`/`pago_em`).
    const frase =
      "Esta CAD já tem cobrança de pré-venda no empreendimento atual. Mover levaria a cobrança para outro empreendimento. Resolva a cobrança antes de mover.";
    responder(Response.json({ error: frase }, { status: 409 }));
    expect(await moverCadDeEmpreendimento(entrada)).toEqual({ error: frase, incerto: false, ok: false });
  });

  it("4xx sem corpo: o status, sem incerteza", async () => {
    responder(new Response("", { status: 413 }));
    expect(await moverCadDeEmpreendimento(entrada)).toEqual({
      error: "Não foi possível mover a CAD (413).",
      incerto: false,
      ok: false,
    });
  });

  it("sem sessão nada saiu da tela: falha certa, não incerta", async () => {
    m.token.mockRejectedValue(new Error("Sessao administrativa ausente."));
    const chamada = vi.fn();
    vi.stubGlobal("fetch", chamada);
    const r = await moverCadDeEmpreendimento(entrada);
    expect(r).toMatchObject({ incerto: false, ok: false });
    expect(chamada).not.toHaveBeenCalled();
  });

  it("200: devolve o dado da rota", async () => {
    const dado = resultado({ avisos: [], etapaNova: "credito" });
    responder(Response.json({ data: dado }, { status: 200 }));
    expect(await moverCadDeEmpreendimento(entrada)).toEqual({ data: dado, ok: true });
  });
});
