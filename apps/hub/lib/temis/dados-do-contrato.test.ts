// Regressões de `dados-do-contrato.ts` — cada teste aqui é um jeito de o contrato sair errado.
//
// ⚠️ NADA DE BANCO. O cliente é um duplo que devolve linhas por tabela; o que se prova é a REGRA
// (precedência, tradução de id, extensos, PF × PJ), não o SQL. As linhas usadas são cópias fiéis do
// formato real: `document_masked` com o documento COMPLETO, ficha PLANA em camelCase, cônjuge no
// `label` + `metadata` do relacionamento.

import { describe, expect, it } from "vitest";

import { dadosDaProposta, dataPorExtenso, hojeEmBrasilia } from "./dados-do-contrato";

type Linhas = Record<string, unknown>;

/**
 * Duplo encadeável do Supabase.
 *
 * `.select`, `.eq`, `.in` e `.order` devolvem o próprio objeto; `maybeSingle()` e o `await` direto
 * resolvem no que o mapa tem para aquela tabela. É o bastante: este módulo lê, não escreve.
 *
 * ⚠️ A MESMA TABELA É LIDA POR DOIS MOTIVOS. `apolo_entities` responde pelos compradores (por
 * `.in("document_masked", …)`) e pela imobiliária da venda (por `.eq("id", …)`), e `apolo_contacts`
 * idem. Por isso o valor do mapa também pode ser uma FUNÇÃO: ela recebe os `.eq` daquela consulta e
 * devolve as linhas. Um valor comum continua valendo para todas.
 */
function clienteFalso(porTabela: Linhas, tabelasLidas?: string[]) {
  const construir = (tabela: string) => {
    const filtros: Record<string, unknown> = {};
    const linhas = () => {
      const bruto = porTabela[tabela];
      return typeof bruto === "function"
        ? (bruto as (f: Record<string, unknown>) => unknown)(filtros)
        : bruto;
    };
    const resposta = () => ({ data: linhas() ?? null, error: null });
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
          return () => encadeia;
        },
      },
    );
    return encadeia;
  };
  return {
    from: (tabela: string) => {
      tabelasLidas?.push(tabela);
      return construir(tabela);
    },
  } as never;
}

const THIAGO = "aaaaaaaa-0000-0000-0000-000000000001";
const EMPRESA = "aaaaaaaa-0000-0000-0000-000000000002";

/** A entidade do Thiago como `apolo_entities` a devolve. */
const ENTIDADE_THIAGO = {
  display_name: "THIAGO HENRIQUE DE SOUZA",
  document_masked: "123.456.789-00",
  entity_kind: "pf",
  id: THIAGO,
  legal_name: null,
  trade_name: null,
};

/** A proposta nativa mínima: um comprador, uma unidade, um empreendimento e o cronograma. */
function proposta(over: Linhas = {}): Linhas {
  return {
    cliente_documento: "12345678900",
    cliente_nome: "THIAGO HENRIQUE DE SOUZA",
    compradores: [
      { cpf: "123.456.789-00", nome: "THIAGO HENRIQUE DE SOUZA", participacao: 60, titular: true },
    ],
    condicoes: {
      anuais: [],
      entrada: [{ numero: 1, total: 1, valor: 37080, vencimento: "2026-10-10" }],
      mensais: Array.from({ length: 120 }, (_, k) => ({ numero: k + 1, valor: 1236 })),
      totais: { anuais: 0, entrada: 37080, financiado: 148320, geral: 185400, mensais: 148320 },
    },
    dia_vencimento: 10,
    empreendimento_id: "eeeeeeee-0000-0000-0000-000000000001",
    plano_nome: "Normal 120x",
    unidade_id: "dddddddd-0000-0000-0000-000000000001",
    valor: 185400,
    ...over,
  };
}

const UNIDADE = {
  area: 300,
  area_extenso: null,
  codigo: "JDG0617",
  lote: "07",
  matricula: "45.678",
  matricula_livro: "3",
  preco_extenso: null,
  preco_tabela: 185400,
  quadra: "12",
  tipo_unidade: "lote",
};

const EMPREENDIMENTO = {
  c2x_enterprise_id: "39",
  cidade: "João Monlevade",
  codigo: "JDG",
  nome: "Jardim das Gerais",
  uf: "MG",
};

/** A ficha do CAD como ela existe em produção: PLANA, camelCase, ids em texto. */
const FICHA_DO_THIAGO = {
  bairro: "Centro",
  cep: "35930-000",
  cidade: "João Monlevade",
  dataNascimento: "1985-03-15",
  estadoCivilId: "2",
  logradouro: "Rua das Acácias",
  nacionalidade: "brasileiro",
  numero: "150",
  orgaoEmissor: "SSP/MG",
  profissaoId: "3",
  regimeBensId: "1",
  rg: "MG-12.345.678",
  uf: "MG",
};

describe("a proposta que não existe", () => {
  it("devolve null — e não um contrato vazio", async () => {
    const r = await dadosDaProposta("nao-existe", clienteFalso({}));
    expect(r).toBeNull();
  });

  it("não vai atrás de unidade, empreendimento nem cadastro", async () => {
    const tabelas: string[] = [];
    await dadosDaProposta("nao-existe", clienteFalso({}, tabelas));
    expect(tabelas).toEqual(["hercules_propostas"]);
  });
});

describe("os *Id da ficha viram rótulo", () => {
  it("estado civil, regime de bens e profissão saem escritos, nunca em número", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [
          {
            display_name: "THIAGO HENRIQUE DE SOUZA",
            document_masked: "123.456.789-00",
            entity_kind: "pf",
            id: THIAGO,
            legal_name: null,
            trade_name: null,
          },
        ],
        apolo_esteira: [{ enterprise_id: "39", entity_id: THIAGO, ficha: FICHA_DO_THIAGO }],
        hercules_empreendimentos: EMPREENDIMENTO,
        hercules_propostas: proposta(),
        hercules_unidades: UNIDADE,
      }),
    ))!;

    const v = dados.compradores[0]!.valores;
    expect(v.estado_civil_cliente).toBe("Casado (a)");
    expect(v.regime_casamento_cliente).toBe("Comunhão parcial de bens");
    expect(v.profissao_cliente).toBe("ADMINISTRADOR(A)");
    // ⚠️ A TRAVA DE VERDADE: nenhum dos três pode ser o número cru.
    expect(v.estado_civil_cliente).not.toBe("2");
    expect(v.regime_casamento_cliente).not.toBe("1");
    expect(v.profissao_cliente).not.toBe("3");
  });

  it("id fora do catálogo NÃO vira o número — a chave some e o motor imprime [estado_civil_cliente]", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [
          {
            display_name: "THIAGO",
            document_masked: "123.456.789-00",
            entity_kind: "pf",
            id: THIAGO,
            legal_name: null,
            trade_name: null,
          },
        ],
        apolo_esteira: [
          {
            enterprise_id: "39",
            entity_id: THIAGO,
            ficha: { ...FICHA_DO_THIAGO, estadoCivilId: "99" },
          },
        ],
        hercules_propostas: proposta(),
      }),
    ))!;

    expect(dados.compradores[0]!.valores.estado_civil_cliente).toBeUndefined();
  });

  it("profissaoOutro (texto livre) ganha do id — foi o que o operador escolheu escrever", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [
          {
            display_name: "THIAGO",
            document_masked: "123.456.789-00",
            entity_kind: "pf",
            id: THIAGO,
            legal_name: null,
            trade_name: null,
          },
        ],
        apolo_esteira: [
          {
            enterprise_id: "39",
            entity_id: THIAGO,
            ficha: { ...FICHA_DO_THIAGO, profissaoOutro: "Perito em rochas ornamentais" },
          },
        ],
        hercules_propostas: proposta(),
      }),
    ))!;

    expect(dados.compradores[0]!.valores.profissao_cliente).toBe("Perito em rochas ornamentais");
  });
});

