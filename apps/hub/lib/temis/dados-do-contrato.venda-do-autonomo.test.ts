// A VENDA DO CORRETOR AUTÔNOMO NO CONTRATO: `imobiliaria_nome` SAI VAZIA, E A CHAVE EXISTE.
//
// Lucas (27/09/2026): *"nao quero ter a informacao que pode ter pessoa fisica como imobiliaria, isso
// sera bem restrito"*. E, sobre a reserva do autônomo (28/09/2026): *"pode fazer, exige um dos dois"*.
//
// ⚠️ SÃO DOIS FUROS NA MESMA LINHA, E O SEGUNDO NASCEU FECHANDO O PRIMEIRO (revisão de 28/09/2026):
//   1. sem a condição `vendaTemImobiliaria`, `imobiliariaNome` cai no `vendeu.vinculado.razaoSocial`,
//      que na venda do autônomo é o `legal_name` da ficha DELE: a variável cujo rótulo é "Nome da
//      imobiliária" (lib/temis/variaveis.ts) passaria a levar o nome de uma pessoa física;
//   2. mas `por("imobiliaria_nome", "")` NÃO grava vazio: o helper é `if (valor) g[nome] = valor`
//      (lib/temis/dados-do-contrato.ts:1966-1968) e chave AUSENTE faz `valorDaVariavel` devolver `null`
//      (lib/temis/preencher-contrato.ts:1186-1193), o que imprime `[imobiliaria_nome]` LITERAL no papel
//      que vai para assinatura (:1074-1081) e ainda registra o nome em `semValor`. A nota de
//      dados-do-contrato.ts:1741 diz isso com todas as letras: *"chave sem valor NÃO entra, o motor
//      imprime `[nome]` e alguém vê"*.
//
// ⚠️ HOJE NENHUMA MINUTA USA A VARIÁVEL — é por isso que dá para fechar antes de virar incêndio.
// MEDIDO em produção (bxgukywoxgivlrhjkwjx, 28/09/2026, só SELECT): das 5 minutas `publicada`, ZERO
// contêm `[imobiliaria_nome]` ou `[corretor_nome]`; todas as 5 usam `[nome_vinculado]`, que é a
// família NEUTRA ("a imobiliária ou o corretor da venda") e continua saindo certa.
// SQL: `select nome, conteudo_html ilike '%[imobiliaria_nome]%' as usa from temis_minutas where
// situacao = 'publicada';` → false nas cinco.

import { describe, expect, it } from "vitest";

import { dadosDaProposta } from "./dados-do-contrato";

type Linhas = Record<string, unknown>;

/** O mesmo duplo encadeável de `dados-do-contrato.test.ts`: lê por tabela, sem banco. */
function clienteFalso(porTabela: Linhas) {
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
  return { from: (tabela: string) => construir(tabela) } as never;
}

const CLIENTE = "aaaaaaaa-0000-0000-0000-000000000001";
const AUTONOMO = "bbbbbbbb-0000-0000-0000-000000000002";
const IMOBILIARIA = "cccccccc-0000-0000-0000-000000000003";

const ENTIDADE_CLIENTE = {
  display_name: "THIAGO HENRIQUE DE SOUZA",
  document_masked: "123.456.789-00",
  entity_kind: "pf",
  id: CLIENTE,
  legal_name: null,
  trade_name: null,
};

/**
 * A ficha do autônomo como a fatia 1 a cria: `pf`, papel `corretor`, e COM `legal_name` preenchido.
 *
 * ⚠️ O `legal_name` É O QUE FAZ O FURO EXISTIR, e ele não é exceção: MEDIDO em 28/09/2026, 4.170 das
 * 4.905 entidades `pf` da base têm `legal_name` preenchido. Sem a condição, é ele que sairia impresso
 * como nome da imobiliária.
 */
const ENTIDADE_AUTONOMO = {
  display_name: "JOAO AUTONOMO",
  document_masked: "529.982.247-25",
  entity_kind: "pf",
  id: AUTONOMO,
  legal_name: "JOAO AUTONOMO DA SILVA",
  trade_name: null,
};

