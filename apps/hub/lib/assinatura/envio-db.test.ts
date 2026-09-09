import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DadosDoContrato } from "@/lib/temis/preencher-contrato";

import type { Opcoes } from "./clicksign/cliente";

// ⚠️ `dadosDaProposta` É SUBSTITUÍDO, e não exercitado: ele lê seis tabelas do Apolo e já tem teste
// próprio (`lib/temis/dados-do-contrato.test.ts`). O que ESTE arquivo testa é o que acontece DEPOIS
// dele — a ordem, a conferência e o registro —, e misturar as duas coisas daria um teste que quebra
// por motivo alheio.
vi.mock("@/lib/temis/dados-do-contrato", () => ({
  dadosDaProposta: vi.fn(),
}));

const { dadosDaProposta } = await import("@/lib/temis/dados-do-contrato");
const { enviarContratoParaAssinatura, prepararEnvio } = await import("./envio-db");

// ── OS DUPLOS ───────────────────────────────────────────────────────────────

type Escrita = { acao: "insert" | "update"; payload: unknown; tabela: string };
type Config = Record<string, { lista?: unknown; unico?: unknown }>;

/**
 * O duplo do Supabase, no molde de `lib/temis/dados-do-contrato.test.ts`, com uma diferença: ele
 * GRAVA o que foi escrito. É por essa lista que se prova a regra do Lucas — o que o operador muda
 * na hora do envio NÃO volta para o cadastro do empreendimento.
 */
function clienteFalso(config: Config, escritas: Escrita[], bytes = new Uint8Array([37, 80, 68, 70])) {
  const from = (tabela: string) => {
    const resposta = (unico: boolean) => ({
      data: unico ? (config[tabela]?.unico ?? null) : (config[tabela]?.lista ?? null),
      error: null,
    });

    const enc: Record<string, unknown> = {};
    for (const metodo of ["select", "eq", "is", "neq", "order", "limit", "in"]) {
      enc[metodo] = () => enc;
    }
    enc.insert = (payload: unknown) => {
      escritas.push({ acao: "insert", payload, tabela });
      return enc;
    };
    enc.update = (payload: unknown) => {
      escritas.push({ acao: "update", payload, tabela });
      return enc;
    };
    enc.maybeSingle = () => Promise.resolve(resposta(true));
    enc.then = (aceitar: (r: unknown) => unknown, recusar?: (e: unknown) => unknown) =>
      Promise.resolve(resposta(false)).then(aceitar, recusar);
    return enc;
  };

  return {
    from,
    storage: {
      from: () => ({
        download: () => Promise.resolve({ data: new Blob([bytes]), error: null }),
      }),
    },
  } as never;
}

type Chamada = { caminho: string; corpo: unknown; metodo: string };

function portaFalsa() {
  const chamadas: Chamada[] = [];
  let signer = 0;
  const porta = async <T = unknown>(caminho: string, opcoes: Opcoes = {}): Promise<T> => {
    chamadas.push({ caminho, corpo: opcoes.corpo, metodo: opcoes.metodo ?? "GET" });
    if (caminho === "/envelopes") return { data: { id: "env_1" } } as T;
    if (caminho.endsWith("/documents")) return { data: { id: "doc_1" } } as T;
    if (caminho.endsWith("/signers")) {
      signer += 1;
      return { data: { id: `sig_${signer}` } } as T;
    }
    return {} as T;
  };
  return { chamadas, porta };
}

// ── O CENÁRIO ───────────────────────────────────────────────────────────────
//
// É o do ZZ TESTE, medido no banco em 08/09/2026: Henrique Sales do Vale (Q01 L05), casado, com a
// cônjuge Patrícia — e os dois com e-mail PRÓPRIO na ficha. É o contrato do primeiro envio real.

const PROPOSTA = "641f22ac-6c4a-4133-afec-49fa7b7e1765";

const dados = (emailDaConjuge: string): DadosDoContrato => ({
  compradores: [
    {
      ehPessoaFisica: true,
      temConjuge: true,
      valores: {
        cpf_cliente: "999.999.004-53",
        email_cliente: "henrique.vale@zzteste.careli.dev",
        email_conjuge: emailDaConjuge,
        nome_cliente: "Henrique Sales do Vale",
        nome_conjuge: "Patrícia Sales do Vale",
      },
    },
  ],
  gerais: {
    __empreendimento_id: "9001",
    empreendimento_codigo: "TST",
    numero_lote: "05",
    numero_quadra: "01",
    vendedora_representante_email: "diretor@spe.com.br",
    vendedora_representante_nome: "Carlos Gurgel Neto",
  },
});

