import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GuardianCompromissoDetail } from "@/lib/guardian/compromissos";

// REVISÃO DO ENVIO DO ACORDO — a lente é uma só: QUEM ASSINA PELO INCORPORADOR, e como esse nome
// chega (ou não chega) ao envelope.
//
// Escrito em 20/09/2026, depois do campo novo de termos (o pedido do Lucas: *"nessa tela vc pode
// abrir mais um campo para assinatura de termos vendedora, ae eu posso apontar quem vai assinar os
// termos, não precisa necessariamente ser os representantes legais, pode ser o juridico, analista,
// enfim"*). Aqui não se conserta nada: mede-se.
//
// ⚠️ NADA TOCA A CLICKSIGN. A conta é de PRODUÇÃO, envelope custa e o ativado não se apaga. A porta
// HTTP é um duplo, como em `envio-db.test.ts`.
//
// ⚠️ OS QUATRO TESTES QUE NASCERAM COM `DEFEITO` NO NOME ESTÃO VERDES desde a correção de
// 20/09/2026: a precedência de pai e filho, a ordem própria do contrato vazando para o acordo, e a
// frase que escondia o envelope vivo. Eles continuam aqui com o nome do comportamento certo.

const leituraDaVenda = vi.fn();
const quadroDoEmpreendimento = vi.fn();
const apontadoParaTermos = vi.fn();

vi.mock("@/lib/temis/dados-do-contrato", () => ({
  dadosDaProposta: (...args: unknown[]) => leituraDaVenda(...args),
}));

vi.mock("@/lib/assinatura/quadro-db", () => ({
  assinanteDeTermosDaVendedora: (...args: unknown[]) => apontadoParaTermos(...args),
  assinantesDoQuadro: (...args: unknown[]) => quadroDoEmpreendimento(...args),
  empresasDoEmpreendimento: async () => ({ coordenador: null, vendedora: "ent-vendedora" }),
}));

const { enviarAcordoParaAssinatura, prepararEnvioDoAcordo } = await import("./envio-db");

// ── O CASO ──────────────────────────────────────────────────────────────────

const acordo = (): GuardianCompromissoDetail =>
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
  }) as unknown as GuardianCompromissoDetail;

function vendaDoPanteon(gerais: Record<string, string> = {}) {
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
        ...gerais,
      },
    },
  };
}

/** A pessoa que o cadastro da PJ devolve — o último degrau da precedência. */
const representanteLegal = {
  cpf: "111.222.333-44",
  email: "representante@incorporadora.test",
  nome: "Fulana Representante Legal",
  papel: "vendedora" as const,
  telefone: null,
};

/** A pessoa que o Lucas aponta no campo novo. */
const analistaDosTermos = {
  cpf: null,
  email: "juridico@incorporadora.test",
  nome: "Analista Do Juridico",
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
 * O CADASTRO DE PAI E FILHO, como o duplo precisa dele.
 *
 * ⚠️ O DUPLO PRECISOU APRENDER `hercules_empreendimentos` (20/09/2026). A cadeia de quem assina sobe
 * até o pai lendo essa tabela duas vezes — a linha do filho pelo `c2x_enterprise_id` e o
 * `c2x_enterprise_id` do `pai_id` dela —, e um duplo que devolvesse sempre a mesma linha não teria
 * como expressar uma família. Os ids são os de produção (VLO 35 é pai de VOL 36; LAB 31 é pai de
 * LBR 27), medidos em 20/09/2026.
 */
type LinhaDoCadastro = { c2x_enterprise_id: null | string; id: string; pai_id: null | string };

const FAMILIA_VALE_DO_OURO: LinhaDoCadastro[] = [
  { c2x_enterprise_id: "35", id: "emp-vlo", pai_id: null },
  { c2x_enterprise_id: "36", id: "emp-vol", pai_id: "emp-vlo" },
];

function bancoDeTeste(
  envelopes: Record<string, unknown>[] = [],
  cadastro: LinhaDoCadastro[] = [],
): SupabaseClient {
  const from = (tabela: string) => {
    const filtros: Record<string, unknown> = {};

    const doCadastro = () =>
      cadastro.find((l) =>
        Object.entries(filtros).every(([coluna, valor]) =>
          coluna in l ? l[coluna as keyof LinhaDoCadastro] === valor : true,
        ),
      ) ?? null;

    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      eq: (coluna: string, valor: unknown) => {
        filtros[coluna] = valor;
        return builder;
      },
      insert: () => builder,
      limit: () =>
        tabela === "temis_envelopes"
          ? Promise.resolve({ data: envelopes, error: null })
          : builder,
      maybeSingle: () =>
        Promise.resolve(
          tabela === "hercules_propostas"
            ? { data: { id: "prop-1", unidade_id: "uni-1" }, error: null }
            : tabela === "hercules_empreendimentos"
              ? { data: doCadastro(), error: null }
              : { data: { id: "registro-1" }, error: null },
        ),
      order: () => builder,
      select: () => builder,
      then: (resolver: (r: { error: null }) => unknown) =>
        Promise.resolve(resolver({ error: null })),
      update: () => builder,
    });
    return builder;
  };
  return { from } as unknown as SupabaseClient;
}

