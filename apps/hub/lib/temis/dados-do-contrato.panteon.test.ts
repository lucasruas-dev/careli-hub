// A RODADA DE 18/09/2026: o card do distrato que veio vazio, e tudo o que ele pedia ao Panteon.
//
// Lucas: *"tem um distrato mas não está trazendo as informações, analisa o porquê"* · *"rg não
// precisa"* · *"tudo tem que ser alimentado pelo panteon"* · *"a única coisa que vamos utilizar o c2x
// é a questão financeira, mesmo assim ela tem que morar dentro da carteira no apolo"*.
//
// ⚠️ O CASO REAL ESTÁ RECONSTRUÍDO, E SEM DADO PESSOAL. A forma é a medida em produção para o card
// c8b22bd1 (proposta 819d9ac1, VOC Q09 L11, venda 4918 do C2X): duas fichas do mesmo CPF (o espelho
// do C2X `active` sem cadastro, e a CAD pública `review` com cadastro), a ponte por `c2xUserId`, a CAD
// do titular no VLO (35) com corretor e imobiliária, a proposta apontando o PAI (VLO) e a unidade na
// divisão (VOC, 37). Os documentos, nomes e ids aqui são inventados.

import { describe, expect, it } from "vitest";

import { dadosDaProposta } from "./dados-do-contrato";

type Filtros = Record<string, unknown>;
type Linhas = Record<string, unknown>;

/**
 * Duplo encadeável do Supabase, com `.eq`, `.in` e `.or` guardados nos filtros.
 *
 * O valor de cada tabela pode ser uma função dos filtros (a mesma tabela é lida por mais de um
 * motivo) e pode devolver `{ erro }` para simular a falha do PostgREST.
 */
function clienteFalso(porTabela: Linhas, lidas?: string[]) {
  const construir = (tabela: string) => {
    const filtros: Filtros = {};
    const resposta = () => {
      const bruto = porTabela[tabela];
      const valor = typeof bruto === "function" ? (bruto as (f: Filtros) => unknown)(filtros) : bruto;
      const comErro = valor as { erro?: { code?: string; message: string } } | null | undefined;
      if (comErro && typeof comErro === "object" && "erro" in comErro && comErro.erro) {
        return { data: null, error: comErro.erro };
      }
      return { data: valor ?? null, error: null };
    };
    const encadeia: Record<string, unknown> = new Proxy(
      {},
      {
        get(_alvo, prop: string) {
          if (prop === "maybeSingle") return () => Promise.resolve(resposta());
          if (prop === "then") {
            return (resolver: (r: unknown) => unknown) => Promise.resolve(resolver(resposta()));
          }
          if (prop === "eq") {
            return (coluna: string, valor: unknown) => {
              filtros[coluna] = valor;
              return encadeia;
            };
          }
          if (prop === "in") {
            return (coluna: string, valores: unknown) => {
              filtros[`in:${coluna}`] = valores;
              return encadeia;
            };
          }
          if (prop === "or") {
            return (expressao: string) => {
              filtros.or = expressao;
              return encadeia;
            };
          }
          return () => encadeia;
        },
      },
    );
    return encadeia;
  };
  return {
    from: (tabela: string) => {
      lidas?.push(tabela);
      return construir(tabela);
    },
  } as never;
}

// ── O CASO DO DISTRATO, RECONSTRUÍDO ─────────────────────────────────────────

const VLO = "e0000000-0000-0000-0000-00000000000a";
const VOC = "e0000000-0000-0000-0000-00000000000b";
const VOL = "e0000000-0000-0000-0000-00000000000c";
const ESPELHO = "a0000000-0000-0000-0000-000000000001";
const CAD = "a0000000-0000-0000-0000-000000000002";
const IMOBILIARIA = "c0000000-0000-0000-0000-000000000001";
const IMOBILIARIA_DUPLICADA = "c0000000-0000-0000-0000-000000000002";
const CORRETOR = "c0000000-0000-0000-0000-000000000003";
const COORDENADORA = "c0000000-0000-0000-0000-000000000004";

const CPF = "111.444.777-35";

