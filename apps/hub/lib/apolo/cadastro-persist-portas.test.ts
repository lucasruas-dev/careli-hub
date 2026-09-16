import { describe, expect, it } from "vitest";

import {
  createApoloEntity,
  fichasDoDocumento,
  linhasQueFaltamNaFicha,
  metadataAcrescentado,
} from "./cadastro-persist";

// O QUE A PORTA DECIDE NO CADASTRO, E O CORPO NÃO — revisão da onda 3 e decisão do Lucas (16/09/2026).
//
// O que está travado aqui:
//   1. A AUTORIA NÃO VEM DO INPUT. As rotas públicas espalham o CORPO em `createApoloEntity`; um
//      `autor` forjado no JSON não pode virar `metadata.cadastradoPor`. Só o terceiro argumento
//      (que a porta monta) grava autoria.
//   2. `fichaExistente: "acrescentar"` (o portal do incorporador) APROVEITA a ficha que já existe:
//      a CAD de outro produto entra na MESMA ficha, sem trocar nada do que ela tem (nome, metadata,
//      telefone, e-mail, endereço, identificadores, cônjuge, papel, índice de busca) e sem devolver o
//      id de ficha em recusa nenhuma. CAD no MESMO produto continua recusada. Leitura que falhou é
//      "não sei", nunca segue.
//   3. O CÓDIGO DE AUTENTICAÇÃO NO MODO ANEXO regrava por cima do metadata MESCLADO: a ficha que veio
//      do sync do C2X não perde `source`, `c2xSynced` nem `c2xUserId` no último passo.
//
// Client falso no espírito do de `cad-por-empreendimento.test.ts`: builder encadeável e "thenable",
// que anota as escritas.

const CPF = "529.982.247-25";
const FICHA = "ent-existente";

type Escrita = { opcoes?: unknown; operacao: string; tabela: string; valores: unknown };