/** O duplo da porta HTTP, guardando o CORPO — é nele que mora a ordem que vai para o provedor. */
function portaDeTeste() {
  const signatarios: { group: number; name: string }[] = [];

  const porta = async <T = unknown>(
    caminho: string,
    opcoes: { corpo?: unknown; metodo?: string } = {},
  ): Promise<T> => {
    const metodo = opcoes.metodo ?? "GET";

    if (metodo === "POST" && caminho.endsWith("/signers")) {
      const atributos = (
        opcoes.corpo as { data?: { attributes?: { group?: number; name?: string } } }
      )?.data?.attributes;
      signatarios.push({ group: Number(atributos?.group ?? 0), name: String(atributos?.name ?? "") });
      return { data: { id: `sig-${signatarios.length}` } } as T;
    }

    if (metodo === "POST" && caminho === "/envelopes") return { data: { id: "env-acordo" } } as T;
    if (caminho.endsWith("/documents")) return { data: { id: "doc-acordo" } } as T;
    return {} as T;
  };

  return { porta, signatarios };
}

beforeEach(() => {
  vi.clearAllMocks();
  leituraDaVenda.mockResolvedValue(vendaDoPanteon());
  quadroDoEmpreendimento.mockResolvedValue([]);
  apontadoParaTermos.mockResolvedValue(null);
});

// ── 1. O ENVELOPE: TRÊS PESSOAS, NA ORDEM DO LUCAS ──────────────────────────

