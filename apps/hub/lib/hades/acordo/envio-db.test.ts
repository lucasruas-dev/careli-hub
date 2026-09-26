import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GuardianCompromissoDetail } from "@/lib/guardian/compromissos";

import { ASSINANTE_DA_CARELI } from "@/lib/hades/acordo/assinante-da-careli";
import { MOTIVOS_DO_TERMO } from "@/lib/hades/dossie/termo-de-acordo-gate";

// ────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ NADA AQUI TOCA A CLICKSIGN, E ISSO NÃO É PRECIOSISMO DE ARQUITETURA. A conta configurada é de
// PRODUÇÃO (Lucas, 08/09/2026: *"o sandbox esta com problemas, vamos de prod mesmo"*), cada
// envelope criado tem CUSTO e, depois de ativado, NÃO SE APAGA. Um teste que chamasse a API de
// verdade deixaria lixo pago e permanente na conta a cada `vitest run`. A porta HTTP é um duplo,
// como em `clicksign/envelope.test.ts`.
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ E O QUE OS TRÊS CASOS DO LUCAS PROVAM (20/09/2026, *"o acordo so pode ficar disponivel para
// envio depois da aprovacao"*): sem aprovação e reprovado NÃO chamam a Clicksign NENHUMA VEZ, e
// aprovado chama. A contagem de chamadas do duplo é a prova — não basta a frase de recusa voltar
// se um envelope já tiver nascido do outro lado.

// A leitura da venda e o quadro do empreendimento são de outras camadas (elas têm teste próprio):
// aqui interessa o que ESTE arquivo faz com o que elas devolvem.
const leituraDaVenda = vi.fn();
const quadroDoEmpreendimento = vi.fn();

vi.mock("@/lib/temis/dados-do-contrato", () => ({
  dadosDaProposta: (...args: unknown[]) => leituraDaVenda(...args),
}));

vi.mock("@/lib/assinatura/quadro-db", () => ({
  // ⚠️ O APONTADO PARA OS TERMOS NÃO EXISTE NESTES CASOS, e é o que mantém estes testes contando a
  // história de antes de 20/09/2026: sem ninguém apontado, o envio cai na vendedora do quadro,
  // exatamente como caía. O caso COM apontado tem teste próprio em
  // `assinante-de-termos-no-envio.test.ts`.
  assinanteDeTermosDaVendedora: async () => null,
  assinantesDoQuadro: (...args: unknown[]) => quadroDoEmpreendimento(...args),
}));

const {
  cancelarAssinaturaDoAcordo,
  enviarAcordoParaAssinatura,
  MIGRATION_DO_ELO_DO_ACORDO,
  prepararEnvioDoAcordo,
} = await import("./envio-db");

// ── O CASO ──────────────────────────────────────────────────────────────────

const acordo = (patch: Partial<GuardianCompromissoDetail> = {}): GuardianCompromissoDetail =>
  ({
    acquisitionRequestC2xId: 9001,
    approvalStatus: "aprovado",
    clientC2xId: 2508,
    id: "11111111-2222-3333-4444-555555555555",
    kind: "acordo",
    metadata: {},
    parcelas: [{ amount: 591.08, dueDate: "2026-07-15", id: "p1", sequence: 1 }],
    protocol: "AC-000042",
    status: "ativo",
    ...patch,
  }) as unknown as GuardianCompromissoDetail;

/** O que `dadosDaProposta` devolve, no recorte que este arquivo lê. */
function vendaDoPanteon(valores: Record<string, string> = {}) {
  return {
    avisos: [],
    carteira: null,
    dados: {
      compradores: [
        {
          temConjuge: false,
          valores: {
            cpf_cliente: "444.555.666-17",
            email_cliente: "comprador@exemplo.test",
            nome_cliente: "Beltrano Exemplo Ferreira",
            telefone_cliente: "31999990000",
          },
        },
      ],
      gerais: {
        __empreendimento_id: "19",
        codigo_unidade: "VDO1301",
        empreendimento_codigo: "VDO",
        ...valores,
      },
    },
  };
}

const representante = {
  cpf: "111.222.333-44",
  email: "representante@incorporadora.test",
  nome: "Fulana Representante Legal",
  papel: "vendedora" as const,
  telefone: null,
};

const PDF_PRONTO = async () => ({
  bytes: new Uint8Array([37, 80, 68, 70]),
  nome: "Termo de Acordo - BELTRANO - VDO1301 - 20-09-2026.pdf",
  ok: true as const,
});

// ── OS DUPLOS ───────────────────────────────────────────────────────────────

/**
 * O duplo do Supabase: a venda, as linhas de `temis_envelopes`, e o que foi escrito.
 *
 * `erroDosEnvelopes` simula a migration 0179 ausente — o 42703 do Postgres.
 */
function bancoDeTeste(dados: {
  envelopes?: Record<string, unknown>[];
  erroDosEnvelopes?: { code: string; message: string };
  erroNoInsert?: { code: string; message: string };
}) {
  const escritas: { patch: Record<string, unknown>; tabela: string }[] = [];

  const from = (tabela: string) => {
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      eq: () => builder,
      insert: (patch: Record<string, unknown>) => {
        escritas.push({ patch, tabela });
        return builder;
      },
      limit: () =>
        tabela === "temis_envelopes"
          ? Promise.resolve({
              data: dados.erroDosEnvelopes ? null : (dados.envelopes ?? []),
              error: dados.erroDosEnvelopes ?? null,
            })
          : builder,
      maybeSingle: () =>
        Promise.resolve(
          tabela === "hercules_propostas"
            ? { data: { id: "prop-1", unidade_id: "uni-1" }, error: null }
            : dados.erroNoInsert
              ? { data: null, error: dados.erroNoInsert }
              : { data: { id: "registro-1" }, error: null },
        ),
      order: () => builder,
      select: () => builder,
      // O builder do Supabase é um `PromiseLike`: `update().eq()` é aguardado direto.
      then: (resolver: (r: { error: null }) => unknown) =>
        Promise.resolve(resolver({ error: null })),
      update: (patch: Record<string, unknown>) => {
        escritas.push({ patch, tabela });
        return builder;
      },
    });
    return builder;
  };

  return { escritas, sb: { from } as unknown as SupabaseClient };
}