describe("os extensos saem em par com o número", () => {
  it("área, preço, valor, entrada, financiado, prazo e dia de vencimento", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        hercules_empreendimentos: EMPREENDIMENTO,
        hercules_propostas: proposta(),
        hercules_unidades: UNIDADE,
      }),
    ))!;

    const g = dados.gerais;
    expect(g.area_lote).toBe("300,00 m²");
    // ⚠️ SEM A UNIDADE REPETIDA: foi "trezentos metros quadrados metros quadrados" que saiu no
    // contrato real do Villa Paris.
    expect(g.area_lote_extenso).toBe("trezentos metros quadrados");

    expect(g.valor_imovel_venda).toBe("R$ 185.400,00");
    expect(g.valor_imovel_venda_extenso).toBe("cento e oitenta e cinco mil e quatrocentos reais");
    // Os dois nomes do mesmo preço: as minutas do legado usam os dois.
    expect(g.preco_venda).toBe(g.valor_imovel_venda);
    expect(g.preco_venda_extenso).toBe(g.valor_imovel_venda_extenso);

    expect(g.valor_entrada).toBe("R$ 37.080,00");
    expect(g.valor_entrada_extenso).toBe("trinta e sete mil e oitenta reais");
    expect(g.valor_divida_financiada).toBe("R$ 148.320,00");

    expect(g.prazo_meses_amortizacao).toBe("120");
    expect(g.prazo_meses_amortizacao_extenso).toBe("cento e vinte");

    expect(g.dia_vencimento).toBe("10");
    expect(g.dia_vencimento_extenso).toBe("dez");

    expect(g.numero_quadra_extenso).toBe("doze");
    expect(g.numero_lote_extenso).toBe("sete");

    // ⚠️ TODO `x` COM EXTENSO NO CATÁLOGO SAI COM O PAR. Um valor sem o extenso ao lado faz o
    // contrato imprimir "R$ 185.400,00 ([valor_imovel_venda_extenso])".
    for (const nome of Object.keys(g)) {
      if (nome.endsWith("_extenso")) continue;
      const par = `${nome}_extenso`;
      if (par in g) expect(g[par]).toBeTruthy();
    }
  });

  it("o extenso GRAVADO na unidade ganha do escrito na hora", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        hercules_propostas: proposta(),
        hercules_unidades: { ...UNIDADE, area_extenso: "trezentos metros quadrados certos" },
      }),
    ))!;
    expect(dados.gerais.area_lote_extenso).toBe("trezentos metros quadrados certos");
  });

  it("quadra com LETRA não ganha extenso — 'zero' no contrato é pior do que nada", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        hercules_propostas: proposta(),
        hercules_unidades: { ...UNIDADE, quadra: "A" },
      }),
    ))!;
    expect(dados.gerais.numero_quadra).toBe("A");
    expect(dados.gerais.numero_quadra_extenso).toBeUndefined();
  });
});

describe("o cônjuge", () => {
  const entidade = [
    {
      display_name: "THIAGO",
      document_masked: "123.456.789-00",
      entity_kind: "pf",
      id: THIAGO,
      legal_name: null,
      trade_name: null,
    },
  ];

  it("vem do RELACIONAMENTO quando a ficha não o tem — quem foi cadastrado pelo wizard e nunca editado", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: entidade,
        apolo_esteira: [{ enterprise_id: "39", entity_id: THIAGO, ficha: FICHA_DO_THIAGO }],
        apolo_relationships: [
          {
            entity_id: THIAGO,
            label: "MARIA DE SOUZA",
            metadata: {
              cpf: "98765432100",
              email: "maria@exemplo.com.br",
              nacionalidade: "brasileira",
              phone: "(31) 98888-0000",
              profissaoId: "4",
            },
          },
        ],
        hercules_propostas: proposta(),
      }),
    ))!;

    const comprador = dados.compradores[0]!;
    // ⚠️ SEM ISTO O BLOCO `[inicio_dados_conjuge]` SOME e o contrato vai a cartório sem o assinante
    // que a comunhão de bens exige.
    expect(comprador.temConjuge).toBe(true);
    expect(comprador.valores.nome_conjuge).toBe("MARIA DE SOUZA");
    expect(comprador.valores.cpf_conjuge).toBe("987.654.321-00");
    expect(comprador.valores.nacionalidade_conjuge).toBe("brasileira");
    expect(comprador.valores.telefone_conjuge).toBe("(31) 98888-0000");
    expect(comprador.valores.profissao_conjuge).toBe("ADVOGADO(A)");
  });

  it("a ficha ganha campo a campo do relacionamento — é o nome que o cliente assinou", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: entidade,
        apolo_esteira: [
          {
            enterprise_id: "39",
            entity_id: THIAGO,
            ficha: { ...FICHA_DO_THIAGO, conjugeNome: "MARIA DE SOUZA LIMA" },
          },
        ],
        apolo_relationships: [
          {
            entity_id: THIAGO,
            label: "MARIA DE SOUZA",
            metadata: { cpf: "98765432100", phone: "(31) 98888-0000" },
          },
        ],
        hercules_propostas: proposta(),
      }),
    ))!;

    const v = dados.compradores[0]!.valores;
    expect(v.nome_conjuge).toBe("MARIA DE SOUZA LIMA");
    // O que a ficha não tem continua vindo do relacionamento.
    expect(v.cpf_conjuge).toBe("987.654.321-00");
  });

  it("casado sem cônjuge nenhum vira AVISO, e o bloco fica desligado", async () => {
    const r = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: entidade,
        apolo_esteira: [{ enterprise_id: "39", entity_id: THIAGO, ficha: FICHA_DO_THIAGO }],
        hercules_propostas: proposta(),
      }),
    ))!;

    expect(r.dados.compradores[0]!.temConjuge).toBe(false);
    expect(r.avisos.join(" ")).toContain("não tem cônjuge cadastrado");
  });
});

describe("pessoa física e pessoa jurídica", () => {
  it("PF sai com CPF e sem razão social", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [
          {
            display_name: "THIAGO HENRIQUE DE SOUZA",
            document_masked: "123.456.789-00",
            entity_kind: "pf",
            id: THIAGO,
            legal_name: null,
            trade_name: null,
          },
        ],
        hercules_propostas: proposta(),
      }),
    ))!;

    const comprador = dados.compradores[0]!;
    expect(comprador.ehPessoaFisica).toBe(true);
    expect(comprador.valores.cpf_cliente).toBe("123.456.789-00");
    expect(comprador.valores.cnpj_cliente).toBeUndefined();
    expect(comprador.valores.razao_social_cliente).toBeUndefined();
  });

  it("PJ sai com CNPJ, razão social e nome fantasia — e nunca com CPF", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [
          {
            display_name: "Souza Participações",
            document_masked: "11.115.899/0001-04",
            entity_kind: "pj",
            id: EMPRESA,
            legal_name: "SOUZA PARTICIPAÇÕES LTDA.",
            trade_name: "Souza Participações",
          },
        ],
        hercules_propostas: proposta({
          compradores: [
            { cpf: "11.115.899/0001-04", nome: "Souza Participações", participacao: 100, titular: true },
          ],
        }),
      }),
    ))!;

    const comprador = dados.compradores[0]!;
    // ⚠️ É ISTO QUE DECIDE QUAL PARÁGRAFO SAI. No contrato do Villa Paris o bloco de PJ saiu impresso
    // num comprador pessoa física.
    expect(comprador.ehPessoaFisica).toBe(false);
    expect(comprador.valores.cnpj_cliente).toBe("11.115.899/0001-04");
    expect(comprador.valores.razao_social_cliente).toBe("SOUZA PARTICIPAÇÕES LTDA.");
    expect(comprador.valores.nome_fantasia_cliente).toBe("Souza Participações");
    expect(comprador.valores.cpf_cliente).toBeUndefined();
  });

  it("sem cadastro no Apolo, o TAMANHO do documento decide: 14 dígitos é CNPJ", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        hercules_propostas: proposta({
          compradores: [{ cpf: "11115899000104", nome: "Souza Participações", titular: true }],
        }),
      }),
    ))!;
    expect(dados.compradores[0]!.ehPessoaFisica).toBe(false);
    expect(dados.compradores[0]!.valores.cnpj_cliente).toBe("11.115.899/0001-04");
  });
});