describe("o envelope do acordo sai com três pessoas, na ordem do Lucas", () => {
  // Lucas, 20/09/2026: *"na ordem comprador, incorporador e nivea careli"*. O `group` da Clicksign
  // é o degrau da fila: 1 assina, depois 2, depois 3. É o que o provedor realmente recebe.
  it("comprador no grupo 1, incorporador no 2, Careli no 3", async () => {
    apontadoParaTermos.mockResolvedValue(analistaDosTermos);
    const { porta, signatarios } = portaDeTeste();

    const saida = await enviarAcordoParaAssinatura(
      bancoDeTeste(),
      acordo(),
      {},
      { montarPdf: PDF_PRONTO, porta },
    );

    expect(saida.ok).toBe(true);
    expect(signatarios).toEqual([
      { group: 1, name: "BELTRANO EXEMPLO FERREIRA" },
      { group: 2, name: "ANALISTA DO JURIDICO" },
      { group: 3, name: "NIVEA CARELI" },
    ]);
  });

  // ⚠️ E O MESMO VALE PELO DEGRAU DE BAIXO. Quem nunca apontar ninguém continua mandando o
  // representante legal, e ele tem de cair no mesmo degrau 2.
  it("sem ninguém apontado, o representante legal ocupa o grupo 2", async () => {
    quadroDoEmpreendimento.mockResolvedValue([representanteLegal]);
    const { porta, signatarios } = portaDeTeste();

    await enviarAcordoParaAssinatura(
      bancoDeTeste(),
      acordo(),
      {},
      { montarPdf: PDF_PRONTO, porta },
    );

    expect(signatarios.map((s) => s.group)).toEqual([1, 2, 3]);
    expect(signatarios[1]?.name).toBe("FULANA REPRESENTANTE LEGAL");
  });

  /**
   * A "ORDEM DE ASSINATURA" DO QUADRO, QUE É DO CONTRATO, NÃO MANDA NO TERMO DE ACORDO.
   *
   * `assinantesDoQuadro` carrega `ordem_assinatura` da linha como `ordemPropria`, e
   * `ordenarSignatarios` faz a ordem da PESSOA vencer a do papel. No termo de acordo isso põe o
   * incorporador no MESMO degrau do comprador quando alguém digitou "Assina em: 1" na linha da
   * vendedora — um campo de uma tela sobre CONTRATO de venda.
   *
   * `assinanteDeTermosDaVendedora` já nascia sem ler a coluna, e a nota dela diz por quê (*"deixar
   * o cadastro do empreendimento mandar aqui permitiria, por um número digitado numa tela sobre
   * contrato, o incorporador assinar ANTES do comprador"*). O degrau de baixo ficou sem a mesma
   * proteção até 20/09/2026, quando `incorporadorDoAcordo` passou a descartar a `ordemPropria` nos
   * dois degraus.
   *
   * `temis_assinantes` tinha ZERO linhas quando isso foi corrigido (medido em 20/09/2026), então
   * nada chegou a quebrar: quebraria no primeiro empreendimento em que alguém cadastrasse a
   * vendedora do CONTRATO com ordem própria 1 e mandasse um acordo antes de apontar o de termos.
   */
  it("'Assina em 1' na vendedora do contrato não adianta o incorporador", async () => {
    quadroDoEmpreendimento.mockResolvedValue([{ ...representanteLegal, ordemPropria: 1 }]);
    const { porta, signatarios } = portaDeTeste();

    await enviarAcordoParaAssinatura(
      bancoDeTeste(),
      acordo(),
      {},
      { montarPdf: PDF_PRONTO, porta },
    );

    // A fila do Lucas tem três degraus, e o comprador ocupa o primeiro sozinho.
    expect(signatarios.map((s) => s.group)).toEqual([1, 2, 3]);
  });
});

// ── 2. A PRECEDÊNCIA DO INCORPORADOR ────────────────────────────────────────

describe("a precedência de quem assina pelo incorporador", () => {
  it("o apontado para TERMOS vence a vendedora do quadro", async () => {
    quadroDoEmpreendimento.mockResolvedValue([representanteLegal]);
    apontadoParaTermos.mockResolvedValue(analistaDosTermos);

    const preparo = await prepararEnvioDoAcordo(bancoDeTeste(), acordo());
    if (!preparo.ok) throw new Error("o preparo devia ter dado certo");

    expect(preparo.impedimento).toBeNull();
    expect(preparo.signatarios.map((s) => s.nome)).toEqual([
      "BELTRANO EXEMPLO FERREIRA",
      "ANALISTA DO JURIDICO",
      "NIVEA CARELI",
    ]);
  });

  // ⚠️ SEM NINGUÉM, A FRASE. E ela tem de dizer o campo e a tela: hoje é a frase que TODO acordo
  // aprovado lê (zero linhas em `temis_assinantes`, zero representantes legais nas 23
  // incorporadoras, medido em 20/09/2026).
  it("sem nenhum dos dois, a frase nomeia o campo, a tela e dispensa o representante legal", async () => {
    const preparo = await prepararEnvioDoAcordo(bancoDeTeste(), acordo());
    if (!preparo.ok) throw new Error("o preparo devia ter dado certo");

    expect(preparo.impedimento).toContain("Assinatura de termos (vendedora)");
    expect(preparo.impedimento).toContain("Quadro de assinatura do empreendimento");
    expect(preparo.impedimento).toContain("não precisa ser o representante legal");
  });

  // ⚠️ E A RECUSA ACONTECE ANTES DA CLICKSIGN. Envelope custa e o ativado não se apaga: nenhuma
  // chamada pode sair quando falta o incorporador.
  it("sem incorporador, o POST recusa sem criar envelope nenhum", async () => {
    const { porta, signatarios } = portaDeTeste();

    const saida = await enviarAcordoParaAssinatura(
      bancoDeTeste(),
      acordo(),
      {},
      { montarPdf: PDF_PRONTO, porta },
    );

    expect(saida.ok).toBe(false);
    expect(signatarios).toEqual([]);
  });
});