/** O duplo da porta HTTP da Clicksign. Ver a nota de `PortaDaClicksign`. */
function portaDeTeste(respostas: Record<string, unknown> = {}) {
  const chamadas: { caminho: string; metodo: string }[] = [];
  /** Quantas vezes cada chave já respondeu — só serve às filas de resposta (ver abaixo). */
  const vezes = new Map<string, number>();

  const porta = async <T = unknown>(
    caminho: string,
    opcoes: { metodo?: string } = {},
  ): Promise<T> => {
    const metodo = opcoes.metodo ?? "GET";
    chamadas.push({ caminho, metodo });

    for (const [padrao, resposta] of Object.entries(respostas)) {
      if (`${metodo} ${caminho}`.includes(padrao)) {
        // ⚠️ UM ARRAY É UMA FILA DE RESPOSTAS PARA A MESMA CHAVE, e ela existe porque o cancelamento
        // faz DUAS leituras do mesmo envelope desde 25/09/2026: a de antes, que decide se pode
        // cancelar, e a de DEPOIS do PATCH, que confirma que o envelope morreu — o 200 do PATCH no
        // documento fala só do documento (ver `cancelarEnvelope`). A última resposta da fila repete.
        if (Array.isArray(resposta)) {
          const vez = Math.min(vezes.get(padrao) ?? 0, resposta.length - 1);
          vezes.set(padrao, vez + 1);
          const daVez = resposta[vez];
          if (daVez instanceof Error) throw daVez;
          return daVez as T;
        }
        if (resposta instanceof Error) throw resposta;
        return resposta as T;
      }
    }

    if (metodo === "POST" && caminho === "/envelopes") return { data: { id: "env-acordo" } } as T;
    if (caminho.endsWith("/documents")) return { data: { id: "doc-acordo" } } as T;
    if (caminho.endsWith("/signers")) return { data: { id: "sig-1" } } as T;
    return {} as T;
  };

  return { chamadas, porta };
}

beforeEach(() => {
  leituraDaVenda.mockReset();
  quadroDoEmpreendimento.mockReset();
  leituraDaVenda.mockResolvedValue(vendaDoPanteon());
  quadroDoEmpreendimento.mockResolvedValue([representante]);
});

// ── OS TRÊS CASOS DO LUCAS ──────────────────────────────────────────────────

