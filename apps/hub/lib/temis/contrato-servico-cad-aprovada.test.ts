import { beforeEach, describe, expect, it, vi } from "vitest";

// A PORTA 2: GERAR O CONTRATO NA TÊMIS — o PDF não nasce sem a CAD aprovada.
//
// Lucas (26/09/2026): *"faz uma barra, para enviar para contrato precisa da cad validada"*.
//
// ⚠️ SÃO DUAS ROTAS, UMA FUNÇÃO. `app/api/temis/contrato/gerar/route.ts:58` (hub, coordenação) e
// `app/api/incorporador/temis/contrato/gerar/route.ts:29` (o espelho do portal, cookie `apolo_inc`,
// hoje só o `cecilio-rocha`) chamam a MESMA `gerarContratoDaProposta`. A barra aqui fecha as duas sem
// editar nenhuma das rotas — e a do portal é a mais exposta, porque o próprio cabeçalho dela declara
// que NÃO HÁ RÉGUA DE PAPEL no portal (a sessão do portal não tem papel por usuário).
//
// ⚠️ A BARRA VEM ANTES DE MONTAR, e é isso que estes testes provam: antes do Chromium, antes do
// bucket, antes de `moverCardDaTemis`. Um contrato que nasce e fica na gaveta sobre uma CAD não
// aprovada é papel com o nome da Careli em cima de uma venda que a coordenação não liberou.

const estado = vi.hoisted(() => ({
  atos: [] as string[],
  montou: 0,
  perguntas: [] as Array<null | string>,
  recusaDaCad: null as null | { erro: string; etapa: null | string; status: number },
}));

// ⚠️ A PORTA CHAMA `recusaDaCadDoAtoDoContrato`, E NÃO `recusaDaCadDaProposta` — a diferença é o
// RECORTE DO TIPO DO CARD, e ela é o conserto de 26/09/2026. `cancelamento`, `cancelamento_correcao`,
// `cessao` e `distrato` nascem com o `propostaId` DA VENDA
// (`lib/temis/cancelar-contrato-servico.ts:685`): sem o recorte, gerar o TERMO que DESFAZ a venda
// recebia a recusa da CAD. O comportamento do recorte é provado em
// `lib/hercules/cad-para-contrato.recorte-do-ato.test.ts`; o que este arquivo prova é a LIGAÇÃO, e que
// o ATO declarado é o desta porta (é ele que escolhe a última oração da frase).
vi.mock("@/lib/hercules/cad-para-contrato", () => ({
  recusaDaCadDoAtoDoContrato: async (_sb: unknown, propostaId: null | string, ato: string) => {
    estado.atos.push(ato);
    estado.perguntas.push(propostaId);
    return estado.recusaDaCad;
  },
}));

// ⚠️ O MONTADOR É O MARCO: se ele foi chamado, a barra deixou passar. Ele devolve "não" de propósito,
// com uma frase inconfundível, para o teste não confundir a recusa da CAD com a dele.
vi.mock("./contrato-da-proposta", () => ({
  montarContratoDaProposta: async () => {
    estado.montou += 1;
    return { erro: "A BARRA DEIXOU PASSAR (montador)", ok: false, status: 422 };
  },
}));

vi.mock("@/lib/apolo/server", () => {
  const consulta = () => {
    const cadeia: Record<string, unknown> = {
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (ok: (r: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(ok),
    };
    for (const metodo of ["eq", "is", "limit", "order", "select"]) cadeia[metodo] = () => cadeia;
    return cadeia;
  };
  return { createApoloAdminClient: () => ({ from: consulta }) };
});

import type { AtorDaTemis } from "./ator";

import { gerarContratoDaProposta } from "./contrato-servico";

/** Ator do HUB: `alcanceDaProposta` devolve "dentro" sem ir ao banco (`contrato-servico.ts:124`). */
const COORDENACAO: AtorDaTemis = {
  tipo: "hub",
  usuarioId: "u-nivea",
  usuarioNome: "Nivea Careli",
} as unknown as AtorDaTemis;

const pedir = () =>
  gerarContratoDaProposta(
    COORDENACAO,
    new Request("https://c2x.app.br/api/temis/contrato/gerar", {
      body: JSON.stringify({ propostaId: "prop-1" }),
      method: "POST",
    }),
  );

beforeEach(() => {
  estado.atos = [];
  estado.montou = 0;
  estado.perguntas = [];
  estado.recusaDaCad = null;
});

describe("gerar o contrato confere a CAD do titular", () => {
  it("com a CAD aprovada, a geração segue e o montador é chamado", async () => {
    const resposta = await pedir();

    expect(estado.perguntas).toEqual(["prop-1"]);
    expect(estado.montou).toBe(1);
    expect((await resposta.json()).erro).toContain("montador");
  });

  // ⚠️ O ATO DECLARADO É O QUE FAZ A FRASE DIZER O QUE FAZER AQUI. Uma frase única terminava sempre com
  // *"envie para contrato depois"*, escrita para a porta 1 — e nesta porta a venda JÁ ESTÁ em
  // `contrato`, e quem lê tem de gerar o contrato, não enviar para contrato.
  it("⚠️ declara o ato `gerar_contrato`, e não o da porta 1", async () => {
    await pedir();

    expect(estado.atos).toEqual(["gerar_contrato"]);
  });

  it("⚠️ a CAD em validação recusa com 409, e o contrato NÃO é montado", async () => {
    estado.recusaDaCad = {
      erro: "A CAD deste cliente está em validação de cadastro desde 26/09/2026. O contrato só sai depois que a CAD for aprovada (etapa Credenciado).",
      etapa: "validacao",
      status: 409,
    };

    const resposta = await pedir();

    expect(resposta.status).toBe(409);
    expect((await resposta.json()).erro).toContain("em validação de cadastro");
    expect(estado.montou).toBe(0);
  });

  it("⚠️ erro de leitura da CAD vira 503, e o contrato NÃO é montado", async () => {
    estado.recusaDaCad = {
      erro: "Não foi possível conferir agora se a CAD do titular está aprovada. Nada foi movido; tente de novo em instantes.",
      etapa: null,
      status: 503,
    };

    const resposta = await pedir();

    expect(resposta.status).toBe(503);
    expect(estado.montou).toBe(0);
  });

  it("a CAD indeferida recusa a geração", async () => {
    estado.recusaDaCad = {
      erro: "A CAD deste cliente está com o cadastro indeferido desde 20/09/2026.",
      etapa: "indeferido",
      status: 409,
    };

    expect((await pedir()).status).toBe(409);
    expect(estado.montou).toBe(0);
  });
});
