import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GuardianCompromissoDetail } from "@/lib/guardian/compromissos";

// ────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ REVISÃO INDEPENDENTE DO CAMINHO DO ENVELOPE (20/09/2026). NADA AQUI TOCA A CLICKSIGN: a porta
// HTTP é um duplo, e cada teste conta as chamadas. A conta configurada é de PRODUÇÃO e envelope
// ativado não se apaga.
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// Cada bloco abaixo nasceu VERMELHO, como a prova reproduzível de um achado da revisão. Os seis
// foram corrigidos em 20/09/2026 e os testes ficaram: agora eles travam o conserto, que é o que um
// teste de revisão vale depois que o defeito morre. O comentário de cada um guarda o que era.

const leituraDaVenda = vi.fn();
const quadroDoEmpreendimento = vi.fn();

vi.mock("@/lib/temis/dados-do-contrato", () => ({
  dadosDaProposta: (...args: unknown[]) => leituraDaVenda(...args),
}));

vi.mock("@/lib/assinatura/quadro-db", () => ({
  assinantesDoQuadro: (...args: unknown[]) => quadroDoEmpreendimento(...args),
  empresasDoEmpreendimento: async () => ({ coordenador: null, vendedora: "ent-vendedora" }),
}));

const { cancelarAssinaturaDoAcordo, enviarAcordoParaAssinatura, prepararEnvioDoAcordo } =
  await import("./envio-db");

// ── O CASO ──────────────────────────────────────────────────────────────────

const ACORDO_ID = "11111111-2222-3333-4444-555555555555";

const acordo = (patch: Partial<GuardianCompromissoDetail> = {}): GuardianCompromissoDetail =>
  ({
    acquisitionRequestC2xId: 9001,
    approvalStatus: "aprovado",
    clientC2xId: 2508,
    id: ACORDO_ID,
    kind: "acordo",
    metadata: {},
    parcelas: [{ amount: 591.08, dueDate: "2026-07-15", id: "p1", sequence: 1 }],
    protocol: "AC-000042",
    status: "ativo",
    ...patch,
  }) as unknown as GuardianCompromissoDetail;

function vendaDoPanteon() {
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

// ── UM BANCO COM MEMÓRIA ────────────────────────────────────────────────────
//
// O duplo do arquivo de testes do implementador devolve sempre a MESMA lista e engole os updates
// (`then` resolve `{ error: null }` sem gravar nada). Para medir "o que fica gravado depois da
// falha" e "dois envios ao mesmo tempo" é preciso um duplo que GUARDE o que foi escrito.

type LinhaGravada = Record<string, unknown> & {
  criado_em: string;
  envelope_id: null | string;
  estado: string;
  falha: null | string;
  id: string;
  provedor: string;
};

function bancoComMemoria(opcoes: { falharNoUpdate?: boolean } = {}) {
  const linhas: LinhaGravada[] = [];
  let proximo = 1;

  const from = (tabela: string) => {
    const estado: { filtros: Record<string, unknown>; op: string; patch: Record<string, unknown> } =
      { filtros: {}, op: "select", patch: {} };

    const resultadoDaLista = () => ({
      data: linhas
        .filter((l) => l.compromisso_id === estado.filtros.compromisso_id)
        .sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1)),
      error: null,
    });

    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      eq: (coluna: string, valor: unknown) => {
        estado.filtros[coluna] = valor;
        if (estado.op === "update") {
          const alvo = linhas.find((l) => l.id === valor);
          if (alvo && !opcoes.falharNoUpdate) Object.assign(alvo, estado.patch);
        }
        return builder;
      },
      insert: (patch: Record<string, unknown>) => {
        estado.op = "insert";
        const id = `registro-${proximo++}`;
        linhas.push({
          criado_em: new Date().toISOString(),
          envelope_id: null,
          falha: null,
          provedor: "clicksign",
          ...patch,
          estado: String(patch.estado ?? "rascunho"),
          id,
        } as LinhaGravada);
        estado.patch = { id };
        return builder;
      },
      limit: () =>
        tabela === "temis_envelopes" ? Promise.resolve(resultadoDaLista()) : builder,
      maybeSingle: () =>
        Promise.resolve(
          tabela === "hercules_propostas"
            ? { data: { id: "prop-1", unidade_id: "uni-1" }, error: null }
            : { data: { id: estado.patch.id }, error: null },
        ),
      order: () => builder,
      select: () => builder,
      then: (resolver: (r: { error: null }) => unknown) =>
        Promise.resolve(resolver({ error: opcoes.falharNoUpdate ? ({ message: "boom" } as never) : null })),
      update: (patch: Record<string, unknown>) => {
        estado.op = "update";
        estado.patch = patch;
        return builder;
      },
    });
    return builder;
  };

  return { linhas, sb: { from } as unknown as SupabaseClient };
}

