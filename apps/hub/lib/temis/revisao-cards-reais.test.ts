// REVISÃO DOS CARDS REAIS (18/09/2026): o que o card da Têmis mostra DEPOIS da rodada A a E, na forma
// medida em produção, e os pontos em que a tela ainda diz algo que o banco desmente.
//
// Lucas (18/09/2026): *"tem um distrato mas não está trazendo as informações, analisa o porquê"* ·
// *"rg não precisa"* · *"a única coisa que vamos utilizar o c2x é a questão financeira, mesmo assim ela
// tem que morar dentro da carteira no apolo"*.
//
// ⚠️ SEM DADO PESSOAL. A forma é a do card c8b22bd1 (proposta 819d9ac1, VOC Q09 L11, venda 4918),
// medida por SELECT: duas fichas do mesmo CPF (espelho `active` com link c2x/users, CAD `review` com
// `metadata.c2xUserId` e `metadata.cadastro` de 11 chaves, estadoCivilId "1"), a CAD no '35' com
// corretor e imobiliária, a imobiliária da venda casando pelo link, VLO '35' com percentuais nulos e
// VOC '37' com 2% e 4%. Nomes, documentos e ids aqui são inventados.
//
// ⚠️ ATÉ A RODADA 2 (18/09/2026) TRÊS TESTES DAQUI TINHAM "DEFEITO" NO NOME E FICAVAM VERMELHOS DE
// PROPÓSITO: descreviam o comportamento certo, que o código não tinha. Corrigidos na rodada 2,
// viraram guardas.

import { describe, expect, it } from "vitest";

import { type LinhaDaParcelaNaCarteira, parcelaDaCarteira, resumirCarteira } from "@/lib/apolo/carteira-da-venda";
import type { ExtratoClienteContrato } from "@/lib/apolo/extrato-cliente";

import { analiseDoTrabalho } from "./analise-do-trabalho";
import { CARTEIRA_AINDA_SEM_A_VENDA, CARTEIRA_ILEGIVEL, SEM_LANCAMENTOS_NA_CARTEIRA } from "./dados-do-contrato";

type Filtros = Record<string, unknown>;
type Linhas = Record<string, unknown>;

function clienteFalso(porTabela: Linhas) {
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
  return { from: (tabela: string) => construir(tabela) } as never;
}

const VLO = "e0000000-0000-0000-0000-0000000000aa";
const VOC = "e0000000-0000-0000-0000-0000000000bb";
const ESPELHO = "a0000000-0000-0000-0000-0000000000e1";
const CAD = "a0000000-0000-0000-0000-0000000000c1";
const IMOBILIARIA = "c0000000-0000-0000-0000-0000000000i1";
const CORRETOR = "c0000000-0000-0000-0000-0000000000k1";
const COORDENADORA = "c0000000-0000-0000-0000-0000000000d1";
const CPF = "529.982.247-25";

const PROPOSTA_IMPORTADA = {
  cliente_c2x_id: 9001,
  cliente_documento: "52998224725",
  cliente_entity_id: null,
  cliente_nome: "COMPRADOR FICTICIO",
  compradores: [{ c2x_user_id: 9001, documento: CPF, nome: "COMPRADOR FICTICIO", percentual: 100, titular: true }],
  condicoes: null,
  contrato_parcelas: null,
  corretor_entity_id: null,
  corretor_nome: null,
  data_assinatura: "2026-09-04",
  data_ato: "2026-09-01",
  data_faturamento: null,
  dia_vencimento: 20,
  empreendimento_id: VLO,
  etapa_c2x: 5,
  imobiliaria_c2x_id: 7001,
  imobiliaria_entity_id: null,
  imobiliaria_nome: "IMOBILIARIA FICTICIA",
  origem_c2x_id: 4918,
  plano_nome: "Plano 156x",
  plano_parcelas: 156,
  unidade_id: "d0000000-0000-0000-0000-0000000000u1",
  valor: 209900,
};

const ENTIDADE_ESPELHO = {
  created_at: "2026-08-28T12:00:00Z",
  display_name: "COMPRADOR FICTICIO",
  document_masked: CPF,
  entity_kind: "pf",
  id: ESPELHO,
  legal_name: null,
  metadata: {},
  status: "active",
  trade_name: null,
};

/** As 11 chaves que a CAD pública real tem em `metadata.cadastro` (medido: n_cad = 11), com valores inventados. */
const ENTIDADE_CAD = {
  created_at: "2026-08-28T11:00:00Z",
  display_name: "COMPRADOR FICTICIO",
  document_masked: CPF,
  entity_kind: "pf",
  id: CAD,
  legal_name: null,
  metadata: {
    c2xUserId: "9001",
    cadastro: {
      dataNascimento: "1991-03-04",
      escolaridadeId: "5",
      estadoCivilId: "1",
      nacionalidade: "Brasileira",
      naturalidade: "Cidade Ficticia",
      nomeMae: "MAE FICTICIA",
      orgaoEmissor: "SSP/MG",
      patrimonio: "1",
      profissaoId: "3",
      rendaId: "2",
      sexoId: "1",
    },
  },
  status: "review",
  trade_name: null,
};