const PROPOSTA_DO_DISTRATO = {
  cliente_c2x_id: 4880,
  cliente_documento: "11144477735",
  cliente_entity_id: null,
  cliente_nome: "COMPRADOR DO DISTRATO",
  compradores: [
    { c2x_user_id: 4880, documento: CPF, nome: "COMPRADOR DO DISTRATO", percentual: 100, titular: true },
  ],
  condicoes: null,
  contrato_parcelas: null,
  corretor_entity_id: null,
  corretor_nome: null,
  data_assinatura: null,
  data_ato: null,
  data_faturamento: null,
  dia_vencimento: 10,
  empreendimento_id: VLO,
  etapa_c2x: 4,
  imobiliaria_c2x_id: 2456,
  imobiliaria_entity_id: null,
  imobiliaria_nome: "IMOBILIARIA DO VOC",
  origem_c2x_id: 4918,
  plano_nome: "Plano 156x",
  plano_parcelas: 156,
  unidade_id: "d0000000-0000-0000-0000-000000000001",
  valor: 150000,
};

const UNIDADE_VOC = {
  area: 360,
  area_extenso: null,
  codigo: "VOC0911",
  enterprise_id: "37",
  lote: "11",
  matricula: "12.345",
  matricula_livro: null,
  preco_extenso: null,
  preco_tabela: 150000,
  quadra: "09",
  tipo_unidade: "lote",
};

const EMPREENDIMENTO_VLO = {
  c2x_enterprise_id: "35",
  cidade: "Pará de Minas",
  codigo: "VLO",
  id: VLO,
  nome: "Vale do Ouro",
  pai_id: null,
  uf: "MG",
};

const FAMILIA_VLO = [
  { c2x_enterprise_id: "35", id: VLO, nome: "Vale do Ouro", pai_id: null },
  { c2x_enterprise_id: "37", id: VOC, nome: "Vale do Ouro · VOC", pai_id: VLO },
  { c2x_enterprise_id: "36", id: VOL, nome: "Vale do Ouro · VOL", pai_id: VLO },
];

/** O espelho do C2X: `active`, sem `metadata.cadastro`. É o que vinha primeiro pela ordem do status. */
const ENTIDADE_ESPELHO = {
  created_at: "2026-08-28T12:00:00Z",
  display_name: "COMPRADOR DO DISTRATO",
  document_masked: CPF,
  entity_kind: "pf",
  id: ESPELHO,
  legal_name: null,
  metadata: {},
  status: "active",
  trade_name: null,
};

/** A CAD pública: `review`, com o cadastro que o card precisava. */
const ENTIDADE_CAD = {
  created_at: "2026-08-28T11:00:00Z",
  display_name: "COMPRADOR DO DISTRATO",
  document_masked: CPF,
  entity_kind: "pf",
  id: CAD,
  legal_name: null,
  metadata: {
    c2xUserId: "4880",
    cadastro: {
      dataNascimento: "1990-01-02",
      estadoCivilId: "1",
      nacionalidade: "Brasileira",
      orgaoEmissor: "SSP/MG",
      profissaoId: "3",
    },
  },
  status: "review",
  trade_name: null,
};

const CADASTROS_DE_QUEM_VENDEU: Record<string, Linhas> = {
  [COORDENADORA]: {
    display_name: "COORDENADORA LTDA",
    document_masked: "11.222.333/0001-81",
    entity_kind: "pj",
    id: COORDENADORA,
    legal_name: "COORDENADORA LTDA",
    trade_name: "Coordenadora",
  },
  [CORRETOR]: {
    display_name: "CORRETOR DA CAD",
    document_masked: "222.333.444-05",
    entity_kind: "pf",
    id: CORRETOR,
    legal_name: null,
    trade_name: null,
  },
  [IMOBILIARIA]: {
    display_name: "IMOBILIARIA DO VOC",
    document_masked: "44.555.666/0001-81",
    entity_kind: "pj",
    id: IMOBILIARIA,
    legal_name: "IMOBILIARIA DO VOC LTDA",
    trade_name: "Imobiliária do VOC",
  },
  [IMOBILIARIA_DUPLICADA]: {
    display_name: "IMOBILIARIA DO VOC (credenciamento)",
    document_masked: "44.555.666/0001-81",
    entity_kind: "pj",
    id: IMOBILIARIA_DUPLICADA,
    legal_name: "IMOBILIARIA DO VOC LTDA",
    trade_name: null,
  },
};

type Montagem = {
  ajustes?: Record<string, Linhas | null>;
  carteiraVendas?: unknown;
  entidades?: Linhas[];
  esteira?: Linhas[];
  links?: Linhas[];
  parcelas?: unknown;
  proposta?: Linhas;
};

