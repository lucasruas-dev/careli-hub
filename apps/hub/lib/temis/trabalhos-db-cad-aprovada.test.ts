import { beforeEach, describe, expect, it, vi } from "vitest";

// A PORTA 4: `marcarAtividade` — a porta que FOGE de `moverCardDaTemis`, e a mais barata de abrir.
//
// Lucas (26/09/2026): *"faz uma barra, para enviar para contrato precisa da cad validada"*.
//
// ⚠️ MEDIDO: barrar só o Gerar e o Enviar deixa o card entrar em `contrato` por MARCAÇÃO. Marcar a
// última atividade do estágio faz `proximoEstagio` levar `analise` → `contrato`
// (`lib/temis/trabalhos.ts:284`) e `refletirCardNaVenda` (`trabalhos-db.ts:1064`) leva a VENDA junto,
// sem passar por `moverCardDaTemis`. E a porta dela, `POST /api/temis/trabalhos`, é guardada por
// `authorizeApoloRead` (`app/api/temis/trabalhos/route.ts:31`), o papel MAIS BAIXO da casa: admin,
// leader, operator E viewer (`lib/apolo/auth.ts:24`). Quem só tem direito de CONFERIR fazia o card
// entrar em Contrato. Em 08/09/2026 a casa subiu o Gerar de `authorizeApoloRead` para coordenação
// depois de o Lucas dizer *"estou como coordenador, nao pode ter esse botao de gerar contrato"*; esta
// porta ficou para trás.
//
// ⚠️ UMA BARRA QUE COBRE UMA PORTA E DEIXA OUTRA ABERTA É PIOR QUE NENHUMA, porque dá a impressão de
// estar resolvido: o quadro mostraria o card em Contrato e a venda em contrato sem que ninguém
// tivesse passado por barra alguma.
//
// ⚠️ A BARRA VALE PARA A TRANSIÇÃO, NÃO PARA O PASSADO. Marcar ou desmarcar SEM avançar continua
// livre — é correção de registro, e travá-la tiraria de quem arruma card antigo a correção que nunca
// fez mal a ninguém (a mesma disciplina de `recusaPorVendaDesfeita`).

const estado = vi.hoisted(() => ({
  /** O ato que a porta declarou à régua: é ele que escolhe a última oração da frase. */
  atos: [] as string[],
  /** O que a porta perguntou quando o card NÃO tem proposta: documento e empreendimento do card. */
  alvosSemProposta: [] as Array<{ documento: null | string; enterpriseId: null | string }>,
  /** O CPF gravado no card. Vazio = card sem pessoa para conferir. */
  cpfDoCard: "52998224725" as null | string,
  /** O `proposta_id` do card. `null` = card aberto à mão pelo quadro. */
  propostaDoCard: "prop-1" as null | string,
  atualizados: [] as Array<Record<string, unknown>>,
  /** O estágio do card antes da marcação. */
  estagio: "analise",
  /** O TIPO do card. Só o `contrato` é a compra e venda — ver o recorte da barra. */
  tipo: "contrato",
  /** As atividades já feitas do card, para o avanço acontecer no estágio certo. */
  feitas: [] as string[],
  perguntas: [] as Array<null | string>,
  recusaDaCad: null as null | { erro: string; etapa: null | string; status: number },
  reflexos: [] as unknown[],
}));

vi.mock("@/lib/hercules/cad-para-contrato", () => ({
  recusaDaCadDaProposta: async (_sb: unknown, propostaId: null | string, ato: string) => {
    estado.atos.push(ato);
    estado.perguntas.push(propostaId);
    return estado.recusaDaCad;
  },
  // ⚠️ O CAMINHO DO CARD ABERTO À MÃO. `POST /api/temis/trabalhos` abre solicitação de tipo `contrato`
  // com `clienteCpf` e `empreendimentoId` e SEM `propostaId` (`lib/temis/trabalho-servico.ts:524` a
  // `:540`), e a rota é guardada por `authorizeApoloRead` — que inclui `operator` e `viewer`. A barra
  // ficava inerte exatamente no único caminho em que ela tinha os dados na mão.
  recusaDaCadParaContrato: async (
    _sb: unknown,
    alvo: { documento: null | string; enterpriseId: null | string },
    ato: string,
  ) => {
    estado.atos.push(ato);
    estado.alvosSemProposta.push(alvo);
    return estado.recusaDaCad;
  },
}));

