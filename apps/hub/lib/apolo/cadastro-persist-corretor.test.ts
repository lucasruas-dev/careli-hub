import { describe, expect, it, vi } from "vitest";

import { createApoloEntity } from "./cadastro-persist";

// O CADASTRO DO CORRETOR AUTÔNOMO NA CAMADA QUE GRAVA — e as duas travas que ele atravessa.
//
// Lucas (27/09/2026): *"Preciso cadastrar corretor autonomo... ele nao sera vinculado a uma
// imobiliaria, ele sera uma entidade"*.
//
// ⚠️ BLOQUEIO 1 — A TRAVA DE CAD DUPLICADA VIRAVA GLOBAL PARA ELE. O autônomo não tem
// empreendimento, e sem `enterpriseId` o dedup por documento cai no ramo conservador: qualquer CAD
// que a pessoa tenha em QUALQUER loteamento recusa o cadastro. Medido em 27/09/2026: dos 131
// corretores que já existem, 26 têm CAD na esteira — eles tomariam a recusa na primeira tentativa.
// O cadastro de corretor NÃO É UMA CAD (ele não entra na esteira, regra do Lucas de 05/08): CAD de
// comprador não pode recusá-lo. O que ele faz é APROVEITAR a ficha que já existe, uma por pessoa.
//
// ⚠️ E O DEDUP DE COMPRADOR NÃO AFROUXA NADA: os mesmos casos com papel `prospect` continuam
// recusados, inclusive o ramo global sem empreendimento (a trava dos "dois Pedro Alexandro").
//
// ⚠️ QUEM SOLTA AS DUAS TRAVAS É A PORTA, NUNCA O CORPO. O afrouxamento mora em
// `OpcoesDoCadastro.cadastroDeCorretorAutonomo` (terceiro argumento, escrito só pela rota do hub),
// e não em `input.role` — que é `payload.role`, o JSON de quem manda o pedido. Se o papel decidisse,
// o operador que tomasse "Este CPF já tem CAD cadastrada" trocaria `?tipo=prospect` por
// `?tipo=corretor` na URL e passaria, contornando a recusa comprada com os "dois Pedro Alexandro".
// O teste "o papel no CORPO não solta trava nenhuma" é o que fecha isso.
//
// ⚠️ BLOQUEIO 2 — A TRAVA DE E-MAIL ÚNICO BARRAVA O PRÓPRIO AUTÔNOMO. Ela perdoa a ficha que a CAD
// vai atualizar, uma só. Medido em 27/09/2026: 34 dos 131 corretores têm mais de uma ficha com o
// mesmo CPF (a cópia do Asana), e todos os 131 têm e-mail cadastrado — o e-mail do corretor na
// CÓPIA DELE MESMO barrava o corretor. Aqui as fichas do MESMO DOCUMENTO deixam de contar contra
// ele. Entre PESSOAS DIFERENTES a trava continua dura: no D4Sign o signatário É o e-mail.

const CPF = "529.982.247-25";
const FICHA = "ent-do-corretor";
const COPIA = "ent-copia-do-asana";

type Escrita = { opcoes?: unknown; operacao: string; tabela: string; valores: unknown };

