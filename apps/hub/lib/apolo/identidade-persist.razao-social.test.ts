import { describe, expect, it } from "vitest";

import { atualizarIdentidade } from "./identidade-persist";
import { hashIdentifier } from "./server";

// A RAZÃO SOCIAL DE PJ É CORRIGIDA NO PANTEON, INCLUSIVE NA FICHA QUE VEIO DO C2X.
//
// Lucas, 28/09/2026, com o print da tela de Validação: *"não conseguimos editar a razão social de
// PJ"*, *"TUDO PRECISA MORAR DENTRO DO PANTEON, não tem mais cadastro vindo do c2x"*, *"TODOS eu
// poderia alterar, atualizar"*.
//
// A recusa que existia aqui ("esta ficha é espelho do C2X: a correção tem que ser feita no legado,
// senão o sync desfaz em até 6 horas") vivia de uma premissa que MORREU em 04/08/2026, quando as 7
// tabelas de identidade do sync passaram a ON CONFLICT DO NOTHING (`lib/apolo/server.ts:3917-3949`:
// `upsertApoloRows(..., "apolo_entities", entityRows, { ignorarDuplicados: true, onConflict: "id" })`).
// Quem já existe fica INTOCADO — é o que `lib/apolo/sync-c2x-identidade.test.ts` trava.
//
// Medido em produção em 28/09/2026 (só SELECT): das 610 fichas PJ, 548 têm vínculo em
// `apolo_source_links` com `source_system = 'c2x'`, e 433 das 483 imobiliárias também. Os 43 eventos
// `edit_identity` feitos em ficha espelho entre 20/07 e 01/08/2026 continuam gravados em
// `apolo_entities` até hoje, o que por si só prova que o resync não desfaz mais a ficha.
//
// O que estes testes travam:
//   1. razão social de ficha COM vínculo do c2x é aceita e GRAVA (display_name e legal_name);
//   2. razão social de ficha SEM vínculo também;
//   3. o NOME FANTASIA não é apagado quando a correção não o manda (a tela manda um DIFF, então
//      quem corrige só a razão social não manda `nomeFantasia` — e a ficha da igreja tem
//      "CBA NOVO TEMPLO" em `trade_name`, justamente o dado certo dela);
//   4. a colisão de documento continua sendo 409: ela NÃO nasce da premissa morta.

type Linha = Record<string, unknown>;

const CNPJ_IGREJA = "55.086.726/0001-80";
const ID_IGREJA = "bda7977b-6f84-4946-a71f-4170821731dd";
const HASH_IGREJA = hashIdentifier("cnpj", "55086726000180");

// Banco em memória com só o que `atualizarIdentidade` encadeia: select/eq/neq/in/limit/maybeSingle,
// update/eq (+ select), delete/eq/in e insert. Cada builder é "thenable", então `await` no fim de
// qualquer cadeia executa a operação — é assim que o supabase-js se comporta.
function bancoFake(inicial: Record<string, Linha[]>) {
  const tabelas: Record<string, Linha[]> = {};
  // Tabelas que recusam INSERT, para provar o caminho "gravou a ficha e falhou depois".
  const recusarInsert = new Set<string>();
  for (const [tabela, linhas] of Object.entries(inicial)) {
    tabelas[tabela] = linhas.map((linha) => ({ ...linha }));
  }

  function consulta(tabela: string) {
    const filtros: ((linha: Linha) => boolean)[] = [];
    let modo: "delete" | "insert" | "select" | "update" = "select";
    let valores: Linha = {};
    let devolverLinhas = false;

    const linhas = () => (tabelas[tabela] ??= []);
    const casam = () => linhas().filter((linha) => filtros.every((teste) => teste(linha)));

    const executar = (): { data: Linha[] | null; error: null | { message: string } } => {
      if (modo === "insert") {
        if (recusarInsert.has(tabela)) {
          return { data: null, error: { message: 'null value in column "status"' } };
        }
        linhas().push({ ...valores });
        return { data: null, error: null };
      }
      if (modo === "update") {
        const alvos = casam();
        for (const alvo of alvos) Object.assign(alvo, valores);
        return { data: devolverLinhas ? alvos : null, error: null };
      }
      if (modo === "delete") {
        const alvos = new Set(casam());
        tabelas[tabela] = linhas().filter((linha) => !alvos.has(linha));
        return { data: null, error: null };
      }
      // ⚠️ CÓPIA, NÃO A LINHA. O supabase-js devolve JSON novo a cada leitura; devolver a referência
      // deixava passar código que lê a linha DEPOIS de atualizá-la e vê o valor novo no lugar do
      // antigo (foi assim que o passo 7 "removia" o nome certo do índice em vez do errado).
      return { data: casam().map((linha) => ({ ...linha })), error: null };
    };

    const builder = {
      delete() {
        modo = "delete";
        return builder;
      },
      eq(coluna: string, valor: unknown) {
        filtros.push((linha) => linha[coluna] === valor);
        return builder;
      },
      in(coluna: string, lista: unknown[]) {
        filtros.push((linha) => lista.includes(linha[coluna]));
        return builder;
      },
      insert(linha: Linha) {
        modo = "insert";
        valores = linha;
        return builder;
      },
      limit() {
        return builder;
      },
      maybeSingle() {
        const { data, error } = executar();
        return Promise.resolve({ data: data?.[0] ?? null, error });
      },
      neq(coluna: string, valor: unknown) {
        filtros.push((linha) => linha[coluna] !== valor);
        return builder;
      },
      select() {
        if (modo !== "select") devolverLinhas = true;
        return builder;
      },
      single() {
        return builder.maybeSingle();
      },
      then(
        resolve: (valor: { data: Linha[] | null; error: null | { message: string } }) => unknown,
        rejeitar?: (erro: unknown) => unknown,
      ) {
        return Promise.resolve(executar()).then(resolve, rejeitar);
      },
      update(linha: Linha) {
        modo = "update";
        valores = linha;
        return builder;
      },
    };

    return builder;
  }

  return { client: { from: consulta } as never, recusarInsert, tabelas };
}

