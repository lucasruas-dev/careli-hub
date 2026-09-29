import { beforeEach, describe, expect, it, vi } from "vitest";

// A BUSCA DE PROPONENTES FORA DO COMERCIAL (revisão de 16/09/2026). A família do VOC (37) é 35 + 36
// + 37 + 41, e o 36 é a carteira do Lino: com a família inteira, o time do Cecílio varria prefixos de
// CPF e levava nome, CPF e etapa de qualquer comprador do Vale do Ouro. A rota é chamada de verdade,
// com o banco falso abaixo.

type Linha = Record<string, unknown>;

const estado = vi.hoisted(() => ({
  permitidos: ["37", "39"] as string[],
  tipo: "incorporador" as "comercial" | "incorporador",
}));

const ESTEIRA: Linha[] = [
  // O cliente do próprio Cecílio, com CAD no VOC.
  { atualizado_em: "2026-09-10", chegou_em: null, created_at: "2026-09-01", enterprise_id: "37", entity_id: "e-voc", etapa: "credenciado" },
  // O cliente do Lino, com CAD no VOL.
  { atualizado_em: "2026-09-10", chegou_em: null, created_at: "2026-09-01", enterprise_id: "36", entity_id: "e-lino", etapa: "credenciado" },
  // O cliente com a CAD no espelho do pai (onde mora quase toda CAD do Vale do Ouro).
  { atualizado_em: "2026-09-10", chegou_em: null, created_at: "2026-09-01", enterprise_id: "35", entity_id: "e-espelho", etapa: "credenciado" },
  // (26/09/2026) AS EMPRESAS, do mesmo jeito: uma no espelho do pai, outra na carteira do Lino.
  // Lucas: *"temos que habilitar pessoa fisica e pessoa juridica, hoje só atende pessoa fisica"*.
  { atualizado_em: "2026-09-10", chegou_em: null, created_at: "2026-09-01", enterprise_id: "35", entity_id: "e-pj-espelho", etapa: "credenciado" },
  { atualizado_em: "2026-09-10", chegou_em: null, created_at: "2026-09-01", enterprise_id: "36", entity_id: "e-pj-lino", etapa: "credenciado" },
  // (26/09/2026) O CÔNJUGE COM A CAD EM ANDAMENTO, no próprio VOC. Lucas: *"pode deixar os
  // coordenadores emitirem proposta sem a cad esta credenciada. ela pode estar em validacao ou em
  // qualquer outro estagio"*. MEDIDO em produção (`bxgukywoxgivlrhjkwjx`, só SELECT): 97 de 4.946
  // propostas têm dois ou mais compradores, e há 173 CADs em `revisao` hoje.
  { atualizado_em: "2026-09-26", chegou_em: null, created_at: "2026-09-01", enterprise_id: "37", entity_id: "e-conjuge", etapa: "validacao" },
  // E a CAD REPROVADA, que continua barrando os dois portais (segunda decisão do Lucas no mesmo dia).
  { atualizado_em: "2026-09-26", chegou_em: null, created_at: "2026-09-01", enterprise_id: "37", entity_id: "e-reprovado", etapa: "indeferido" },
];

const ENTIDADES: Linha[] = [
  { display_name: "Ana do VOC", document_masked: "111.111.111-11", document_hash: null, id: "e-voc", legal_name: null, trade_name: null },
  { display_name: "Ana do Lino", document_masked: "222.222.222-22", document_hash: null, id: "e-lino", legal_name: null, trade_name: null },
  { display_name: "Ana do Espelho", document_masked: "333.333.333-33", document_hash: null, id: "e-espelho", legal_name: null, trade_name: null },
  { display_name: "ACME do Espelho", document_masked: "12.345.678/0001-95", document_hash: null, id: "e-pj-espelho", legal_name: "ACME Construtora Ltda", trade_name: "ACME do Espelho" },
  { display_name: "BETA do Lino", document_masked: "11.222.333/0001-81", document_hash: null, id: "e-pj-lino", legal_name: "BETA Empreendimentos Ltda", trade_name: "BETA do Lino" },
  // ⚠️ 666 E 777, E NÃO 444 E 555: A JUNÇÃO DE 26/09/2026 TINHA DOIS DONOS PARA O MESMO CPF. O bloco
  // do comprador da carteira, neste mesmo arquivo, usa 444.444.444-44 para a BIA (`e-bia`) e
  // 555.555.555-55 para o "OUTRO TITULAR" do contrato do co. Com os dois números repetidos, o hash
  // `hash:cpf:44444444444` achava DUAS entidades e a resposta da carteira vinha com a CAD em
  // `validacao` da Zilda: um teste da carteira falhando por causa de uma fixture de outro assunto.
  { display_name: "Zilda Esposa", document_masked: "666.666.666-66", document_hash: null, id: "e-conjuge", legal_name: null, trade_name: null },
  { display_name: "Zeca Reprovado", document_masked: "777.777.777-77", document_hash: null, id: "e-reprovado", legal_name: null, trade_name: null },
];