function distrato(m: Montagem = {}, lidas?: string[]) {
  const proposta = { ...PROPOSTA_DO_DISTRATO, ...(m.proposta ?? {}) };
  return clienteFalso(
    {
      apolo_addresses: [],
      apolo_carteira_parcelas: m.parcelas ?? [],
      // ⚠️ É O ESTADO DE HOJE: a tabela ainda não existe (a migration espera o OK do Lucas).
      apolo_carteira_vendas:
        m.carteiraVendas === undefined
          ? {
              erro: {
                code: "PGRST205",
                message: "Could not find the table 'public.apolo_carteira_vendas' in the schema cache",
              },
            }
          : m.carteiraVendas,
      apolo_contacts: (f: Filtros) =>
        f.entity_id === IMOBILIARIA
          ? [
              { contact_type: "whatsapp", entity_id: IMOBILIARIA, value: "(31) 90000-0001" },
              { contact_type: "email", entity_id: IMOBILIARIA, value: "contato@imobiliaria.exemplo" },
            ]
          : [],
      apolo_enterprise_settings: (f: Filtros) =>
        (m.ajustes ?? {
          "35": {
            comissao_coordenadora_percentual: null,
            comissao_imobiliaria_percentual: null,
            coordenadora_entity_id: COORDENADORA,
          },
          "37": {
            comissao_coordenadora_percentual: "2.000",
            comissao_imobiliaria_percentual: "4.000",
            coordenadora_entity_id: COORDENADORA,
          },
        })[String(f.enterprise_id)] ?? null,
      apolo_entities: (f: Filtros) =>
        f.id ? (CADASTROS_DE_QUEM_VENDEU[String(f.id)] ?? null) : (m.entidades ?? [ENTIDADE_ESPELHO, ENTIDADE_CAD]),
      apolo_esteira: m.esteira ?? [
        {
          corretor: "CORRETOR DA CAD",
          corretor_entity_id: CORRETOR,
          enterprise_id: "35",
          entity_id: CAD,
          ficha: null,
          imobiliaria: "IMOBILIARIA DO VOC",
          imobiliaria_entity_id: IMOBILIARIA,
        },
      ],
      apolo_relationships: [],
      apolo_source_links: m.links ?? [
        { entity_id: ESPELHO, source_id: "4880" },
        { entity_id: IMOBILIARIA, source_id: "2456" },
      ],
      hercules_empreendimentos: (f: Filtros) => (f.or ? FAMILIA_VLO : EMPREENDIMENTO_VLO),
      hercules_proposta_eventos: [],
      hercules_propostas: proposta,
      hercules_unidades: UNIDADE_VOC,
      temis_envelopes: [],
    },
    lidas,
  );
}

// ── A. A FICHA CERTA ─────────────────────────────────────────────────────────