describe("só acordo APROVADO vai para a Clicksign", () => {
  it("SEM APROVAÇÃO: recusa com a frase, e não chama a Clicksign nem uma vez", async () => {
    const { escritas, sb } = bancoDeTeste({});
    const { chamadas, porta } = portaDeTeste();

    const saida = await enviarAcordoParaAssinatura(
      sb,
      acordo({ approvalStatus: "pendente" }),
      {},
      { montarPdf: PDF_PRONTO, porta },
    );

    expect(saida.ok).toBe(false);
    if (!saida.ok) {
      expect(saida.erro).toBe(MOTIVOS_DO_TERMO.pendente);
      expect(saida.status).toBe(409);
    }
    // ⚠️ ZERO CHAMADAS E ZERO ESCRITAS: nada nasceu na conta, e nenhuma linha ficou pendurada.
    expect(chamadas).toHaveLength(0);
    expect(escritas).toHaveLength(0);
  });

  it("REPROVADO: recusa com a frase, e não chama a Clicksign nem uma vez", async () => {
    const { escritas, sb } = bancoDeTeste({});
    const { chamadas, porta } = portaDeTeste();

    const saida = await enviarAcordoParaAssinatura(
      sb,
      acordo({ approvalStatus: "reprovado" }),
      {},
      { montarPdf: PDF_PRONTO, porta },
    );

    expect(saida.ok).toBe(false);
    if (!saida.ok) expect(saida.erro).toBe(MOTIVOS_DO_TERMO.reprovado);
    expect(chamadas).toHaveLength(0);
    expect(escritas).toHaveLength(0);
  });

  it("APROVADO: manda, com as três partes na ordem, e carimba o envelope", async () => {
    const { sb } = bancoDeTeste({});
    const { chamadas, porta } = portaDeTeste();

    const saida = await enviarAcordoParaAssinatura(
      sb,
      acordo(),
      { usuarioNome: "Operador da Cobrança" },
      { montarPdf: PDF_PRONTO, porta },
    );

    expect(saida.ok).toBe(true);
    if (saida.ok) {
      expect(saida.envelopeId).toBe("env-acordo");
      expect(saida.signatarios.map((s) => [s.papel, s.ordem])).toEqual([
        ["comprador", 1],
        ["vendedora", 2],
        ["careli", 3],
      ]);
    }

    // Os seis passos da Clicksign aconteceram, e o envelope foi ATIVADO e NOTIFICADO.
    expect(chamadas.some((c) => c.metodo === "POST" && c.caminho === "/envelopes")).toBe(true);
    expect(chamadas.filter((c) => c.caminho.endsWith("/signers"))).toHaveLength(3);
    expect(chamadas.some((c) => c.metodo === "PATCH")).toBe(true);
    expect(chamadas.some((c) => c.caminho.endsWith("/notifications"))).toBe(true);
  });
});

// ── A LINHA QUE LIGA O ENVELOPE AO ACORDO ───────────────────────────────────