const IDENTIFICADORES: Linha[] = [
  { entity_id: "e-voc", value_hash: "hash:cpf:11111111111" },
  { entity_id: "e-lino", value_hash: "hash:cpf:22222222222" },
  { entity_id: "e-espelho", value_hash: "hash:cpf:33333333333" },
  // ⚠️ NAMESPACE `cnpj`, E ISSO É O PONTO. `hashIdentifier` concatena "apolo-identifier:TIPO:valor":
  // hasheado como "cpf", um CNPJ gera uma chave que não existe em lugar nenhum do banco. MEDIDO em
  // 26/09/2026 (produção, só SELECT): as 11 CADs de entidade pj da esteira têm identificador `cnpj`
  // cujo `value_hash` é igual ao `document_hash` da entidade em 11 de 11 casos, e ZERO delas casa
  // com um hash de namespace `cpf`.
  { entity_id: "e-pj-espelho", value_hash: "hash:cnpj:12345678000195" },
  { entity_id: "e-pj-lino", value_hash: "hash:cnpj:11222333000181" },
  { entity_id: "e-conjuge", value_hash: "hash:cpf:66666666666" },
  { entity_id: "e-reprovado", value_hash: "hash:cpf:77777777777" },
];

// (26/09/2026) Os contratos ativos da carteira (`hercules_propostas` com a unidade embutida) e a
// ligação usuário do C2X → entidade (`apolo_source_links`). O filtro com ponto percorre o embutido.
const CONTRATOS: Linha[] = [];
const FONTES: Linha[] = [];
const ESTEIRA_EXTRA: Linha[] = [];
const ENTIDADES_EXTRA: Linha[] = [];
const IDENTIFICADORES_EXTRA: Linha[] = [];

const valorDe = (linha: Linha, coluna: string): unknown =>
  coluna
    .split(".")
    .reduce<unknown>((atual, parte) => (atual && typeof atual === "object" ? (atual as Linha)[parte] : undefined), linha);

function clienteFalso() {
  const from = (tabela: string) => {
    const filtros: Array<(linha: Linha) => boolean> = [];
    const base = (): Linha[] => {
      if (tabela === "hercules_unidades") {
        return [
          { enterprise_id: "37", id: "u-voc", workspace_id: "careli" },
          // (26/09/2026) Uma unidade do Garden, que não tem pai: a família dele é só o 39.
          { enterprise_id: "39", id: "u-gdn", workspace_id: "careli" },
        ];
      }
      if (tabela === "apolo_esteira") return [...ESTEIRA, ...ESTEIRA_EXTRA];
      if (tabela === "apolo_entities") return [...ENTIDADES, ...ENTIDADES_EXTRA];
      if (tabela === "apolo_entity_identifiers") return [...IDENTIFICADORES, ...IDENTIFICADORES_EXTRA];
      if (tabela === "hercules_propostas") return CONTRATOS;
      if (tabela === "apolo_source_links") return FONTES;
      return [];
    };
    const resultado = () => ({ data: base().filter((l) => filtros.every((f) => f(l))), error: null });
    const cadeia = {
      eq: (coluna: string, valor: unknown) => {
        filtros.push((l) => valorDe(l, coluna) === valor);
        return cadeia;
      },
      in: (coluna: string, valores: unknown[]) => {
        filtros.push((l) => valores.includes(valorDe(l, coluna)));
        return cadeia;
      },
      is: (coluna: string, valor: unknown) => {
        filtros.push((l) => valorDe(l, coluna) === valor);
        return cadeia;
      },
      order: () => cadeia,
      range: () => cadeia,
      limit: () => cadeia,
      maybeSingle: () => Promise.resolve({ data: resultado().data[0] ?? null, error: null }),
      select: () => cadeia,
      then: (ok: (valor: ReturnType<typeof resultado>) => unknown) => Promise.resolve(resultado()).then(ok),
    };
    return cadeia;
  };
  return { from };
}

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => clienteFalso(),
  hashIdentifier: (tipo: string, valor: string) => `hash:${tipo}:${valor}`,
}));