/** O duplo da porta HTTP, guardando o CORPO de cada chamada. */
function portaDeTeste(respostas: Record<string, unknown> = {}) {
  const chamadas: { caminho: string; corpo: unknown; metodo: string }[] = [];
  let envelopes = 0;

  const porta = async <T = unknown>(
    caminho: string,
    opcoes: { corpo?: unknown; metodo?: string } = {},
  ): Promise<T> => {
    const metodo = opcoes.metodo ?? "GET";
    chamadas.push({ caminho, corpo: opcoes.corpo, metodo });

    for (const [padrao, resposta] of Object.entries(respostas)) {
      if (`${metodo} ${caminho}`.includes(padrao)) {
        if (resposta instanceof Error) throw resposta;
        return resposta as T;
      }
    }

    if (metodo === "POST" && caminho === "/envelopes") {
      envelopes += 1;
      return { data: { id: `env-${envelopes}` } } as T;
    }
    if (caminho.endsWith("/documents")) return { data: { id: "doc-acordo" } } as T;
    if (caminho.endsWith("/signers")) return { data: { id: "sig-1" } } as T;
    return {} as T;
  };

  return { chamadas, porta };
}

function corpoDe(chamadas: { caminho: string; corpo: unknown; metodo: string }[], alvo: string) {
  const achada = chamadas.find((c) => c.caminho.endsWith(alvo) || c.caminho === alvo);
  return (achada?.corpo ?? {}) as { data?: { attributes?: Record<string, unknown> } };
}

beforeEach(() => {
  leituraDaVenda.mockReset();
  quadroDoEmpreendimento.mockReset();
  leituraDaVenda.mockResolvedValue(vendaDoPanteon());
  quadroDoEmpreendimento.mockResolvedValue([representante]);
});

// ── O QUE ESTÁ CERTO (confirmação) ──────────────────────────────────────────