/** A ficha da igreja do print: PJ, nome colado com o rótulo do documento pelo OCR. */
function igreja(over: Linha = {}): Linha {
  return {
    display_name: "DATA DE CONSTITUIÇÃO\nIGREJA EVANGELICA CBA TEMPLO NOVO 10/05/2024",
    document_hash: null,
    document_kind: "cnpj",
    document_masked: CNPJ_IGREJA,
    entity_kind: "pj",
    id: ID_IGREJA,
    legal_name: "DATA DE CONSTITUIÇÃO\nIGREJA EVANGELICA CBA TEMPLO NOVO 10/05/2024",
    trade_name: "CBA NOVO TEMPLO",
    ...over,
  };
}

function cenario(opcoes: { espelho: boolean; outraFicha?: Linha }) {
  return bancoFake({
    apolo_audit_events: [],
    apolo_entities: [igreja(), ...(opcoes.outraFicha ? [opcoes.outraFicha] : [])],
    apolo_entity_identifiers: [],
    apolo_esteira: [{ entity_id: ID_IGREJA, motivo: null }],
    apolo_search_entries: [
      {
        display_name: igreja().display_name,
        entity_id: ID_IGREJA,
        normalized_text: "data de constituicao igreja evangelica cba templo novo",
        status: "active",
      },
    ],
    apolo_source_links: opcoes.espelho
      ? [
          {
            entity_id: ID_IGREJA,
            source_id: "4957",
            source_system: "c2x",
            source_table: "users",
          },
        ]
      : [],
  });
}

const CORRIGIR_SO_A_RAZAO_SOCIAL = {
  autorUserId: null,
  documento: CNPJ_IGREJA,
  entityId: ID_IGREJA,
  motivo: "Correcao na validacao da CAD",
  nome: "IGREJA EVANGELICA CBA TEMPLO NOVO",
  tipo: "pj" as const,
};