const ENTIDADE_IMOBILIARIA = {
  display_name: "RR SOLUCOES",
  document_masked: "60.054.065/0001-41",
  entity_kind: "pj",
  id: IMOBILIARIA,
  legal_name: "RR SOLUCOES LTDA",
  trade_name: null,
};

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

const PROPOSTA = {
  cliente_documento: "12345678900",
  cliente_nome: "THIAGO HENRIQUE DE SOUZA",
  compradores: [
    { cpf: "123.456.789-00", nome: "THIAGO HENRIQUE DE SOUZA", participacao: 100, titular: true },
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
};

/** A venda do autônomo: CAD com corretor e SEM imobiliária, proposta sem nada de imobiliária. */
function vendaDoAutonomo(over: Linhas = {}) {
  return clienteFalso({
    apolo_contacts: [],
    apolo_entities: (f: Record<string, unknown>) =>
      f.id === AUTONOMO
        ? ENTIDADE_AUTONOMO
        : f.id === IMOBILIARIA
          ? ENTIDADE_IMOBILIARIA
          : [ENTIDADE_CLIENTE],
    apolo_esteira: [
      {
        corretor: "JOAO AUTONOMO",
        corretor_entity_id: AUTONOMO,
        enterprise_id: "39",
        entity_id: CLIENTE,
        ficha: null,
        imobiliaria: null,
        imobiliaria_entity_id: null,
      },
    ],
    apolo_relationships: [],
    apolo_source_links: [],
    hercules_empreendimentos: EMPREENDIMENTO,
    hercules_propostas: { ...PROPOSTA, ...over },
    hercules_unidades: UNIDADE,
  });
}

describe("o contrato da venda do corretor autônomo", () => {
  it("⚠️ `imobiliaria_nome` NÃO leva o nome da pessoa física", async () => {
    const g = (await dadosDaProposta("p1", vendaDoAutonomo()))!.dados.gerais;
    expect(g.imobiliaria_nome).not.toContain("JOAO");
    expect(g.imobiliaria_nome).not.toContain("AUTONOMO");
  });

  it("⚠️ a CHAVE `imobiliaria_nome` EXISTE e está VAZIA: chave ausente imprime `[imobiliaria_nome]`", async () => {
    const g = (await dadosDaProposta("p1", vendaDoAutonomo()))!.dados.gerais;
    // A distinção é o teste inteiro: `undefined` faz `valorDaVariavel` devolver `null` e o motor
    // escrever o colchete no papel assinado; `""` imprime nada, que é o que a venda tem a dizer.
    expect(Object.hasOwn(g, "imobiliaria_nome")).toBe(true);
    expect(g.imobiliaria_nome).toBe("");
  });

  it("`nome_vinculado` continua saindo com o nome do autônomo: a família neutra é a que as minutas usam", async () => {
    const g = (await dadosDaProposta("p1", vendaDoAutonomo()))!.dados.gerais;
    expect(g.nome_vinculado).toBe("JOAO AUTONOMO DA SILVA");
    expect(g.corretor_nome).toBe("JOAO AUTONOMO");
  });

  it("a venda COM imobiliária não muda: a razão social continua ganhando do nome da proposta", async () => {
    const comImobiliaria = clienteFalso({
      apolo_contacts: [],
      apolo_entities: (f: Record<string, unknown>) =>
        f.id === IMOBILIARIA ? ENTIDADE_IMOBILIARIA : [ENTIDADE_CLIENTE],
      apolo_esteira: [],
      apolo_relationships: [],
      apolo_source_links: [],
      hercules_empreendimentos: EMPREENDIMENTO,
      hercules_propostas: {
        ...PROPOSTA,
        imobiliaria_entity_id: IMOBILIARIA,
        imobiliaria_nome: "RR SOLUCOES",
      },
      hercules_unidades: UNIDADE,
    });
    const g = (await dadosDaProposta("p1", comImobiliaria))!.dados.gerais;
    expect(g.imobiliaria_nome).toBe("RR SOLUCOES LTDA");
    expect(g.nome_vinculado).toBe("RR SOLUCOES LTDA");
  });
});