describe("as seis fontes do comprador", () => {
  it("o endereço da FICHA aparece mesmo sem linha em apolo_addresses (333 das 343 CADs)", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [
          {
            display_name: "THIAGO",
            document_masked: "123.456.789-00",
            entity_kind: "pf",
            id: THIAGO,
            legal_name: null,
            trade_name: null,
          },
        ],
        apolo_esteira: [{ enterprise_id: "39", entity_id: THIAGO, ficha: FICHA_DO_THIAGO }],
        hercules_propostas: proposta(),
      }),
    ))!;

    const v = dados.compradores[0]!.valores;
    expect(v.rua_cliente).toBe("Rua das Acácias");
    expect(v.numero_cliente).toBe("150");
    expect(v.bairro_cliente).toBe("Centro");
    expect(v.cep_cliente).toBe("35930-000");
    expect(v.cidade_cliente).toBe("João Monlevade/MG");
  });

  it("o endereço de apolo_addresses aparece quando a ficha não o tem", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_addresses: [
          {
            city: "Contagem",
            complement: null,
            district: "Eldorado",
            entity_id: THIAGO,
            number: "32",
            postal_code: "32310-230",
            state: "MG",
            street: "Rua Manacá",
          },
        ],
        apolo_entities: [
          {
            display_name: "THIAGO",
            document_masked: "123.456.789-00",
            entity_kind: "pf",
            id: THIAGO,
            legal_name: null,
            trade_name: null,
          },
        ],
        apolo_esteira: [
          { enterprise_id: "39", entity_id: THIAGO, ficha: { nacionalidade: "brasileiro" } },
        ],
        hercules_propostas: proposta(),
      }),
    ))!;

    expect(dados.compradores[0]!.valores.rua_cliente).toBe("Rua Manacá");
    expect(dados.compradores[0]!.valores.cidade_cliente).toBe("Contagem/MG");
  });

  it("UF sem cidade e órgão emissor sem RG NÃO viram campo preenchido", async () => {
    const r = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [
          {
            display_name: "THIAGO",
            document_masked: "123.456.789-00",
            entity_kind: "pf",
            id: THIAGO,
            legal_name: null,
            trade_name: null,
          },
        ],
        // Meia-verdade nos dois campos: o cadastro tem o acessório e não tem o essencial.
        apolo_esteira: [
          {
            enterprise_id: "39",
            entity_id: THIAGO,
            ficha: { ...FICHA_DO_THIAGO, cidade: "", orgaoEmissor: "SSP/MG", rg: "", uf: "MG" },
          },
        ],
        hercules_propostas: proposta(),
      }),
    ))!;

    const v = r.dados.compradores[0]!.valores;
    // ⚠️ "residente e domiciliado em MG" e "portador da identidade SSP/MG" PARECEM preenchidos:
    // passam por qualquer conferência automática e por nenhuma humana, tarde demais.
    expect(v.cidade_cliente).toBeUndefined();
    expect(v.rg_cliente).toBeUndefined();
    // E, por não existirem, os dois entram na lista de quem vai conferir.
    expect(r.avisos.join(" ")).toContain("RG");
  });

  it("e-mail e telefone caem em apolo_contacts quando a ficha não os tem", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_contacts: [
          { contact_type: "email", entity_id: THIAGO, value: "thiago@exemplo.com.br" },
          { contact_type: "whatsapp", entity_id: THIAGO, value: "(31) 99999-0000" },
        ],
        apolo_entities: [
          {
            display_name: "THIAGO",
            document_masked: "123.456.789-00",
            entity_kind: "pf",
            id: THIAGO,
            legal_name: null,
            trade_name: null,
          },
        ],
        hercules_propostas: proposta(),
      }),
    ))!;

    expect(dados.compradores[0]!.valores.email_cliente).toBe("thiago@exemplo.com.br");
    expect(dados.compradores[0]!.valores.telefone_cliente).toBe("(31) 99999-0000");
  });

  it("a ficha DO EMPREENDIMENTO da proposta ganha da mais recente de outro loteamento", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [
          {
            display_name: "THIAGO",
            document_masked: "123.456.789-00",
            entity_kind: "pf",
            id: THIAGO,
            legal_name: null,
            trade_name: null,
          },
        ],
        // A ordem é a que o PostgREST devolveu: a mais recente primeiro, e ela é de OUTRO
        // empreendimento. Sem o desempate por `enterprise_id`, o contrato do JDG sairia com o
        // endereço que a pessoa deu ao comprar no Vale do Ouro.
        apolo_esteira: [
          { enterprise_id: "35", entity_id: THIAGO, ficha: { logradouro: "Rua do Vale do Ouro" } },
          { enterprise_id: "39", entity_id: THIAGO, ficha: FICHA_DO_THIAGO },
        ],
        hercules_empreendimentos: EMPREENDIMENTO,
        hercules_propostas: proposta(),
        hercules_unidades: UNIDADE,
      }),
    ))!;

    expect(dados.compradores[0]!.valores.rua_cliente).toBe("Rua das Acácias");
  });

  it("casa o CPF do jsonb com o document_masked, que guarda o documento COM máscara", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [
          {
            display_name: "THIAGO HENRIQUE DE SOUZA",
            document_masked: "123.456.789-00",
            entity_kind: "pf",
            id: THIAGO,
            legal_name: null,
            trade_name: null,
          },
        ],
        // A proposta gravou só os dígitos; a entidade tem a máscara. As duas formas viajam no
        // mesmo `.in()`, então o casamento acontece de qualquer lado.
        hercules_propostas: proposta({
          compradores: [{ cpf: "12345678900", nome: "Thiago", participacao: 100, titular: true }],
        }),
      }),
    ))!;

    expect(dados.compradores[0]!.valores.nome_cliente).toBe("THIAGO HENRIQUE DE SOUZA");
  });
});

describe("a ordem e a quantidade de compradores", () => {
  it("o titular vai na frente — é dele a primeira qualificação da minuta", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        hercules_propostas: proposta({
          compradores: [
            { cpf: "98765432100", nome: "MARIA", participacao: 40, titular: false },
            { cpf: "12345678900", nome: "THIAGO", participacao: 60, titular: true },
          ],
        }),
      }),
    ))!;

    expect(dados.compradores.map((c) => c.valores.nome_cliente)).toEqual(["THIAGO", "MARIA"]);
    expect(dados.compradores[0]!.valores.percentual_cliente).toBe("60%");
    expect(dados.compradores[1]!.valores.percentual_cliente).toBe("40%");
  });

  it("proposta importada do C2X, com o jsonb vazio, cai nas colunas do titular", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({ hercules_propostas: proposta({ compradores: [], condicoes: null }) }),
    ))!;

    expect(dados.compradores).toHaveLength(1);
    expect(dados.compradores[0]!.valores.nome_cliente).toBe("THIAGO HENRIQUE DE SOUZA");
    expect(dados.compradores[0]!.valores.cpf_cliente).toBe("123.456.789-00");
  });

  it("sem comprador nenhum, avisa em vez de devolver um contrato calado", async () => {
    const r = (await dadosDaProposta(
      "p1",
      clienteFalso({
        hercules_propostas: proposta({
          cliente_documento: null,
          cliente_nome: null,
          compradores: [],
        }),
      }),
    ))!;

    expect(r.dados.compradores).toEqual([]);
    expect(r.avisos.join(" ")).toContain("não tem comprador nenhum");
  });
});

describe("os avisos", () => {
  it("comprador sem cadastro no Apolo dá UM aviso, não doze", async () => {
    const r = (await dadosDaProposta(
      "p1",
      clienteFalso({ hercules_propostas: proposta() }),
    ))!;

    const doComprador = r.avisos.filter((a) => a.startsWith("THIAGO"));
    expect(doComprador).toHaveLength(1);
    expect(doComprador[0]).toContain("sem cadastro no Apolo");
  });

  it("lista campo a campo o que falta em quem TEM cadastro", async () => {
    const r = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [
          {
            display_name: "THIAGO",
            document_masked: "123.456.789-00",
            entity_kind: "pf",
            id: THIAGO,
            legal_name: null,
            trade_name: null,
          },
        ],
        apolo_esteira: [
          {
            enterprise_id: "39",
            entity_id: THIAGO,
            ficha: { ...FICHA_DO_THIAGO, rg: "", estadoCivilId: "1", regimeBensId: "" },
          },
        ],
        hercules_propostas: proposta(),
      }),
    ))!;

    // ⚠️ PROCURA PELO CONTEÚDO, não pelo prefixo exato: o aviso é prefixado com o nome COMO ELE ESTÁ
    // no cadastro ("THIAGO HENRIQUE DE SOUZA"), e casar o prefixo exato faz o teste quebrar por um
    // detalhe do fixture em vez de por um defeito do código.
    const aviso = r.avisos.find((a) => a.includes("falta"));
    expect(aviso, r.avisos.join(" | ")).toBeDefined();
    expect(aviso).toContain("RG");
    // ⚠️ SOLTEIRO NÃO É COBRADO POR REGIME DE BENS — aviso que sempre aparece é aviso que ninguém lê.
    expect(r.avisos.join(" ")).not.toContain("regime de bens");
  });

  it("unidade e empreendimento ausentes, cronograma nulo: cada um com o seu aviso", async () => {
    const r = (await dadosDaProposta(
      "p1",
      clienteFalso({
        hercules_propostas: proposta({
          condicoes: null,
          empreendimento_id: null,
          unidade_id: null,
        }),
      }),
    ))!;

    const tudo = r.avisos.join(" | ");
    expect(tudo).toContain("nenhuma unidade");
    expect(tudo).toContain("nenhum empreendimento");
    expect(tudo).toContain("não tem cronograma gravado");
    expect(r.dados.gerais.numero_lote).toBeUndefined();
    expect(r.dados.gerais.prazo_meses_amortizacao).toBeUndefined();
  });

  it("unidade sem matrícula avisa — a qualificação do imóvel depende dela", async () => {
    const r = (await dadosDaProposta(
      "p1",
      clienteFalso({
        hercules_propostas: proposta(),
        hercules_unidades: { ...UNIDADE, matricula: null },
      }),
    ))!;
    expect(r.avisos.join(" ")).toContain("não tem matrícula");
  });

  it("leitura que FALHA não vira 'não tem': quebra", async () => {
    const quebrado = {
      from: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: "timeout" } }) }),
        select: function () {
          return this;
        },
      }),
    } as never;

    await expect(dadosDaProposta("p1", quebrado)).rejects.toThrow(/hercules_propostas/);
  });
});