function clienteFake(opcoes: {
  cads?: Array<{ empreendimento: null | string; enterprise_id: null | string; entity_id: string }>;
  /** Uma segunda ficha do MESMO documento (a cópia do Asana), achada pelo `document_hash`. */
  copiaDoDocumento?: string;
  contatosDaFicha?: Array<Record<string, unknown>>;
  enderecosDaFicha?: Array<Record<string, unknown>>;
  erroNaLeituraDaFicha?: boolean;
  erroNasFichas?: boolean;
  fichaExiste?: boolean;
  identificadoresDaFicha?: Array<Record<string, unknown>>;
  metadataDaFicha?: Record<string, unknown>;
  relacionamentosDaFicha?: Array<Record<string, unknown>>;
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
          if (opcoes.erroNasFichas) return { data: null, error: { message: "timeout" } };
          if (!opcoes.fichaExiste) return { data: [], error: null };
          return {
            data: (opcoes.identificadoresDaFicha ?? [{ identifier_type: "cpf" }]).map((linha) => ({
              entity_id: FICHA,
              ...linha,
            })),
            error: null,
          };
        }
        if (tabela === "apolo_entities") {
          if (opcoes.erroNaLeituraDaFicha && colunas === "metadata") {
            return { data: null, error: { message: "timeout" } };
          }
          const fichas = opcoes.fichaExiste
            ? [{ display_name: "MARIA", id: FICHA, metadata: opcoes.metadataDaFicha ?? {} }]
            : [];
          if (colunas === "id" && opcoes.copiaDoDocumento) {
            fichas.push({ display_name: "MARIA", id: opcoes.copiaDoDocumento, metadata: {} });
          }
          return { data: fichas, error: null };
        }
        if (tabela === "apolo_esteira") return { data: opcoes.cads ?? [], error: null };
        if (tabela === "apolo_contacts") return { data: opcoes.contatosDaFicha ?? [], error: null };
        if (tabela === "apolo_addresses") return { data: opcoes.enderecosDaFicha ?? [], error: null };
        if (tabela === "apolo_relationships") {
          return { data: opcoes.relacionamentosDaFicha ?? [], error: null };
        }
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

const PESSOA = {
  dedupPorDocumento: true,
  enterpriseId: "37",
  identidade: { cpf: CPF, nome: "Maria da Silva" },
  persona: "pf" as const,
  role: "prospect" as const,
};

const AUTOR_DO_PORTAL = {
  nome: "Maria do Comercial",
  origem: "portal" as const,
  slug: "cecilio-rocha",
  usuarioId: "u-1",
};

describe("a autoria vem da porta, nunca do input", () => {
  it("um `autor` forjado no input (o corpo espalhado da rota pública) não grava cadastradoPor", async () => {
    const { client, escritas } = clienteFake({});
    const r = await createApoloEntity(client, {
      ...PESSOA,
      autor: { nome: "Forjado", origem: "portal", slug: "cecilio-rocha", usuarioId: "x" },
    } as never);

    expect(r.ok).toBe(true);
    expect(JSON.stringify(escritas)).not.toContain("cadastradoPor");
  });

  it("o autor do terceiro argumento grava cadastradoPor", async () => {
    const { client, escritas } = clienteFake({});
    await createApoloEntity(client, PESSOA, { autor: AUTOR_DO_PORTAL });

    const ficha = escritas.find((e) => e.tabela === "apolo_entities" && e.operacao === "insert");
    expect(ficha?.valores).toMatchObject({
      metadata: {
        cadastradoPor: { nome: "Maria do Comercial", origem: "portal", slug: "cecilio-rocha", usuarioId: "u-1" },
      },
    });
  });
});

describe("fichaExistente: acrescentar (o portal aproveita a ficha, sem trocar nada)", () => {
  // A Maria já é da Careli: CAD no VOC (37), telefone X, e-mail Y, endereço, cônjuge e código de
  // autenticação. O time da Cecílio cadastra a mesma pessoa no Garden (39) com telefone Z e e-mail W.
  const FICHA_DA_CARELI = {
    cads: [{ empreendimento: "VALE DO OURO", enterprise_id: "37", entity_id: FICHA }],
    contatosDaFicha: [
      { contact_type: "phone", entity_id: FICHA, normalized_value: "62999990001", value: "(62) 99999-0001" },
      { contact_type: "email", entity_id: FICHA, normalized_value: "maria@careli.com", value: "maria@careli.com" },
    ],
    enderecosDaFicha: [{ id: "end-1" }],
    fichaExiste: true,
    identificadoresDaFicha: [
      { identifier_type: "cpf" },
      { identifier_type: "email" },
      { identifier_type: "phone" },
    ],
    metadataDaFicha: {
      autenticacao: { codigo: "CAD-2025-AAAA1111", geradoEm: "2025-03-01T10:00:00.000Z" },
      c2xSynced: true,
      c2xUserId: 4321,
      cadastradoPor: { nome: "Operador Careli", origem: "portal", slug: "outro", usuarioId: "u-0" },
      cadastro: { dataNascimento: "1980-01-01", nomeMae: "" },
      source: "c2x",
    },
    relacionamentosDaFicha: [{ label: "JOÃO", related_entity_id: null, relationship_type: "conjuge" }],
  };

  const NO_GARDEN = {
    ...PESSOA,
    conjuge: { nome: "PEDRO" },
    endereco: { cidade: "Goiânia", logradouro: "Rua Nova", uf: "GO" },
    enterpriseId: "39",
    identidade: { cpf: CPF, dataNascimento: "1990-02-02", nome: "Maria Outra Grafia", nomeMae: "ANA" },
    perfil: { email: "maria.nova@portal.com", telefone: "(62) 98888-0003" },
  };

  it("telefone Z e e-mail W no pedido: a CAD entra na ficha e nada do que ela tem é trocado", async () => {
    const { client, escritas } = clienteFake(FICHA_DA_CARELI);
    const r = await createApoloEntity(client, NO_GARDEN, {
      autor: AUTOR_DO_PORTAL,
      fichaExistente: "acrescentar",
    });

    // Mesma ficha, e o código que ela JÁ tinha (a CAD nova sai com ele).
    expect(r).toEqual({ autenticacao: "CAD-2025-AAAA1111", entityId: FICHA, ok: true, warnings: [] });

    // Nenhum contato, endereço, identificador ou cônjuge novo: a ficha já tinha de cada tipo.
    const naTabela = (tabela: string) => escritas.filter((e) => e.tabela === tabela);
    expect(naTabela("apolo_contacts")).toHaveLength(0);
    expect(naTabela("apolo_addresses")).toHaveLength(0);
    expect(naTabela("apolo_entity_identifiers")).toHaveLength(0);
    expect(naTabela("apolo_relationships")).toHaveLength(0);

    // A ficha: uma gravação só, sem nome, e com o metadata dela inteiro.
    const naFicha = naTabela("apolo_entities");
    expect(naFicha.map((e) => e.operacao)).toEqual(["update"]);
    const gravado = naFicha[0]?.valores as Record<string, unknown>;
    expect(gravado).not.toHaveProperty("display_name");
    expect(gravado.metadata).toMatchObject({
      autenticacao: { codigo: "CAD-2025-AAAA1111" },
      c2xSynced: true,
      c2xUserId: 4321,
      cadastradoPor: { slug: "outro", usuarioId: "u-0" },
      // O nascimento que a Careli tem vence; a mãe, que estava vazia, entra.
      cadastro: { dataNascimento: "1980-01-01", nomeMae: "ANA" },
      cadsAcrescentadas: [
        { enterpriseId: "39", nome: "Maria do Comercial", origem: "portal", slug: "cecilio-rocha", usuarioId: "u-1" },
      ],
      source: "c2x",
    });

    // Papel e índice de busca só se faltarem: nunca por cima.
    for (const tabela of ["apolo_entity_profiles", "apolo_search_entries"]) {
      const upsert = naTabela(tabela)[0];
      expect(upsert?.opcoes).toMatchObject({ ignoreDuplicates: true });
    }
    expect(JSON.stringify(r)).not.toContain("VALE DO OURO");
  });

  // (16/09/2026, revisão do conjunto) ⚠️ Telefone e e-mail são CHAVE DE IDENTIDADE da Iris (hash do
  // identificador e texto do contato). Na ficha que já existia, o número digitado no portal (que pode
  // ser o WhatsApp de quem opera) nunca vira chave do cliente da Careli, nem quando falta.
  it("ficha SEM telefone: o do portal NÃO entra (nem contato nem identificador); fica só como pendência", async () => {
    const { client, escritas } = clienteFake({
      ...FICHA_DA_CARELI,
      contatosDaFicha: [],
      enderecosDaFicha: [],
      identificadoresDaFicha: [{ identifier_type: "cpf" }],
    });
    await createApoloEntity(client, NO_GARDEN, { autor: AUTOR_DO_PORTAL, fichaExistente: "acrescentar" });

    expect(escritas.filter((e) => e.tabela === "apolo_contacts")).toHaveLength(0);
    expect(escritas.filter((e) => e.tabela === "apolo_entity_identifiers")).toHaveLength(0);
    // O que não identifica a pessoa e faltava (o endereço) continua entrando.
    expect(escritas.filter((e) => e.tabela === "apolo_addresses" && e.operacao === "insert")).toHaveLength(1);

    const gravado = escritas.find((e) => e.tabela === "apolo_entities")?.valores as { metadata: Record<string, unknown> };
    expect(gravado.metadata.cadsAcrescentadas).toEqual([
      expect.objectContaining({
        contatoInformado: { email: "maria.nova@portal.com", telefone: "(62) 98888-0003" },
        enterpriseId: "39",
      }),
    ]);
    // O índice de busca da ficha não aprende o contato digitado.
    const busca = escritas.find((e) => e.tabela === "apolo_search_entries")?.valores as Array<{ normalized_text: string }>;
    expect(busca[0]?.normalized_text).not.toContain("98888");
    expect(busca[0]?.normalized_text).not.toContain("portal.com");
  });

  it("e-mail único: a cópia da ficha do MESMO documento não barra o e-mail da própria pessoa", async () => {
    const { client } = clienteFake({
      ...FICHA_DA_CARELI,
      contatosDaFicha: [
        ...FICHA_DA_CARELI.contatosDaFicha,
        {
          contact_type: "email",
          entity_id: "ent-copia-asana",
          normalized_value: "maria.nova@portal.com",
          status: "pending",
          value: "maria.nova@portal.com",
        },
      ],
      copiaDoDocumento: "ent-copia-asana",
    });
    const r = await createApoloEntity(client, NO_GARDEN, { autor: AUTOR_DO_PORTAL, fichaExistente: "acrescentar" });
    expect(r).toMatchObject({ entityId: FICHA, ok: true });
  });

  it("CAD no MESMO produto: recusa de sempre, sem o id da ficha e sem escrever nada", async () => {
    const { client, escritas } = clienteFake({
      ...FICHA_DA_CARELI,
      cads: [{ empreendimento: "GARDEN", enterprise_id: "39", entity_id: FICHA }],
    });
    const r = await createApoloEntity(client, NO_GARDEN, { fichaExistente: "acrescentar" });

    expect(r).toMatchObject({ motivo: "cad-no-empreendimento", ok: false });
    expect(r).not.toHaveProperty("entityIdExistente");
    expect(escritas).toHaveLength(0);
  });

  it("o hub, com CAD no mesmo empreendimento, continua recebendo o id da ficha", async () => {
    const { client } = clienteFake({
      cads: [{ empreendimento: "VALE DO OURO", enterprise_id: "37", entity_id: FICHA }],
      fichaExiste: true,
    });
    const r = await createApoloEntity(client, PESSOA);
    expect(r).toMatchObject({ entityIdExistente: FICHA, motivo: "cad-no-empreendimento", ok: false });
  });

  it("leitura das fichas que falhou: 'não sei' é recusa, nunca uma segunda ficha", async () => {
    const { client, escritas } = clienteFake({ erroNasFichas: true });
    const r = await createApoloEntity(client, PESSOA, { fichaExistente: "acrescentar" });
    expect(r).toMatchObject({ motivo: "verificacao-indisponivel", ok: false });
    expect(escritas).toHaveLength(0);
  });

  it("leitura do metadata da ficha que falhou: não grava por cima às cegas", async () => {
    const { client, escritas } = clienteFake({ ...FICHA_DA_CARELI, erroNaLeituraDaFicha: true });
    const r = await createApoloEntity(client, NO_GARDEN, { fichaExistente: "acrescentar" });
    expect(r).toMatchObject({ motivo: "verificacao-indisponivel", ok: false });
    expect(escritas).toHaveLength(0);
  });

  it("ficha sem código de autenticação ganha um, na mesma gravação do metadata", async () => {
    const { client, escritas } = clienteFake({
      ...FICHA_DA_CARELI,
      metadataDaFicha: { source: "c2x" },
    });
    const r = await createApoloEntity(client, NO_GARDEN, { fichaExistente: "acrescentar" });
    expect(r.ok && r.autenticacao).toMatch(/^CAD-\d{4}-/);

    const naFicha = escritas.filter((e) => e.tabela === "apolo_entities");
    expect(naFicha).toHaveLength(1);
    expect((naFicha[0]?.valores as { metadata: unknown }).metadata).toMatchObject({
      autenticacao: { codigo: r.ok ? r.autenticacao : "" },
      source: "c2x",
    });
  });

  it("o hub (padrão) segue anexando, como sempre", async () => {
    const { client } = clienteFake({ fichaExiste: true });
    const r = await createApoloEntity(client, PESSOA);
    expect(r.ok && r.entityId).toBe(FICHA);
  });

  it("fichasDoDocumento diz quando a leitura falhou", async () => {
    const { client } = clienteFake({ erroNasFichas: true });
    expect(await fichasDoDocumento(client, "cpf", "52998224725")).toEqual({ falhou: true, ids: [] });
  });
});

describe("as regras puras do acrescentar", () => {
  const acrescimo = {
    em: "2026-09-16T12:00:00.000Z",
    enterpriseId: "39",
    nome: "Maria do Comercial",
    origem: "portal",
    slug: "cecilio-rocha",
    usuarioId: "u-1",
  };

  it("metadataAcrescentado: o existente vence, o vazio é preenchido e o registro vai para uma lista", () => {
    const antes = {
      cadastro: { escolaridadeId: "3", estadoCivilId: "", profissaoOutro: null, socios: [] },
      cadsAcrescentadas: [{ ...acrescimo, enterpriseId: "100012" }],
      origem: "c2x-sync",
    };
    const depois = metadataAcrescentado(
      antes,
      { escolaridadeId: "7", estadoCivilId: "2", profissaoOutro: "Pintor", socios: [{ nome: "X" }] },
      acrescimo,
    );
    expect(depois).toEqual({
      cadastro: { escolaridadeId: "3", estadoCivilId: "2", profissaoOutro: "Pintor", socios: [{ nome: "X" }] },
      cadsAcrescentadas: [{ ...acrescimo, enterpriseId: "100012" }, acrescimo],
      origem: "c2x-sync",
    });
  });

  it("linhasQueFaltamNaFicha: vínculo de trabalho novo entra, repetido não; leitura falha não insere", () => {
    const imobNova = { label: "Cecílio Rocha", related_entity_id: "IMOB-B", relationship_type: "imobiliaria" };
    const imobIgual = { label: "RR", related_entity_id: "imob-a", relationship_type: "imobiliaria" };
    const conjuge = { label: "PEDRO", related_entity_id: null, relationship_type: "conjuge" };
    const novas = {
      contatos: [{ contact_type: "email" }, { contact_type: "phone" }],
      enderecos: [{ street: "Rua Nova" }],
      identificadores: [{ identifier_type: "cpf" }, { identifier_type: "phone" }, { identifier_type: "rg" }],
      relacionamentos: [imobNova, imobIgual, conjuge],
    };

    expect(
      linhasQueFaltamNaFicha(novas, {
        contatos: [{ contact_type: "email" }],
        enderecos: [],
        identificadores: [{ identifier_type: "cpf" }],
        relacionamentos: [{ label: "RR", related_entity_id: "IMOB-A", relationship_type: "imobiliaria" }],
      }),
    ).toEqual({
      // Telefone e e-mail nunca entram na ficha que já existia (chave de identidade da Iris).
      contatos: [],
      enderecos: [{ street: "Rua Nova" }],
      identificadores: [{ identifier_type: "rg" }],
      relacionamentos: [imobNova, conjuge],
    });

    expect(
      linhasQueFaltamNaFicha(novas, {
        contatos: null,
        enderecos: null,
        identificadores: null,
        relacionamentos: null,
      }),
    ).toEqual({ contatos: [], enderecos: [], identificadores: [], relacionamentos: [] });
  });
});

describe("o código de autenticação no modo anexo", () => {
  it("regrava por cima do metadata mesclado: o que veio do sync do C2X continua na ficha", async () => {
    const { client, escritas } = clienteFake({
      fichaExiste: true,
      metadataDaFicha: { c2xSynced: true, c2xUserId: 4321, source: "c2x" },
    });
    const r = await createApoloEntity(client, PESSOA);
    expect(r.ok).toBe(true);

    const atualizacoes = escritas.filter((e) => e.tabela === "apolo_entities" && e.operacao === "update");
    const ultima = atualizacoes[atualizacoes.length - 1]?.valores as { metadata: Record<string, unknown> };
    expect(ultima.metadata).toMatchObject({
      autenticacao: { codigo: expect.stringMatching(/^CAD-/) },
      c2xSynced: true,
      c2xUserId: 4321,
      source: "c2x",
    });
  });
});