// ── 3. TENTANDO QUEBRAR: O E-MAIL ───────────────────────────────────────────

describe("o apontado com e-mail ruim para antes de existir envelope", () => {
  // `temis_assinantes.email` é NULO no banco (medido em 20/09/2026); a porta de escrita exige, mas
  // a coluna não. Uma linha sem e-mail não pode virar signatário: a Clicksign cadastraria a pessoa
  // sem ter para onde mandar o convite, e o envelope nunca fecharia.
  it("sem e-mail: recusa, nomeia a pessoa, e não chama a Clicksign", async () => {
    apontadoParaTermos.mockResolvedValue({ ...analistaDosTermos, email: "" });
    const { porta, signatarios } = portaDeTeste();

    const saida = await enviarAcordoParaAssinatura(
      bancoDeTeste(),
      acordo(),
      {},
      { montarPdf: PDF_PRONTO, porta },
    );

    if (saida.ok) throw new Error("o envio devia ter sido recusado");
    expect(saida.erro).toContain("ANALISTA DO JURIDICO");
    expect(saida.erro).toContain("sem e-mail");
    expect(signatarios).toEqual([]);
  });

  // ⚠️ O APONTADO SEM E-MAIL NÃO CAI PARA O REPRESENTANTE, e isso é o certo: o operador escolheu
  // aquela pessoa, e trocá-la calado mandaria o termo para outra. O teste prende o comportamento.
  it("sem e-mail, NÃO cai calado para o representante legal", async () => {
    quadroDoEmpreendimento.mockResolvedValue([representanteLegal]);
    apontadoParaTermos.mockResolvedValue({ ...analistaDosTermos, email: "" });

    const preparo = await prepararEnvioDoAcordo(bancoDeTeste(), acordo());
    if (!preparo.ok) throw new Error("o preparo devia ter dado certo");

    expect(preparo.impedimento).toContain("ANALISTA DO JURIDICO");
    expect(preparo.signatarios.map((s) => s.nome)).not.toContain("FULANA REPRESENTANTE LEGAL");
  });

  // ⚠️ O MESMO E-MAIL DO COMPRADOR é o caso da imobiliária que cadastra o próprio endereço como
  // contato do cliente. A Clicksign não aceita dois signatários no mesmo endereço: o envelope
  // sairia com DUAS pessoas em vez de três, e o termo ficaria sem uma das partes.
  it("e-mail igual ao do comprador: recusa citando os dois, sem envelope", async () => {
    apontadoParaTermos.mockResolvedValue({
      ...analistaDosTermos,
      email: "COMPRADOR@Exemplo.test ",
    });
    const { porta, signatarios } = portaDeTeste();

    const saida = await enviarAcordoParaAssinatura(
      bancoDeTeste(),
      acordo(),
      {},
      { montarPdf: PDF_PRONTO, porta },
    );

    if (saida.ok) throw new Error("o envio devia ter sido recusado");
    expect(saida.erro).toContain("BELTRANO EXEMPLO FERREIRA");
    expect(saida.erro).toContain("ANALISTA DO JURIDICO");
    expect(saida.erro).toContain("MESMO e-mail");
    expect(signatarios).toEqual([]);
  });
});

// ── 4. PAI E FILHO ──────────────────────────────────────────────────────────
//
// O QUE A CASA FAZ COM PAI E FILHO, e é regra do Lucas (08/09/2026): *"o pai sempre será o
// referencial, ele é o macro"*, e o filho que configurou usa o seu. `chavesDaComissao`, em
// `lib/temis/dados-do-contrato.ts`, escreve essa precedência com todas as letras:
//
//     a divisão da unidade  →  o empreendimento da proposta  →  o pai dele
//
// O envio do acordo usava a ordem CONTRÁRIA e parava no segundo degrau:
//
//     __empreendimento_id  ||  __unidade_enterprise_id
//
// Desde 20/09/2026 ele percorre a cadeia da casa (`cadeiaDeEmpreendimentos`, em `envio-db.ts`). O id
// gravado em `temis_envelopes.enterprise_id` continua sendo o de antes: é outra pergunta.
//
// Os pares existem em produção (medido em 20/09/2026): LAB (31) é pai de LBR (27), e VLO (35) é pai
// de VOC (37) e VOL (36). 408 das 2.012 propostas faturadas têm os dois ids preenchidos e
// DIFERENTES — e é de propostas faturadas que saem os acordos. O único acordo de hoje nessa
// situação é um do LAB (proposta em 31, unidade em 27), hoje reprovado.