describe("confirmado: a Clicksign só é chamada no caminho previsto", () => {
  it("a ordem das três partes é comprador 1, incorporador 2, Careli 3", async () => {
    const { sb } = bancoComMemoria();
    const { chamadas, porta } = portaDeTeste();

    const saida = await enviarAcordoParaAssinatura(sb, acordo(), {}, { montarPdf: PDF_PRONTO, porta });

    expect(saida.ok).toBe(true);
    if (saida.ok) {
      expect(saida.signatarios.map((s) => [s.papel, s.ordem])).toEqual([
        ["comprador", 1],
        ["vendedora", 2],
        ["careli", 3],
      ]);
    }
    // O `group` da Clicksign é o que faz a ordem virar comportamento.
    const grupos = chamadas
      .filter((c) => c.caminho.endsWith("/signers"))
      .map((c) => (c.corpo as { data: { attributes: { group: number } } }).data.attributes.group);
    expect(grupos).toEqual([1, 2, 3]);
  });

  it("falha no passo ATIVAR com rascunho apagado: nada sobra e o reenvio libera", async () => {
    const { linhas, sb } = bancoComMemoria();
    const { chamadas, porta } = portaDeTeste({
      "PATCH /envelopes/env-1": new Error("500 na Clicksign"),
    });

    const saida = await enviarAcordoParaAssinatura(sb, acordo(), {}, { montarPdf: PDF_PRONTO, porta });

    expect(saida.ok).toBe(false);
    if (!saida.ok) expect(saida.envelopeAtivo).toBe(false);
    // O DELETE do rascunho aconteceu.
    expect(chamadas.some((c) => c.metodo === "DELETE")).toBe(true);
    expect(linhas[0]?.envelope_id).toBeNull();
    expect(String(linhas[0]?.falha)).toContain("ativar");

    // E o próximo envio passa: não há envelope vivo nenhum.
    const de_novo = await prepararEnvioDoAcordo(sb, acordo());
    expect(de_novo.ok).toBe(true);
    if (de_novo.ok) expect(de_novo.impedimento).toBeNull();
  });

  it("falha no passo NOTIFICAR: o envelope ficou ativo, e o segundo envio é barrado", async () => {
    const { linhas, sb } = bancoComMemoria();
    const { chamadas, porta } = portaDeTeste({
      "POST /envelopes/env-1/notifications": new Error("timeout"),
    });

    const saida = await enviarAcordoParaAssinatura(sb, acordo(), {}, { montarPdf: PDF_PRONTO, porta });

    expect(saida.ok).toBe(false);
    if (!saida.ok) expect(saida.envelopeAtivo).toBe(true);
    // ⚠️ NUNCA apaga um envelope já ativado.
    expect(chamadas.some((c) => c.metodo === "DELETE")).toBe(false);
    expect(linhas[0]?.estado).toBe("aguardando");
    expect(linhas[0]?.envelope_id).toBe("env-1");

    const segundo = await enviarAcordoParaAssinatura(sb, acordo(), {}, { montarPdf: PDF_PRONTO, porta });
    expect(segundo.ok).toBe(false);
    // Nenhum envelope novo nasceu.
    expect(chamadas.filter((c) => c.metodo === "POST" && c.caminho === "/envelopes")).toHaveLength(1);
  });
});

// ── ACHADO 1 ────────────────────────────────────────────────────────────────

// O QUE ERA: `default_subject` era fixo em "Assinatura do contrato" mais o nome, então o convite de
// um termo de acordo de DÍVIDA chegava na caixa do inadimplente falando em contrato. O nome do
// envelope já tinha sido corrigido pela `especie`; o assunto, que é o que o CLIENTE lê, não.
describe("o convite do termo de acordo não chega com o assunto de CONTRATO", () => {
  it("o assunto do e-mail carrega a espécie do documento, e não a palavra contrato", async () => {
    const { sb } = bancoComMemoria();
    const { chamadas, porta } = portaDeTeste();

    await enviarAcordoParaAssinatura(sb, acordo(), {}, { montarPdf: PDF_PRONTO, porta });

    const atributos = corpoDe(chamadas, "/envelopes").data?.attributes ?? {};
    // O NOME do envelope foi corrigido pela `especie`…
    expect(String(atributos.name)).toContain("Termo de Acordo");
    // …e o ASSUNTO do e-mail que o comprador recebe segue a mesma espécie.
    expect(String(atributos.default_subject)).not.toContain("contrato");
    expect(String(atributos.default_subject)).toContain("Termo de Acordo");
    // Regra da casa para texto visível, e este é o mais visível de todos: vai para fora.
    expect(String(atributos.default_subject)).not.toContain("—");
    // O teto que a doc da Clicksign impõe ao campo.
    expect(String(atributos.default_subject).length).toBeLessThanOrEqual(100);
  });
});

// ── ACHADO 2 ────────────────────────────────────────────────────────────────