describe("A. a ficha certa do cliente", () => {
  it("o caso real: a CAD (review, com cadastro) ganha do espelho (active, vazio)", async () => {
    const r = (await dadosDaProposta("819d9ac1", distrato()))!;
    const v = r.dados.compradores[0]!.valores;

    expect(v.data_nascimento_cliente).toBe("02/01/1990");
    expect(v.estado_civil_cliente).toBe("Solteiro (a)");
    expect(v.nacionalidade_cliente).toBe("Brasileira");
    expect(v.profissao_cliente).toBe("ADMINISTRADOR(A)");
    // Nada disso entra na lista de faltas.
    const falta = r.avisos.find((a) => a.includes("falta"));
    expect(falta ?? "").not.toMatch(/nacionalidade|estado civil|profissão|nascimento/);
  });

  it("ANTES era o espelho que ganhava: sem a ponte e sem o cadastro, a ordem do status decidia", async () => {
    // A mesma venda com a CAD SEM cadastro e sem `c2xUserId`: sobra a ordem do banco, e o espelho,
    // que vem primeiro, continua sendo a escolha. É o comportamento antigo, preservado onde não há
    // nada melhor para escolher.
    const r = (await dadosDaProposta(
      "p",
      distrato({
        entidades: [ENTIDADE_ESPELHO, { ...ENTIDADE_CAD, display_name: "NOME DA CAD", metadata: {} }],
        esteira: [],
        links: [],
      }),
    ))!;
    expect(r.dados.compradores[0]!.valores.nome_cliente).toBe("COMPRADOR DO DISTRATO");
    expect(r.dados.compradores[0]!.valores.estado_civil_cliente).toBeUndefined();
  });

  it("a entidade que a proposta APONTA ganha da que tem mais cadastro — e é completada por ela", async () => {
    // ⚠️ O NOME É O DA MESMA PESSOA (o da outra ficha contido no dela). Com primeiro nome diferente a
    // outra ficha NÃO completa: ver "a CAD de outra pessoa com o mesmo CPF" na revisão de segurança.
    const apontada = {
      ...ENTIDADE_ESPELHO,
      display_name: "COMPRADOR DO DISTRATO APONTADO",
      metadata: { cadastro: { nacionalidade: "Portuguesa" } },
    };
    const r = (await dadosDaProposta(
      "p",
      distrato({
        entidades: [ENTIDADE_CAD, apontada],
        links: [],
        proposta: { cliente_c2x_id: null, cliente_entity_id: ESPELHO, compradores: [
          { cpf: CPF, nome: "X", participacao: 100, titular: true },
        ] },
      }),
    ))!;
    const v = r.dados.compradores[0]!.valores;
    expect(v.nome_cliente).toBe("COMPRADOR DO DISTRATO APONTADO");
    // O que ela tem, fica: a nacionalidade da apontada vence a da outra ficha.
    expect(v.nacionalidade_cliente).toBe("Portuguesa");
    // O que falta nela vem da outra ficha do MESMO documento.
    expect(v.data_nascimento_cliente).toBe("02/01/1990");
    expect(v.estado_civil_cliente).toBe("Solteiro (a)");
  });

  it("a ponte pelo C2X funciona também pelo `apolo_source_links`, sem `metadata.c2xUserId`", async () => {
    const outra = { ...ENTIDADE_CAD, id: "a0000000-0000-0000-0000-000000000009", metadata: {} };
    const r = (await dadosDaProposta(
      "p",
      distrato({
        // Duas vivas sem cadastro; só a do espelho é ligada ao usuário 4880.
        entidades: [outra, { ...ENTIDADE_ESPELHO, display_name: "A DO ESPELHO" }],
        esteira: [],
      }),
    ))!;
    expect(r.dados.compradores[0]!.valores.nome_cliente).toBe("A DO ESPELHO");
  });

  it("a arquivada nunca ganha, nem apontada pela proposta", async () => {
    const arquivada = { ...ENTIDADE_CAD, display_name: "A ARQUIVADA", status: "archived" };
    const r = (await dadosDaProposta(
      "p",
      distrato({
        entidades: [ENTIDADE_ESPELHO, arquivada],
        esteira: [],
        proposta: { cliente_entity_id: CAD },
      }),
    ))!;
    const v = r.dados.compradores[0]!.valores;
    expect(v.nome_cliente).toBe("COMPRADOR DO DISTRATO");
    // E a arquivada não completa nada: o cadastro dela é o que o merge descartou.
    expect(v.data_nascimento_cliente).toBeUndefined();
  });

  it("os campos em bloco não se misturam: com estado civil, o regime não vem de outra ficha", async () => {
    const escolhida = {
      ...ENTIDADE_CAD,
      metadata: { c2xUserId: "4880", cadastro: { estadoCivilId: "1", logradouro: "Rua Um", numero: "10" } },
    };
    const outra = {
      ...ENTIDADE_ESPELHO,
      metadata: {
        cadastro: { cep: "35000-000", dataNascimento: "1980-05-05", estadoCivilId: "2", regimeBensId: "1" },
      },
    };
    const r = (await dadosDaProposta(
      "p",
      distrato({ entidades: [outra, escolhida], esteira: [], links: [] }),
    ))!;
    const v = r.dados.compradores[0]!.valores;
    expect(v.estado_civil_cliente).toBe("Solteiro (a)");
    expect(v.regime_casamento_cliente).toBeUndefined();
    // O endereço da escolhida fica inteiro; o CEP da outra NÃO entra nele.
    expect(v.rua_cliente).toBe("Rua Um");
    expect(v.cep_cliente).toBeUndefined();
    // Campo solto, sim: o nascimento vem da outra.
    expect(v.data_nascimento_cliente).toBe("05/05/1980");
  });

  it("duas pessoas diferentes na mesma venda nunca se misturam", async () => {
    const CPF_B = "222.555.888-40";
    const pessoaA = {
      ...ENTIDADE_CAD,
      display_name: "PESSOA A",
      metadata: { c2xUserId: "4880", cadastro: { nacionalidade: "Brasileira" } },
    };
    const pessoaB = {
      created_at: "2026-01-01T00:00:00Z",
      display_name: "PESSOA B",
      document_masked: CPF_B,
      entity_kind: "pf",
      id: "b0000000-0000-0000-0000-000000000001",
      legal_name: null,
      metadata: {
        c2xUserId: "4880",
        cadastro: { dataNascimento: "1970-07-07", estadoCivilId: "2", profissaoId: "3", regimeBensId: "1" },
      },
      status: "active",
      trade_name: null,
    };
    const r = (await dadosDaProposta(
      "p",
      distrato({
        entidades: [pessoaA, pessoaB],
        esteira: [],
        proposta: {
          compradores: [
            { c2x_user_id: 4880, documento: CPF, nome: "PESSOA A", percentual: 50, titular: true },
            { c2x_user_id: 9999, documento: CPF_B, nome: "PESSOA B", percentual: 50, titular: false },
          ],
        },
      }),
    ))!;

    const [a, b] = r.dados.compradores;
    expect(a!.valores.nome_cliente).toBe("PESSOA A");
    expect(b!.valores.nome_cliente).toBe("PESSOA B");
    // ⚠️ A é quem NÃO tem nascimento nem profissão — e não os ganha de B, nem mesmo com o
    // `c2xUserId` da B igual ao do titular: a ponte só ordena dentro do mesmo documento.
    expect(a!.valores.data_nascimento_cliente).toBeUndefined();
    expect(a!.valores.profissao_cliente).toBeUndefined();
    expect(a!.valores.estado_civil_cliente).toBeUndefined();
    expect(b!.valores.data_nascimento_cliente).toBe("07/07/1970");
    expect(b!.valores.nacionalidade_cliente).toBeUndefined();
  });
});