const QUEM_VENDEU: Record<string, Linhas> = {
  [COORDENADORA]: {
    display_name: "COORDENADORA FICTICIA",
    document_masked: "11.222.333/0001-81",
    entity_kind: "pj",
    id: COORDENADORA,
    legal_name: "COORDENADORA FICTICIA LTDA",
    trade_name: "Coordenadora Ficticia",
  },
  [CORRETOR]: {
    display_name: "CORRETOR FICTICIO",
    document_masked: "222.333.444-05",
    entity_kind: "pf",
    id: CORRETOR,
    legal_name: null,
    trade_name: null,
  },
  [IMOBILIARIA]: {
    display_name: "IMOBILIARIA FICTICIA",
    document_masked: "44.555.666/0001-81",
    entity_kind: "pj",
    id: IMOBILIARIA,
    legal_name: "IMOBILIARIA FICTICIA LTDA",
    trade_name: "Imobiliaria Ficticia",
  },
};

function cardC8b22bd1(extra: Linhas = {}) {
  return clienteFalso({
    apolo_addresses: (f: Filtros) =>
      Array.isArray(f["in:entity_id"]) && (f["in:entity_id"] as string[]).includes(CAD)
        ? [
            {
              city: "Cidade Ficticia",
              complement: null,
              district: "Bairro Ficticio",
              entity_id: CAD,
              number: "10",
              postal_code: "35000-000",
              state: "MG",
              street: "Rua Ficticia",
            },
          ]
        : [],
    apolo_carteira_parcelas: [],
    // O estado de hoje: a tabela não existe (medido por SELECT em pg_class: 0 relações apolo_carteira_*).
    apolo_carteira_vendas: {
      erro: { code: "PGRST205", message: "Could not find the table 'public.apolo_carteira_vendas' in the schema cache" },
    },
    apolo_contacts: (f: Filtros) => {
      if (f.entity_id === IMOBILIARIA) {
        return [
          { contact_type: "whatsapp", entity_id: IMOBILIARIA, value: "(31) 90000-0001" },
          { contact_type: "email", entity_id: IMOBILIARIA, value: "contato@imobiliaria.exemplo" },
        ];
      }
      if (Array.isArray(f["in:entity_id"])) {
        return [
          { contact_type: "email", entity_id: CAD, value: "comprador@exemplo.invalid" },
          { contact_type: "whatsapp", entity_id: CAD, value: "(31) 90000-0002" },
        ];
      }
      return [];
    },
    apolo_enterprise_settings: (f: Filtros) =>
      ({
        "35": { comissao_coordenadora_percentual: null, comissao_imobiliaria_percentual: null, coordenadora_entity_id: COORDENADORA },
        "37": { comissao_coordenadora_percentual: "2.000", comissao_imobiliaria_percentual: "4.000", coordenadora_entity_id: COORDENADORA },
      })[String(f.enterprise_id)] ?? null,
    apolo_entities: (f: Filtros) => (f.id ? (QUEM_VENDEU[String(f.id)] ?? null) : [ENTIDADE_ESPELHO, ENTIDADE_CAD]),
    apolo_esteira: [
      {
        corretor: "CORRETOR FICTICIO",
        corretor_entity_id: CORRETOR,
        enterprise_id: "35",
        entity_id: CAD,
        ficha: null,
        imobiliaria: "IMOBILIARIA FICTICIA",
        imobiliaria_entity_id: IMOBILIARIA,
      },
    ],
    apolo_relationships: [],
    apolo_source_links: [
      { entity_id: ESPELHO, source_id: "9001" },
      { entity_id: IMOBILIARIA, source_id: "7001" },
    ],
    hercules_empreendimentos: (f: Filtros) =>
      f.or
        ? [
            { c2x_enterprise_id: "35", id: VLO, nome: "Vale do Ouro", pai_id: null },
            { c2x_enterprise_id: "37", id: VOC, nome: "Vale do Ouro VOC", pai_id: VLO },
          ]
        : { c2x_enterprise_id: "35", cidade: "Cidade Ficticia", codigo: "VLO", id: VLO, nome: "Vale do Ouro", pai_id: null, uf: "MG" },
    hercules_proposta_eventos: [],
    hercules_propostas: PROPOSTA_IMPORTADA,
    hercules_unidades: {
      area: 360,
      area_extenso: null,
      codigo: "VOC0911",
      enterprise_id: "37",
      lote: "11",
      matricula: "99.999",
      matricula_livro: null,
      preco_extenso: null,
      preco_tabela: 209900,
      quadra: "09",
      tipo_unidade: "lote",
    },
    temis_envelopes: [],
    ...extra,
  });
}