// ⚠️ MOCK PARCIAL DE PROPÓSITO: só o reflexo é dublado (ele escreve na venda). `motivoDoReflexo` é
// frase pura e continua a de verdade, para o teste não passar com um reflexo que não existe.
vi.mock("@/lib/hercules/reflexo-da-temis-server", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  refletirCardNaVenda: async (_sb: unknown, passo: unknown) => {
    estado.reflexos.push(passo);
    return { andou: true };
  },
}));

vi.mock("@/lib/apolo/server", () => {
  const consulta = (tabela: string) => {
    const cadeia: Record<string, unknown> = {
      single: () =>
        Promise.resolve({
          data: {
            aberto_por: "u-1",
            atividades_feitas: estado.feitas,
            canal: "hercules",
            cliente_cpf: estado.cpfDoCard,
            cliente_nome: "MAURA MARIA PASSOS",
            criado_em: "2026-09-20T12:00:00.000Z",
            empreendimento_codigo: "VOC",
            empreendimento_id: "37",
            empreendimento_nome: "VOC",
            estagio: estado.estagio,
            estagio_desde: "2026-09-20T12:00:00.000Z",
            enterprise_id: "37",
            id: "card-1",
            proposta_id: estado.propostaDoCard,
            tipo: estado.tipo,
            unidade: "Q03 L06",
          },
          error: null,
        }),
      then: (ok: (r: unknown) => unknown) =>
        Promise.resolve({
          data: tabela === "hercules_propostas" ? { etapa: "contrato" } : [],
          error: null,
        }).then(ok),
    };
    for (const metodo of ["eq", "in", "insert", "order", "select"]) cadeia[metodo] = () => cadeia;
    cadeia.maybeSingle = () =>
      Promise.resolve({
        data: tabela === "hercules_propostas" ? { etapa: "contrato" } : null,
        error: null,
      });
    cadeia.update = (linha: Record<string, unknown>) => {
      if (tabela === "temis_trabalhos") estado.atualizados.push(linha);
      return cadeia;
    };
    return cadeia;
  };
  return { createApoloAdminClient: () => ({ from: consulta }) };
});

import { marcarAtividade } from "./trabalhos-db";

/** A única atividade do estágio `analise` de um card de contrato (`lib/temis/trabalhos.ts:285`). */
const ULTIMA_DA_ANALISE = "Conferir a proposta e o plano vindos do Hércules";

beforeEach(() => {
  estado.alvosSemProposta = [];
  estado.atos = [];
  estado.cpfDoCard = "52998224725";
  estado.propostaDoCard = "prop-1";
  estado.atualizados = [];
  estado.estagio = "analise";
  estado.feitas = [];
  estado.perguntas = [];
  estado.recusaDaCad = null;
  estado.reflexos = [];
  estado.tipo = "contrato";
});