describe("atualizarIdentidade — razão social de PJ", () => {
  it("ficha COM vínculo do c2x: a razão social grava (a trava do espelho morreu em 04/08/2026)", async () => {
    const banco = cenario({ espelho: true });

    const resultado = await atualizarIdentidade({ ...CORRIGIR_SO_A_RAZAO_SOCIAL, client: banco.client });

    expect(resultado).toEqual({ ok: true });

    const ficha = banco.tabelas.apolo_entities?.[0];
    expect(ficha?.display_name).toBe("IGREJA EVANGELICA CBA TEMPLO NOVO");
    expect(ficha?.legal_name).toBe("IGREJA EVANGELICA CBA TEMPLO NOVO");
    // O vínculo com o legado continua lá: o sync segue criando ficha nova, só não sobrescreve.
    expect(banco.tabelas.apolo_source_links).toHaveLength(1);
    // Auditada como qualquer correção de identidade.
    expect(banco.tabelas.apolo_audit_events?.[0]?.action).toBe("edit_identity");
  });

  it("ficha SEM vínculo do c2x: continua gravando (a do print é esta)", async () => {
    const banco = cenario({ espelho: false });

    const resultado = await atualizarIdentidade({ ...CORRIGIR_SO_A_RAZAO_SOCIAL, client: banco.client });

    expect(resultado).toEqual({ ok: true });
    expect(banco.tabelas.apolo_entities?.[0]?.legal_name).toBe("IGREJA EVANGELICA CBA TEMPLO NOVO");
  });

  it("⚠️ NÃO apaga o nome fantasia quando a correção não o manda", async () => {
    const banco = cenario({ espelho: false });

    const resultado = await atualizarIdentidade({ ...CORRIGIR_SO_A_RAZAO_SOCIAL, client: banco.client });

    expect(resultado).toEqual({ ok: true });
    expect(banco.tabelas.apolo_entities?.[0]?.legal_name).toBe("IGREJA EVANGELICA CBA TEMPLO NOVO");
    expect(banco.tabelas.apolo_entities?.[0]?.trade_name).toBe("CBA NOVO TEMPLO");
  });

  it("nome fantasia mandado é gravado; mandado vazio limpa", async () => {
    const banco = cenario({ espelho: true });

    await atualizarIdentidade({
      ...CORRIGIR_SO_A_RAZAO_SOCIAL,
      client: banco.client,
      nomeFantasia: "CBA TEMPLO NOVO",
    });
    expect(banco.tabelas.apolo_entities?.[0]?.trade_name).toBe("CBA TEMPLO NOVO");

    await atualizarIdentidade({
      ...CORRIGIR_SO_A_RAZAO_SOCIAL,
      client: banco.client,
      nomeFantasia: "",
    });
    expect(banco.tabelas.apolo_entities?.[0]?.trade_name).toBeNull();
  });

  it("PJ que vira PF perde o nome fantasia, mesmo sem o campo vir", async () => {
    const banco = cenario({ espelho: true });

    const resultado = await atualizarIdentidade({
      ...CORRIGIR_SO_A_RAZAO_SOCIAL,
      client: banco.client,
      documento: "123.456.789-09",
      nome: "JOSE DA SILVA",
      tipo: "pf",
    });

    expect(resultado).toEqual({ ok: true });
    expect(banco.tabelas.apolo_entities?.[0]?.trade_name).toBeNull();
    expect(banco.tabelas.apolo_entities?.[0]?.legal_name).toBeNull();
  });

  it("⚠️ a COLISÃO de documento continua recusando quando o documento MUDA", async () => {
    const OUTRO_CNPJ = "12.345.678/0001-95";
    const banco = cenario({
      espelho: true,
      outraFicha: {
        display_name: "OUTRA IGREJA LTDA",
        document_hash: hashIdentifier("cnpj", "12345678000195"),
        entity_kind: "pj",
        id: "11111111-1111-1111-1111-111111111111",
      },
    });

    const resultado = await atualizarIdentidade({
      ...CORRIGIR_SO_A_RAZAO_SOCIAL,
      client: banco.client,
      documento: OUTRO_CNPJ,
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.ok === false && resultado.motivo).toBe("colisao");
    // E não gravou nada pela metade.
    expect(banco.tabelas.apolo_entities?.[0]?.display_name).toBe(igreja().display_name);
  });

  it("⚠️ documento que JÁ estava repetido não barra a correção do NOME: o operador não o criou", async () => {
    // O CNPJ desta ficha já aparece em outra (a migration 0026 dropou o índice único, então o banco
    // permite). Revalidar o documento que não mudou transformava a correção do nome em recusa por
    // dado antigo de terceiro, e o campo do CNPJ é cinza de propósito: não havia saída pela tela.
    const banco = cenario({
      espelho: true,
      outraFicha: {
        display_name: "OUTRA IGREJA LTDA",
        document_hash: HASH_IGREJA,
        entity_kind: "pj",
        id: "11111111-1111-1111-1111-111111111111",
      },
    });

    const resultado = await atualizarIdentidade({ ...CORRIGIR_SO_A_RAZAO_SOCIAL, client: banco.client });

    expect(resultado).toEqual({ ok: true });
    expect(banco.tabelas.apolo_entities?.[0]?.display_name).toBe("IGREJA EVANGELICA CBA TEMPLO NOVO");
  });
});

// ⚠️ A RAZÃO SOCIAL GRAVA TAMBÉM NA PJ CUJO DOCUMENTO GRAVADO NÃO PRESTA.
//
// A tela manda `documento` só quando o operador mexeu nele, e a rota não revalida o que não mudou. Sem
// isso, a razão social continuava presa justamente na população do print: quando o C2X não tem
// `cpf_cnpj` com 11 ou 14 dígitos, o sync grava a FRASE "Documento em revisao" em `document_masked`
// (`lib/apolo/server.ts:5260-5271`) e é essa mesma frase que põe a ficha em `status = "review"`
// (:4558), isto é, na coluna Validação. O CNPJ é cinza de propósito (trocar o CNPJ é mudar QUEM A
// EMPRESA É), então o erro falava de um campo sem saída pela tela.
describe("atualizarIdentidade — PJ sem CNPJ válido gravado", () => {
  const SEM_DOCUMENTO = {
    autorUserId: null,
    entityId: ID_IGREJA,
    motivo: "Correcao na validacao da CAD",
    nome: "IGREJA EVANGELICA CBA TEMPLO NOVO",
    tipo: "pj" as const,
  };

  it('"Documento em revisao" no lugar do CNPJ: a razão social grava', async () => {
    const banco = bancoFake({
      apolo_audit_events: [],
      apolo_entities: [igreja({ document_kind: null, document_masked: "Documento em revisao" })],
      apolo_entity_identifiers: [],
      apolo_esteira: [],
      apolo_search_entries: [],
      apolo_source_links: [],
    });

    // A tela manda a frase de volta quando o operador não mexe no campo: ela não tem dígito, então
    // não é correção de documento.
    const resultado = await atualizarIdentidade({
      ...SEM_DOCUMENTO,
      client: banco.client,
      documento: "Documento em revisao",
    });

    expect(resultado).toEqual({ ok: true });
    expect(banco.tabelas.apolo_entities?.[0]?.legal_name).toBe("IGREJA EVANGELICA CBA TEMPLO NOVO");
    // E o documento fica como estava: não virou hash de string vazia.
    expect(banco.tabelas.apolo_entities?.[0]?.document_masked).toBe("Documento em revisao");
    expect(banco.tabelas.apolo_entities?.[0]?.document_hash).toBeNull();
  });

  it("sem `documento` no corpo (a ficha nem tem `document_masked`): a razão social grava", async () => {
    const banco = bancoFake({
      apolo_audit_events: [],
      apolo_entities: [igreja({ document_kind: null, document_masked: null })],
      apolo_entity_identifiers: [],
      apolo_esteira: [],
      apolo_search_entries: [],
      apolo_source_links: [],
    });

    const resultado = await atualizarIdentidade({ ...SEM_DOCUMENTO, client: banco.client });

    expect(resultado).toEqual({ ok: true });
    expect(banco.tabelas.apolo_entities?.[0]?.legal_name).toBe("IGREJA EVANGELICA CBA TEMPLO NOVO");
  });

  it("PJ com CPF gravado (o caso JFL): a razão social grava, e o CPF fica onde está", async () => {
    const banco = bancoFake({
      apolo_audit_events: [],
      apolo_entities: [igreja({ document_kind: "cpf", document_masked: "123.456.789-09" })],
      apolo_entity_identifiers: [
        {
          entity_id: ID_IGREJA,
          identifier_type: "cpf",
          is_primary: true,
          source_system: "c2x",
          value_hash: hashIdentifier("cpf", "12345678909"),
        },
      ],
      apolo_esteira: [],
      apolo_search_entries: [],
      apolo_source_links: [],
    });

    const resultado = await atualizarIdentidade({
      ...SEM_DOCUMENTO,
      client: banco.client,
      documento: "123.456.789-09",
    });

    expect(resultado).toEqual({ ok: true });
    expect(banco.tabelas.apolo_entities?.[0]?.legal_name).toBe("IGREJA EVANGELICA CBA TEMPLO NOVO");
    expect(banco.tabelas.apolo_entity_identifiers).toHaveLength(1);
  });

  it("⚠️ TROCAR PF↔PJ continua exigindo coerência: PJ com CPF gravado é recusado", async () => {
    const banco = bancoFake({
      apolo_audit_events: [],
      apolo_entities: [
        igreja({
          document_kind: "cpf",
          document_masked: "123.456.789-09",
          entity_kind: "pf",
        }),
      ],
      apolo_entity_identifiers: [],
      apolo_esteira: [],
      apolo_search_entries: [],
      apolo_source_links: [],
    });

    const resultado = await atualizarIdentidade({
      ...SEM_DOCUMENTO,
      client: banco.client,
      documento: "123.456.789-09",
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.ok === false && resultado.erro).toBe("Pessoa juridica exige CNPJ.");
  });

  it("documento NOVO e inválido continua sendo recusado", async () => {
    const banco = cenario({ espelho: true });

    const resultado = await atualizarIdentidade({
      ...CORRIGIR_SO_A_RAZAO_SOCIAL,
      client: banco.client,
      documento: "11.111.111/1111-11",
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.ok === false && resultado.motivo).toBe("invalido");
  });
});

// ⚠️ O QUE A CORREÇÃO DE NOME NÃO PODE ENCOSTAR.
//
// Duas escritas do passo 6 e do passo 7 eram o que o resync desfazia (ver `lib/apolo/server.ts`,
// `lerFichasGravadas`, e `lib/apolo/sync-c2x-identidade.test.ts`). A correção do NOME não precisa de
// nenhuma das duas, e mexer nelas à toa era o que abria a porta.
describe("atualizarIdentidade — a correção de nome não mexe no documento nem apaga a busca", () => {
  it("não apaga nem reinsere o identificador quando o documento não mudou", async () => {
    const identificadorDoLegado = {
      entity_id: ID_IGREJA,
      identifier_type: "cnpj",
      is_primary: true,
      source_system: "c2x",
      value_hash: HASH_IGREJA,
    };
    const banco = bancoFake({
      apolo_audit_events: [],
      apolo_entities: [igreja()],
      apolo_entity_identifiers: [identificadorDoLegado],
      apolo_esteira: [],
      apolo_search_entries: [],
      apolo_source_links: [],
    });

    await atualizarIdentidade({ ...CORRIGIR_SO_A_RAZAO_SOCIAL, client: banco.client });

    // A MESMA linha, do jeito que estava: nada apagado (o que o resync recriaria) e nada duplicado.
    expect(banco.tabelas.apolo_entity_identifiers).toEqual([identificadorDoLegado]);
  });

  it("⚠️ o índice de busca NÃO perde os termos de carteira: o nome novo é costurado no texto", async () => {
    const banco = bancoFake({
      apolo_audit_events: [],
      apolo_entities: [igreja()],
      apolo_entity_identifiers: [],
      apolo_esteira: [],
      apolo_search_entries: [
        {
          display_name: igreja().display_name,
          entity_id: ID_IGREJA,
          normalized_text:
            "data de constituicao igreja evangelica cba templo novo 10/05/2024 cba novo templo " +
            "55.086.726/0001-80 lagoa bonita q10 l07 lb-q10-l07 sol-9931 comprador adimplente " +
            "contato@cbanovotemplo.com.br",
          status: "active",
        },
      ],
      apolo_source_links: [],
    });

    await atualizarIdentidade({ ...CORRIGIR_SO_A_RAZAO_SOCIAL, client: banco.client });

    const texto = String(banco.tabelas.apolo_search_entries?.[0]?.normalized_text ?? "");

    // O nome novo entrou e o velho saiu.
    expect(texto).toContain("igreja evangelica cba templo novo");
    expect(texto).not.toContain("data de constituicao");
    // E a CARTEIRA continua lá: era ela que sumia quando o texto era montado do zero, e com ela a
    // imobiliária deixava de ser achada por empreendimento e por unidade até a rodada seguinte.
    expect(texto).toContain("lagoa bonita");
    expect(texto).toContain("lb-q10-l07");
    expect(texto).toContain("sol-9931");
    expect(texto).toContain("comprador adimplente");
    expect(texto).toContain("contato@cbanovotemplo.com.br");
    // O nome fantasia da ficha segue indexado.
    expect(texto).toContain("cba novo templo");
  });

  it("falha DEPOIS da ficha gravada volta `motivo: parcial`, não `invalido`", async () => {
    const banco = bancoFake({
      apolo_audit_events: [],
      apolo_entities: [igreja()],
      apolo_entity_identifiers: [],
      apolo_esteira: [],
      apolo_search_entries: [],
      apolo_source_links: [],
    });

    // O índice recusa o INSERT de fallback (é o que aconteceu em 21/jul: `status` NOT NULL).
    banco.recusarInsert.add("apolo_search_entries");

    const resultado = await atualizarIdentidade({ ...CORRIGIR_SO_A_RAZAO_SOCIAL, client: banco.client });

    expect(resultado.ok).toBe(false);
    // A ficha JÁ FOI GRAVADA: dizer "nada foi salvo" seria mentira.
    expect(resultado.ok === false && resultado.motivo).toBe("parcial");
    expect(banco.tabelas.apolo_entities?.[0]?.display_name).toBe("IGREJA EVANGELICA CBA TEMPLO NOVO");
  });
});