const porRotulo = (campos: { faltando: boolean; rotulo: string; valor: string }[]) =>
  Object.fromEntries(campos.map((c) => [c.rotulo, c]));

describe("o card c8b22bd1 reconstruído, DEPOIS da rodada", () => {
  it("proponente, quem vendeu e a proposta: o que o SELECT mediu", async () => {
    const a = (await analiseDoTrabalho(cardC8b22bd1(), "819d9ac1"))!;
    const proponente = porRotulo(a.proponentes[0]!.campos);

    // A. a ficha da CAD ganhou do espelho: nascimento, estado civil e nacionalidade aparecem.
    expect(proponente.Nascimento?.faltando).toBe(false);
    expect(proponente["Estado civil"]?.valor).toBe("Solteiro (a)");
    expect(proponente.Nacionalidade?.faltando).toBe(false);
    // B. sem número de RG, a linha do RG não existe.
    expect(proponente.RG).toBeUndefined();
    // ⚠️ A PROFISSÃO DO PROPONENTE NÃO TEM LINHA NO CARD (só a do cônjuge): o "4/4" do relato é do
    // contrato, não da tela.
    expect(proponente["Profissão"]).toBeUndefined();

    // D. corretor pela CAD, no escopo e com a mesma imobiliária.
    const vendeu = porRotulo(a.imobiliaria);
    expect(vendeu.Corretor).toEqual({ faltando: false, rotulo: "Corretor", valor: "CORRETOR FICTICIO" });

    // E. sem a venda na carteira: a frase, e não "não informado". E não "sem lançamentos": o retrato
    // por pessoa da carteira do Apolo tem as 158 parcelas deste distrato (medido em 18/09/2026).
    expect(a.financeiro?.situacao).toBe("nunca_sincronizada");
    const proposta = porRotulo(a.proposta);
    expect(proposta.Entrada?.valor).toBe(CARTEIRA_AINDA_SEM_A_VENDA);
    expect(proposta["A financiar"]?.valor).toBe(CARTEIRA_AINDA_SEM_A_VENDA);
    expect(proposta.Parcelas?.valor).toBe(CARTEIRA_AINDA_SEM_A_VENDA);
    expect(proposta.Entrada?.valor).not.toBe(SEM_LANCAMENTOS_NA_CARTEIRA);

    // O único aviso que sobra é o da carteira (o relato: 3 → 1).
    expect(a.avisos).toHaveLength(1);
    expect(a.avisos[0]).toMatch(/^Venda importada: a carteira do Apolo ainda não separa esta venda por parcela/);
  });

  it("o solteiro do card real NÃO aparece com 'Regime de bens: não informado' marcado como pendência", async () => {
    // Medido por SELECT: 7 dos 10 titulares dos cards em análise têm estadoCivilId "1" e nenhum
    // regimeBensId. `conferir` (dados-do-contrato.ts) já diz que o regime só importa para casado ou
    // união estável, e não põe aviso; a tela pinta a linha de pendência mesmo assim. Depois desta
    // rodada é a ÚNICA pendência do bloco do proponente nesses 7 cards.
    const a = (await analiseDoTrabalho(cardC8b22bd1(), "819d9ac1"))!;
    const regime = a.proponentes[0]!.campos.find((c) => c.rotulo === "Regime de bens");
    expect(regime === undefined || regime.faltando === false).toBe(true);
  });

  it("a linha do regime aparece para o casado sem regime, para quem não tem estado civil, e sempre que houver valor", async () => {
    const comCadastro = (cadastro: Record<string, unknown>) =>
      cardC8b22bd1({
        apolo_entities: (f: Filtros) =>
          f.id
            ? (QUEM_VENDEU[String(f.id)] ?? null)
            : [ENTIDADE_ESPELHO, { ...ENTIDADE_CAD, metadata: { c2xUserId: "9001", cadastro } }],
      });
    const regime = async (cadastro: Record<string, unknown>) =>
      (await analiseDoTrabalho(comCadastro(cadastro), "819d9ac1"))!.proponentes[0]!.campos.find(
        (c) => c.rotulo === "Regime de bens",
      );

    // Casado sem regime: pendência (o contrato imprime a cláusula do regime).
    expect(await regime({ dataNascimento: "1991-03-04", estadoCivilId: "2" })).toMatchObject({ faltando: true });
    // Sem estado civil: pendência também, pela mesma razão (`ehCasado` indefinido mantém a cláusula).
    expect(await regime({ dataNascimento: "1991-03-04" })).toMatchObject({ faltando: true });
    // Solteiro com regime gravado: aparece, preenchido.
    expect(await regime({ estadoCivilId: "1", regimeBensId: "1" })).toEqual({
      faltando: false,
      rotulo: "Regime de bens",
      valor: "Comunhão parcial de bens",
    });
  });

  it("leitura da carteira que FALHOU diz nos campos que não conseguiu ler, e não 'sem lançamentos'", async () => {
    // `carteira-da-venda.ts` jura que "leitura que falhou não é sem carteira", e o aviso e a frase do
    // topo respeitam isso. Mas `camposDaCarteira` (analise-do-trabalho.ts) trata `erro` igual a
    // `sem_carteira` e escreve "sem lançamentos" em Entrada, A financiar e Parcelas.
    const a = (await analiseDoTrabalho(
      cardC8b22bd1({ apolo_carteira_vendas: { erro: { code: "57014", message: "canceling statement due to statement timeout" } } }),
      "819d9ac1",
    ))!;
    expect(a.financeiro?.situacao).toBe("erro");
    const proposta = porRotulo(a.proposta);
    expect(proposta.Entrada?.valor).not.toBe(SEM_LANCAMENTOS_NA_CARTEIRA);
    expect(proposta["A financiar"]?.valor).not.toBe(SEM_LANCAMENTOS_NA_CARTEIRA);
    expect(proposta.Entrada?.valor).toBe(CARTEIRA_ILEGIVEL);
    expect(proposta.Parcelas?.valor).toBe(CARTEIRA_ILEGIVEL);
  });
});