vi.mock("@/lib/apolo/incorporador/board-do-portal", () => ({
  autorizarOperacaoDeVenda: () => ({
    ok: true,
    sessao: { slug: "cecilio-rocha", tipo: estado.tipo, usuarioId: "u", usuarioNome: "Maria" },
  }),
}));

vi.mock("@/lib/apolo/incorporador/escopo", () => ({
  idsDaSessao: async () => estado.permitidos,
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [
    { codes: ["VOL", "VOC", "VOR"], id: "group:Vale do Ouro", name: "Vale do Ouro", stageIds: ["36", "37", "41"] },
    { codes: ["VLO"], id: "35", name: "Vale do Ouro", stageIds: ["35"] },
    { codes: ["GDN"], id: "39", name: "Garden", stageIds: ["39"] },
  ],
}));

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: async () => [
    { c2xEnterpriseId: "35", codigo: "VLO", id: "vlo", nome: "Vale do Ouro", paiId: null },
    { c2xEnterpriseId: "36", codigo: "VOL", id: "vol", nome: "VOL", paiId: "vlo" },
    { c2xEnterpriseId: "37", codigo: "VOC", id: "voc", nome: "VOC", paiId: "vlo" },
    { c2xEnterpriseId: "41", codigo: "VOR", id: "vor", nome: "VOR", paiId: "vlo" },
    { c2xEnterpriseId: "39", codigo: "GDN", id: "gdn", nome: "Garden", paiId: null },
  ],
}));

import { GET } from "./route";

async function buscar(q: string): Promise<string[]> {
  const resposta = await GET(
    new Request(`https://c2x.app.br/api/incorporador/venda/proponentes?unidade=u-voc&q=${encodeURIComponent(q)}`),
  );
  expect(resposta.status).toBe(200);
  const corpo = (await resposta.json()) as { data: { encontrados: Array<{ nome: string }> } };
  return corpo.data.encontrados.map((p) => p.nome).sort();
}

// ⚠️ UM TIPO SÓ PARA OS DOIS LOTES DE 26/09/2026 (junção): a CAD em andamento lê
// `podeGerarProposta` e a carteira lê `origem`. Dois `Achado` diferentes no mesmo arquivo era o jeito
// de um teste afirmar sobre um campo que a rota parou de mandar sem nada reclamar.
type Achado = {
  credenciado: boolean;
  etapa: null | string;
  motivo: null | string;
  nome: string;
  origem?: null | string;
  podeGerarProposta: boolean;
};

/**
 * A DECISÃO do único candidato que a busca devolveu.
 *
 * ⚠️ FALHA SE VIER MAIS DE UM, e não pega o primeiro calado: ler `[0]` de uma lista inesperada é
 * como um teste passa a afirmar coisa sobre a pessoa errada.
 */
async function decidirUm(q: string): Promise<Achado> {
  const achados = await decidir(q);
  expect(achados).toHaveLength(1);
  return achados[0] as Achado;
}

/** A mesma busca, devolvendo a DECISÃO de cada candidato e não só o nome. */
async function decidir(q: string): Promise<Achado[]> {
  const resposta = await GET(
    new Request(`https://c2x.app.br/api/incorporador/venda/proponentes?unidade=u-voc&q=${encodeURIComponent(q)}`),
  );
  expect(resposta.status).toBe(200);
  const corpo = (await resposta.json()) as { data: { encontrados: Achado[] } };
  return corpo.data.encontrados;
}

beforeEach(() => {
  estado.permitidos = ["37", "39"];
  estado.tipo = "incorporador";
  CONTRATOS.length = 0;
  FONTES.length = 0;
  ESTEIRA_EXTRA.length = 0;
  ENTIDADES_EXTRA.length = 0;
  IDENTIFICADORES_EXTRA.length = 0;
});