describe("o registro em temis_envelopes", () => {
  it("nasce ANTES da chamada, com o compromisso e SEM proposta", async () => {
    const { escritas, sb } = bancoDeTeste({});
    const { porta } = portaDeTeste();

    await enviarAcordoParaAssinatura(sb, acordo(), {}, { montarPdf: PDF_PRONTO, porta });

    const insert = escritas.find((e) => "compromisso_id" in e.patch);
    expect(insert?.tabela).toBe("temis_envelopes");
    expect(insert?.patch.compromisso_id).toBe(acordo().id);
    // ⚠️ `proposta_id` NULO É UMA TRAVA. Preenchido, o card da Têmis recusaria o envio do CONTRATO
    // daquela venda ("já existe envelope vivo") e o portal do incorporador contaria o acordo como
    // assinatura de contrato — todas as leituras de contrato filtram por essa coluna.
    expect(insert?.patch.proposta_id).toBeNull();
    expect(insert?.patch.estado).toBe("rascunho");
    // A ordem do acordo é sempre ligada: comprador, depois incorporador, depois Careli.
    expect(insert?.patch.ordenada).toBe(true);
  });

  it("⚠️ só o proponente vai ao envelope: cônjuge e segundo comprador da venda ficam de fora", async () => {
    // Lucas, 20/09/2026: *"entra no envelope somente o proponente"*. A venda pode ter casal e mais de
    // um comprador; o termo de acordo qualifica UM, o dono do débito.
    const comCasal = vendaDoPanteon();
    comCasal.dados.compradores = [
      {
        temConjuge: true,
        valores: {
          cpf_cliente: "444.555.666-17",
          cpf_conjuge: "777.888.999-00",
          email_cliente: "comprador@exemplo.test",
          email_conjuge: "conjuge@exemplo.test",
          nome_cliente: "Beltrano Exemplo Ferreira",
          nome_conjuge: "Beltrana Exemplo Ferreira",
          telefone_cliente: "31999990000",
        },
      },
      {
        temConjuge: false,
        valores: {
          cpf_cliente: "222.333.444-05",
          email_cliente: "segundo@exemplo.test",
          nome_cliente: "Segundo Comprador Silva",
          telefone_cliente: "31988880000",
        },
      },
    ] as (typeof comCasal)["dados"]["compradores"];
    leituraDaVenda.mockResolvedValue(comCasal);
    const { escritas, sb } = bancoDeTeste({});
    const { porta } = portaDeTeste();

    const feito = await enviarAcordoParaAssinatura(sb, acordo(), {}, { montarPdf: PDF_PRONTO, porta });

    expect("ok" in feito && feito.ok).toBe(true);
    const insert = escritas.find((e) => "compromisso_id" in e.patch);
    const assinam = (insert?.patch.signatarios ?? []) as Array<{ email: string; papel: string }>;
    expect(assinam).toHaveLength(3);
    expect(assinam.map((p) => p.papel)).toEqual(["comprador", "vendedora", "careli"]);
    expect(assinam.map((p) => p.email)).toEqual([
      "comprador@exemplo.test",
      representante.email,
      ASSINANTE_DA_CARELI.email,
    ]);
  });

  it("o carimbo do sucesso grava o id do envelope e o estado aguardando", async () => {
    const { escritas, sb } = bancoDeTeste({});
    const { porta } = portaDeTeste();

    await enviarAcordoParaAssinatura(sb, acordo(), {}, { montarPdf: PDF_PRONTO, porta });

    const carimbo = escritas.find((e) => e.patch.envelope_id === "env-acordo");
    expect(carimbo?.patch.estado).toBe("aguardando");
    expect(carimbo?.patch.estado_cru).toBe("clicksign:running");
    expect(carimbo?.patch.provedor_documento_id).toBe("doc-acordo");
  });

  // ⚠️ O ID DO SIGNATÁRIO É O QUE A CLICKSIGN DEVOLVEU, E O CARIMBO É O ÚNICO LUGAR ONDE ELE CABE.
  // Nívea, 24/09/2026: *"Deu erro no envio dos acordos. Não recebi e não consigo reenviar."* O envio
  // de AC-000051 não falhou; quem devolvia 422 era o REENVIO, que precisa do signer id do endpoint
  // `POST /envelopes/{id}/signers/{signer_id}/notifications`. Esse id existia por milissegundos
  // dentro de `enviarParaAssinatura` e morria ali.
  it("o carimbo de sucesso congela a chave da Clicksign de cada signatário", async () => {
    const { escritas, sb } = bancoDeTeste({});
    // Um id DIFERENTE por pessoa: com um id só, o teste passaria mesmo se a junção casasse errado.
    let n = 0;
    const { porta } = portaDeTeste();
    const portaComIds = async <T = unknown>(
      caminho: string,
      opcoes: { metodo?: string } = {},
    ): Promise<T> => {
      if (caminho.endsWith("/signers") && (opcoes.metodo ?? "GET") === "POST") {
        n += 1;
        return { data: { id: `sig-clicksign-${n}` } } as T;
      }
      return porta<T>(caminho, opcoes);
    };

    await enviarAcordoParaAssinatura(sb, acordo(), {}, { montarPdf: PDF_PRONTO, porta: portaComIds });

    const carimbo = escritas.find((e) => e.patch.envelope_id === "env-acordo");
    const congelados = (carimbo?.patch.signatarios ?? []) as Array<{
      chave?: string;
      papel: string;
    }>;
    expect(congelados.map((s) => s.papel)).toEqual(["comprador", "vendedora", "careli"]);
    expect(congelados.map((s) => s.chave)).toEqual([
      "sig-clicksign-1",
      "sig-clicksign-2",
      "sig-clicksign-3",
    ]);
  });
});