describe("o resumo da carteira (quando ela existir)", () => {
  const CONTRATO: ExtratoClienteContrato = {
    area: 360,
    codigo: "VOC0911",
    dataAssinatura: null,
    dataAto: null,
    empreendimentoCodigo: "VLO",
    empreendimentoNome: "Vale do Ouro",
    encerrado: false,
    estagio: 5,
    estagioNome: null,
    id: 4918,
    indiceCorrecao: null,
    jurosContratuais: null,
    lote: "11",
    planoPadraoParcelas: 156,
    planoParcelas: 156,
    planoPersonalizado: false,
    precoTabela: 209900,
    quadra: "09",
    titulares: [],
  };

  const mensal = (n: number, valor: number, extra: Partial<LinhaDaParcelaNaCarteira> = {}): LinhaDaParcelaNaCarteira => ({
    a_excluir: false,
    boleto_url: null,
    c2x_payment_id: 1000 + n,
    competencia: null,
    descricao: null,
    fatura_url: null,
    juros: 0,
    multa: 0,
    pagamento: null,
    parcela_atual: n,
    parcela_total: 13,
    sinal_atual: 0,
    sinal_total: 0,
    status_id: 6,
    tipo_id: 3,
    tipo_nome: "Parcela",
    valor_inicial: valor,
    valor_pago: 0,
    vencimento: "2030-01-20",
    ...extra,
  });

  it("sem dupla contagem: pago + em aberto fecham com o contratado, e cada parcela conta uma vez", () => {
    const parcelas = [
      ...Array.from({ length: 3 }, (_, k) => mensal(k + 1, 1000, { pagamento: "2026-0" + (k + 1) + "-20", status_id: 5, valor_pago: 1000 })),
      ...Array.from({ length: 9 }, (_, k) => mensal(k + 4, 1000)),
    ].map(parcelaDaCarteira);
    const r = resumirCarteira(parcelas, CONTRATO, "2026-09-18");
    expect(r.porTipoTotal).toBe(12);
    expect(r.porTipo.mensal.pago + r.porTipo.mensal.aberto).toBe(r.porTipo.mensal.valorContratual);
    expect(r.relatorio.totais.parcelasPagas + r.relatorio.totais.parcelasAbertas).toBe(12);
  });

  it("mensal PEQUENA (abaixo de um terço da mediana) continua mensal, e não vira 'Anuais e reforços'", () => {
    // O relato descreve o reforço como "parcela do tipo 3 acima de 3 vezes a mediana". O código usa
    // `mensalidadePlausivel`, que também recusa o que é MENOR que um terço da mediana: um resíduo de
    // R$ 200 no meio de mensais de R$ 1.000 sai no card como "Anuais e reforços: 1, somando R$ 200,00".
    const parcelas = [...Array.from({ length: 12 }, (_, k) => mensal(k + 1, 1000)), mensal(13, 200)].map(parcelaDaCarteira);
    const r = resumirCarteira(parcelas, CONTRATO, "2026-09-18");
    expect(r.porTipo.reforco.quantidade).toBe(0);
    expect(r.parcelasMensais).toBe(13);
  });
});