// ── C. A COMISSÃO PELA DIVISÃO ───────────────────────────────────────────────

describe("C. a comissão pela divisão da unidade", () => {
  it("o caso real: VOC (37) tem 2% e 4%, o VLO (35) está nulo — vale o VOC, sem aviso", async () => {
    const r = (await dadosDaProposta("p", distrato()))!;
    const g = r.dados.gerais;

    expect(g.percentual_comissao_coordenadora_vendas).toBe("2%");
    expect(g.percentual_comissao_vinculado).toBe("4%");
    // 150.000 × 2% = 3.000 · × 4% = 6.000 · total 9.000.
    expect(g.valor_total_comissao).toBe("R$ 9.000,00");
    expect(r.avisos.join(" | ")).not.toContain("percentuais de comissão");
    // A coordenadora veio (as duas linhas apontam a mesma).
    expect(g.nome_fantasia_coordenadora_vendas).toBe("Coordenadora");
    // ⚠️ E A MINUTA CONTINUA A DO PAI.
    expect(g.__empreendimento_id).toBe("35");
  });

  it("a divisão sem linha herda o pai inteiro", async () => {
    const r = (await dadosDaProposta(
      "p",
      distrato({
        ajustes: {
          "35": {
            comissao_coordenadora_percentual: "3.000",
            comissao_imobiliaria_percentual: "4.500",
            coordenadora_entity_id: COORDENADORA,
          },
        },
      }),
    ))!;
    expect(r.dados.gerais.percentual_comissao_coordenadora_vendas).toBe("3%");
    expect(r.dados.gerais.percentual_comissao_vinculado).toBe("4,5%");
  });

  it("herda campo a campo: o que a divisão não configurou vem do pai", async () => {
    const r = (await dadosDaProposta(
      "p",
      distrato({
        ajustes: {
          "35": {
            comissao_coordenadora_percentual: "3.000",
            comissao_imobiliaria_percentual: "4.500",
            coordenadora_entity_id: COORDENADORA,
          },
          "37": {
            comissao_coordenadora_percentual: null,
            comissao_imobiliaria_percentual: "5.000",
            coordenadora_entity_id: null,
          },
        },
      }),
    ))!;
    const g = r.dados.gerais;
    expect(g.percentual_comissao_vinculado).toBe("5%");
    expect(g.percentual_comissao_coordenadora_vendas).toBe("3%");
    expect(g.nome_fantasia_coordenadora_vendas).toBe("Coordenadora");
  });

  it("empreendimento sem divisão: a chave é uma só, e nada muda", async () => {
    const lidas: string[] = [];
    const sb = clienteFalso(
      {
        apolo_enterprise_settings: (f: Filtros) =>
          f.enterprise_id === "39"
            ? {
                comissao_coordenadora_percentual: "1.500",
                comissao_imobiliaria_percentual: "5.000",
                coordenadora_entity_id: null,
              }
            : null,
        hercules_empreendimentos: {
          c2x_enterprise_id: "39",
          cidade: "Pará de Minas",
          codigo: "GDN",
          id: "e0000000-0000-0000-0000-0000000000ff",
          nome: "Garden",
          pai_id: null,
          uf: "MG",
        },
        hercules_propostas: {
          ...PROPOSTA_DO_DISTRATO,
          condicoes: { anuais: [], mensais: [], totais: { entrada: 0, financiado: 0 } },
          origem_c2x_id: null,
        },
        hercules_unidades: { ...UNIDADE_VOC, enterprise_id: "39" },
      },
      lidas,
    );
    const g = (await dadosDaProposta("p", sb))!.dados.gerais;
    expect(g.percentual_comissao_coordenadora_vendas).toBe("1,5%");
    expect(lidas.filter((t) => t === "apolo_enterprise_settings")).toHaveLength(1);
  });

  it("a divisão nativa (VOL) sobe ao pai para o que não configurou", async () => {
    const sb = clienteFalso({
      apolo_enterprise_settings: (f: Filtros) =>
        f.enterprise_id === "35"
          ? {
              comissao_coordenadora_percentual: "2.000",
              comissao_imobiliaria_percentual: "4.000",
              coordenadora_entity_id: COORDENADORA,
            }
          : null,
      apolo_entities: (f: Filtros) => (f.id ? (CADASTROS_DE_QUEM_VENDEU[String(f.id)] ?? null) : []),
      hercules_empreendimentos: (f: Filtros) =>
        f.id === VLO
          ? { c2x_enterprise_id: "35" }
          : {
              c2x_enterprise_id: "36",
              cidade: "Pará de Minas",
              codigo: "VOL",
              id: VOL,
              nome: "Vale do Ouro · VOL",
              pai_id: VLO,
              uf: "MG",
            },
      hercules_propostas: {
        ...PROPOSTA_DO_DISTRATO,
        condicoes: { anuais: [], mensais: [], totais: { entrada: 0, financiado: 0 } },
        empreendimento_id: VOL,
        origem_c2x_id: null,
      },
      hercules_unidades: { ...UNIDADE_VOC, enterprise_id: "36" },
    });
    const g = (await dadosDaProposta("p", sb))!.dados.gerais;
    expect(g.percentual_comissao_coordenadora_vendas).toBe("2%");
    expect(g.nome_fantasia_coordenadora_vendas).toBe("Coordenadora");
  });
});