// ── A MIGRATION QUE PODE NÃO TER ENTRADO ────────────────────────────────────

describe("sem a migration 0179, o envio para", () => {
  const semAColuna = {
    code: "42703",
    message: 'column temis_envelopes.compromisso_id does not exist',
  };

  // ⚠️ SEM O ELO NÃO HÁ GUARDA CONTRA O SEGUNDO ENVELOPE, e a conta é de produção. A escolha é
  // RECUSAR: um envelope pago, permanente e invisível para o Panteon é pior do que um envio adiado.
  it("recusa nomeando a migration, sem chamar a Clicksign", async () => {
    const { sb } = bancoDeTeste({ erroDosEnvelopes: semAColuna });
    const { chamadas, porta } = portaDeTeste();

    const saida = await enviarAcordoParaAssinatura(
      sb,
      acordo(),
      {},
      { montarPdf: PDF_PRONTO, porta },
    );

    expect(saida.ok).toBe(false);
    if (!saida.ok) {
      expect(saida.erro).toContain(MIGRATION_DO_ELO_DO_ACORDO);
      expect(saida.erro).toContain("Nada foi mandado para a Clicksign");
      expect(saida.status).toBe(503);
    }
    expect(chamadas).toHaveLength(0);
  });

  // ⚠️ E O PGRST204 É O MESMO DEFEITO POR OUTRA PORTA: o Postgres devolve 42703 no `select`, e o
  // PostgREST devolve PGRST204 no `insert`. Reconhecer só um deixaria metade dos caminhos caindo
  // como "não foi possível registrar o envio", que manda conferir a migration errada.
  it("o PGRST204 do insert também é reconhecido", async () => {
    const { sb } = bancoDeTeste({
      erroNoInsert: {
        code: "PGRST204",
        message: "Could not find the 'compromisso_id' column of 'temis_envelopes' in the schema cache",
      },
    });
    const { chamadas, porta } = portaDeTeste();

    const saida = await enviarAcordoParaAssinatura(
      sb,
      acordo(),
      {},
      { montarPdf: PDF_PRONTO, porta },
    );

    expect(saida.ok).toBe(false);
    if (!saida.ok) expect(saida.erro).toContain(MIGRATION_DO_ELO_DO_ACORDO);
    expect(chamadas).toHaveLength(0);
  });

  // ⚠️ MAS A LEITURA TOLERA: é isso que permite o código subir antes da migration. A tela abre,
  // mostra quem assinaria, e diz que falta a 0179 — em vez de estourar.
  it("o preparo não quebra: mostra quem assina e explica o que falta", async () => {
    const { sb } = bancoDeTeste({ erroDosEnvelopes: semAColuna });

    const preparo = await prepararEnvioDoAcordo(sb, acordo());

    expect(preparo.ok).toBe(true);
    if (preparo.ok) {
      expect(preparo.envelope).toBeNull();
      expect(preparo.impedimento).toContain(MIGRATION_DO_ELO_DO_ACORDO);
      expect(preparo.signatarios).toHaveLength(3);
    }
  });
});

// ── A GUARDA CONTRA O SEGUNDO ENVELOPE ──────────────────────────────────────