describe("GET /api/incorporador/venda/proponentes fora do comercial", () => {
  it("⚠️ pelo nome, só quem tem CAD na família que a sessão alcança (nem o Lino, nem o espelho)", async () => {
    expect(await buscar("ana")).toEqual(["Ana do VOC"]);
  });

  it("⚠️ prefixo de CPF não abre a lista do Vale do Ouro", async () => {
    expect(await buscar("2222")).toEqual([]);
    expect(await buscar("3333")).toEqual([]);
  });

  it("o CPF INTEIRO acha o cliente cuja CAD mora no espelho do pai", async () => {
    expect(await buscar("333.333.333-33")).toEqual(["Ana do Espelho"]);
  });

  it("⚠️ nem com o CPF inteiro sai o cliente do irmão de outro dono (36)", async () => {
    expect(await buscar("22222222222")).toEqual([]);
  });

  // ── AS MESMAS DUAS PERGUNTAS, COM CNPJ ─────────────────────────────────────
  //
  // (26/09/2026) O ramo do documento inteiro deixou de ser `digitos.length === 11` e passou a
  // `tipoDePessoa(termo.digitos) !== null`, ou seja, o oráculo "este documento existe na base da
  // Careli" passou a valer para CNPJ também, no espelho do pai e fora do comercial. É ramo de
  // PRIVACIDADE: foi aqui que a busca já devolveu o VOL do Lino (ver o comentário de
  // `familia-no-portal.ts`), e sem o par de casos o único caminho coberto seria o de 11 dígitos.
  it("o CNPJ INTEIRO acha a empresa cuja CAD mora no espelho do pai", async () => {
    expect(await buscar("12.345.678/0001-95")).toEqual(["ACME do Espelho"]);
    expect(await buscar("12345678000195")).toEqual(["ACME do Espelho"]);
  });

  it("⚠️ prefixo de CNPJ não abre a lista do Vale do Ouro", async () => {
    expect(await buscar("1234567800")).toEqual([]);
  });

  it("⚠️ nem com o CNPJ inteiro sai a empresa do irmão de outro dono (36)", async () => {
    expect(await buscar("11.222.333/0001-81")).toEqual([]);
  });
});

describe("GET /api/incorporador/venda/proponentes no comercial", () => {
  it("continua lendo a família inteira, como antes", async () => {
    estado.tipo = "comercial";
    estado.permitidos = ["35", "36", "37", "41", "group:Vale do Ouro"];
    expect(await buscar("ana")).toEqual(["Ana do Espelho", "Ana do Lino", "Ana do VOC"]);
  });
});