describe("as condições e a data", () => {
  it("plano com anuais liga o par [inicio_tem_anuais]", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        hercules_propostas: proposta({
          condicoes: {
            anuais: [{ valor: 8000 }, { valor: 8000 }],
            mensais: [{ valor: 1000 }],
            totais: { entrada: 10000, financiado: 90000 },
          },
        }),
      }),
    ))!;

    expect(dados.condicoes?.tem_anuais).toBe(true);
    expect(dados.gerais.plano_anuais_quantidade).toBe("2");
    expect(dados.gerais.plano_anuais_valor).toBe("R$ 8.000,00");
    expect(dados.gerais.plano_anuais_valor_extenso).toBe("oito mil reais");
  });

  it("plano SEM anuais desliga o par — senão o contrato anuncia '0 parcelas de'", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({ hercules_propostas: proposta() }),
    ))!;
    expect(dados.condicoes?.tem_anuais).toBe(false);
    expect(dados.gerais.plano_anuais_quantidade).toBeUndefined();
  });

  it("a data de emissão sai nos dois formatos", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({ hercules_propostas: proposta() }),
    ))!;
    expect(dados.gerais.data_emissao_contrato).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(dados.gerais.data_emissao_contrato_extenso).toMatch(/^\d{1,2} de \p{L}+ de \d{4}$/u);
  });

  it("hoje é o dia de BRASÍLIA, e não o da máquina que gerou", () => {
    // 08/09/2026 às 23h30 de Brasília já é 09/09 em UTC. O contrato tem que dizer 08.
    expect(hojeEmBrasilia(new Date("2026-09-09T02:30:00Z"))).toBe("2026-09-08");
    expect(hojeEmBrasilia(new Date("2026-09-08T12:00:00Z"))).toBe("2026-09-08");
  });

  it("a data por extenso não leva zero à esquerda: é frase, não tabela", () => {
    expect(dataPorExtenso("2026-09-08")).toBe("8 de setembro de 2026");
    expect(dataPorExtenso("2026-12-25")).toBe("25 de dezembro de 2026");
    expect(dataPorExtenso("nao e data")).toBe("");
  });

  it("data de nascimento ilegível não vai para o papel", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [
          {
            display_name: "THIAGO",
            document_masked: "123.456.789-00",
            entity_kind: "pf",
            id: THIAGO,
            legal_name: null,
            trade_name: null,
          },
        ],
        apolo_esteira: [
          {
            enterprise_id: "39",
            entity_id: THIAGO,
            ficha: { ...FICHA_DO_THIAGO, dataNascimento: "nao informado" },
          },
        ],
        hercules_propostas: proposta(),
      }),
    ))!;

    expect(dados.compradores[0]!.valores.data_nascimento_cliente).toBeUndefined();
  });

  it("data de nascimento boa sai em DD/MM/AAAA", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [
          {
            display_name: "THIAGO",
            document_masked: "123.456.789-00",
            entity_kind: "pf",
            id: THIAGO,
            legal_name: null,
            trade_name: null,
          },
        ],
        apolo_esteira: [{ enterprise_id: "39", entity_id: THIAGO, ficha: FICHA_DO_THIAGO }],
        hercules_propostas: proposta(),
      }),
    ))!;

    expect(dados.compradores[0]!.valores.data_nascimento_cliente).toBe("15/03/1985");
    expect(dados.compradores[0]!.valores.rg_cliente).toBe("MG-12.345.678 SSP/MG");
  });
});

// ── AS REGRESSÕES DA REVISÃO DE 08/09/2026 ───────────────────────────────────
//
// Cada bloco daqui para baixo é um defeito que estava no código e chegava ao papel. Todos passam
// pelo mesmo caminho dos de cima; o que muda é a forma da linha que o banco devolve.

describe("a proposta IMPORTADA do C2X (4.857 delas)", () => {
  // ⚠️ O JSONB DELAS TEM OUTRAS CHAVES. `scripts/hercules/importar-fluxo-de-venda.mjs` grava
  // `{ c2x_user_id, documento, nome, percentual, titular }`; a proposta nativa grava
  // `{ cpf, nome, participacao, telefone, titular }`. Lendo só a segunda grafia a lista NÃO fica
  // vazia — ela fica com um comprador de nome e sem documento, e a reserva de `cliente_documento`
  // nunca dispara. O resultado era a qualificação inteira em branco em toda proposta antiga.
  const compradorImportado = {
    c2x_user_id: 4199,
    documento: "123.456.789-00",
    nome: "THIAGO HENRIQUE DE SOUZA",
    percentual: 60,
    titular: true,
  };

  it("casa a entidade pelo `documento` e traz a qualificação inteira", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [ENTIDADE_THIAGO],
        apolo_esteira: [{ enterprise_id: "39", entity_id: THIAGO, ficha: FICHA_DO_THIAGO }],
        hercules_empreendimentos: EMPREENDIMENTO,
        hercules_propostas: proposta({ compradores: [compradorImportado], condicoes: null }),
      }),
    ))!;

    const v = dados.compradores[0]!.valores;
    expect(v.cpf_cliente).toBe("123.456.789-00");
    expect(v.nacionalidade_cliente).toBe("brasileiro");
    expect(v.estado_civil_cliente).toBe("Casado (a)");
    expect(v.rua_cliente).toBe("Rua das Acácias");
    // `percentual`, e não `participacao`.
    expect(v.percentual_cliente).toBe("60%");
  });

  it("não avisa 'sem cadastro no Apolo' para quem TEM cadastro", async () => {
    const r = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [ENTIDADE_THIAGO],
        apolo_esteira: [{ enterprise_id: "39", entity_id: THIAGO, ficha: FICHA_DO_THIAGO }],
        hercules_propostas: proposta({ compradores: [compradorImportado], condicoes: null }),
      }),
    ))!;
    expect(r.avisos.join(" ")).not.toContain("sem cadastro no Apolo");
  });

  it("a PJ importada continua PJ — senão o bloco [inicio_dados_cliente_pj] some do contrato", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        hercules_propostas: proposta({
          compradores: [
            {
              c2x_user_id: 7,
              documento: "11115899000104",
              nome: "Souza Participações",
              titular: true,
            },
          ],
          condicoes: null,
        }),
      }),
    ))!;
    expect(dados.compradores[0]!.ehPessoaFisica).toBe(false);
    expect(dados.compradores[0]!.valores.cnpj_cliente).toBe("11.115.899/0001-04");
  });
});