describe("o segundo envelope do mesmo acordo", () => {
  const envelopeVivo = {
    criado_em: "2026-09-20T12:00:00.000Z",
    envelope_id: "env-ja-existe",
    estado: "aguardando",
    falha: null,
    id: "registro-velho",
    provedor: "clicksign",
  };

  it("acordo com envelope aguardando não manda de novo", async () => {
    const { sb } = bancoDeTeste({ envelopes: [envelopeVivo] });
    const { chamadas, porta } = portaDeTeste();

    const saida = await enviarAcordoParaAssinatura(
      sb,
      acordo(),
      {},
      { montarPdf: PDF_PRONTO, porta },
    );

    expect(saida.ok).toBe(false);
    if (!saida.ok) {
      expect(saida.erro).toContain("env-ja-existe");
      expect(saida.erro).toContain("Envelope não se apaga");
      expect(saida.status).toBe(409);
    }
    expect(chamadas).toHaveLength(0);
  });

  // ⚠️ `assinado` NÃO LIBERA REENVIO, e é o que mais importa: um segundo envelope de um termo já
  // assinado produziria dois acordos assinados da mesma dívida, cada um com o seu parcelamento.
  it("acordo já assinado não manda de novo", async () => {
    const { sb } = bancoDeTeste({
      envelopes: [{ ...envelopeVivo, estado: "assinado" }],
    });
    const { chamadas, porta } = portaDeTeste();

    const saida = await enviarAcordoParaAssinatura(
      sb,
      acordo(),
      {},
      { montarPdf: PDF_PRONTO, porta },
    );

    expect(saida.ok).toBe(false);
    if (!saida.ok) expect(saida.erro).toContain("já foi assinado por todos");
    expect(chamadas).toHaveLength(0);
  });

  // ⚠️ O REENVIO LEGÍTIMO É O CASO DE USO, não a exceção: cancelado, recusado e vencido são as três
  // situações em que alguém PRECISA mandar de novo. Travar as três trocaria um problema caro por
  // uma cobrança parada.
  it.each(["cancelado", "expirado", "recusado"])("envelope %s libera o reenvio", async (estado) => {
    const { sb } = bancoDeTeste({ envelopes: [{ ...envelopeVivo, estado }] });
    const { porta } = portaDeTeste();

    const saida = await enviarAcordoParaAssinatura(
      sb,
      acordo(),
      {},
      { montarPdf: PDF_PRONTO, porta },
    );

    expect(saida.ok).toBe(true);
  });
});

// ── O DADO QUE FALTA ────────────────────────────────────────────────────────

describe("dado obrigatório faltando", () => {
  // ⚠️ É O CASO DE HOJE: medido em 20/09/2026, ZERO das vendedoras dos 18 acordos aprovados tem
  // representante legal, e `temis_assinantes` está vazia.
  it("sem quem assine pelo incorporador, nada vai para a Clicksign", async () => {
    quadroDoEmpreendimento.mockResolvedValue([]);
    const { escritas, sb } = bancoDeTeste({});
    const { chamadas, porta } = portaDeTeste();

    const saida = await enviarAcordoParaAssinatura(
      sb,
      acordo(),
      {},
      { montarPdf: PDF_PRONTO, porta },
    );

    expect(saida.ok).toBe(false);
    if (!saida.ok) expect(saida.erro).toContain("INCORPORADOR");
    expect(chamadas).toHaveLength(0);
    expect(escritas).toHaveLength(0);
  });

  it("comprador sem e-mail no Panteon também para o envio", async () => {
    leituraDaVenda.mockResolvedValue({
      ...vendaDoPanteon(),
      dados: {
        compradores: [
          {
            temConjuge: false,
            valores: {
              cpf_cliente: "444.555.666-17",
              email_cliente: "",
              nome_cliente: "Beltrano Exemplo Ferreira",
            },
          },
        ],
        gerais: { __empreendimento_id: "19", empreendimento_codigo: "VDO" },
      },
    });
    const { sb } = bancoDeTeste({});
    const { chamadas, porta } = portaDeTeste();

    const saida = await enviarAcordoParaAssinatura(
      sb,
      acordo(),
      {},
      { montarPdf: PDF_PRONTO, porta },
    );

    expect(saida.ok).toBe(false);
    if (!saida.ok) expect(saida.erro).toContain("sem e-mail");
    expect(chamadas).toHaveLength(0);
  });

  // ⚠️ O PDF É MONTADO NA HORA, E ELE PODE RECUSAR. `montarDadosDoTermoDeAcordo` compara o débito
  // negociado com o que o C2X mostra AGORA: uma parcela liquidada entre a conferência e o clique
  // faria o papel afirmar que está em aberto algo que já foi pago.
  it("o papel que o C2X não confirma mais não vira envelope", async () => {
    const { sb } = bancoDeTeste({});
    const { chamadas, porta } = portaDeTeste();

    const saida = await enviarAcordoParaAssinatura(
      sb,
      acordo(),
      {},
      {
        montarPdf: async () => ({
          motivo: "A parcela que este acordo cobre já consta paga no C2X; revise o acordo.",
          ok: false as const,
          status: 422,
        }),
        porta,
      },
    );

    expect(saida.ok).toBe(false);
    if (!saida.ok) expect(saida.erro).toContain("já consta paga no C2X");
    expect(chamadas).toHaveLength(0);
  });
});

// ── O CANCELAMENTO ──────────────────────────────────────────────────────────