// ── D. QUEM VENDEU, PELA CAD DO TITULAR ──────────────────────────────────────

describe("D. o corretor e a imobiliária da venda importada, pelo Apolo", () => {
  it("o caso real: corretor da CAD (no VLO 35) e CNPJ/contatos da imobiliária pelo link", async () => {
    const g = (await dadosDaProposta("p", distrato()))!.dados.gerais;

    expect(g.corretor_nome).toBe("CORRETOR DA CAD");
    // O nome da proposta continua ganhando.
    expect(g.imobiliaria_nome).toBe("IMOBILIARIA DO VOC");
    expect(g.nome_vinculado).toBe("IMOBILIARIA DO VOC");
    expect(g.cpf_cnpj_vinculado).toBe("44.555.666/0001-81");
    expect(g.telefone_vinculado).toBe("(31) 90000-0001");
    expect(g.email_vinculado).toBe("contato@imobiliaria.exemplo");
  });

  it("a CAD gravada no grupo (`group:Vale do Ouro`) também é do empreendimento", async () => {
    const g = (await dadosDaProposta(
      "p",
      distrato({
        esteira: [
          {
            corretor_entity_id: CORRETOR,
            enterprise_id: "group:Vale do Ouro",
            entity_id: CAD,
            ficha: null,
            imobiliaria_entity_id: IMOBILIARIA,
          },
        ],
      }),
    ))!.dados.gerais;
    expect(g.corretor_nome).toBe("CORRETOR DA CAD");
  });

  it("a CAD de OUTRO empreendimento não entra — o corretor dela não vendeu este lote", async () => {
    const g = (await dadosDaProposta(
      "p",
      distrato({
        esteira: [
          {
            corretor_entity_id: CORRETOR,
            enterprise_id: "39",
            entity_id: CAD,
            ficha: null,
            imobiliaria_entity_id: IMOBILIARIA,
          },
        ],
      }),
    ))!.dados.gerais;
    expect(g.corretor_nome).toBeUndefined();
    // O CNPJ da imobiliária continua vindo pelo link da própria venda.
    expect(g.cpf_cnpj_vinculado).toBe("44.555.666/0001-81");
  });

  it("CAD de outra imobiliária não nomeia o corretor", async () => {
    const OUTRA = "c0000000-0000-0000-0000-0000000000aa";
    CADASTROS_DE_QUEM_VENDEU[OUTRA] = {
      display_name: "OUTRA IMOBILIARIA",
      document_masked: "99.888.777/0001-00",
      entity_kind: "pj",
      id: OUTRA,
      legal_name: null,
      trade_name: null,
    };
    const g = (await dadosDaProposta(
      "p",
      distrato({
        esteira: [
          {
            corretor_entity_id: CORRETOR,
            enterprise_id: "35",
            entity_id: CAD,
            ficha: null,
            imobiliaria_entity_id: OUTRA,
          },
        ],
      }),
    ))!.dados.gerais;
    expect(g.corretor_nome).toBeUndefined();
    expect(g.cpf_cnpj_vinculado).toBe("44.555.666/0001-81");
  });

  it("CAD com a MESMA imobiliária em outra entidade (mesmo CNPJ) vale", async () => {
    const g = (await dadosDaProposta(
      "p",
      distrato({
        esteira: [
          {
            corretor_entity_id: CORRETOR,
            enterprise_id: "35",
            entity_id: CAD,
            ficha: null,
            imobiliaria_entity_id: IMOBILIARIA_DUPLICADA,
          },
        ],
      }),
    ))!.dados.gerais;
    expect(g.corretor_nome).toBe("CORRETOR DA CAD");
  });

  it("sem CAD e sem link, tudo fica como antes: só o nome da proposta", async () => {
    const g = (await dadosDaProposta("p", distrato({ esteira: [], links: [] })))!.dados.gerais;
    expect(g.nome_vinculado).toBe("IMOBILIARIA DO VOC");
    expect(g.corretor_nome).toBeUndefined();
    expect(g.cpf_cnpj_vinculado).toBeUndefined();
  });

  it("a nativa com vínculo não procura CAD nem link", async () => {
    const lidas: string[] = [];
    await dadosDaProposta(
      "p",
      distrato(
        {
          proposta: {
            cliente_c2x_id: null,
            compradores: [{ cpf: CPF, nome: "X", participacao: 100, titular: true }],
            corretor_entity_id: CORRETOR,
            imobiliaria_c2x_id: null,
            imobiliaria_entity_id: IMOBILIARIA,
            origem_c2x_id: null,
          },
        },
        lidas,
      ),
    );
    expect(lidas).not.toContain("apolo_source_links");
    expect(lidas.filter((t) => t === "hercules_empreendimentos")).toHaveLength(1);
  });
});