function clienteFake(opcoes: {
  cads?: Array<{ empreendimento: null | string; enterprise_id: null | string; entity_id: string }>;
  codigoDaFicha?: null | string;
  contatos?: Array<Record<string, unknown>>;
  copiaDoDocumento?: string;
  // O `select("display_name, metadata")` do modo anexo falha: é o estado em que o jsonb da ficha
  // NÃO pode ser reescrito (não se mescla o que não se leu).
  erroNaLeituraDaFicha?: { code?: string; message: string };
  fichaExiste?: boolean;
  metadataDaFicha?: Record<string, unknown>;
}) {
  const escritas: Escrita[] = [];

  const client = {
    from(tabela: string) {
      let operacao = "select";
      let colunas = "";
      const builder: Record<string, unknown> = {};

      function resposta(): { data: unknown; error: unknown } {
        if (operacao === "insert" && tabela === "apolo_entities") {
          return { data: [{ id: "ent-nova" }], error: null };
        }
        if (operacao !== "select") return { data: null, error: null };
        if (tabela === "apolo_entity_identifiers") {
          if (!opcoes.fichaExiste) return { data: [], error: null };
          return { data: [{ entity_id: FICHA, identifier_type: "cpf" }], error: null };
        }
        if (tabela === "apolo_entities") {
          if (colunas === "display_name, metadata" && opcoes.erroNaLeituraDaFicha) {
            return { data: null, error: opcoes.erroNaLeituraDaFicha };
          }
          const fichas: Array<Record<string, unknown>> = opcoes.fichaExiste
            ? [
                {
                  broker_code: opcoes.codigoDaFicha ?? null,
                  display_name: "JOAO CORRETOR",
                  id: FICHA,
                  metadata: opcoes.metadataDaFicha ?? {},
                },
              ]
            : [];
          if (colunas === "id" && opcoes.copiaDoDocumento) {
            fichas.push({
              broker_code: null,
              display_name: "JOAO CORRETOR",
              id: opcoes.copiaDoDocumento,
              metadata: {},
            });
          }
          return { data: fichas, error: null };
        }
        if (tabela === "apolo_esteira") return { data: opcoes.cads ?? [], error: null };
        if (tabela === "apolo_contacts") return { data: opcoes.contatos ?? [], error: null };
        return { data: [], error: null };
      }

      for (const metodo of ["eq", "in", "is", "limit", "neq", "not", "order", "range", "ilike", "or"]) {
        builder[metodo] = () => builder;
      }
      builder.select = (selecao?: string) => {
        if (operacao === "select") colunas = String(selecao ?? "");
        return builder;
      };
      const registrar = (op: string, valores: unknown, extra?: unknown) => {
        operacao = op;
        escritas.push({ opcoes: extra, operacao: op, tabela, valores });
        return builder;
      };
      builder.insert = (valores: unknown) => registrar("insert", valores);
      builder.update = (valores: unknown) => registrar("update", valores);
      builder.upsert = (valores: unknown, extra?: unknown) => registrar("upsert", valores, extra);
      builder.maybeSingle = async () => {
        const r = resposta();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      };
      builder.single = builder.maybeSingle;
      builder.then = (ok: (valor: unknown) => unknown, falha: (e: unknown) => unknown) =>
        Promise.resolve(resposta()).then(ok, falha);

      return builder;
    },
  };

  return { client: client as never, escritas };
}

const CORRETOR = {
  dedupPorDocumento: true,
  identidade: { cpf: CPF, nome: "Joao Corretor" },
  perfil: { email: "joao@corretor.com", telefone: "(62) 98888-0001" },
  persona: "pf" as const,
  role: "corretor" as const,
};

// A PORTA DO HUB, em objeto: é isto que a rota interna escreve no terceiro argumento, e é a única
// coisa que solta as duas travas do autônomo. O código viaja como FUNÇÃO porque `nextval` não volta
// atrás: ele só pode ser consumido depois de todas as recusas (ver o teste do fim do arquivo).
function porta(codigo = "CA-0007") {
  const gerador = vi.fn(async () => ({ codigo, ok: true as const }));
  return { gerador, opcoes: { cadastroDeCorretorAutonomo: true, codigoDoCorretor: gerador } };
}

const CAD_NO_VALE = [
  { empreendimento: "VALE DO OURO", enterprise_id: "37", entity_id: FICHA },
];

