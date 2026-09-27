import { beforeEach, describe, expect, it, vi } from "vitest";

// A PORTA 3: O ENVIO PARA ASSINATURA — o ato que custa dinheiro e não se desfaz.
//
// Lucas (26/09/2026): *"faz uma barra, para enviar para contrato precisa da cad validada"*.
//
// ⚠️ MEDIDO EM 26/09/2026: `grep -rln credenciad` em `app/api/temis`, `app/api/incorporador/temis`,
// `lib/temis` e `lib/assinatura` devolvia UM arquivo só, `lib/temis/dados-do-contrato.ts:1294`, e ali
// a esteira é lida apenas para NOMEAR o corretor no contrato de corretagem. Nenhuma porta da Têmis
// ou da assinatura conferia CAD. Uma CAD em `validacao` mandava envelope de PRODUÇÃO, que custa e
// cujo cancelamento não se desfaz.
//
// ⚠️ A BARRA MORA NO `impedimento` DE `prepararEnvio`, E ISSO NÃO É CONVENIÊNCIA: é o único ponto
// que fecha as QUATRO portas de uma vez sem editar nenhuma rota, porque
//   • o GET da tela mostra `impedimento` ANTES do clique (`lib/temis/assinatura-servico.ts:359`), e
//   • o POST o EXIGE com 409 ANTES de existir envelope (`envio-db.ts:240`),
// e as duas rotas do hub mais as duas espelho do portal passam pelos dois. O precedente é exato:
// `impedimentoDaVirada0191` (`quadro-db.ts:156`) já é um impedimento assíncrono que lê o banco.
//
// ⚠️ A CLICKSIGN NÃO É CHAMADA AQUI, nem para leitura: conta de produção. Tudo por porta dublada.

const estado = vi.hoisted(() => ({
  atos: [] as string[],
  perguntas: [] as Array<null | string>,
  recusaDaCad: null as null | { erro: string; etapa: null | string; status: number },
}));

// ⚠️ DUBLADA DE PROPÓSITO: o comportamento da régua (etapa por etapa, família, grupo e fail-closed)
// é provado em `lib/hercules/cad-para-contrato.test.ts`. O que este arquivo prova é a LIGAÇÃO.
//
// ⚠️ E A PORTA CHAMA `recusaDaCadDoAtoDoContrato`, QUE CONFERE O TIPO DO CARD ANTES DE BARRAR — o
// conserto de 26/09/2026. Este painel é servido para QUATRO tipos de card, não só o contrato
// (`modules/temis/blocks/trabalho/tela-de-trabalho.tsx:2203` com `EXIGE_ASSINATURA`,
// `lib/temis/trabalhos.ts:145`), e todos chamam esta rota com o MESMO `propostaId` da venda
// (`organizacao-da-assinatura.tsx:165` e `:293`, com o card de saída nascendo em
// `lib/temis/cancelar-contrato-servico.ts:685`). Sem o recorte, a CAD `indeferido` — a que PRODUZ
// distrato — trancava a saída. O recorte em si é provado em
// `lib/hercules/cad-para-contrato.recorte-do-ato.test.ts`.
vi.mock("@/lib/hercules/cad-para-contrato", () => ({
  recusaDaCadDoAtoDoContrato: async (_sb: unknown, propostaId: null | string, ato: string) => {
    estado.atos.push(ato);
    estado.perguntas.push(propostaId);
    return estado.recusaDaCad;
  },
}));

vi.mock("@/lib/temis/dados-do-contrato", () => ({
  dadosDaProposta: async () => ({
    dados: {
      compradores: [{ valores: { nome_cliente: "MAURA MARIA PASSOS" } }],
      gerais: { __empreendimento_id: "37", __unidade_enterprise_id: "37" },
    },
  }),
}));

vi.mock("./quadro-db", () => ({
  assinantesDoQuadro: async () => ({}),
  impedimentoDaVirada0191: async () => null,
}));

vi.mock("./signatarios", () => ({
  conferirSignatarios: () => ({ ok: true }),
  coordenadoraSemQuemAssine: () => null,
  signatariosDoContrato: () => ({
    avisos: [],
    pessoas: [{ email: "maura@exemplo.com", nome: "MAURA MARIA PASSOS", papel: "comprador" }],
  }),
}));

vi.mock("./ordem-db", () => ({
  descreverOrigem: () => "o padrão da casa",
  regraDeOrdemDaVenda: async () => ({ origem: "padrao", regra: { ordenada: false } }),
}));