describe("pai e filho: onde o Panteon procura quem assina os termos", () => {
  /**
   * APONTAR NA DIVISÃO DA UNIDADE VALE, E VEM PRIMEIRO.
   *
   * A venda importada aponta para o PAI e a unidade vive na divisão. O operador abre a tela do
   * empreendimento em que o lote está (LBR, 27) e aponta o analista; antes de 20/09/2026 o envio
   * procurava só no pai (31), o campo novo ficava invisível e a frase de impedimento mandava
   * apontar de novo.
   */
  it("o apontado na divisão da unidade vence o empreendimento da proposta", async () => {
    leituraDaVenda.mockResolvedValue(
      vendaDoPanteon({ __empreendimento_id: "31", __unidade_enterprise_id: "27" }),
    );
    // Só o filho tem alguém apontado: é a tela que o operador abre para ver aquele lote.
    apontadoParaTermos.mockImplementation(async (_sb: unknown, id: string) =>
      id === "27" ? analistaDosTermos : null,
    );

    const preparo = await prepararEnvioDoAcordo(bancoDeTeste(), acordo());
    if (!preparo.ok) throw new Error("o preparo devia ter dado certo");

    expect(preparo.impedimento).toBeNull();
    expect(preparo.signatarios.map((s) => s.nome)).toContain("ANALISTA DO JURIDICO");
  });

  /**
   * O FILHO HERDA DO PAI.
   *
   * O caso inverso, e o mais provável no dia a dia: a venda é nativa da divisão (VOL, 36) e o
   * Lucas apontou UMA pessoa por incorporadora, na tela do loteamento inteiro (VLO, 35). Antes da
   * correção o envio lia só o 36, não achava ninguém, e o acordo parava — embora o pai tivesse
   * exatamente o que faltava.
   */
  it("o filho herda do pai o assinante de termos", async () => {
    leituraDaVenda.mockResolvedValue(
      vendaDoPanteon({ __empreendimento_id: "36", __unidade_enterprise_id: "36" }),
    );
    apontadoParaTermos.mockImplementation(async (_sb: unknown, id: string) =>
      id === "35" ? analistaDosTermos : null,
    );

    const preparo = await prepararEnvioDoAcordo(
      bancoDeTeste([], FAMILIA_VALE_DO_OURO),
      acordo(),
    );
    if (!preparo.ok) throw new Error("o preparo devia ter dado certo");

    expect(preparo.impedimento).toBeNull();
    expect(preparo.signatarios.map((s) => s.nome)).toContain("ANALISTA DO JURIDICO");
  });

  // ⚠️ E ESTE É O COMPORTAMENTO DE HOJE, escrito para quem for consertar saber o que muda: sem
  // `__empreendimento_id` (LOX, PDX e RDX têm a coluna nula, e 15 dos 18 acordos aprovados são
  // LOX) a queda para a unidade funciona, e é o único caminho que hoje tem acordo aprovado.
  it("sem id no empreendimento, procura no id que vive na unidade", async () => {
    leituraDaVenda.mockResolvedValue(
      vendaDoPanteon({ __empreendimento_id: "", __unidade_enterprise_id: "4" }),
    );

    const sb = bancoDeTeste();
    await prepararEnvioDoAcordo(sb, acordo());

    expect(apontadoParaTermos).toHaveBeenCalledWith(sb, "4");
  });
});

// ── 5. DEPOIS DO ENVIO ──────────────────────────────────────────────────────