describe("o card não entra em Contrato por marcação quando a CAD não está aprovada", () => {
  it("com a CAD aprovada, a marcação faz o card andar para contrato", async () => {
    const r = await marcarAtividade({ atividade: ULTIMA_DA_ANALISE, feita: true, id: "card-1" });

    expect(r).toMatchObject({ andou: true, estagio: "contrato", ok: true });
    expect(estado.perguntas).toEqual(["prop-1"]);
  });

  it("⚠️ a CAD em validação recusa o avanço, e NADA é escrito no card", async () => {
    estado.recusaDaCad = {
      erro: "A CAD deste cliente está em validação de cadastro desde 26/09/2026. O contrato só sai depois que a CAD for aprovada (etapa Credenciado).",
      etapa: "validacao",
      status: 409,
    };

    const r = await marcarAtividade({ atividade: ULTIMA_DA_ANALISE, feita: true, id: "card-1" });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toContain("em validação de cadastro");
    // Nem o estágio, nem as atividades, nem o reflexo na venda.
    expect(estado.atualizados).toHaveLength(0);
    expect(estado.reflexos).toHaveLength(0);
  });

  it("⚠️ erro de leitura da CAD recusa o avanço, nunca libera", async () => {
    estado.recusaDaCad = {
      erro: "Não foi possível conferir agora se a CAD do titular está aprovada. Nada foi movido; tente de novo em instantes.",
      etapa: null,
      status: 503,
    };

    const r = await marcarAtividade({ atividade: ULTIMA_DA_ANALISE, feita: true, id: "card-1" });

    expect(r.ok).toBe(false);
    expect(estado.atualizados).toHaveLength(0);
  });

  // ⚠️ REGRA DA CASA: a barra vale para a TRANSIÇÃO. Marcar sem fechar o estágio é correção de
  // registro, e continua livre — e nem gasta uma leitura de CAD.
  it("marcar atividade que NÃO faz o card andar continua livre, e não pergunta a CAD", async () => {
    estado.estagio = "contrato";

    const r = await marcarAtividade({
      atividade: "Gerar o contrato pela minuta do empreendimento",
      feita: true,
      id: "card-1",
    });

    expect(r).toMatchObject({ andou: false, ok: true });
    expect(estado.perguntas).toHaveLength(0);
  });

  it("DESMARCAR continua livre mesmo com a CAD barrada: não é avanço", async () => {
    estado.recusaDaCad = {
      erro: "A CAD deste cliente está em revisão pela coordenação desde 14/09/2026.",
      etapa: "revisao",
      status: 409,
    };

    const r = await marcarAtividade({ atividade: ULTIMA_DA_ANALISE, feita: false, id: "card-1" });

    expect(r.ok).toBe(true);
    expect(estado.perguntas).toHaveLength(0);
  });

  // ⚠️ O ATO QUE CUSTA DINHEIRO TAMBÉM NÃO ANDA POR MARCAÇÃO: `contrato` → `assinatura` por
  // marcação existe e é conhecido da casa (`lib/temis/trabalhos.ts:94`, `retorno-para-correcao.ts:36`
  // e `lib/roadmap/roadmap.ts:349`, o card do Henrique que chegou ao fim sem envelope em 09/09/2026).
  it("⚠️ a passagem de contrato para assinatura por marcação também confere a CAD", async () => {
    estado.estagio = "contrato";
    estado.feitas = ["Gerar o contrato pela minuta do empreendimento"];
    estado.recusaDaCad = {
      erro: "A CAD deste cliente está com o cadastro indeferido desde 20/09/2026.",
      etapa: "indeferido",
      status: 409,
    };

    const r = await marcarAtividade({
      atividade: "Definir signatários e a ordem de assinatura",
      feita: true,
      id: "card-1",
    });

    expect(r.ok).toBe(false);
    expect(estado.atualizados).toHaveLength(0);
  });
  // ⚠️ O RECORTE QUE DOIS TESTES ANTIGOS DA CASA PEGARAM (`marcar-atividade-reflexo.test.ts`), e ele é
  // a diferença entre a barra que o Lucas pediu e uma trava absurda. `estagiosDoTipo`
  // (`lib/temis/trabalhos.ts:164`) dá um estágio chamado `contrato` TAMBÉM ao cancelamento, ao
  // distrato, à cessão e à correção — lá ele quer dizer "gerar o termo" (`trabalhos.ts:243`), não
  // "vender". O Lucas barrou a venda NASCER; barrar o cancelamento por causa de uma CAD em revisão
  // prenderia o lote de quem está saindo da venda, que é o oposto do pedido.
  it.each(["cancelamento", "distrato", "cessao"])(
    "⚠️ card de %s NÃO é barrado pela CAD: ali o estágio contrato é o TERMO, não a venda",
    async (tipo) => {
      estado.tipo = tipo;
      estado.recusaDaCad = {
        erro: "A CAD deste cliente está em revisão pela coordenação desde 14/09/2026.",
        etapa: "revisao",
        status: 409,
      };

      const r = await marcarAtividade({
        atividade: tipo === "cancelamento"
          ? "Registrar o motivo do cancelamento"
          : ULTIMA_DA_ANALISE,
        feita: true,
        id: "card-1",
      });

      expect(r.ok).toBe(true);
      expect(estado.perguntas).toHaveLength(0);
    },
  );

  // ⚠️ A FRASE TEM DE DIZER O QUE FAZER NESTA PORTA. "Envie para contrato depois" é a instrução da
  // porta 1; aqui quem lê acabou de marcar uma atividade e o que falta é marcá-la depois.
  it("declara o ato `marcar_atividade` à régua", async () => {
    await marcarAtividade({ atividade: ULTIMA_DA_ANALISE, feita: true, id: "card-1" });

    expect(estado.atos).toEqual(["marcar_atividade"]);
  });

  // ⚠️ O 503 NÃO PODE CHEGAR À ROTA COMO ERRO DO CLIENTE. Esta função jogava o `status` fora e
  // `lib/temis/trabalho-servico.ts` traduzia todo `!ok` para HTTP 400: a frase de fail-closed (*"tente
  // de novo em instantes"*) saía com código de pedido inválido, e as outras três portas da MESMA barra
  // já respondiam 409 e 503. Um monitor que separa pedido errado de falha temporária classificava
  // PostgREST oscilando como pedido errado.
  it("⚠️ leva o `status` da barra no retorno: 503 é 503, e 409 é 409", async () => {
    estado.recusaDaCad = {
      erro: "Não foi possível conferir agora se a CAD do titular está aprovada. Nada foi movido; tente de novo em instantes.",
      etapa: null,
      status: 503,
    };

    const r = await marcarAtividade({ atividade: ULTIMA_DA_ANALISE, feita: true, id: "card-1" });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(503);

    estado.recusaDaCad = {
      erro: "A CAD deste cliente está em validação de cadastro desde 26/09/2026.",
      etapa: "validacao",
      status: 409,
    };

    const outro = await marcarAtividade({ atividade: ULTIMA_DA_ANALISE, feita: true, id: "card-1" });

    expect(outro.ok).toBe(false);
    if (!outro.ok) expect(outro.status).toBe(409);
  });

  // ⚠️ O CARD ABERTO À MÃO ATRAVESSAVA CONTRATO E EM ASSINATURA SEM NENHUMA CONFERÊNCIA. A abertura
  // livre de `POST /api/temis/trabalhos` não passa `propostaId` (`lib/temis/trabalho-servico.ts:524` a
  // `:540`), e `recusaDaCadDaProposta` devolve `null` sem proposta — a barra ficava inerte no único
  // caminho em que tinha `clienteCpf` e `empreendimentoId` na mão. Não sai PDF nem envelope por ali (os
  // dois exigem proposta), mas o quadro do jurídico passava a mostrar um contrato em assinatura de um
  // cliente que ninguém credenciou, e a impressão de estar resolvido é o que a régua diz ser pior que
  // não ter barra.
  it("⚠️ card SEM proposta é conferido pelo CPF e pelo empreendimento DO CARD", async () => {
    estado.propostaDoCard = null;
    estado.recusaDaCad = {
      erro: "A CAD deste cliente está em validação de cadastro desde 26/09/2026.",
      etapa: "validacao",
      status: 409,
    };

    const r = await marcarAtividade({ atividade: ULTIMA_DA_ANALISE, feita: true, id: "card-1" });

    expect(r.ok).toBe(false);
    expect(estado.alvosSemProposta).toEqual([{ documento: "52998224725", enterpriseId: "37" }]);
    expect(estado.atualizados).toHaveLength(0);
  });

  it("card sem proposta E com a CAD aprovada anda normalmente", async () => {
    estado.propostaDoCard = null;

    const r = await marcarAtividade({ atividade: ULTIMA_DA_ANALISE, feita: true, id: "card-1" });

    expect(r).toMatchObject({ andou: true, estagio: "contrato", ok: true });
    expect(estado.alvosSemProposta).toHaveLength(1);
  });

  // ⚠️ SEM CPF NÃO HÁ PESSOA PARA CONFERIR, e inventar uma recusa travaria os quatro cards antigos do
  // Garden e da Lavra que nasceram antes de qualquer elo. Deixa passar e grita no log.
  it("card sem proposta E sem CPF passa, sem perguntar nada", async () => {
    estado.propostaDoCard = null;
    estado.cpfDoCard = null;

    const r = await marcarAtividade({ atividade: ULTIMA_DA_ANALISE, feita: true, id: "card-1" });

    expect(r.ok).toBe(true);
    expect(estado.alvosSemProposta).toHaveLength(0);
    expect(estado.perguntas).toHaveLength(0);
  });
});