describe("o documento que não é um documento", () => {
  it("CPF incompleto na proposta NÃO vira campo preenchido — e entra nos avisos", async () => {
    // ⚠️ `formatarDocumento` DEVOLVE A ENTRADA quando os dígitos não fecham 11 nem 14. O `cli_cpf`
    // do legado é texto livre, e um CPF truncado atravessava a importação e saía impresso como
    // "portador do CPF 1234567890": um campo que PARECE preenchido, some da lista de quem vai
    // conferir e passa por qualquer leitura automática.
    const r = (await dadosDaProposta(
      "p1",
      clienteFalso({
        // A entidade existe e guarda o MESMO número truncado: o aviso que se espera é "falta CPF",
        // e não "sem cadastro no Apolo".
        apolo_entities: [{ ...ENTIDADE_THIAGO, document_masked: "1234567890" }],
        apolo_esteira: [{ enterprise_id: "39", entity_id: THIAGO, ficha: FICHA_DO_THIAGO }],
        hercules_propostas: proposta({
          compradores: [{ cpf: "1234567890", nome: "THIAGO", participacao: 100, titular: true }],
        }),
      }),
    ))!;

    expect(r.dados.compradores[0]!.valores.cpf_cliente).toBeUndefined();
    const aviso = r.avisos.find((a) => a.includes("falta"));
    expect(aviso, r.avisos.join(" | ")).toContain("CPF");
  });

  it("o documento gravado CRU sai pontuado — cartório não recebe 12345678900", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [{ ...ENTIDADE_THIAGO, document_masked: "12345678900" }],
        hercules_propostas: proposta(),
      }),
    ))!;
    expect(dados.compradores[0]!.valores.cpf_cliente).toBe("123.456.789-00");
  });

  it("CPF do cônjuge pela metade não vira campo preenchido", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [ENTIDADE_THIAGO],
        apolo_relationships: [
          {
            entity_id: THIAGO,
            label: "MARIA DE SOUZA",
            metadata: { cpf: "987654" },
            status: "verified",
          },
        ],
        hercules_propostas: proposta(),
      }),
    ))!;
    expect(dados.compradores[0]!.valores.nome_conjuge).toBe("MARIA DE SOUZA");
    expect(dados.compradores[0]!.valores.cpf_conjuge).toBeUndefined();
  });
});

describe("o cônjuge ARQUIVADO", () => {
  it("não entra no contrato nem liga o bloco [inicio_dados_conjuge]", async () => {
    // ⚠️ `apolo_relationships` NÃO APAGA: desfazer o vínculo grava `status = "archived"`. Lido como
    // se estivesse vivo, o contrato vai a cartório qualificando — e pedindo a assinatura de — uma
    // pessoa que saiu do negócio.
    const r = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [ENTIDADE_THIAGO],
        apolo_esteira: [{ enterprise_id: "39", entity_id: THIAGO, ficha: FICHA_DO_THIAGO }],
        apolo_relationships: [
          {
            entity_id: THIAGO,
            label: "EX-CÔNJUGE",
            metadata: { arquivadoEm: "2026-08-01T12:00:00Z", cpf: "98765432100" },
            status: "archived",
          },
        ],
        hercules_propostas: proposta(),
      }),
    ))!;

    expect(r.dados.compradores[0]!.temConjuge).toBe(false);
    expect(r.dados.compradores[0]!.valores.nome_conjuge).toBeUndefined();
  });

  it("mas o vivo que vem DEPOIS do arquivado continua sendo lido", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [ENTIDADE_THIAGO],
        apolo_relationships: [
          { entity_id: THIAGO, label: "EX-CÔNJUGE", metadata: {}, status: "archived" },
          {
            entity_id: THIAGO,
            label: "MARIA DE SOUZA",
            metadata: { cpf: "98765432100" },
            status: "verified",
          },
        ],
        hercules_propostas: proposta(),
      }),
    ))!;
    expect(dados.compradores[0]!.valores.nome_conjuge).toBe("MARIA DE SOUZA");
  });

  it("status NULO (vínculo antigo) continua valendo — silêncio não é arquivamento", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [ENTIDADE_THIAGO],
        apolo_relationships: [
          { entity_id: THIAGO, label: "MARIA DE SOUZA", metadata: {}, status: null },
        ],
        hercules_propostas: proposta(),
      }),
    ))!;
    expect(dados.compradores[0]!.valores.nome_conjuge).toBe("MARIA DE SOUZA");
  });
});

describe("o empreendimento que a prévia usa para achar a minuta", () => {
  it("sai como o id do C2X, que é o que temis_minutas.enterprise_id guarda", async () => {
    // ⚠️ SEM ESTA CHAVE A PRÉVIA NÃO ACHA MINUTA NENHUMA. `/api/temis/contrato/previa` procura a
    // minuta publicada por `dados.gerais.__empreendimento_id`; com string vazia a busca não casa e
    // TODA prévia responde "Não há minuta de contrato PUBLICADA para este empreendimento".
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        hercules_empreendimentos: EMPREENDIMENTO,
        hercules_propostas: proposta(),
      }),
    ))!;
    expect(dados.gerais.__empreendimento_id).toBe("39");
  });

  it("sem empreendimento, a chave não existe — e o aviso diz por quê", async () => {
    const r = (await dadosDaProposta(
      "p1",
      clienteFalso({ hercules_propostas: proposta({ empreendimento_id: null }) }),
    ))!;
    expect(r.dados.gerais.__empreendimento_id).toBeUndefined();
    expect(r.avisos.join(" ")).toContain("nenhum empreendimento");
  });
});

describe("o prazo do contrato", () => {
  it("vem de contrato_parcelas mesmo sem cronograma — é o caso das importadas", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        hercules_propostas: proposta({ condicoes: null, contrato_parcelas: 62 }),
      }),
    ))!;
    expect(dados.gerais.prazo_meses_amortizacao).toBe("62");
    expect(dados.gerais.prazo_meses_amortizacao_extenso).toBe("sessenta e dois");
  });

  it("a coluna ganha do tamanho do cronograma", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({ hercules_propostas: proposta({ contrato_parcelas: 62 }) }),
    ))!;
    // O fixture tem 120 mensais gravadas; o prazo contratado é 62.
    expect(dados.gerais.prazo_meses_amortizacao).toBe("62");
  });

  it("sem a coluna, o cronograma responde", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({ hercules_propostas: proposta() }),
    ))!;
    expect(dados.gerais.prazo_meses_amortizacao).toBe("120");
  });
});

describe("o telefone do comprador", () => {
  it("whatsapp ganha de phone — 3.941 entidades só têm a linha de whatsapp", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_contacts: [
          { contact_type: "phone", entity_id: THIAGO, value: "(31) 3851-0000" },
          { contact_type: "whatsapp", entity_id: THIAGO, value: "(31) 99999-0000" },
        ],
        apolo_entities: [ENTIDADE_THIAGO],
        hercules_propostas: proposta(),
      }),
    ))!;
    expect(dados.compradores[0]!.valores.telefone_cliente).toBe("(31) 99999-0000");
  });

  it("o segundo comprador cai no telefone do jsonb — é o único contato que ele tem", async () => {
    // ⚠️ O PROPONENTE QUE NÃO É TITULAR pode não ter reserva, CAD nem entidade no Apolo. A rota que
    // grava a proposta diz isso em nota: o jsonb é o único lugar onde o contato dele existe.
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso({
        hercules_propostas: proposta({
          compradores: [
            { cpf: "12345678900", nome: "THIAGO", participacao: 60, telefone: null, titular: true },
            {
              cpf: "98765432100",
              nome: "MARIA",
              participacao: 40,
              telefone: "(31) 98888-0000",
              titular: false,
            },
          ],
        }),
      }),
    ))!;
    expect(dados.compradores[1]!.valores.telefone_cliente).toBe("(31) 98888-0000");
  });
});