// ⚠️ O CO-PROPONENTE TAMBÉM, E NÃO SÓ O TITULAR (26/09/2026).
//
// Lucas: *"pode deixar os coordenadores emitirem proposta sem a cad esta credenciada. ela pode
// estar em validacao ou em qualquer outro estagio"*. Enquanto esta rota chamava `decidirPelasLinhas`
// SEM modo, o afrouxamento alcançava só o titular (que entra automático do GET da proposta): o
// coordenador passava o marido e travava na esposa, e sobravam duas saídas erradas — esperar a CAD
// (o que o pedido queria destravar) ou gravar 100% no titular, que muda quem assina o contrato.
//
// ⚠️ MEDIDO EM PRODUÇÃO (`bxgukywoxgivlrhjkwjx`, só SELECT, 26/09/2026):
//   select count(*) as propostas,
//          count(*) filter (where jsonb_array_length(compradores) > 1) as com_dois
//     from hercules_propostas where compradores is not null;
//     → 97 de 4.946 propostas têm dois ou mais compradores.
//   select etapa, count(*) from apolo_esteira group by 1;
//     → credenciado 662 · revisao 173 · correcao 6 · validacao 1 (ZERO em `indeferido`).
describe("a CAD em andamento e o CO-PROPONENTE", () => {
  it("no comercial, o cônjuge em validação PODE entrar — e `credenciado` continua dizendo a verdade", async () => {
    estado.tipo = "comercial";
    estado.permitidos = ["35", "36", "37", "41", "group:Vale do Ouro"];

    const zilda = await decidirUm("zilda");

    expect(zilda.podeGerarProposta).toBe(true);
    // ⚠️ A TELA NÃO MENTE: `credenciado` segue `false`, e é ele que faz a frase da etapa aparecer
    // ao lado do nome como AVISO em vez de virar um "CAD credenciada" falso.
    expect(zilda.credenciado).toBe(false);
    expect(zilda.etapa).toBe("validacao");
    // ⚠️ 25/09 E NÃO 26/09: a fixture grava `atualizado_em` só com a data, e meia-noite UTC é
    // o dia anterior em America/Sao_Paulo, que é o fuso em que a frase é escrita.
    expect(zilda.motivo).toBe("A CAD deste cliente está em validação de cadastro desde 25/09/2026.");
  });

  it("o MESMO cônjuge NÃO entra no portal do Cecílio — só o comercial da Careli foi afrouxado", async () => {
    // Segunda decisão do Lucas em 26/09/2026: o `cecilio-rocha` opera a própria venda
    // (`portalOperaVenda`, perfis-de-portal.ts:122) e continua precisando da CAD credenciada.
    const zilda = await decidirUm("zilda");

    expect(zilda.nome).toBe("Zilda Esposa");
    expect(zilda.podeGerarProposta).toBe(false);
    expect(zilda.credenciado).toBe(false);
  });

  it("⚠️ a CAD INDEFERIDA do co-proponente não entra nem no comercial", async () => {
    estado.tipo = "comercial";
    estado.permitidos = ["35", "36", "37", "41", "group:Vale do Ouro"];

    const zeca = await decidirUm("zeca reprovado");

    expect(zeca.podeGerarProposta).toBe(false);
    expect(zeca.motivo).toBe(
      "A CAD deste cliente está com o cadastro indeferido desde 25/09/2026.",
    );
  });

  it("⚠️ o afrouxamento NÃO mudou quem aparece na lista — a privacidade da busca é o ESCOPO", async () => {
    // Quem entra na resposta é quem tem CAD no escopo (`porEntidade.has(c.id)`), e não quem está
    // credenciado. Fora do comercial, o cliente do Lino (36) continua invisível mesmo com a régua
    // da etapa afrouxada do outro lado.
    expect(await buscar("ana")).toEqual(["Ana do VOC"]);

    // E no comercial a família inteira continua visível, exatamente como antes deste lote.
    estado.tipo = "comercial";
    estado.permitidos = ["35", "36", "37", "41", "group:Vale do Ouro"];
    expect(await buscar("2222")).toEqual(["Ana do Lino"]);
  });
});

// ── O COMPRADOR DA CARTEIRA COMO CO-PROPONENTE (26/09/2026) ──────────────────
//
// A mesma régua do titular (`decidirPelasLinhas` com a compra): quem não tem CAD no escopo, mas é
// comprador de contrato ativo numa unidade da família, aparece como credenciado. E um recorte de
// privacidade MAIS FECHADO que o da esteira (revisão de 26/09/2026): o comprador da carteira só é
// alcançado pelo CPF INTEIRO, nunca por nome ou prefixo, e nunca no irmão de outro dono (36, o Lino).

const BIA = { cpf: "444.444.444-44", digitos: "44444444444", entidade: "e-bia", usuario: "9001" };

function contratoDaBia(parcial: Linha = {}): Linha {
  return {
    cancelada_em: null,
    cancelamento_pedido_em: null,
    cliente_c2x_id: BIA.usuario,
    cliente_documento: BIA.cpf,
    cliente_entity_id: null,
    cliente_nome: "BIA DA CARTEIRA",
    codigo: "000501",
    compradores: [{ c2x_user_id: BIA.usuario, documento: BIA.cpf, nome: "BIA DA CARTEIRA", percentual: 100, titular: true }],
    etapa: "faturado",
    etapa_desde: "2024-05-01T12:00:00.000Z",
    id: "prop-bia",
    unidade: { codigo: "VOC0501", enterprise_id: "37", id: "u-501" },
    workspace_id: "careli",
    ...parcial,
  };
}