// O QUE ERA: o `metadata` do documento levava comprador, empreendimento, origem e unidade, e nada
// mais. `proposta_id` fica nulo de propósito num acordo, então o webhook (`acharEnvelope`) podia sair
// das TRÊS tentativas de mãos vazias. O contrato tem essa rede pela proposta; o acordo não tinha.
describe("o documento do acordo leva a chave que o identifica", () => {
  it("o metadata leva compromisso_id, que é a rede de segurança do webhook", async () => {
    const { sb } = bancoComMemoria();
    const { chamadas, porta } = portaDeTeste();

    await enviarAcordoParaAssinatura(sb, acordo(), {}, { montarPdf: PDF_PRONTO, porta });

    const meta = (corpoDe(chamadas, "/documents").data?.attributes?.metadata ?? {}) as Record<
      string,
      string
    >;
    // `acharEnvelope` (lib/assinatura/estado-db.ts) tenta provedor_documento_id, envelope_id,
    // metadata.proposta_id e, desde 20/09/2026, metadata.compromisso_id.
    expect(Object.keys(meta)).toContain("compromisso_id");
    expect(meta.compromisso_id).toBe(ACORDO_ID);
    // E `proposta_id` CONTINUA FORA: mandá-la faria o webhook de um ACORDO assinado tentar mover o
    // card do CONTRATO daquela venda.
    expect(Object.keys(meta)).not.toContain("proposta_id");
  });

  /**
   * O QUE ERA: `carimbarSucesso` ENGOLIA o erro do update. O envelope ficava criado, ativado e
   * notificado na conta de produção, o cliente já com o convite na caixa, e a rota respondia 200
   * limpo sobre uma linha que continuava em rascunho, sem `envelope_id`. A tela recarregava, não
   * mostrava envelope nenhum, e o operador clicava de novo.
   *
   * ⚠️ E O CONSERTO NÃO É LIBERAR O ENVIO. Devolver `impedimento: null` aqui mandaria criar o
   * SEGUNDO envelope pago em cima de um que está vivo. O envio continua barrado, de propósito; o que
   * passou a existir é (1) um aviso no 200, com o id do envelope que ficou de pé, e (2) uma frase de
   * impedimento que diz como sair. A saída é de banco, e é a mesma do contrato.
   */
  it("carimbo de sucesso que não grava AVISA, e a frase do impedimento diz como sair", async () => {
    // O envelope é criado, ativado e notificado; o UPDATE do Panteon falha (a janela real: a
    // função morre, o Supabase recusa, o timeout da Vercel estoura depois do passo 6).
    const { linhas, sb } = bancoComMemoria({ falharNoUpdate: true });
    const { porta } = portaDeTeste();

    const saida = await enviarAcordoParaAssinatura(sb, acordo(), {}, { montarPdf: PDF_PRONTO, porta });
    expect(saida.ok).toBe(true);

    // ⚠️ O ENVIO ACONTECEU, e por isso não vira `ok: false`: chamar de falha faria a tela oferecer
    // "tentar de novo", que é o clique que cria o segundo envelope. O que sobe é um AVISO, com o id
    // do envelope que ficou vivo lá.
    if (saida.ok) {
      expect(saida.aviso ?? "").toContain("env-1");
      expect(saida.aviso ?? "").toContain("não pode ser mandado de novo");
    }

    // A linha ficou sem `envelope_id`: é exatamente o estado que o aviso descreve.
    expect(linhas[0]?.envelope_id).toBeNull();

    // Cancelar pela tela continua sem achar o envelope, porque não há id gravado…
    const cancelamento = await cancelarAssinaturaDoAcordo(sb, acordo(), {}, { porta });
    expect(cancelamento.ok).toBe(false);

    // …e o envio segue barrado, que é o certo: há um envelope vivo lá.
    //
    // ⚠️ E A FRASE MUDA COM A IDADE DA LINHA, que é a segunda correção. Recém-gravada, ela pode ser
    // um envio EM CURSO (o duplo clique, a segunda aba), e o conselho é esperar sem tocar em nada.
    const agora = await prepararEnvioDoAcordo(sb, acordo());
    expect(agora.ok).toBe(true);
    if (agora.ok) {
      expect(agora.impedimento ?? "").toContain("ESTÁ SENDO ENVIADO");
      expect(agora.impedimento ?? "").toContain("NÃO cancele nada");
    }

    // Passada a janela do `maxDuration` da rota, a mesma linha quer dizer "morreu no meio" — e aí a
    // frase precisa dizer O QUE FAZER, em vez de deixar o acordo num beco sem saída.
    linhas[0]!.criado_em = new Date(Date.now() - 10 * 60_000).toISOString();

    const depois = await prepararEnvioDoAcordo(sb, acordo());
    expect(depois.ok).toBe(true);
    if (depois.ok) {
      expect(depois.impedimento ?? "").toContain("precisa ser encerrado em temis_envelopes");
    }
  });
});