describe("o ruído de carga não vira endereço", () => {
  // ⚠️ SAIU IMPRESSO NUM CONTRATO REAL, em 08/09/2026: "residente e domiciliado na Endereco
  // cadastral, nº [numero_cliente]". Não é o endereço de ninguém — é um rótulo que uma carga pôs na
  // coluna `street` de 4.633 linhas de `apolo_addresses`.
  //
  // ⚠️ E ISSO É PIOR QUE O CAMPO VAZIO: `[rua_cliente]` impresso salta aos olhos e entra na lista de
  // avisos; "Endereco cadastral" parece preenchido, passa pela conferência e chega ao cartório.
  it('"Endereco cadastral" vira ausência, e entra nos avisos', async () => {
    const r = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_addresses: [
          {
            city: "Belo Horizonte",
            complement: null,
            district: "Centro",
            entity_id: THIAGO,
            number: "100",
            postal_code: "30000-000",
            state: "MG",
            street: "Endereco cadastral",
          },
        ],
        apolo_entities: [
          {
            display_name: "THIAGO",
            document_masked: "123.456.789-00",
            entity_kind: "pf",
            id: THIAGO,
            legal_name: null,
            trade_name: null,
          },
        ],
        hercules_propostas: proposta(),
      }),
    ))!;

    expect(r.dados.compradores[0]?.valores.rua_cliente).toBeUndefined();
    // O resto do endereço continua valendo: só a rua era ruído.
    expect(r.dados.compradores[0]?.valores.bairro_cliente).toBe("Centro");
  });

  it("uma rua de verdade continua passando", async () => {
    const r = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_addresses: [
          {
            city: "Belo Horizonte",
            complement: null,
            district: "Centro",
            entity_id: THIAGO,
            number: "100",
            postal_code: "30000-000",
            state: "MG",
            street: "Rua Sem Nome",
          },
        ],
        apolo_entities: [
          {
            display_name: "THIAGO",
            document_masked: "123.456.789-00",
            entity_kind: "pf",
            id: THIAGO,
            legal_name: null,
            trade_name: null,
          },
        ],
        hercules_propostas: proposta(),
      }),
    ))!;
    expect(r.dados.compradores[0]?.valores.rua_cliente).toBe("Rua Sem Nome");
  });
});

describe("as armadilhas achadas pela auditoria de 08/09/2026", () => {
  const entidade = (over: Record<string, unknown>) => ({
    created_at: "2026-01-01T00:00:00Z",
    display_name: "FULANO",
    document_masked: "123.456.789-00",
    entity_kind: "pf",
    id: THIAGO,
    legal_name: null,
    status: "active",
    trade_name: null,
    ...over,
  });

  // ⚠️ SEIS ENTIDADES TÊM CPF E `entity_kind = 'pj'`, e CINCO são compradoras de propostas reais
  // (uma delas um MEI). O contrato gravava o CPF no slot do CNPJ, formatado como CPF, e o bloco de
  // pessoa jurídica substituía o de física: estado civil, regime e cônjuge SUMIAM do papel. E a
  // conferência não avisava, porque ela só cobra CNPJ e razão social quando não é PF — e os dois
  // estavam preenchidos.
  it("CPF de 11 dígitos é pessoa física, mesmo com entity_kind='pj'", async () => {
    const r = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [entidade({ entity_kind: "pj", legal_name: "FULANO MEI LTDA" })],
        hercules_propostas: proposta(),
      }),
    ))!;

    const c = r.dados.compradores[0]!;
    expect(c.ehPessoaFisica).toBe(true);
    expect(c.valores.cpf_cliente).toBe("123.456.789-00");
    // O CPF não pode aparecer no slot do CNPJ — era esse o defeito.
    expect(c.valores.cnpj_cliente).toBeUndefined();
  });

  it("14 dígitos continua sendo pessoa jurídica", async () => {
    const r = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [
          entidade({
            document_masked: "11.115.899/0001-04",
            entity_kind: "pf",
            legal_name: "EMPRESA LTDA",
          }),
        ],
        hercules_propostas: proposta({
          cliente_documento: "11115899000104",
          compradores: [
            { cpf: "11.115.899/0001-04", nome: "EMPRESA LTDA", participacao: 100, titular: true },
          ],
        }),
      }),
    ))!;
    expect(r.dados.compradores[0]?.ehPessoaFisica).toBe(false);
  });

  // ⚠️ DE 622 CPFs DUPLICADOS, 415 têm como mais antiga a entidade ARQUIVADA pelo merge — e as 415
  // estão vazias, sem ficha, contato ou endereço. Isso atingia 262 propostas no Vale do Ouro: o
  // contrato sairia sem cidade, sem telefone e sem e-mail, com o cadastro completo ali do lado.
  it("a entidade arquivada perde para a viva, mesmo sendo mais antiga", async () => {
    const outra = "aaaaaaaa-0000-0000-0000-0000000000ff";
    const r = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [
          entidade({
            created_at: "2020-01-01T00:00:00Z",
            display_name: "A ARQUIVADA",
            id: outra,
            status: "archived",
          }),
          entidade({ created_at: "2026-01-01T00:00:00Z", display_name: "A VIVA", status: "active" }),
        ],
        hercules_propostas: proposta(),
      }),
    ))!;
    expect(r.dados.compradores[0]?.valores.nome_cliente).toBe("A VIVA");
  });

  it("entre duas vivas, a mais antiga continua ganhando", async () => {
    const outra = "aaaaaaaa-0000-0000-0000-0000000000ff";
    const r = (await dadosDaProposta(
      "p1",
      clienteFalso({
        apolo_entities: [
          entidade({ created_at: "2020-01-01T00:00:00Z", display_name: "A ORIGINAL", id: outra }),
          entidade({ created_at: "2026-01-01T00:00:00Z", display_name: "A NOVA" }),
        ],
        hercules_propostas: proposta(),
      }),
    ))!;
    expect(r.dados.compradores[0]?.valores.nome_cliente).toBe("A ORIGINAL");
  });
});

// ── A IMOBILIÁRIA DA VENDA ───────────────────────────────────────────────────
//
// Lucas, 08/09/2026, sobre o contrato do Rodrigo na prévia: *"falta informação da imobiliaria"*.
// O nome saía (vem desnormalizado na proposta); CNPJ, telefone e e-mail, não.
describe("o cadastro da imobiliária entra pelo vínculo", () => {
  const IMOBILIARIA = "cccccccc-0000-0000-0000-000000000001";

  function comVinculo(over: Linhas = {}) {
    return clienteFalso({
      apolo_contacts: (f: Record<string, unknown>) =>
        f.entity_id === IMOBILIARIA
          ? [
              { contact_type: "whatsapp", entity_id: IMOBILIARIA, value: "3197250-6566" },
              { contact_type: "email", entity_id: IMOBILIARIA, value: "raiane@c2x.tec.br" },
            ]
          : [],
      apolo_entities: (f: Record<string, unknown>) =>
        f.id === IMOBILIARIA
          ? { document_masked: "60.054.065/0001-41", id: IMOBILIARIA }
          : [ENTIDADE_THIAGO],
      hercules_empreendimentos: EMPREENDIMENTO,
      hercules_propostas: proposta({
        imobiliaria_entity_id: IMOBILIARIA,
        imobiliaria_nome: "RAIANE IMOBILIARIA",
        ...over,
      }),
      hercules_unidades: UNIDADE,
    });
  }

  it("CNPJ, telefone e e-mail saem do cadastro da entidade vinculada", async () => {
    const r = await dadosDaProposta("p1", comVinculo());
    const g = r!.dados.gerais;

    expect(g.nome_vinculado).toBe("RAIANE IMOBILIARIA");
    expect(g.cpf_cnpj_vinculado).toBe("60.054.065/0001-41");
    expect(g.telefone_vinculado).toBe("3197250-6566");
    expect(g.email_vinculado).toBe("raiane@c2x.tec.br");
  });

  // ⚠️ SEM VÍNCULO, OS TRÊS FICAM EM BRANCO — e é o certo. É o caso das propostas importadas do C2X,
  // que guardam só o nome. Inventar o cadastro a partir do nome poria o CNPJ de OUTRA imobiliária
  // num contrato de corretagem.
  it("proposta importada, só com o nome, não ganha cadastro nenhum", async () => {
    const sb = clienteFalso({
      apolo_entities: [ENTIDADE_THIAGO],
      hercules_empreendimentos: EMPREENDIMENTO,
      hercules_propostas: proposta({ imobiliaria_nome: "IMOBILIÁRIA ANTIGA" }),
      hercules_unidades: UNIDADE,
    });
    const g = (await dadosDaProposta("p1", sb))!.dados.gerais;

    expect(g.nome_vinculado).toBe("IMOBILIÁRIA ANTIGA");
    expect(g.cpf_cnpj_vinculado).toBeUndefined();
    expect(g.telefone_vinculado).toBeUndefined();
    expect(g.email_vinculado).toBeUndefined();
  });
});