describe("cancelar o envelope do acordo", () => {
  const envelopeVivo = {
    criado_em: "2026-09-20T12:00:00.000Z",
    envelope_id: "env-vivo",
    estado: "aguardando",
    falha: null,
    id: "registro-1",
    provedor: "clicksign",
    // ⚠️ O ID DO DOCUMENTO É O QUE SE CANCELA na v3 — ver `cancelarEnvelope` (doc lida 25/09/2026).
    provedor_documento_id: "doc-vivo",
  };

  /** running na leitura de antes, canceled na releitura que confirma a morte. */
  const RUNNING_DEPOIS_CANCELED = [
    { data: { attributes: { status: "running" }, id: "env-vivo" } },
    { data: { attributes: { status: "canceled" }, id: "env-vivo" } },
  ];

  it("lê o estado na Clicksign antes, e cancela com PATCH no DOCUMENTO", async () => {
    const { escritas, sb } = bancoDeTeste({ envelopes: [envelopeVivo] });
    const { chamadas, porta } = portaDeTeste({
      "GET /envelopes/env-vivo": RUNNING_DEPOIS_CANCELED,
    });

    const saida = await cancelarAssinaturaDoAcordo(sb, acordo(), {}, { porta });

    expect(saida.ok).toBe(true);
    expect(chamadas[0]).toEqual({ caminho: "/envelopes/env-vivo", metodo: "GET" });
    // ⚠️ O PATCH QUE CANCELA É NO DOCUMENTO, não no envelope: `PATCH
    // /envelopes/{envelope_id}/documents/{document_id}` ("Editar Documento", lida em 25/09/2026).
    expect(chamadas).toContainEqual({
      caminho: "/envelopes/env-vivo/documents/doc-vivo",
      metodo: "PATCH",
    });
    // ⚠️ E O ENVELOPE É RELIDO DEPOIS DO PATCH: o 200 fala do DOCUMENTO, e nenhuma das duas páginas da
    // doc diz que cancelar o documento mata o envelope. Só a releitura com `canceled` libera o `ok`.
    expect(chamadas.filter((c) => c.metodo === "GET")).toHaveLength(2);
    // ⚠️ NUNCA DELETE: depois de ativado o envelope é permanente, e cancelar apenas o fecha.
    expect(chamadas.some((c) => c.metodo === "DELETE")).toBe(false);
    expect(escritas.some((e) => e.patch.estado === "cancelado")).toBe(true);
  });

  // ⚠️ O 200 DO PATCH NO DOCUMENTO NÃO É A MORTE DO ENVELOPE (doc lida em 25/09/2026: nenhuma das duas
  // páginas liga uma coisa à outra). Se o envelope voltar `running`, o Panteon NÃO grava `cancelado` —
  // gravar liberaria o reenvio e deixaria um SEGUNDO termo pago com o primeiro ainda correndo.
  it("PATCH 200 e o envelope ainda running: não grava cancelado, e manda conferir", async () => {
    const { escritas, sb } = bancoDeTeste({ envelopes: [envelopeVivo] });
    const rodando = { data: { attributes: { status: "running" }, id: "env-vivo" } };
    const { chamadas, porta } = portaDeTeste({ "GET /envelopes/env-vivo": [rodando, rodando] });

    const saida = await cancelarAssinaturaDoAcordo(sb, acordo(), {}, { porta });

    expect(saida.ok).toBe(false);
    if (!saida.ok) expect(saida.erro).toContain("Não deu para confirmar o cancelamento");
    expect(chamadas.map((c) => c.metodo)).toEqual(["GET", "PATCH", "GET"]);
    expect(escritas.some((e) => e.patch.estado === "cancelado")).toBe(false);
  });

  // ⚠️ O NOSSO BANCO ESTÁ SEMPRE ATRASADO EM RELAÇÃO AO WEBHOOK. A tela carregada às 13:58 mostra
  // "parcial", o terceiro signatário assina às 14:00, e às 14:00:01 o Panteon cancelaria um termo
  // ASSINADO POR TODOS — e `cancelado` é terminal, então o evento de fechamento seria descartado.
  it("envelope FECHADO na Clicksign não é cancelado", async () => {
    const { sb } = bancoDeTeste({ envelopes: [envelopeVivo] });
    const { chamadas, porta } = portaDeTeste({
      "GET /envelopes/env-vivo": { data: { attributes: { status: "closed" }, id: "env-vivo" } },
    });

    const saida = await cancelarAssinaturaDoAcordo(sb, acordo(), {}, { porta });

    expect(saida.ok).toBe(false);
    if (!saida.ok) expect(saida.erro).toContain("já está FECHADO");
    expect(chamadas.some((c) => c.metodo === "PATCH")).toBe(false);
  });

  // ⚠️ SEM O ID DO DOCUMENTO NÃO HÁ O QUE CANCELAR na v3, e a linha precisa de uma recusa honesta em
  // vez de um "ok" que deixaria o termo na mão de quem ia assinar. Mas a recusa vem DEPOIS da leitura:
  // este fluxo não tem nem a peneira do nosso banco antes dela, então recusar primeiro era mandar
  // alguém cancelar à mão um envelope cujo estado ninguém havia lido.
  it("envelope sem o id do documento LÊ o estado e então recusa, sem mandar PATCH", async () => {
    const { escritas, sb } = bancoDeTeste({
      envelopes: [{ ...envelopeVivo, provedor_documento_id: null }],
    });
    const { chamadas, porta } = portaDeTeste({
      "GET /envelopes/env-vivo": { data: { attributes: { status: "running" }, id: "env-vivo" } },
    });

    const saida = await cancelarAssinaturaDoAcordo(sb, acordo(), {}, { porta });

    expect(saida.ok).toBe(false);
    if (!saida.ok) expect(saida.erro).toContain("env-vivo");
    expect(chamadas).toEqual([{ caminho: "/envelopes/env-vivo", metodo: "GET" }]);
    expect(escritas.some((e) => e.patch.estado === "cancelado")).toBe(false);
  });

  it("acordo sem envelope não tem o que cancelar", async () => {
    const { sb } = bancoDeTeste({ envelopes: [] });
    const { chamadas, porta } = portaDeTeste();

    const saida = await cancelarAssinaturaDoAcordo(sb, acordo(), {}, { porta });

    expect(saida.ok).toBe(false);
    expect(chamadas).toHaveLength(0);
  });
});