// ── ACHADO 3 ────────────────────────────────────────────────────────────────

// O QUE ERA: a guarda é um SELECT seguido de um INSERT, e entre os dois cabia o envio inteiro (a
// montagem do PDF abre o C2X, e a rota reserva 120s). Duas abas, dois operadores ou um retry da
// Vercel passavam os dois pela guarda e criavam DOIS envelopes pagos. Agora são duas travas: o
// índice único parcial da 0179, que é a única que vale entre duas funções que nunca se falam, e a
// leitura de volta logo depois do insert, que é a que um teste consegue exercitar sem um Postgres.
describe("dois envios ao mesmo tempo NÃO criam dois envelopes do mesmo acordo", () => {
  it("o mesmo acordo enviado duas vezes em paralelo vira UM envelope, e o outro recusa", async () => {
    const { sb } = bancoComMemoria();
    const { chamadas, porta } = portaDeTeste();

    // Duas abas, dois cliques, ou o F5 no meio: as duas leituras da guarda acontecem antes de
    // qualquer uma das duas escritas.
    const [a, b] = await Promise.all([
      enviarAcordoParaAssinatura(sb, acordo(), {}, { montarPdf: PDF_PRONTO, porta }),
      enviarAcordoParaAssinatura(sb, acordo(), {}, { montarPdf: PDF_PRONTO, porta }),
    ]);

    const nascidos = chamadas.filter((c) => c.metodo === "POST" && c.caminho === "/envelopes");
    expect([a.ok, b.ok]).toContain(false);
    expect(nascidos).toHaveLength(1);
  });
});

// ── ACHADO 4 ────────────────────────────────────────────────────────────────

// O QUE ERA: uma frase só para os dois sentidos da mesma linha. Durante os 40 a 90 segundos de um
// envio normal a linha vive em rascunho, sem `envelope_id` e sem `falha`, e a frase mandava
// "cancele por lá". Quem seguisse o conselho mataria um envelope pago que o `carimbarSucesso` ia
// registrar meio minuto depois. A idade separa os dois casos, com a régua do contrato.
describe("durante o envio em curso, a frase manda ESPERAR", () => {
  it("a linha de 5 segundos atrás recebe o conselho de esperar, e não o de cancelar", async () => {
    const { linhas, sb } = bancoComMemoria();
    linhas.push({
      compromisso_id: ACORDO_ID,
      criado_em: new Date(Date.now() - 5_000).toISOString(),
      envelope_id: null,
      estado: "rascunho",
      falha: null,
      id: "registro-em-curso",
      provedor: "clicksign",
    });

    const preparo = await prepararEnvioDoAcordo(sb, acordo());

    expect(preparo.ok).toBe(true);
    if (preparo.ok) {
      // A mesma distinção do contrato (impedimentoDeEnvelopeVivo, lib/assinatura/envio-db.ts).
      expect(preparo.impedimento).toContain("ESTÁ SENDO ENVIADO");
      expect(preparo.impedimento).toContain("NÃO cancele nada");
    }
  });
});