// ── QUEM TEM REGIME DE BENS ──────────────────────────────────────────────────
//
// A bandeira que apaga a oração "casado sob o regime de" no papel de quem é solteiro.
// Ver `semOracaoDoRegime` em preencher-contrato.ts.
describe("a bandeira de casado", () => {
  async function comEstadoCivil(estadoCivilId: null | string) {
    const sb = clienteFalso({
      apolo_entities: [ENTIDADE_THIAGO],
      apolo_esteira: [
        {
          enterprise_id: "39",
          entity_id: THIAGO,
          ficha: estadoCivilId === null
            ? { ...FICHA_DO_THIAGO, estadoCivilId: undefined }
            : { ...FICHA_DO_THIAGO, estadoCivilId },
        },
      ],
      hercules_empreendimentos: EMPREENDIMENTO,
      hercules_propostas: proposta(),
      hercules_unidades: UNIDADE,
    });
    return (await dadosDaProposta("p1", sb))!.dados.compradores[0];
  }

  it("casado (2) e união estável (6) têm regime; os outros não", async () => {
    expect((await comEstadoCivil("2"))!.ehCasado).toBe(true);
    expect((await comEstadoCivil("6"))!.ehCasado).toBe(true);
    expect((await comEstadoCivil("1"))!.ehCasado).toBe(false);
    expect((await comEstadoCivil("5"))!.ehCasado).toBe(false);
  });

  // ⚠️ SEM ESTADO CIVIL A RESPOSTA É INDEFINIDA, e não `false`: a oração fica no papel com o
  // colchete à mostra, que é o que faz alguém completar o cadastro. Ver a nota da função.
  it("ficha sem estado civil não vira 'não casado'", async () => {
    expect((await comEstadoCivil(null))!.ehCasado).toBeUndefined();
  });
});