// ── E. O FINANCEIRO PELA CARTEIRA DO APOLO ───────────────────────────────────

describe("E. o financeiro da venda importada pela carteira do Apolo", () => {
  it("hoje (tabela ainda não existe): o aviso diz que a carteira ainda não separa a venda, e NÃO 'sem lançamentos'", async () => {
    // ⚠️ "Sem lançamentos" era desmentido pelo retrato por pessoa da própria carteira do Apolo, que tem
    // as parcelas de 4 dos 6 distratos em análise (medido em 18/09/2026).
    const r = (await dadosDaProposta("p", distrato()))!;
    const tudo = r.avisos.join(" | ");
    expect(tudo).toContain("a carteira do Apolo ainda não separa esta venda por parcela");
    expect(tudo).not.toContain("sem lançamentos");
    expect(tudo).not.toContain("não tem cronograma gravado");
    expect(r.carteira).toEqual({
      motivo: "nunca_sincronizada",
      situacao: "sem_carteira",
      sincronizadaEm: null,
    });
    // Nada de valor inventado.
    expect(r.dados.gerais.valor_entrada).toBeUndefined();
    expect(r.dados.gerais.valor_divida_financiada).toBeUndefined();
  });

  it("NÃO lê o C2X nem o retrato por pessoa", async () => {
    const lidas: string[] = [];
    await dadosDaProposta("p", distrato({}, lidas));
    expect(lidas.some((t) => t.startsWith("c2x_"))).toBe(false);
    expect(lidas).not.toContain("apolo_financial_snapshots");
    expect(lidas).not.toContain("apolo_financeiro_por_entidade");
  });

  it("com a carteira sincronizada: entrada, financiado e prazo saem dela", async () => {
    const parcela = (id: number, tipo: number, valor: number, extra: Linhas = {}) => ({
      a_excluir: false,
      boleto_url: null,
      c2x_payment_id: id,
      competencia: null,
      descricao: null,
      fatura_url: null,
      juros: 0,
      multa: 0,
      pagamento: null,
      parcela_atual: tipo === 3 ? id - 10 : 0,
      parcela_total: tipo === 3 ? 3 : 0,
      sinal_atual: tipo === 2 ? 1 : 0,
      sinal_total: tipo === 2 ? 1 : 0,
      status_id: 6,
      tipo_id: tipo,
      tipo_nome: tipo === 1 ? "Ato" : tipo === 2 ? "Sinal" : "Parcela",
      valor_inicial: valor,
      valor_pago: 0,
      vencimento: "2030-01-10",
      ...extra,
    });
    const r = (await dadosDaProposta(
      "p",
      distrato({
        carteiraVendas: { estagio_c2x: 4, parcelas: 5, sincronizada_em: "2026-09-18T21:45:19Z" },
        parcelas: [
          parcela(1, 1, 0.01, { pagamento: "2026-08-20", status_id: 5, valor_pago: 0.01 }),
          parcela(2, 2, 14999.99),
          parcela(11, 3, 1000),
          parcela(12, 3, 1000),
          parcela(13, 3, 1000),
        ],
      }),
    ))!;
    const g = r.dados.gerais;
    expect(r.carteira?.situacao).toBe("ok");
    expect(g.valor_entrada).toBe("R$ 15.000,00");
    expect(g.valor_divida_financiada).toBe("R$ 3.000,00");
    expect(g.prazo_meses_amortizacao).toBe("3");
    expect(r.avisos.join(" | ")).not.toContain("carteira do Apolo");
  });

  it("sincronizada e vazia, com ato pago no Hércules: é fato, e a divergência aparece", async () => {
    const r = (await dadosDaProposta(
      "p",
      distrato({
        carteiraVendas: { estagio_c2x: 4, parcelas: 0, sincronizada_em: "2026-09-18T21:45:19Z" },
        parcelas: [],
        proposta: { data_ato: "2026-08-22" },
      }),
    ))!;
    const aviso = r.avisos.find((a) => a.includes("carteira do Apolo")) ?? "";
    expect(aviso).toContain("sem lançamentos na carteira do Apolo");
    expect(aviso).toContain("18/09/2026");
    expect(aviso).toContain("ato pago em");
  });

  it("leitura que falhou não vira 'sem lançamentos'", async () => {
    const r = (await dadosDaProposta(
      "p",
      distrato({ carteiraVendas: { erro: { code: "57014", message: "timeout" } } }),
    ))!;
    const tudo = r.avisos.join(" | ");
    expect(r.carteira?.situacao).toBe("erro");
    expect(tudo).toContain("Não consegui ler a carteira do Apolo");
    expect(tudo).not.toContain("sem lançamentos");
  });

  it("a NATIVA sem cronograma continua com o aviso antigo e não procura carteira", async () => {
    const lidas: string[] = [];
    const r = (await dadosDaProposta(
      "p",
      distrato({ proposta: { origem_c2x_id: null } }, lidas),
    ))!;
    expect(r.carteira).toBeNull();
    expect(r.avisos.join(" | ")).toContain("não tem cronograma gravado");
    expect(lidas).not.toContain("apolo_carteira_vendas");
  });
});