// ── ACHADO 5 ────────────────────────────────────────────────────────────────

// O QUE ERA: `careli` entrou em `PAPEIS` em 20/09/2026 para o termo de acordo, e
// `lib/temis/ordem-da-categoria.ts` media a ordem de uma categoria de CONTRATO por `PAPEIS`.
// Resultado: `careli` gravava em `apolo_enterprise_categorias.assinatura_ordem` de uma venda, e a
// frase de erro da rota a oferecia como papel válido. `gruposDaRegra` e o cartão do empreendimento
// já tinham sido corrigidos para `PAPEIS_DO_CONTRATO`; faltavam a validação e a aba de categorias.
describe("o papel `careli` não entra na ordem de assinatura do CONTRATO", () => {
  /**
   * ⚠️ RECUSA, E NÃO DESCARTE SILENCIOSO. Deixar passar e apagar a Careli da lista gravaria uma
   * ordem DIFERENTE da que a pessoa mandou, sem dizer nada, e a régua desta lib para todo papel que
   * ela não reconhece é a mesma: responder qual é o problema.
   */
  it("a porta de entrada da ordem da categoria RECUSA `careli` num contrato de venda", async () => {
    const { lerOrdemDoCorpo } = await import("@/lib/temis/ordem-da-categoria");

    const salvo = lerOrdemDoCorpo({
      assinaturaOrdem: ["comprador", "vendedora", "careli"],
      assinaturaOrdenada: true,
    });

    expect(salvo.ok).toBe(false);
    if (!salvo.ok) {
      expect(salvo.erro).toContain("careli");
      // E o que ela oferece como válido não inclui a Careli.
      expect(salvo.erro.split("Os válidos são")[1] ?? "").not.toContain("careli");
    }
  });

  it("a frase de erro da rota não oferece `careli` como papel válido de contrato", async () => {
    const { lerOrdemDoCorpo } = await import("@/lib/temis/ordem-da-categoria");

    const recusa = lerOrdemDoCorpo({
      assinaturaOrdem: ["papel_que_nao_existe"],
      assinaturaOrdenada: true,
    });

    expect(recusa.ok).toBe(false);
    if (!recusa.ok) expect(recusa.erro).not.toContain("careli");
  });
});

// ── ACHADO 6 ────────────────────────────────────────────────────────────────

// O QUE ERA: a chave vivia só na tela. Com ela `false` o botão não existia, e mesmo assim qualquer
// usuário de ESCRITA do Hades, ou um script com o token dele, chamava o POST e criava um envelope
// REAL na conta de PRODUÇÃO, com convite por e-mail para o comprador, antes de o Lucas ter ligado
// coisa nenhuma. O COMPORTAMENTO está exercitado em `revisao-da-porta.test.ts`; aqui fica a leitura
// do texto, que é o que pega alguém removendo a guarda sem rodar a rota.
describe("a chave TERMO_DE_ACORDO_LIBERADO protege a ROTA, e não só o botão", () => {
  it("o POST e o PATCH, que mandam e-mail para o cliente, consultam a chave", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const rota = readFileSync(
      join(process.cwd(), "app/api/guardian/termo-de-acordo/assinatura/route.ts"),
      "utf8",
    );

    // A régua do Lucas (aprovação) mora no servidor — isso está certo e é o que o gate faz.
    expect(rota).toContain("motivoParaNaoEnviarParaAssinatura");

    // E a chave também, nos DOIS métodos que mandam e-mail para o cliente.
    expect(rota).toContain("TERMO_DE_ACORDO_LIBERADO");
    for (const metodo of ["POST", "PATCH"]) {
      const daqui = rota.slice(rota.indexOf("export async function " + metodo + "("));
      const ate = daqui.indexOf("\nexport ");
      expect(ate === -1 ? daqui : daqui.slice(0, ate)).toContain("portaFechada()");
    }
  });
});