vi.mock("./ordem", () => ({
  ordenarSignatarios: (pessoas: unknown[]) => pessoas,
}));

import { prepararEnvio } from "./envio-db";

/** Um `hercules_documentos` com o contrato vigente: é só o que `prepararEnvio` lê do banco. */
function sbFake() {
  const cadeia: Record<string, unknown> = {
    then: (ok: (r: unknown) => unknown) =>
      Promise.resolve({
        data: [
          {
            caminho: "careli/contratos/voc0306-v1.pdf",
            criado_em: "2026-09-25T12:00:00.000Z",
            id: "doc-1",
            nome: "Contrato VOC0306 v1.pdf",
            unidade_id: "uni-1",
          },
        ],
        error: null,
      }).then(ok),
  };
  for (const metodo of ["eq", "is", "limit", "order", "select"]) cadeia[metodo] = () => cadeia;
  return { from: () => cadeia } as unknown as Parameters<typeof prepararEnvio>[0];
}

beforeEach(() => {
  estado.atos = [];
  estado.perguntas = [];
  estado.recusaDaCad = null;
});

describe("o envio para assinatura confere a CAD do titular", () => {
  it("com a CAD aprovada, o preparo segue sem impedimento", async () => {
    const preparo = await prepararEnvio(sbFake(), "prop-1");

    expect(preparo.ok).toBe(true);
    if (preparo.ok) expect(preparo.impedimento).toBe(null);
    expect(estado.perguntas).toEqual(["prop-1"]);
  });

  // ⚠️ A FRASE TEM DE DIZER O QUE FAZER NESTA PORTA. A venda aqui já está em `contrato` e o card já
  // existe na Têmis: "envie para contrato depois" (a frase da porta 1) manda a administrativa procurar
  // um botão que não se aplica e descreve um estado que não é o atual. O que falta é reenviar para
  // assinatura.
  it("⚠️ declara o ato `mandar_para_assinatura`, e não o da porta 1", async () => {
    await prepararEnvio(sbFake(), "prop-1");

    expect(estado.atos).toEqual(["mandar_para_assinatura"]);
  });

  // ⚠️ É ESTE TESTE QUE PROTEGE A CONTA DA CLICKSIGN. O impedimento aparece na tela antes do clique
  // e o POST recusa com 409 antes de existir envelope.
  it("⚠️ a CAD em validação vira impedimento, e a frase diz a etapa real", async () => {
    estado.recusaDaCad = {
      erro: "A CAD deste cliente está em validação de cadastro desde 26/09/2026. O contrato só sai depois que a CAD for aprovada (etapa Credenciado).",
      etapa: "validacao",
      status: 409,
    };

    const preparo = await prepararEnvio(sbFake(), "prop-1");

    expect(preparo.ok).toBe(true);
    if (preparo.ok) {
      expect(preparo.impedimento).toContain("em validação de cadastro");
      // ⚠️ A LISTA DE QUEM ASSINA CONTINUA VINDO: é olhando a lista que o operador entende o caso.
      // `prepararEnvio` devolve o impedimento, não recusa (ver o JSDoc dela).
      expect(preparo.signatarios).toHaveLength(1);
    }
  });

  it("a CAD indeferida também vira impedimento", async () => {
    estado.recusaDaCad = {
      erro: "A CAD deste cliente está com o cadastro indeferido desde 20/09/2026.",
      etapa: "indeferido",
      status: 409,
    };

    const preparo = await prepararEnvio(sbFake(), "prop-1");

    if (preparo.ok) expect(preparo.impedimento).toContain("indeferido");
    else throw new Error("o preparo tinha que continuar devolvendo a lista");
  });

  // ⚠️ FAIL-CLOSED: erro de leitura NÃO pode virar impedimento com frase sobre a CAD (isso acusaria
  // o cliente de algo que ninguém mediu) nem liberação. Vira falha do preparo, com 503.
  it("⚠️ erro de leitura da CAD derruba o preparo com 503, nunca libera", async () => {
    estado.recusaDaCad = {
      erro: "Não foi possível conferir agora se a CAD do titular está aprovada.",
      etapa: null,
      status: 503,
    };

    const preparo = await prepararEnvio(sbFake(), "prop-1");

    expect(preparo.ok).toBe(false);
    if (!preparo.ok) {
      expect(preparo.status).toBe(503);
      expect(preparo.erro).not.toMatch(/não está aprovada|não credenciad/i);
    }
  });
});
