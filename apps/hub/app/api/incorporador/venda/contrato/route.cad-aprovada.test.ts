import { beforeEach, describe, expect, it, vi } from "vitest";

// A PORTA 1: /api/incorporador/venda/contrato — a proposta só vira contrato com a CAD APROVADA.
//
// Lucas (26/09/2026): *"faz uma barra, para enviar para contrato precisa da cad validada"*.
//
// ⚠️ ESTA É A PORTA ESTREITA, e é por ela que o card da Têmis NASCE. Medido em 26/09/2026 (varredura
// do literal `etapa: "contrato"` em app/ e lib/, fora de testes): só DOIS lugares escrevem essa
// etapa — esta rota (`route.ts:203`) e o reflexo da Têmis
// (`lib/hercules/reflexo-da-temis-server.ts:94`), que apenas registra o que o card já fez. Antes
// deste lote a rota tinha ZERO ocorrências de "credenciad" no arquivo inteiro: uma CAD em
// `validacao`, `revisao`, `correcao` e até `indeferido` atravessava inteira e o card entrava na fila
// do jurídico.
//
// ⚠️ A BARRA VEM ANTES DA ESCRITA, e é o que estes testes provam: com a recusa, `hercules_propostas`
// não é tocada, nenhum card abre na Têmis e nenhuma linha entra em `hercules_proposta_etapas`. Uma
// barra depois do `update` deixaria a venda em contrato sem card, que é o estado que a própria rota
// já descreve como o pior de todos (ver o bloco do desfazer, `route.ts:308`).

const estado = vi.hoisted(() => ({
  abertos: [] as Array<Record<string, unknown>>,
  atualizados: [] as Array<{ linha: unknown; tabela: string }>,
  inseridos: [] as Array<{ linha: unknown; tabela: string }>,
  /** O que a barra responde. `null` = pode seguir. */
  recusaDaCad: null as null | { erro: string; etapa: null | string; status: number },
  /** Com que argumentos a barra foi chamada — é aqui que a expansão de escopo se prova. */
  perguntas: [] as Array<{ documento: null | string; enterpriseId: null | string }>,
  sessao: {} as Record<string, unknown>,
  unidade: {} as Record<string, unknown>,
}));

const CADASTRO = vi.hoisted(() => [
  { c2xEnterpriseId: "37", codigo: "VOC", id: "voc", nome: "VOC", operadoPor: null, paiId: "vlo" },
  { c2xEnterpriseId: "35", codigo: "VLO", id: "vlo", nome: "VLO", operadoPor: null, paiId: null },
]);

const GURGEL = {
  incorporadorId: "inc-gurgel",
  slug: "gurgel",
  tipo: "comercial",
  usuarioId: "u-gurgel",
  usuarioNome: "Nivea",
};

vi.mock("@/lib/apolo/incorporador/board-do-portal", () => ({
  autorizarOperacaoDeVenda: () => ({ ok: true, sessao: estado.sessao }),
  autorizarPortalQueOperaSozinho: async (_request: Request, sessao: unknown) => ({ ok: true, sessao }),
}));

vi.mock("@/lib/apolo/incorporador/escopo", async () => {
  const { NextResponse } = await import("next/server");
  return {
    foraDoEscopo: () => NextResponse.json({ error: "Não encontrado." }, { status: 404 }),
    idsDaSessao: async () => ["35", "37"],
  };
});

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: async () => CADASTRO,
  lerCadastroDeEmpreendimentos: async () => ({ com0170: true, linhas: CADASTRO }),
}));

vi.mock("@/lib/temis/trabalhos-db", () => ({
  abrirTrabalho: async (novo: Record<string, unknown>) => {
    estado.abertos.push(novo);
    return { id: "trab-1", ok: true };
  },
}));

// ⚠️ A BARRA É DUBLADA AQUI DE PROPÓSITO. O comportamento dela (etapa por etapa, família, grupo e
// fail-closed) é provado em `lib/hercules/cad-para-contrato.test.ts` com banco falso. O que ESTE
// arquivo prova é a LIGAÇÃO: que a rota chama a régua, com o documento do titular e o empreendimento
// da unidade, e obedece à resposta antes de escrever qualquer linha.
vi.mock("@/lib/hercules/cad-para-contrato", () => ({
  recusaDaCadParaContrato: async (
    _admin: unknown,
    alvo: { documento: null | string; enterpriseId: null | string },
  ) => {
    estado.perguntas.push(alvo);
    return estado.recusaDaCad;
  },
}));