describe("bloqueio 1: CAD existente não recusa o cadastro do corretor autônomo", () => {
  it("CPF com ficha E com CAD em outro empreendimento: o corretor entra na ficha que existe", async () => {
    const { client, escritas } = clienteFake({ cads: CAD_NO_VALE, fichaExiste: true });

    const r = await createApoloEntity(client, CORRETOR, porta().opcoes);

    expect(r.ok).toBe(true);
    expect(r).toMatchObject({ entityId: FICHA });
    // Nenhuma segunda ficha para o mesmo CPF: é uma ficha por pessoa.
    expect(escritas.filter((e) => e.tabela === "apolo_entities" && e.operacao === "insert")).toHaveLength(0);
    // O papel de corretor entra na ficha.
    const papel = escritas.find((e) => e.tabela === "apolo_entity_profiles");
    expect(papel?.valores).toEqual([
      { entity_id: FICHA, profile: "corretor", status: "active" },
    ]);
  });

  it("CPF sem ficha nenhuma: nasce a entidade PF com papel corretor e SEM imobiliária", async () => {
    const { client, escritas } = clienteFake({ fichaExiste: false });

    const r = await createApoloEntity(client, CORRETOR, porta().opcoes);

    expect(r.ok).toBe(true);
    const ficha = escritas.find((e) => e.tabela === "apolo_entities" && e.operacao === "insert");
    expect(ficha?.valores).toMatchObject({
      entity_kind: "pf",
      metadata: { bornRole: "corretor", imobiliariaId: null },
    });
    // Nenhum relacionamento de imobiliária: ele não é vinculado a nenhuma.
    const vinculos = escritas
      .filter((e) => e.tabela === "apolo_relationships")
      .flatMap((e) => e.valores as Array<Record<string, unknown>>);
    expect(vinculos.filter((v) => v.relationship_type === "imobiliaria")).toEqual([]);
  });

  it("o COMPRADOR continua barrado: o mesmo CPF como prospect no 37 é recusado", async () => {
    const { client } = clienteFake({ cads: CAD_NO_VALE, fichaExiste: true });

    const r = await createApoloEntity(
      client,
      { ...CORRETOR, enterpriseId: "37", role: "prospect" },
      porta().opcoes,
    );

    expect(r).toMatchObject({ motivo: "cad-no-empreendimento", ok: false });
  });

  it("o ramo GLOBAL do comprador continua valendo: prospect sem empreendimento é recusado", async () => {
    const { client } = clienteFake({ cads: CAD_NO_VALE, fichaExiste: true });

    const r = await createApoloEntity(client, { ...CORRETOR, role: "prospect" }, porta().opcoes);

    expect(r).toMatchObject({ motivo: "cad-no-empreendimento", ok: false });
  });

  // ⚠️ A DECISÃO É DA PORTA, E O `role` DO CORPO NÃO A SUBSTITUI (27/09/2026). `input.role` é
  // `payload.role`: o JSON do pedido. Sem `cadastroDeCorretorAutonomo` na porta, o papel `corretor`
  // não solta nada — senão o operador que tomasse a recusa trocaria `?tipo=prospect` por
  // `?tipo=corretor` na URL, reenviaria e contornaria a trava dos "dois Pedro Alexandro".
  it("o papel no CORPO não solta trava nenhuma: sem a porta, a CAD existente continua recusando", async () => {
    const { client } = clienteFake({ cads: CAD_NO_VALE, fichaExiste: true });

    const r = await createApoloEntity(client, CORRETOR);

    expect(r).toMatchObject({ motivo: "cad-no-empreendimento", ok: false });
  });

  // ⚠️ E A PORTA SOZINHA TAMBÉM NÃO SOLTA: porta e papel precisam concordar. Se a opção valesse por
  // si, uma rota que a ligasse por engano afrouxaria o dedup de TODO comprador que passa por ela.
  it("a porta ligada com papel de comprador não solta nada: prospect continua recusado", async () => {
    const { client } = clienteFake({ cads: CAD_NO_VALE, fichaExiste: true });

    const r = await createApoloEntity(client, { ...CORRETOR, role: "prospect" }, porta().opcoes);

    expect(r).toMatchObject({ motivo: "cad-no-empreendimento", ok: false });
  });
});

describe("bloqueio 2: a trava de e-mail único e o corretor autônomo", () => {
  it("o e-mail dele na CÓPIA da própria ficha (mesmo CPF) não o barra", async () => {
    const { client } = clienteFake({
      contatos: [
        {
          contact_type: "email",
          entity_id: COPIA,
          normalized_value: "joao@corretor.com",
          status: "pending",
          value: "joao@corretor.com",
        },
      ],
      copiaDoDocumento: COPIA,
      fichaExiste: true,
    });

    const r = await createApoloEntity(client, CORRETOR, porta().opcoes);

    expect(r.ok).toBe(true);
  });

  it("e-mail que é de OUTRA PESSOA continua recusando (no D4Sign o signatário é o e-mail)", async () => {
    const { client } = clienteFake({
      contatos: [
        {
          contact_type: "email",
          entity_id: "ent-de-outra-pessoa",
          normalized_value: "joao@corretor.com",
          status: "pending",
          value: "joao@corretor.com",
        },
      ],
      fichaExiste: false,
    });

    const { gerador, opcoes } = porta();
    const r = await createApoloEntity(client, CORRETOR, opcoes);

    expect(r).toMatchObject({ motivo: "email-repetido", ok: false });
    // ⚠️ E A RECUSA NÃO QUEIMA NÚMERO (27/09/2026). `nextval` não volta atrás: pedido no começo da
    // rota, cada erro de e-mail do operador gastava um código e a numeração que o Lucas pediu
    // (*"CA-0001, CA-0002"*) nascia salteada, sem nada que explicasse os buracos. O gerador só é
    // chamado depois de TODAS as travas.
    expect(gerador).not.toHaveBeenCalled();
  });
});

