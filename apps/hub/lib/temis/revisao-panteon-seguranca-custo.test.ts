// REVISÃO DA RODADA DE 18/09/2026, com uma lente só: SÓ PANTEON, SEGURANÇA E CUSTO.
//
// Lucas (18/09/2026): *"tudo tem que ser alimentado pelo panteon"* · *"a única coisa que vamos
// utilizar o c2x é a questão financeira, mesmo assim ela tem que morar dentro da carteira no apolo"*.
//
// ⚠️ ATÉ A RODADA 2 (18/09/2026) CINCO TESTES DAQUI TINHAM "DEFEITO" NO NOME E FICAVAM VERMELHOS DE
// PROPÓSITO: cada um prendia um achado da revisão, medido em produção só por SELECT. Corrigidos na
// rodada 2, viraram guardas, junto com as que já passavam (o custo de uma abertura e a ausência do
// legado).
//
// ⚠️ SEM DADO PESSOAL: nomes, documentos e ids daqui são inventados. A forma de cada caso é a medida.

import { describe, expect, it } from "vitest";

import { analiseDoTrabalho } from "./analise-do-trabalho";
import {
  CARTEIRA_AINDA_SEM_A_VENDA,
  CARTEIRA_ILEGIVEL,
  dadosDaProposta,
  SEM_LANCAMENTOS_NA_CARTEIRA,
} from "./dados-do-contrato";

type Filtros = Record<string, unknown>;
type Leitura = { filtros: Filtros; tabela: string };