const CONTRATO_GUARDADO = [
  {
    caminho: "unidades/u1/abc-contrato.pdf",
    criado_em: "2026-09-09T12:00:00.000Z",
    id: "doc-uuid-v2",
    nome: "Contrato - TST - Q01 L05 - Henrique Sales do Vale - 2026-09-09 v2.pdf",
    unidade_id: "unid-uuid",
  },
  {
    caminho: "unidades/u1/velho.pdf",
    criado_em: "2026-09-08T12:00:00.000Z",
    id: "doc-uuid-v1",
    nome: "Contrato - TST - Q01 L05 - Henrique Sales do Vale - 2026-09-08 v1.pdf",
    unidade_id: "unid-uuid",
  },
];

function cenario(
  extra: Config = {},
): Config {
  return {
    apolo_enterprise_settings: {
      unico: { assinatura_ordem: ["comprador", "conjuge", "vendedora"], assinatura_ordenada: true },
    },
    hercules_documentos: {
      lista: CONTRATO_GUARDADO,
      unico: { caminho: "unidades/u1/abc-contrato.pdf" },
    },
    hercules_unidades: { unico: { categoria_id: null, enterprise_id: "9001" } },
    temis_envelopes: { unico: { id: "reg-1" } },
    ...extra,
  };
}

beforeEach(() => {
  vi.mocked(dadosDaProposta).mockResolvedValue({
    avisos: [],
    dados: dados("patricia.vale@zzteste.careli.dev"),
  });
});

// ── O PREPARO ───────────────────────────────────────────────────────────────

describe("o que a tela mostra antes de alguém confirmar", () => {
  // ⚠️ A VERSÃO VIGENTE É A QUE SAI, e não "a primeira que a consulta devolveu". Duas versões
  // guardadas é o caso normal (alguém consertou um dado e gerou de novo); mandar a antiga para
  // assinatura é o defeito que ninguém percebe até o PDF assinado voltar com o dado errado.
  it("escolhe o contrato vigente entre as versões guardadas", async () => {
    const preparo = await prepararEnvio(clienteFalso(cenario(), []), PROPOSTA);
    expect(preparo.ok).toBe(true);
    if (!preparo.ok) return;
    expect(preparo.contrato.documentoId).toBe("doc-uuid-v2");
    expect(preparo.contrato.versao).toBe(2);
  });

  it("traz a ordem do cadastro já resolvida, e diz de onde ela veio", async () => {
    const preparo = await prepararEnvio(clienteFalso(cenario(), []), PROPOSTA);
    expect(preparo.ok).toBe(true);
    if (!preparo.ok) return;

    expect(preparo.origemDaRegra).toBe("empreendimento");
    expect(preparo.origemDescrita).toContain("Setup do empreendimento");
    expect(preparo.signatarios.map((s) => [s.papel, s.ordem])).toEqual([
      ["comprador", 1],
      ["conjuge", 2],
      ["vendedora", 3],
    ]);
  });

  // ⚠️ O PREPARO NÃO RECUSA, DEVOLVE O IMPEDIMENTO. A tela precisa mostrar a lista de quem assina
  // MESMO quando falta e-mail: é olhando a lista que o operador entende o que corrigir.
  it("devolve o impedimento junto com a lista, em vez de recusar", async () => {
    vi.mocked(dadosDaProposta).mockResolvedValue({
      avisos: [],
      dados: dados("henrique.vale@zzteste.careli.dev"),
    });

    const preparo = await prepararEnvio(clienteFalso(cenario(), []), PROPOSTA);
    expect(preparo.ok).toBe(true);
    if (!preparo.ok) return;
    expect(preparo.impedimento).toContain("MESMO e-mail");
    expect(preparo.signatarios).toHaveLength(3);
  });

  it("recusa quando a proposta ainda não tem contrato gerado", async () => {
    const preparo = await prepararEnvio(
      clienteFalso(cenario({ hercules_documentos: { lista: [], unico: null } }), []),
      PROPOSTA,
    );
    expect(preparo.ok).toBe(false);
    if (preparo.ok) return;
    expect(preparo.status).toBe(409);
    expect(preparo.erro).toContain("Gere o contrato");
  });
});

// ── O ENVIO ─────────────────────────────────────────────────────────────────