describe("apagar o apontado DEPOIS de o envelope existir", () => {
  const envelopeVivo = {
    atualizado_em: null,
    criado_em: "2026-09-19T12:00:00.000Z",
    enviado_em: "2026-09-19T12:01:00.000Z",
    enviado_por_nome: "Operador",
    envelope_id: "env-acordo-vivo",
    estado: "aguardando",
    estado_cru: "clicksign:running",
    falha: null,
    id: "registro-vivo",
    provedor: "clicksign",
    provedor_documento_id: "doc-vivo",
  };

  // ⚠️ O ENVELOPE NÃO MUDA. Quem já está na Clicksign foi gravado em `temis_envelopes.signatarios`
  // no momento do envio; apagar a linha do quadro depois não tira ninguém de lá, e a tela continua
  // mostrando o envelope e seu estado.
  it("o envelope continua na tela, com id e estado", async () => {
    const preparo = await prepararEnvioDoAcordo(bancoDeTeste([envelopeVivo]), acordo());
    if (!preparo.ok) throw new Error("o preparo devia ter dado certo");

    expect(preparo.envelope?.envelopeId).toBe("env-acordo-vivo");
    expect(preparo.envelope?.estado).toBe("aguardando");
  });

  /**
   * A FRASE FALA DO ENVELOPE VIVO ANTES DE FALAR DO CADASTRO.
   *
   * `prepararEnvioDoAcordo` resolvia o impedimento nesta ordem: erro de leitura, falta de parte,
   * envelope vivo. Com o apontado apagado depois do envio, a falta de parte vencia e o operador lia
   * "falta apontar quem assina os TERMOS" ao lado de um termo que ESTÁ cobrando assinatura do
   * cliente, sem uma palavra sobre o envelope, seu id ou o caminho para cancelá-lo. Desde
   * 20/09/2026 o envelope vivo vem primeiro: ele é um fato, a falta de cadastro é uma previsão.
   */
  it("com envelope vivo, a frase é a do envelope, com o id dele", async () => {
    const preparo = await prepararEnvioDoAcordo(bancoDeTeste([envelopeVivo]), acordo());
    if (!preparo.ok) throw new Error("o preparo devia ter dado certo");

    expect(preparo.impedimento).toContain("env-acordo-vivo");
  });
});

// ── 6. DUAS VENDEDORAS ──────────────────────────────────────────────────────

describe("duas pessoas pela vendedora: só uma entra no termo", () => {
  // Lucas (13/09/2026): *"a vendedora eu posso ter mais de um assinante"* — isso é do CONTRATO. O
  // termo de acordo qualifica UMA parte vendedora: mandar as duas poria no envelope alguém que o
  // papel não menciona.
  it("com duas vendedoras no quadro, o termo leva a primeira e mais ninguém", async () => {
    quadroDoEmpreendimento.mockResolvedValue([
      representanteLegal,
      { ...representanteLegal, email: "segunda@incorporadora.test", nome: "Segunda Vendedora Silva" },
    ]);

    const preparo = await prepararEnvioDoAcordo(bancoDeTeste(), acordo());
    if (!preparo.ok) throw new Error("o preparo devia ter dado certo");

    expect(preparo.signatarios).toHaveLength(3);
    expect(preparo.signatarios.map((s) => s.nome)).toEqual([
      "BELTRANO EXEMPLO FERREIRA",
      "FULANA REPRESENTANTE LEGAL",
      "NIVEA CARELI",
    ]);
  });

  // ⚠️ E O APONTADO PARA TERMOS TAMBÉM É UM SÓ: quem escolhe é `assinanteDeTermosDaVendedora`
  // (menor `posicao`, `limit(1)`), e o envio não soma a vendedora do contrato por cima.
  it("apontado para termos e vendedora do contrato não viram dois signatários", async () => {
    quadroDoEmpreendimento.mockResolvedValue([representanteLegal]);
    apontadoParaTermos.mockResolvedValue(analistaDosTermos);

    const preparo = await prepararEnvioDoAcordo(bancoDeTeste(), acordo());
    if (!preparo.ok) throw new Error("o preparo devia ter dado certo");

    expect(preparo.signatarios.filter((s) => s.papel === "vendedora")).toHaveLength(1);
  });
});