function comABia(contrato: Linha) {
  CONTRATOS.push(contrato);
  FONTES.push({ entity_id: BIA.entidade, source_id: BIA.usuario, source_system: "c2x", source_table: "users" });
  ENTIDADES_EXTRA.push({
    display_name: "Bia da Carteira",
    document_hash: null,
    document_masked: BIA.cpf,
    id: BIA.entidade,
    legal_name: null,
    trade_name: null,
  });
  IDENTIFICADORES_EXTRA.push({ entity_id: BIA.entidade, value_hash: `hash:cpf:${BIA.digitos}` });
}

async function buscarTudo(q: string, unidade = "u-voc"): Promise<Achado[]> {
  const resposta = await GET(
    new Request(`https://c2x.app.br/api/incorporador/venda/proponentes?unidade=${unidade}&q=${encodeURIComponent(q)}`),
  );
  expect(resposta.status).toBe(200);
  return ((await resposta.json()) as { data: { encontrados: Achado[] } }).data.encontrados;
}

describe("GET /api/incorporador/venda/proponentes: o comprador da carteira", () => {
  it("⚠️ sem CAD, com contrato ativo na família da sessão, o CPF inteiro o acha credenciado e marcado", async () => {
    comABia(contratoDaBia());
    for (const q of [BIA.cpf, BIA.digitos]) {
      expect(await buscarTudo(q)).toEqual([
        expect.objectContaining({ credenciado: true, nome: "Bia da Carteira", origem: "comprador_da_carteira" }),
      ]);
    }
  });

  it("⚠️ por NOME ou por PREFIXO de CPF o comprador sem CAD não aparece: não se enumera a carteira", async () => {
    comABia(contratoDaBia());
    expect(await buscarTudo("bia")).toEqual([]);
    expect(await buscarTudo("4444")).toEqual([]);
    expect(await buscarTudo("4444444444")).toEqual([]);
  });

  it("⚠️ nem no comercial o nome ou o prefixo listam a carteira; o CPF inteiro, sim", async () => {
    estado.tipo = "comercial";
    estado.permitidos = ["35", "36", "37", "41", "group:Vale do Ouro"];
    comABia(contratoDaBia({ unidade: { codigo: "VOL0501", enterprise_id: "36", id: "u-36" } }));
    expect(await buscarTudo("bia")).toEqual([]);
    expect(await buscarTudo("4444")).toEqual([]);
    expect((await buscarTudo(BIA.digitos)).map((a) => a.nome)).toEqual(["Bia da Carteira"]);
  });

  it("⚠️ o contrato no irmão de outro dono (36) nunca aparece, nem com o CPF inteiro", async () => {
    comABia(contratoDaBia({ unidade: { codigo: "VOL0501", enterprise_id: "36", id: "u-36" } }));
    expect(await buscarTudo("bia")).toEqual([]);
    expect(await buscarTudo(BIA.digitos)).toEqual([]);
  });

  it("⚠️ o contrato no espelho do pai (35) só aparece com o CPF inteiro", async () => {
    comABia(contratoDaBia({ unidade: { codigo: "VLO0501", enterprise_id: "35", id: "u-35" } }));
    expect(await buscarTudo("bia")).toEqual([]);
    expect(await buscarTudo("4444")).toEqual([]);
    expect((await buscarTudo(BIA.cpf)).map((a) => a.nome)).toEqual(["Bia da Carteira"]);
  });

  it("⚠️ comprador do Vale do Ouro buscado numa unidade do GARDEN (39): não aparece, nem com o CPF inteiro", async () => {
    // A sessão do Cecílio alcança o 37 e o 39. O Garden não tem pai: a família dele é só o 39, e o
    // contrato no VOC (37) não é prova para o Garden.
    comABia(contratoDaBia());
    expect(await buscarTudo(BIA.digitos, "u-gdn")).toEqual([]);
    expect(await buscarTudo(BIA.cpf, "u-gdn")).toEqual([]);
  });

  it("e o comprador do próprio Garden aparece no Garden pelo CPF inteiro (o recorte não está só vazio)", async () => {
    comABia(contratoDaBia({ unidade: { codigo: "GDN0101", enterprise_id: "39", id: "u-39" } }));
    expect((await buscarTudo(BIA.digitos, "u-gdn")).map((a) => a.nome)).toEqual(["Bia da Carteira"]);
    expect(await buscarTudo(BIA.digitos)).toEqual([]);
  });

  it("o CO-COMPRADOR do contrato também aparece, pelo CPF inteiro", async () => {
    comABia(
      contratoDaBia({
        cliente_c2x_id: "9999",
        cliente_documento: "555.555.555-55",
        cliente_nome: "OUTRO TITULAR",
        compradores: [
          { c2x_user_id: "9999", documento: "555.555.555-55", nome: "OUTRO TITULAR", percentual: 50, titular: true },
          { c2x_user_id: BIA.usuario, documento: BIA.digitos, nome: "BIA DA CARTEIRA", percentual: 50, titular: false },
        ],
      }),
    );
    expect(await buscarTudo("bia")).toEqual([]);
    const achados = await buscarTudo(BIA.digitos);
    expect(achados.map((a) => [a.nome, a.credenciado, a.origem])).toEqual([
      ["Bia da Carteira", true, "comprador_da_carteira"],
    ]);
  });

  it("distrato não é contrato ativo: a pessoa sem CAD continua sem aparecer", async () => {
    comABia(contratoDaBia({ etapa: "distrato" }));
    expect(await buscarTudo(BIA.digitos)).toEqual([]);
  });

  it("faturado com pedido de cancelamento em curso não é contrato ativo", async () => {
    comABia(contratoDaBia({ cancelamento_pedido_em: "2026-09-20T12:00:00.000Z" }));
    expect(await buscarTudo(BIA.digitos)).toEqual([]);
  });

  it("⚠️ CAD em revisão numa entidade qualquer do CPF barra, como no titular", async () => {
    comABia(contratoDaBia());
    ENTIDADES_EXTRA.push({
      display_name: "Bia (Apolo)",
      document_hash: `hash:cpf:${BIA.digitos}`,
      document_masked: "***.444.444-**",
      id: "e-bia-apolo",
      legal_name: null,
      trade_name: null,
    });
    ESTEIRA_EXTRA.push({
      atualizado_em: "2026-09-11",
      chegou_em: null,
      created_at: "2026-09-01",
      enterprise_id: "37",
      entity_id: "e-bia-apolo",
      etapa: "revisao",
    });
    const daCarteira = (await buscarTudo(BIA.digitos)).find((a) => a.nome === "Bia da Carteira");
    expect(daCarteira?.credenciado).toBe(false);
    expect(daCarteira?.etapa).toBe("revisao");
    // ⚠️ E FORA DO COMERCIAL A PORTA DA PROPOSTA TAMBÉM FECHA (junção de 26/09/2026): o portal do
    // Cecílio continua exigindo a CAD credenciada, e ter contrato antigo não muda a etapa da CAD.
    expect(daCarteira?.podeGerarProposta).toBe(false);
  });

  // ⚠️ AS DUAS DECISÕES DE 26/09/2026 NO MESMO CANDIDATO, e este teste é o encontro delas nesta
  // rota. Lucas: *"pode deixar os coordenadores emitirem proposta sem a cad esta credenciada"* e
  // *"temos que aproveitar esses cadastros de comprador"*. Quem chega pela carteira mas TEM CAD em
  // andamento é decidido pela CAD (a compra só vale no ramo "sem CAD nenhuma"), e o modo do
  // coordenador tem de alcançar esse caminho também — senão o mesmo co-comprador ficaria mais
  // apertado quando achado pelo CPF do que quando achado pelo nome, na mesma lista.
  it("⚠️ no comercial, o comprador da carteira COM CAD em andamento entra pela porta da CAD", async () => {
    estado.tipo = "comercial";
    estado.permitidos = ["35", "36", "37", "41", "group:Vale do Ouro"];
    comABia(contratoDaBia());
    ESTEIRA_EXTRA.push({
      atualizado_em: "2026-09-26",
      chegou_em: null,
      created_at: "2026-09-01",
      enterprise_id: "37",
      entity_id: BIA.entidade,
      etapa: "revisao",
    });

    const daCarteira = (await buscarTudo(BIA.digitos)).find((a) => a.nome === "Bia da Carteira");

    // A porta abre pelo MODO, e a resposta não finge que ela está credenciada.
    expect(daCarteira?.podeGerarProposta).toBe(true);
    expect(daCarteira?.credenciado).toBe(false);
    expect(daCarteira?.etapa).toBe("revisao");
    // ⚠️ E `origem` É `cad`, NÃO A CARTEIRA: quem decidiu foi a CAD. A tela não pode dizer
    // "Comprador da carteira" sobre uma decisão que a carteira não tomou.
    expect(daCarteira?.origem).toBe("cad");
  });

  it("⚠️ no comercial, a CAD INDEFERIDA barra mesmo com o contrato ativo na família", async () => {
    // O caso perigoso do cruzamento: comprador antigo REPROVADO no crédito. Nem o modo do
    // coordenador nem a carteira podem passar por cima de um indeferimento.
    estado.tipo = "comercial";
    estado.permitidos = ["35", "36", "37", "41", "group:Vale do Ouro"];
    comABia(contratoDaBia());
    ESTEIRA_EXTRA.push({
      atualizado_em: "2026-09-26",
      chegou_em: null,
      created_at: "2026-09-01",
      enterprise_id: "37",
      entity_id: BIA.entidade,
      etapa: "indeferido",
    });

    const daCarteira = (await buscarTudo(BIA.digitos)).find((a) => a.nome === "Bia da Carteira");

    expect(daCarteira?.podeGerarProposta).toBe(false);
    expect(daCarteira?.credenciado).toBe(false);
    expect(daCarteira?.etapa).toBe("indeferido");
  });
});