describe("o código do autônomo é gravado em COLUNA, e a porta é que o traz", () => {
  it("ficha nova: o código entra na mesma gravação da entidade", async () => {
    const { client, escritas } = clienteFake({ fichaExiste: false });

    await createApoloEntity(client, CORRETOR, porta().opcoes);

    const ficha = escritas.find((e) => e.tabela === "apolo_entities" && e.operacao === "insert");
    expect(ficha?.valores).toMatchObject({ broker_code: "CA-0007" });
  });

  it("um código no CORPO do pedido é ignorado: só a porta grava código", async () => {
    const { client, escritas } = clienteFake({ fichaExiste: false });

    await createApoloEntity(
      client,
      { ...CORRETOR, broker_code: "CA-9999" } as never,
      porta().opcoes,
    );

    const ficha = escritas.find((e) => e.tabela === "apolo_entities" && e.operacao === "insert");
    expect(JSON.stringify(ficha?.valores)).not.toContain("CA-9999");
  });

  it("a ficha que JÁ tem código não recebe outro (o código dela não muda)", async () => {
    const { client, escritas } = clienteFake({ codigoDaFicha: "CA-0002", fichaExiste: true });

    await createApoloEntity(client, CORRETOR, porta().opcoes);

    const gravacoes = escritas.filter(
      (e) => e.tabela === "apolo_entities" && e.operacao === "update",
    );
    expect(JSON.stringify(gravacoes)).not.toContain("CA-0007");
  });

  it("ficha existente SEM código: o código novo entra nela", async () => {
    const { client, escritas } = clienteFake({ codigoDaFicha: null, fichaExiste: true });

    await createApoloEntity(client, CORRETOR, porta().opcoes);

    const gravacoes = escritas.filter(
      (e) => e.tabela === "apolo_entities" && e.operacao === "update",
    );
    expect(JSON.stringify(gravacoes)).toContain("CA-0007");
  });

  it("prospect nunca recebe código, nem quando a porta manda um por engano", async () => {
    const { client, escritas } = clienteFake({ fichaExiste: false });
    const { gerador, opcoes } = porta();

    await createApoloEntity(client, { ...CORRETOR, enterpriseId: "37", role: "prospect" }, opcoes);

    expect(gerador).not.toHaveBeenCalled();
    expect(JSON.stringify(escritas)).not.toContain("CA-0007");
  });

  // ⚠️ SEM SEQUÊNCIA NO BANCO, NADA É GRAVADO. Enquanto a migration 0193 não rodar a função não
  // existe, e o único caminho que produziria código repetido seria o app inventar um número.
  it("a sequência do banco não respondeu: recusa e NENHUMA gravação", async () => {
    const { client, escritas } = clienteFake({ fichaExiste: false });

    const r = await createApoloEntity(client, CORRETOR, {
      cadastroDeCorretorAutonomo: true,
      codigoDoCorretor: async () => ({ mensagem: "sem sequencia neste ambiente", ok: false }),
    });

    expect(r).toMatchObject({
      error: "sem sequencia neste ambiente",
      motivo: "verificacao-indisponivel",
      ok: false,
    });
    expect(escritas).toEqual([]);
  });
});