// ── O PREPARO ───────────────────────────────────────────────────────────────

describe("o preparo da tela", () => {
  // ⚠️ O GATE VEM ANTES DA LEITURA DA VENDA. 22 dos 40 acordos estão reprovados; ler a venda
  // primeiro faria cada abertura de card carregar `dadosDaProposta` inteiro para devolver uma frase
  // que o card já sabia.
  it("acordo reprovado nem chega a ler a venda", async () => {
    const { sb } = bancoDeTeste({ envelopes: [] });

    const preparo = await prepararEnvioDoAcordo(sb, acordo({ approvalStatus: "reprovado" }));

    expect(preparo.ok).toBe(true);
    if (preparo.ok) {
      expect(preparo.impedimento).toBe(MOTIVOS_DO_TERMO.reprovado);
      expect(preparo.signatarios).toEqual([]);
    }
    expect(leituraDaVenda).not.toHaveBeenCalled();
  });

  // ⚠️ O PREPARO NÃO RECUSA, DEVOLVE O IMPEDIMENTO: a tela precisa mostrar QUEM assina mesmo quando
  // falta o e-mail de alguém — é olhando a lista que o operador entende o que corrigir.
  it("mostra as três partes mesmo quando algo impede", async () => {
    quadroDoEmpreendimento.mockResolvedValue([{ ...representante, email: "" }]);
    const { sb } = bancoDeTeste({ envelopes: [] });

    const preparo = await prepararEnvioDoAcordo(sb, acordo());

    expect(preparo.ok).toBe(true);
    if (preparo.ok) {
      expect(preparo.impedimento).toContain("sem e-mail");
      expect(preparo.signatarios.map((s) => s.papel)).toEqual([
        "comprador",
        "vendedora",
        "careli",
      ]);
    }
  });

  it("o acordo pronto não tem impedimento nenhum", async () => {
    const { sb } = bancoDeTeste({ envelopes: [] });

    const preparo = await prepararEnvioDoAcordo(sb, acordo());

    expect(preparo.ok).toBe(true);
    if (preparo.ok) {
      expect(preparo.impedimento).toBeNull();
      expect(preparo.envelope).toBeNull();
    }
  });
});