vi.mock("@/lib/apolo/server", () => {
  const consulta = (tabela: string) => {
    let atualizando = false;
    const resposta = () => {
      if (atualizando) return { data: [{ id: "prop-1" }], error: null };
      if (tabela === "hercules_unidades") return { data: estado.unidade, error: null };
      if (tabela === "hercules_propostas") {
        return {
          data: {
            cliente_documento: "52998224725",
            cliente_nome: "MARIA DA SILVA",
            codigo: "VOC0306",
            empreendimento_codigo: "VOC",
            empreendimento_id: "voc",
            etapa_desde: "2026-09-15T10:00:00.000Z",
            etapa_por: "Nivea",
            id: "prop-1",
            protocolo_numero: 12,
          },
          error: null,
        };
      }
      return { data: null, error: null };
    };
    const cadeia: Record<string, unknown> = {
      then: (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) =>
        Promise.resolve(resposta()).then(ok, falha),
    };
    for (const metodo of ["eq", "in", "maybeSingle", "select"]) cadeia[metodo] = () => cadeia;
    cadeia.insert = (linha: unknown) => {
      estado.inseridos.push({ linha, tabela });
      return cadeia;
    };
    cadeia.update = (linha: unknown) => {
      atualizando = true;
      estado.atualizados.push({ linha, tabela });
      return cadeia;
    };
    return cadeia;
  };
  return { createApoloAdminClient: () => ({ from: consulta }) };
});

import { POST } from "./route";

const enviar = () =>
  POST(
    new Request("https://c2x.app.br/api/incorporador/venda/contrato", {
      body: JSON.stringify({ propostaId: "prop-1", unidadeId: "u-1" }),
      method: "POST",
    }),
  );

beforeEach(() => {
  estado.abertos = [];
  estado.atualizados = [];
  estado.inseridos = [];
  estado.perguntas = [];
  estado.recusaDaCad = null;
  estado.sessao = GURGEL;
  // O VOC (37), filho do VLO (35): é o caso real em que a CAD mora no pai.
  estado.unidade = { codigo: "VOC0306", enterprise_id: "37", id: "u-1", lote: "06", quadra: "03" };
});

describe("a CAD tem que estar aprovada para a proposta virar contrato", () => {
  it("com a CAD aprovada, segue como antes: etapa em contrato e card na Têmis", async () => {
    const resposta = await enviar();

    expect(resposta.status).toBe(200);
    expect(estado.atualizados[0]?.linha).toMatchObject({ etapa: "contrato" });
    expect(estado.abertos).toHaveLength(1);
  });

  it("⚠️ pergunta pelo titular da proposta e pelo empreendimento da UNIDADE", async () => {
    await enviar();

    expect(estado.perguntas).toEqual([{ documento: "52998224725", enterpriseId: "37" }]);
  });

  it("⚠️ a CAD em validação recusa com 409, e NADA é escrito", async () => {
    estado.recusaDaCad = {
      erro: "A CAD deste cliente está em validação de cadastro desde 26/09/2026. O contrato só sai depois que a CAD for aprovada (etapa Credenciado).",
      etapa: "validacao",
      status: 409,
    };

    const resposta = await enviar();

    expect(resposta.status).toBe(409);
    expect((await resposta.json()).error).toContain("em validação de cadastro");
    // A barra vem ANTES da escrita: nem etapa, nem card, nem histórico.
    expect(estado.atualizados).toHaveLength(0);
    expect(estado.abertos).toHaveLength(0);
    expect(estado.inseridos).toHaveLength(0);
  });

  it("⚠️ erro de leitura da CAD vira 503, nunca liberação", async () => {
    estado.recusaDaCad = {
      erro: "Não foi possível conferir agora se a CAD do titular está aprovada.",
      etapa: null,
      status: 503,
    };

    const resposta = await enviar();

    expect(resposta.status).toBe(503);
    expect(estado.atualizados).toHaveLength(0);
    expect(estado.abertos).toHaveLength(0);
  });

  it("a CAD indeferida também recusa, e o card não nasce", async () => {
    estado.recusaDaCad = {
      erro: "A CAD deste cliente está com o cadastro indeferido desde 20/09/2026.",
      etapa: "indeferido",
      status: 409,
    };

    const resposta = await enviar();

    expect(resposta.status).toBe(409);
    expect(estado.abertos).toHaveLength(0);
  });

  // ⚠️ A ORDEM IMPORTA: a linha espelho é recusada antes de qualquer pergunta sobre CAD. Medido em
  // 26/09/2026: das 7 propostas vivas em `proposta`, 4 são linha espelho do VLO. Perguntar a CAD
  // delas seria gastar duas leituras para recusar pelo mesmo motivo de sempre.
  it("a linha espelho continua sendo recusada antes da CAD", async () => {
    estado.unidade = { ...estado.unidade, espelho_de: "u-pai" };

    const resposta = await enviar();

    expect(resposta.status).toBe(409);
    expect((await resposta.json()).error).toContain("registro antigo do terreno");
    expect(estado.perguntas).toHaveLength(0);
  });
});