// ── A CORRETAGEM ─────────────────────────────────────────────────────────────
//
// As lacunas que o contrato de corretagem imprimia entre colchetes até 08/09/2026. A comissão virou
// DADO do empreendimento na migration 0145 — paliativo até a migração do financeiro, palavra do
// Lucas — e é percentual sobre o valor VENDIDO, com o total sendo a soma das duas pontas.
describe("a comissão de corretagem e a coordenadora de vendas", () => {
  const COORDENADORA = "bbbbbbbb-0000-0000-0000-000000000001";

  /** A entidade da coordenadora como `apolo_entities` a devolve: PJ, com fantasia e razão social. */
  const ENTIDADE_COORDENADORA = {
    display_name: "CARELI VENDAS LTDA",
    document_masked: "11.115.899/0001-04",
    entity_kind: "pj",
    id: COORDENADORA,
    legal_name: "CARELI VENDAS E INTERMEDIACAO LTDA",
    metadata: null,
    trade_name: "Careli Vendas",
  };

  /**
   * ⚠️ `numeric` CHEGA COMO STRING do PostgREST, e o fixture repete isso de propósito: é assim que
   * `comissao_coordenadora_percentual` aparece na resposta real, e um `typeof === "number"` no
   * caminho leria a comissão inteira como ausente.
   */
  const AJUSTES = {
    comissao_coordenadora_percentual: "1.500",
    comissao_imobiliaria_percentual: "5.000",
    coordenadora_entity_id: COORDENADORA,
  };

  function cliente(
    entrada: {
      ajustes?: Linhas | null;
      chave?: string;
      empreendimento?: Linhas;
      proposta?: Linhas;
      unidade?: Linhas;
    } = {},
  ) {
    return clienteFalso({
      apolo_addresses: (f: Record<string, unknown>) =>
        f.entity_id === COORDENADORA
          ? [
              {
                city: "Belo Horizonte",
                complement: null,
                district: "Funcionários",
                entity_id: COORDENADORA,
                number: "1000",
                postal_code: "30110-000",
                state: "MG",
                street: "Avenida Central",
              },
            ]
          : [],
      apolo_contacts: (f: Record<string, unknown>) =>
        f.entity_id === COORDENADORA
          ? [
              { contact_type: "whatsapp", entity_id: COORDENADORA, value: "(31) 3333-1111" },
              { contact_type: "email", entity_id: COORDENADORA, value: "vendas@careli.adm.br" },
            ]
          : [],
      // A mesma tabela responde pelos compradores (por `.in`, sem `.eq`) e pela coordenadora.
      apolo_entities: (f: Record<string, unknown>) =>
        f.id === COORDENADORA ? ENTIDADE_COORDENADORA : [ENTIDADE_THIAGO],
      // ⚠️ A CHAVE É O ID DO C2X: o duplo só devolve a linha quando a consulta perguntou por "39",
      // que é o `c2x_enterprise_id` do empreendimento. Perguntar pelo uuid não acha nada.
      apolo_enterprise_settings: (f: Record<string, unknown>) =>
        entrada.ajustes && f.enterprise_id === (entrada.chave ?? "39") ? entrada.ajustes : null,
      hercules_empreendimentos: entrada.empreendimento ?? EMPREENDIMENTO,
      hercules_propostas: entrada.proposta ?? proposta(),
      hercules_unidades: entrada.unidade ?? UNIDADE,
    });
  }

  it("os três valores e os três extensos: 1,5% e 5% de R$ 185.400", async () => {
    const g = (await dadosDaProposta("p1", cliente({ ajustes: AJUSTES })))!.dados.gerais;

    // 185.400 × 1,5% = 2.781,00 · 185.400 × 5% = 9.270,00 · total 12.051,00.
    expect(g.valor_pago_coordenadora_vendas).toBe("R$ 2.781,00");
    expect(g.valor_pago_coordenadora_vendas_extenso).toBe("dois mil setecentos e oitenta e um reais");
    expect(g.valor_corretagem_menos_coordenadora_vendas).toBe("R$ 9.270,00");
    expect(g.valor_corretagem_menos_coordenadora_vendas_extenso).toBe(
      "nove mil duzentos e setenta reais",
    );
    expect(g.valor_total_comissao).toBe("R$ 12.051,00");
    expect(g.valor_total_comissao_extenso).toBe("doze mil e cinquenta e um reais");

    expect(g.percentual_comissao_coordenadora_vendas).toBe("1,5%");
    expect(g.percentual_comissao_vinculado).toBe("5%");
  });

  // ⚠️ O TOTAL É A SOMA DAS DUAS LINHAS IMPRESSAS, e este é o valor que prova a diferença: R$
  // 170.010,08 a 1,5% e 5% dá 2.550,15 e 8.500,50, que somam 11.050,65. A mesma conta em reais dá
  // 11050.6552 e imprimiria R$ 11.050,66 — um centavo a mais do que as duas quantias que a frase do
  // contrato manda somar, na mesma linha.
  it("valor quebrado não vaza dízima nem desencontra o total das partes", async () => {
    const g = (await dadosDaProposta(
      "p1",
      cliente({ ajustes: AJUSTES, proposta: proposta({ valor: 170010.08 }) }),
    ))!.dados.gerais;

    expect(g.valor_pago_coordenadora_vendas).toBe("R$ 2.550,15");
    expect(g.valor_corretagem_menos_coordenadora_vendas).toBe("R$ 8.500,50");
    expect(g.valor_total_comissao).toBe("R$ 11.050,65");

    // Nenhum número com mais de duas casas depois da vírgula chega ao papel.
    for (const nome of Object.keys(g)) {
      expect(g[nome], nome).not.toMatch(/,\d{3,}/);
    }
  });

  it("os nove campos da coordenadora saem do cadastro dela no Apolo", async () => {
    const g = (await dadosDaProposta("p1", cliente({ ajustes: AJUSTES })))!.dados.gerais;

    expect(g.nome_fantasia_coordenadora_vendas).toBe("Careli Vendas");
    expect(g.cnpj_coordenadora_vendas).toBe("11.115.899/0001-04");
    expect(g.rua_coordenadora_vendas).toBe("Avenida Central");
    expect(g.numero_coordenadora_vendas).toBe("1000");
    expect(g.bairro_coordenadora_vendas).toBe("Funcionários");
    // "Cidade/UF" é o formato que o catálogo declara — e a UF sozinha não seria uma cidade.
    expect(g.cidade_coordenadora_vendas).toBe("Belo Horizonte/MG");
    expect(g.cep_coordenadora_vendas).toBe("30110-000");
    // ⚠️ WHATSAPP, NÃO `phone`: é o tipo que a maioria das entidades do Apolo tem.
    expect(g.telefone_coordenadora_vendas).toBe("(31) 3333-1111");
    expect(g.email_coordenadora_vendas).toBe("vendas@careli.adm.br");
  });

  it("entidade sem `trade_name` cai no `display_name` — 19 das 590 PJ estão assim", async () => {
    const sb = clienteFalso({
      apolo_entities: (f: Record<string, unknown>) =>
        f.id === COORDENADORA ? { ...ENTIDADE_COORDENADORA, trade_name: null } : [ENTIDADE_THIAGO],
      apolo_enterprise_settings: AJUSTES,
      hercules_empreendimentos: EMPREENDIMENTO,
      hercules_propostas: proposta(),
      hercules_unidades: UNIDADE,
    });
    const g = (await dadosDaProposta("p1", sb))!.dados.gerais;
    expect(g.nome_fantasia_coordenadora_vendas).toBe("CARELI VENDAS LTDA");
  });

  // ⚠️ NULO NÃO É ZERO, e esta é a metade "nulo": a variável NÃO entra no dicionário, o motor
  // imprime `[valor_total_comissao]` no papel e o colchete é o aviso para alguém cadastrar.
  it("percentual nulo não escreve a variável — o colchete volta ao papel", async () => {
    const r = (await dadosDaProposta(
      "p1",
      cliente({
        ajustes: {
          ...AJUSTES,
          comissao_coordenadora_percentual: null,
          comissao_imobiliaria_percentual: null,
        },
      }),
    ))!;
    const g = r.dados.gerais;

    expect(g.valor_pago_coordenadora_vendas).toBeUndefined();
    expect(g.valor_pago_coordenadora_vendas_extenso).toBeUndefined();
    expect(g.valor_corretagem_menos_coordenadora_vendas).toBeUndefined();
    expect(g.valor_total_comissao).toBeUndefined();
    expect(g.valor_total_comissao_extenso).toBeUndefined();
    expect(g.percentual_comissao_coordenadora_vendas).toBeUndefined();
    expect(g.percentual_comissao_vinculado).toBeUndefined();

    expect(r.avisos.join(" | ")).toContain("percentuais de comissão");
  });

  // ⚠️ E ESTA É A OUTRA METADE: zero é DECISÃO (empreendimento em que aquela ponta não recebe) e
  // imprime R$ 0,00. Um contrato que imprime R$ 0,00 foi decidido; um que imprime o colchete foi
  // esquecido — e o resolvedor tem de saber a diferença.
  it("percentual ZERO imprime R$ 0,00, e não o colchete", async () => {
    const r = (await dadosDaProposta(
      "p1",
      cliente({ ajustes: { ...AJUSTES, comissao_coordenadora_percentual: "0.000" } }),
    ))!;
    const g = r.dados.gerais;

    expect(g.valor_pago_coordenadora_vendas).toBe("R$ 0,00");
    expect(g.valor_pago_coordenadora_vendas_extenso).toBe("zero reais");
    expect(g.percentual_comissao_coordenadora_vendas).toBe("0%");
    // O total continua sendo a soma: 0 + 9.270,00.
    expect(g.valor_total_comissao).toBe("R$ 9.270,00");
    // Zero é decisão: não vira aviso de "falta cadastrar".
    expect(r.avisos.join(" | ")).not.toContain("percentual da coordenadora");
  });

  // ⚠️ COM UMA PONTA SÓ, A SOMA É DESCONHECIDA. Escrever a que existe no lugar do total imprimiria
  // uma comissão menor do que a combinada, em cima da frase que diz que o total é a intermediação.
  it("um percentual só escreve a sua linha e deixa o total em branco", async () => {
    const r = (await dadosDaProposta(
      "p1",
      cliente({ ajustes: { ...AJUSTES, comissao_imobiliaria_percentual: null } }),
    ))!;
    const g = r.dados.gerais;

    expect(g.valor_pago_coordenadora_vendas).toBe("R$ 2.781,00");
    expect(g.valor_corretagem_menos_coordenadora_vendas).toBeUndefined();
    expect(g.valor_total_comissao).toBeUndefined();
    expect(r.avisos.join(" | ")).toContain("percentual da imobiliária");
  });

  // ⚠️ UM AVISO, E NÃO NOVE. Sem coordenadora apontada são nove variáveis vazias e uma causa só;
  // listá-las campo a campo esconderia os outros avisos no meio.
  it("sem `coordenadora_entity_id`, nenhum dos nove campos — e UM aviso só", async () => {
    const r = (await dadosDaProposta(
      "p1",
      cliente({ ajustes: { ...AJUSTES, coordenadora_entity_id: null } }),
    ))!;
    const g = r.dados.gerais;

    for (const nome of [
      "bairro_coordenadora_vendas",
      "cep_coordenadora_vendas",
      "cidade_coordenadora_vendas",
      "cnpj_coordenadora_vendas",
      "email_coordenadora_vendas",
      "nome_fantasia_coordenadora_vendas",
      "numero_coordenadora_vendas",
      "rua_coordenadora_vendas",
      "telefone_coordenadora_vendas",
    ]) {
      expect(g[nome], nome).toBeUndefined();
    }

    // Os valores continuam saindo: quem falta é o NOME de quem recebe, não o quanto.
    expect(g.valor_pago_coordenadora_vendas).toBe("R$ 2.781,00");

    const daCoordenadora = r.avisos.filter((a) => a.includes("coordenadora de vendas"));
    expect(daCoordenadora, r.avisos.join(" | ")).toHaveLength(1);
  });

  // ⚠️ ID ÓRFÃO É "SEM COORDENADORA", E NÃO ERRO. A 0145 deixou a coluna sem foreign key de
  // propósito, porque `apolo_entities` recebe merge e arquivamento.
  it("id que não acha entidade nenhuma vira a mesma lacuna visível", async () => {
    const sb = clienteFalso({
      apolo_entities: (f: Record<string, unknown>) => (f.id ? null : [ENTIDADE_THIAGO]),
      apolo_enterprise_settings: AJUSTES,
      hercules_empreendimentos: EMPREENDIMENTO,
      hercules_propostas: proposta(),
      hercules_unidades: UNIDADE,
    });
    const r = (await dadosDaProposta("p1", sb))!;

    expect(r.dados.gerais.nome_fantasia_coordenadora_vendas).toBeUndefined();
    expect(r.avisos.join(" | ")).toContain("coordenadora de vendas");
  });

  // ⚠️ A CHAVE É O `c2x_enterprise_id`, E NÃO O UUID. Medido em 08/09/2026: `enterprise_id` é a
  // chave primária de `apolo_enterprise_settings`, é TEXTO, e 13 dos 38 empreendimentos têm linha lá
  // casando por ele. Mandar o uuid devolveria zero linha em TODO contrato, calado.
  it("procura os ajustes pelo id do C2X, nunca pelo uuid do Hércules", async () => {
    const sb = clienteFalso({
      apolo_enterprise_settings: (f: Record<string, unknown>) =>
        f.enterprise_id === "eeeeeeee-0000-0000-0000-000000000001" ? AJUSTES : null,
      hercules_empreendimentos: EMPREENDIMENTO,
      hercules_propostas: proposta(),
      hercules_unidades: UNIDADE,
    });
    const g = (await dadosDaProposta("p1", sb))!.dados.gerais;
    expect(g.valor_total_comissao).toBeUndefined();
  });

  // ⚠️ LOX, PDX E RDX NÃO TÊM `c2x_enterprise_id`, e são 1.822 propostas (medido em 08/09/2026).
  // Para eles a unidade carrega o id na própria coluna — o mesmo segundo caminho de
  // `__unidade_enterprise_id`.
  it("empreendimento sem id do C2X cai no id da unidade", async () => {
    const g = (await dadosDaProposta(
      "p1",
      cliente({
        ajustes: AJUSTES,
        chave: "13",
        empreendimento: { ...EMPREENDIMENTO, c2x_enterprise_id: null },
        unidade: { ...UNIDADE, enterprise_id: "13" },
      }),
    ))!.dados.gerais;

    expect(g.valor_total_comissao).toBe("R$ 12.051,00");
  });

  // ⚠️ SEM VALOR NÃO HÁ COMISSÃO, e o aviso disso já existe ("não tem valor negociado"): repetir a
  // mesma causa em três linhas novas afogaria o resto da lista.
  it("proposta sem valor não inventa comissão, mas mantém os percentuais", async () => {
    const r = (await dadosDaProposta(
      "p1",
      cliente({ ajustes: AJUSTES, proposta: proposta({ valor: null }) }),
    ))!;
    const g = r.dados.gerais;

    expect(g.valor_total_comissao).toBeUndefined();
    expect(g.valor_pago_coordenadora_vendas).toBeUndefined();
    expect(g.percentual_comissao_coordenadora_vendas).toBe("1,5%");
    expect(r.avisos.join(" | ")).toContain("valor negociado");
  });
});