// ⚠️ O CADASTRO DO AUTÔNOMO NÃO MEXE NA CAD QUE A FICHA JÁ TEM (27/09/2026).
//
// Tirar o corretor da recusa de CAD duplicada fez o cadastro dele ANEXAR justamente na ficha que tem
// a CAD viva (`anexarEm` escolhe a ficha COM esteira, de propósito). Medido em 27/09/2026: 26 dos 131
// corretores têm linha em `apolo_esteira`. Com a precedência de sempre (`{ ...cadastroAtual,
// ...cadastro }`), o que fosse digitado no wizard do corretor venceria estado civil, regime de bens,
// profissão, renda, patrimônio, escolaridade, endereço e cônjuge de um COMPRADOR que o analista está
// validando no Board — e `origemCadPublica` trocaria de valor, sem versão anterior em lugar nenhum.
// Antes esse caso era RECUSADO, e é por isso que a recusa existia.
describe("o cadastro de corretor sobre uma ficha que tem CAD em validação", () => {
  const METADATA_DA_CAD = {
    autenticacao: "CAD-2026-AAAA1111",
    bornRole: "prospect",
    c2xSynced: true,
    c2xUserId: 90210,
    cadastro: { estadoCivilId: "2", profissaoId: "77", rendaId: "5" },
    cadastroEditado: { em: "2026-09-10", por: "analista" },
    imobiliariaId: "imob-1",
    origemCadPublica: "cad-publica",
    source: "c2x",
  };

  function metadataGravado(escritas: Escrita[]): Record<string, unknown> {
    const update = escritas.find((e) => e.tabela === "apolo_entities" && e.operacao === "update");
    return (update?.valores as { metadata: Record<string, unknown> }).metadata;
  }

  it("o que a ficha já tem VENCE o que foi digitado no wizard do corretor", async () => {
    const { client, escritas } = clienteFake({
      cads: CAD_NO_VALE,
      fichaExiste: true,
      metadataDaFicha: METADATA_DA_CAD,
    });

    const r = await createApoloEntity(
      client,
      { ...CORRETOR, perfil: { ...CORRETOR.perfil, estadoCivilId: "1", rendaId: "9" } },
      porta().opcoes,
    );

    expect(r.ok).toBe(true);
    expect(metadataGravado(escritas).cadastro).toMatchObject({
      estadoCivilId: "2",
      profissaoId: "77",
      rendaId: "5",
    });
  });

  it("`origemCadPublica` não é tocado: quem o escreveu foi a CAD, não este cadastro", async () => {
    const { client, escritas } = clienteFake({
      cads: CAD_NO_VALE,
      fichaExiste: true,
      metadataDaFicha: METADATA_DA_CAD,
    });

    await createApoloEntity(client, { ...CORRETOR, origem: "cadastro-formulario" }, porta().opcoes);

    expect(metadataGravado(escritas).origemCadPublica).toBe("cad-publica");
  });

  it("o elo com o C2X e a correção humana continuam na ficha", async () => {
    const { client, escritas } = clienteFake({
      cads: CAD_NO_VALE,
      fichaExiste: true,
      metadataDaFicha: METADATA_DA_CAD,
    });

    await createApoloEntity(client, CORRETOR, porta().opcoes);

    expect(metadataGravado(escritas)).toMatchObject({
      autenticacao: "CAD-2026-AAAA1111",
      c2xSynced: true,
      c2xUserId: 90210,
      cadastroEditado: { em: "2026-09-10", por: "analista" },
      source: "c2x",
    });
  });

  // ⚠️ E A CAD DE COMPRADOR MANTÉM A PRECEDÊNCIA DELA: no modo anexo do prospect o cadastro novo é o
  // mais completo e entra por cima, como sempre. A inversão vale SÓ para o corretor.
  it("no anexo do prospect o cadastro novo continua vencendo (a regra não virou geral)", async () => {
    const { client, escritas } = clienteFake({
      fichaExiste: true,
      metadataDaFicha: METADATA_DA_CAD,
    });

    await createApoloEntity(client, {
      ...CORRETOR,
      enterpriseId: "37",
      perfil: { ...CORRETOR.perfil, estadoCivilId: "1" },
      role: "prospect",
    });

    expect(metadataGravado(escritas).cadastro).toMatchObject({ estadoCivilId: "1" });
  });
});

// ⚠️ LER-ANTES-DE-GRAVAR QUE ENGOLE ERRO DE LEITURA NÃO PRESERVA NADA. O update do PostgREST
// substitui o jsonb INTEIRO: com a leitura falhando em silêncio, `metaAtual` virava `{}` e o
// `metadata` da ficha era reescrito do zero — iam embora `source`, `c2xSynced`, `c2xUserId`, o código
// de autenticação da CAD que já circulou, `imobiliariaId`, `bornRole` e `cadastroEditado`. Com
// resposta de SUCESSO, e nada na tela. E o modo anexo é o caminho COMUM: 3.920 CPFs vivem na base
// vindos do sync do C2X sem CAD. "Não sei o que a ficha tem" é tratado como "não grave", igual ao
// dedup.
describe("o modo anexo não grava o que não conseguiu ler", () => {
  it("leitura da ficha falhou: recusa com `verificacao-indisponivel` e nada é gravado", async () => {
    const { client, escritas } = clienteFake({
      cads: CAD_NO_VALE,
      erroNaLeituraDaFicha: {
        code: "57014",
        message: "canceling statement due to statement timeout",
      },
      fichaExiste: true,
      metadataDaFicha: { c2xUserId: 90210, source: "c2x" },
    });

    const r = await createApoloEntity(client, CORRETOR, porta().opcoes);

    expect(r).toMatchObject({ motivo: "verificacao-indisponivel", ok: false });
    expect(escritas.filter((e) => e.tabela === "apolo_entities")).toEqual([]);
  });

  it("vale também para a CAD de comprador, que é quem mais passa pelo anexo", async () => {
    const { client, escritas } = clienteFake({
      erroNaLeituraDaFicha: { code: "42703", message: 'column "algo" does not exist' },
      fichaExiste: true,
      metadataDaFicha: { c2xUserId: 90210, source: "c2x" },
    });

    const r = await createApoloEntity(client, {
      ...CORRETOR,
      enterpriseId: "37",
      role: "prospect",
    });

    expect(r).toMatchObject({ motivo: "verificacao-indisponivel", ok: false });
    expect(escritas.filter((e) => e.tabela === "apolo_entities")).toEqual([]);
  });
});