/** Duplo encadeável do Supabase que registra cada consulta e os filtros dela. */
function clienteFalso(porTabela: Record<string, unknown>, lidas: Leitura[] = []) {
  const construir = (tabela: string) => {
    const filtros: Filtros = {};
    const resposta = () => {
      lidas.push({ filtros: { ...filtros }, tabela });
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
  return { from: (tabela: string) => construir(tabela) } as never;
}

const VLO = "e0000000-0000-0000-0000-00000000000a";
const VOC = "e0000000-0000-0000-0000-00000000000b";
const ESPELHO = "a0000000-0000-0000-0000-000000000001";
const CAD = "a0000000-0000-0000-0000-000000000002";
const IMOBILIARIA = "c0000000-0000-0000-0000-000000000001";
const CORRETOR = "c0000000-0000-0000-0000-000000000003";
const COORDENADORA = "c0000000-0000-0000-0000-000000000004";
const CPF = "111.444.777-35";

const PROPOSTA_IMPORTADA = {
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

const ENTIDADE_CAD = {
  created_at: "2026-08-28T11:00:00Z",
  display_name: "COMPRADOR DO DISTRATO",
  document_masked: CPF,
  entity_kind: "pf",
  id: CAD,
  legal_name: null,
  metadata: {
    c2xUserId: "4880",
    cadastro: { dataNascimento: "1990-01-02", estadoCivilId: "1", nacionalidade: "Brasileira", profissaoId: "3" },
  },
  status: "review",
  trade_name: null,
};

const POR_ID: Record<string, Record<string, unknown>> = {
  [CAD]: { display_name: "COMPRADOR DO DISTRATO", document_masked: CPF, entity_kind: "pf", id: CAD },
  [COORDENADORA]: {
    display_name: "COORDENADORA LTDA",
    document_masked: "11.222.333/0001-81",
    entity_kind: "pj",
    id: COORDENADORA,
    legal_name: "COORDENADORA LTDA",
    trade_name: "Coordenadora",
  },
  [CORRETOR]: { display_name: "CORRETOR DA CAD", document_masked: "222.333.444-05", entity_kind: "pf", id: CORRETOR },
  [ESPELHO]: { display_name: "COMPRADOR DO DISTRATO", document_masked: CPF, entity_kind: "pf", id: ESPELHO },
  [IMOBILIARIA]: {
    display_name: "IMOBILIARIA DO VOC",
    document_masked: "44.555.666/0001-81",
    entity_kind: "pj",
    id: IMOBILIARIA,
    legal_name: "IMOBILIARIA DO VOC LTDA",
    trade_name: "Imobiliária do VOC",
  },
};

type Montagem = {
  carteiraVendas?: unknown;
  enderecos?: unknown[];
  entidades?: unknown[];
  esteira?: unknown[];
  links?: unknown[];
};

function distrato(m: Montagem = {}, lidas?: Leitura[]) {
  return clienteFalso(
    {
      apolo_addresses: m.enderecos ?? [],
      apolo_carteira_parcelas: [],
      apolo_carteira_vendas:
        m.carteiraVendas ??
        ({
          erro: {
            code: "PGRST205",
            message: "Could not find the table 'public.apolo_carteira_vendas' in the schema cache",
          },
        } as unknown),
      apolo_contacts: (f: Filtros) =>
        f.entity_id === IMOBILIARIA
          ? [{ contact_type: "email", entity_id: IMOBILIARIA, value: "contato@imobiliaria.exemplo" }]
          : [],
      apolo_enterprise_settings: (f: Filtros) =>
        (
          {
            "35": { comissao_coordenadora_percentual: null, comissao_imobiliaria_percentual: null, coordenadora_entity_id: COORDENADORA },
            "37": { comissao_coordenadora_percentual: "2.000", comissao_imobiliaria_percentual: "4.000", coordenadora_entity_id: COORDENADORA },
          } as Record<string, unknown>
        )[String(f.enterprise_id)] ?? null,
      apolo_entities: (f: Filtros) =>
        f.id ? (POR_ID[String(f.id)] ?? null) : (m.entidades ?? [ENTIDADE_ESPELHO, ENTIDADE_CAD]),
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
      hercules_empreendimentos: (f: Filtros) =>
        f.or
          ? [
              { c2x_enterprise_id: "35", id: VLO, nome: "Vale do Ouro", pai_id: null },
              { c2x_enterprise_id: "37", id: VOC, nome: "Vale do Ouro · VOC", pai_id: VLO },
            ]
          : { c2x_enterprise_id: "35", cidade: "Pará de Minas", codigo: "VLO", id: VLO, nome: "Vale do Ouro", pai_id: null, uf: "MG" },
      hercules_proposta_eventos: [],
      hercules_propostas: PROPOSTA_IMPORTADA,
      hercules_unidades: {
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
      },
      temis_envelopes: [],
    },
    lidas,
  );
}

// ── O CORRETOR DA CAD PÚBLICA PODE SER O PRÓPRIO CLIENTE ─────────────────────

describe("D. o corretor que vem da CAD do titular", () => {
  // Medido em produção (18/09/2026, SELECT): das 98 importadas abertas que passam a ganhar corretor
  // pela CAD, em 19 o `corretor_entity_id` da CAD é a PRÓPRIA ficha do titular (ou o mesmo CPF). É o
  // formulário público: quem preenche a primeira etapa vira "corretor", e o cliente que preenche
  // sozinho vira corretor de si mesmo (ver a memória "corretor do CAD público é o CLIENTE").
  it("a CAD em que o cliente se cadastrou como corretor NÃO põe o comprador como corretor da venda", async () => {
    const g = (await dadosDaProposta(
      "p",
      distrato({
        esteira: [
          {
            corretor: "COMPRADOR DO DISTRATO",
            corretor_entity_id: CAD,
            enterprise_id: "35",
            entity_id: CAD,
            ficha: null,
            imobiliaria: "IMOBILIARIA DO VOC",
            imobiliaria_entity_id: IMOBILIARIA,
          },
        ],
      }),
    ))!.dados.gerais;

    // O comprador não vendeu o próprio lote: o certo é "não informado", como sem CAD.
    expect(g.corretor_nome).not.toBe("COMPRADOR DO DISTRATO");
  });
});

// ── O MESMO CPF, DUAS PESSOAS ────────────────────────────────────────────────

describe("A. a ficha complementada por outra do mesmo documento", () => {
  // Medido em produção (18/09/2026, SELECT): 9 documentos têm fichas VIVAS com primeiros nomes
  // diferentes (dois deles com 23 e 17 nomes distintos no mesmo CPF). Um desses documentos é o
  // titular de 4 vendas importadas ABERTAS: a ficha ligada pela ponte do C2X (espelho, sem cadastro,
  // com endereço na tabela) e uma CAD `review` de OUTRO primeiro nome, com nascimento, estado civil,
  // nacionalidade, profissão, RG e endereço na ficha. O Apolo tem o defeito conhecido de CAD gravada
  // com o CPF do cônjuge ("fichas com a PESSOA ERRADA").
  it("a CAD de outra pessoa com o mesmo CPF NÃO completa nascimento, RG e endereço da escolhida, e vira aviso", async () => {
    const pessoaA = { ...ENTIDADE_ESPELHO, display_name: "ANA SOBRENOME COMUM" };
    const pessoaB = {
      ...ENTIDADE_CAD,
      display_name: "BRUNO SOBRENOME COMUM",
      metadata: {
        cadastro: { dataNascimento: "1970-07-07", estadoCivilId: "2", nacionalidade: "Brasileira", profissaoId: "3" },
      },
    };
    const r = (await dadosDaProposta(
      "p",
      distrato({
        enderecos: [
          {
            city: "Cidade da Ana",
            complement: null,
            district: "Centro",
            entity_id: ESPELHO,
            number: "1",
            postal_code: "30000-000",
            state: "MG",
            street: "Rua da Ana",
          },
        ],
        entidades: [pessoaA, pessoaB],
        esteira: [
          {
            enterprise_id: "35",
            entity_id: CAD,
            ficha: {
              cep: "35000-000",
              cidade: "Cidade do Bruno",
              logradouro: "Rua do Bruno",
              numero: "2",
              orgaoEmissor: "SSP/MG",
              rg: "MG-99.999.999",
              uf: "MG",
            },
          },
        ],
      }),
    ))!;
    const v = r.dados.compradores[0]!.valores;

    // A escolhida é a certa (a ponte do C2X aponta a Ana)...
    expect(v.nome_cliente).toBe("ANA SOBRENOME COMUM");
    // ...mas nada do Bruno pode entrar no contrato da Ana.
    expect(v.data_nascimento_cliente).toBeUndefined();
    expect(v.rg_cliente).toBeUndefined();
    expect(v.rua_cliente).toBe("Rua da Ana");
    expect(v.cidade_cliente).toBe("Cidade da Ana/MG");
    // ...e quem confere fica sabendo que há outra pessoa no mesmo CPF.
    expect(r.avisos.join(" | ")).toContain("ANA SOBRENOME COMUM: o Apolo tem outra ficha com este CPF e outro nome");
  });

  // Medido em produção (18/09/2026, SELECT): em 10 vendas abertas a ficha escolhida tem endereço na
  // TABELA e nenhum na ficha, e outra ficha viva do mesmo documento tem endereço na FICHA. O bloco de
  // endereço da outra entra na ficha complementada, e `unirEndereco` faz a ficha ganhar da tabela:
  // o contrato troca o endereço da escolhida pelo da outra. "A escolhida sempre tem precedência."
  it("o endereço de outra ficha do mesmo documento NÃO vence o endereço da própria escolhida", async () => {
    const r = (await dadosDaProposta(
      "p",
      distrato({
        enderecos: [
          {
            city: "Cidade Atual",
            complement: null,
            district: "Centro",
            entity_id: ESPELHO,
            number: "1",
            postal_code: "30000-000",
            state: "MG",
            street: "Rua Atual",
          },
        ],
        entidades: [ENTIDADE_ESPELHO, { ...ENTIDADE_CAD, metadata: { cadastro: { nacionalidade: "Brasileira" } } }],
        esteira: [
          {
            enterprise_id: "35",
            entity_id: CAD,
            ficha: { cep: "35000-000", cidade: "Cidade Antiga", logradouro: "Rua Antiga", numero: "2", uf: "MG" },
          },
        ],
      }),
    ))!;
    const v = r.dados.compradores[0]!.valores;
    // A ponte (4880 → espelho) escolhe o espelho; o endereço dele é o que vale.
    expect(v.rua_cliente).toBe("Rua Atual");
  });
});

// ── A FALTA DE CARTEIRA, DITA CERTO ──────────────────────────────────────────

describe("E. a frase da carteira no card", () => {
  it("leitura da carteira que falhou diz nos campos que não conseguiu ler, e não 'sem lançamentos'", async () => {
    const a = (await analiseDoTrabalho(
      distrato({ carteiraVendas: { erro: { code: "57014", message: "canceling statement due to statement timeout" } } }),
      "p",
    ))!;
    expect(a.financeiro?.situacao).toBe("erro");
    const entrada = a.proposta.find((c) => c.rotulo === "Entrada");
    // O topo diz "não consegui ler"; o campo não pode afirmar que a carteira não tem lançamento.
    expect(entrada?.valor).not.toBe(SEM_LANCAMENTOS_NA_CARTEIRA);
    expect(entrada?.valor).toBe(CARTEIRA_ILEGIVEL);
  });

  it("a mensagem crua do banco NÃO vai no aviso (que também vai para o portal do incorporador)", async () => {
    // `abrirCardDoTrabalho` esconde a mensagem do Postgres de quem vem de fora ("o texto do Postgres é
    // detalhe de schema da casa"); o aviso novo a carrega inteira em `analise.avisos`, que a rota do
    // portal devolve sem filtro.
    const r = (await dadosDaProposta(
      "p",
      distrato({ carteiraVendas: { erro: { code: "42501", message: "permission denied for table apolo_carteira_vendas" } } }),
    ))!;
    expect(r.avisos.join(" | ")).not.toContain("permission denied");
    expect(r.avisos.join(" | ")).toContain("Não consegui ler a carteira do Apolo desta venda");
  });

  it("carteira ainda inexistente: campos e aviso dizem que ela ainda não separa a venda, e não 'sem lançamentos'", async () => {
    const a = (await analiseDoTrabalho(distrato(), "p"))!;
    expect(a.financeiro?.situacao).toBe("nunca_sincronizada");
    expect(a.proposta.find((c) => c.rotulo === "Entrada")?.valor).toBe(CARTEIRA_AINDA_SEM_A_VENDA);
    expect(a.proposta.find((c) => c.rotulo === "A financiar")?.valor).toBe(CARTEIRA_AINDA_SEM_A_VENDA);
    expect(a.avisos.join(" | ")).toContain(CARTEIRA_AINDA_SEM_A_VENDA);
    expect(a.avisos.join(" | ")).not.toContain("sem lançamentos");
    expect(a.avisos.join(" | ")).not.toContain("não tem cronograma gravado");
    // Nenhum texto novo com travessão.
    expect([a.financeiro?.texto ?? "", ...a.avisos.filter((x) => x.includes("carteira"))].join(" ")).not.toMatch(/[—–]/);
  });
});

// ── SÓ PANTEON, E QUANTO CUSTA ABRIR ─────────────────────────────────────────

describe("custo e fonte de uma abertura do card do distrato importado", () => {
  it("não lê tabela do legado, e nenhuma lista de .in() passa de 100", async () => {
    const lidas: Leitura[] = [];
    await analiseDoTrabalho(distrato({}, lidas), "p");
    expect(lidas.filter((l) => /^c2x_|^guardian|^hades_/.test(l.tabela))).toEqual([]);
    const maiorIn = Math.max(
      0,
      ...lidas.flatMap((l) =>
        Object.entries(l.filtros)
          .filter(([k]) => k.startsWith("in:"))
          .map(([, v]) => (Array.isArray(v) ? v.length : 0)),
      ),
    );
    expect(maiorIn).toBeLessThanOrEqual(100);
  });

  it("guarda do custo: 21 consultas por abertura (eram 13 na base f384e036)", async () => {
    // Medido com o mesmo cliente falso rodando a base (git show f384e036) e o worktree: 13 → 21
    // consultas e 5 → 7 ondas em série. Das 8 a mais, 4 são `lerEntidadesDoVinculo` lendo entidade e
    // contatos UM ID POR VEZ (imobiliária e corretor), e uma é o contato do corretor, que não é usado
    // quando a imobiliária existe. Se este número subir, alguém somou viagem ao card.
    const lidas: Leitura[] = [];
    await analiseDoTrabalho(distrato({}, lidas), "p");
    expect(lidas.length).toBeLessThanOrEqual(21);
  });
});