// ── A EMPRESA COMPRADORA DA CARTEIRA (26/09/2026, junção com a v1.384.0) ──────────────────
//
// A porta da carteira segue a mesma peça do espelho do pai (`ehDocumentoInteiro`): o CNPJ INTEIRO a
// abre, e nunca o nome nem o prefixo. O recorte de privacidade é o mesmo do CPF, inclusive o 36.
const GAMA = { cnpj: "33.444.555/0001-66", digitos: "33444555000166", entidade: "e-gama", usuario: "9101" };

function comAGama(unidade: Linha) {
  CONTRATOS.push(
    contratoDaBia({
      cliente_c2x_id: GAMA.usuario,
      cliente_documento: GAMA.cnpj,
      cliente_nome: "GAMA URBANISMO LTDA",
      compradores: [
        { c2x_user_id: GAMA.usuario, documento: GAMA.cnpj, nome: "GAMA URBANISMO LTDA", percentual: 100, titular: true },
      ],
      id: "prop-gama",
      unidade,
    }),
  );
  FONTES.push({ entity_id: GAMA.entidade, source_id: GAMA.usuario, source_system: "c2x", source_table: "users" });
  ENTIDADES_EXTRA.push({
    display_name: "Gama Urbanismo",
    document_hash: null,
    document_masked: GAMA.cnpj,
    id: GAMA.entidade,
    legal_name: "GAMA URBANISMO LTDA",
    trade_name: "Gama Urbanismo",
  });
  IDENTIFICADORES_EXTRA.push({ entity_id: GAMA.entidade, value_hash: `hash:cnpj:${GAMA.digitos}` });
}

describe("GET /api/incorporador/venda/proponentes: a empresa compradora da carteira", () => {
  it("⚠️ sem CAD, com contrato ativo na família da sessão, o CNPJ inteiro a acha credenciada e marcada", async () => {
    comAGama({ codigo: "VOC0601", enterprise_id: "37", id: "u-601" });
    for (const q of [GAMA.cnpj, GAMA.digitos]) {
      expect(await buscarTudo(q)).toEqual([
        expect.objectContaining({ credenciado: true, nome: "Gama Urbanismo", origem: "comprador_da_carteira" }),
      ]);
    }
  });

  it("⚠️ por NOME ou por PREFIXO de CNPJ a empresa sem CAD não aparece", async () => {
    comAGama({ codigo: "VOC0601", enterprise_id: "37", id: "u-601" });
    expect(await buscarTudo("gama")).toEqual([]);
    expect(await buscarTudo("3344455500")).toEqual([]);
  });

  it("⚠️ o contrato da empresa no irmão de outro dono (36) nunca aparece, nem com o CNPJ inteiro", async () => {
    comAGama({ codigo: "VOL0601", enterprise_id: "36", id: "u-36b" });
    expect(await buscarTudo(GAMA.digitos)).toEqual([]);
  });
});