describe("o envio", () => {
  it("manda o contrato e registra o envelope", async () => {
    const escritas: Escrita[] = [];
    const { chamadas, porta } = portaFalsa();

    const r = await enviarContratoParaAssinatura(
      clienteFalso(cenario(), escritas),
      { propostaId: PROPOSTA, usuarioId: "user-1", usuarioNome: "Lucas" },
      porta,
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.envelopeId).toBe("env_1");

    // ⚠️ A LINHA NASCE ANTES DA CHAMADA. Se ela só existisse depois de a Clicksign responder, uma
    // queda no meio deixaria um envelope pago e PERMANENTE na conta do qual o Panteon não teria
    // notícia nenhuma.
    const insercao = escritas.find((e) => e.acao === "insert" && e.tabela === "temis_envelopes");
    expect(insercao).toBeTruthy();
    expect((insercao?.payload as { envelope_id?: string }).envelope_id).toBeUndefined();

    // E o id só é carimbado no fim.
    const carimbo = escritas.find(
      (e) => e.acao === "update" && e.tabela === "temis_envelopes",
    )?.payload as { envelope_id: string; estado: string };
    expect(carimbo.envelope_id).toBe("env_1");
    expect(carimbo.estado).toBe("aguardando");

    // O card da Têmis anda porque um fato aconteceu, e não porque alguém arrastou.
    const card = escritas.find((e) => e.tabela === "temis_trabalhos")?.payload as {
      estagio: string;
    };
    expect(card.estagio).toBe("assinatura");

    expect(chamadas.some((c) => c.caminho === "/envelopes" && c.metodo === "POST")).toBe(true);
  });

  // ⚠️ A REGRA DO LUCAS (08/09/2026): *"claro que temos que ter a opção de alterar antes de enviar o
  // contrato, mas vem preenchido por padrão"*. ALTERAR ANTES DE ENVIAR É UMA EXCEÇÃO DAQUELE
  // CONTRATO — transformá-la na política do empreendimento inteiro seria um efeito colateral que
  // ninguém pediu, e o sintoma apareceria no PRÓXIMO contrato, com outra pessoa.
  it("a ordem escolhida no envio vale para o envelope e NÃO volta para o cadastro", async () => {
    const escritas: Escrita[] = [];
    const { chamadas, porta } = portaFalsa();

    const r = await enviarContratoParaAssinatura(
      clienteFalso(cenario(), escritas),
      {
        // O cadastro diz comprador → cônjuge → vendedora. Aqui a vendedora assina PRIMEIRO.
        ordemEscolhida: { ordenada: true, papeis: ["vendedora", "comprador", "conjuge"] },
        propostaId: PROPOSTA,
      },
      porta,
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // O envelope saiu com a ordem escolhida…
    const grupos = chamadas
      .filter((c) => c.caminho.endsWith("/signers"))
      .map((c) => (c.corpo as { data: { attributes: { group: number } } }).data.attributes.group);
    expect(grupos).toEqual([2, 3, 1]);

    // …e NADA foi gravado no cadastro do empreendimento nem na categoria.
    expect(escritas.map((e) => e.tabela)).not.toContain("apolo_enterprise_settings");
    expect(escritas.map((e) => e.tabela)).not.toContain("temis_categorias");
  });

  // ⚠️ A ARMADILHA CONHECIDA: o cônjuge que compartilha a caixa do titular. Deixá-la falhar na API
  // deixaria um envelope criado com metade dos signatários dentro — numa conta de produção onde o
  // rascunho só se apaga enquanto ninguém ativou.
  it("RECUSA e-mail repetido ANTES de tocar a API e antes de abrir registro", async () => {
    vi.mocked(dadosDaProposta).mockResolvedValue({
      avisos: [],
      dados: dados("henrique.vale@zzteste.careli.dev"),
    });

    const escritas: Escrita[] = [];
    const { chamadas, porta } = portaFalsa();

    const r = await enviarContratoParaAssinatura(
      clienteFalso(cenario(), escritas),
      { propostaId: PROPOSTA },
      porta,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toContain("MESMO e-mail");
    // Nenhuma chamada à Clicksign, nenhuma linha aberta.
    expect(chamadas).toHaveLength(0);
    expect(escritas).toHaveLength(0);
  });

  it("RECUSA signatário sem e-mail ANTES de tocar a API", async () => {
    vi.mocked(dadosDaProposta).mockResolvedValue({ avisos: [], dados: dados("") });

    const escritas: Escrita[] = [];
    const { chamadas, porta } = portaFalsa();

    const r = await enviarContratoParaAssinatura(
      clienteFalso(cenario(), escritas),
      { propostaId: PROPOSTA },
      porta,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("Patrícia Sales do Vale");
    expect(r.erro).toContain("e-mail");
    expect(chamadas).toHaveLength(0);
    expect(escritas).toHaveLength(0);
  });

  // ⚠️ SEM A LINHA DE REGISTRO NADA SAI. É a única falha que para tudo: o envelope existiria na
  // Clicksign sem NADA no Panteon apontando para ele — pago, permanente e invisível.
  it("não manda nada quando não consegue registrar o envio", async () => {
    const escritas: Escrita[] = [];
    const { chamadas, porta } = portaFalsa();

    const r = await enviarContratoParaAssinatura(
      clienteFalso(cenario({ temis_envelopes: { unico: null } }), escritas),
      { propostaId: PROPOSTA },
      porta,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("0147");
    expect(chamadas).toHaveLength(0);
  });
});
