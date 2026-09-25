import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { mapaDeNomesDeMercado } from "./nome-de-mercado-por-id";
import { mapC2xPortfolioRowToCommercialLink, persistApoloEntityBatch } from "./server";

// O SYNC DO APOLO PARA DE COPIAR O NOME DO EMPREENDIMENTO DO C2X (Lucas, 24/09/2026: "pode" para
// travar as portas por onde o C2X ainda mexe no Panteon).
//
// Até aqui os crons `/api/apolo/sync/c2x` (6 h) e `.../incremental` (5 min) gravavam em
// `apolo_commercial_links.enterprise_name` o nome que o legado tivesse na hora. Um renome lá entrava
// aqui sozinho, e só nos clientes que a rodada tocou: a Aldeia (42) ficou com 27 linhas de um nome e
// 20 de outro (medido em 24/09/2026).
//
// O que estes testes cobram:
//   1. com o mapa do Panteon, o nome gravado é o de MERCADO pelo id (o do pai, sem divisão), nas três
//      tabelas que o carregam: vínculo comercial, linha do tempo e índice de busca;
//   2. id que o Panteon não conhece fica com o nome do C2X;
//   3. sem mapa (leitura falhou), grava o nome do C2X, como antes;
//   4. o id do C2X vai para `metadata.enterpriseId`, a chave que não muda no renome;
//   5. a carteira AO VIVO da ficha também passa pelo nome de mercado;
//   6. o cadastro é lido UMA vez por rodada, nunca dentro do lote.

type Linha = Record<string, unknown>;
type UsuarioC2x = Parameters<typeof persistApoloEntityBatch>[1][number];

// Mesmo banco em memória de `sync-c2x-identidade.test.ts`: só o upsert, que é o que o lote usa.
function bancoFake() {
  const tabelas: Record<string, Linha[]> = {};
  const client = {
    from(tabela: string) {
      return {
        upsert(linhas: Linha[], opcoes?: { ignoreDuplicates?: boolean; onConflict?: string }) {
          const chave = (opcoes?.onConflict ?? "id").split(",").map((c) => c.trim());
          const existentes = (tabelas[tabela] ??= []);
          const identidade = (l: Linha) => chave.map((c) => String(l[c])).join("::");
          for (const linha of linhas) {
            const atual = existentes.find((g) => identidade(g) === identidade(linha));
            if (!atual) existentes.push({ ...linha });
            else if (!opcoes?.ignoreDuplicates) Object.assign(atual, linha);
          }
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { client: client as never, tabelas };
}

// O C2X devolve NULL, não undefined: o fixture nasce todo nulo.
const CAMPOS_C2X = [
  "billed_request_count", "cellphone", "cnpj", "cpf", "display_name", "email", "fantasy_name",
  "latest_enterprise_id", "latest_enterprise_name", "latest_paid_area",
  "latest_paid_contract_document_id", "latest_paid_contract_status", "latest_paid_contract_url",
  "latest_paid_enterprise_code", "latest_paid_enterprise_id", "latest_paid_enterprise_name",
  "latest_paid_request_id", "latest_paid_request_code", "latest_paid_stage_name",
  "latest_paid_unit_block", "latest_paid_unit_code", "latest_paid_unit_id", "latest_paid_unit_label",
  "latest_paid_unit_lot", "latest_paid_unit_price", "latest_request_code", "latest_stage_name",
  "latest_unit_label", "linked_party_name", "location_label", "overdue_amount",
  "overdue_installments", "paid_amount", "payment_count", "person_type_id", "person_type_name",
  "phone", "phone_list", "profile_id", "profile_name", "request_count", "social_name",
  "total_portfolio_amount", "unit_count", "updated_at", "user_name", "vinculed_by_id",
] as const;

function usuarioC2x(dados: Partial<Omit<UsuarioC2x, "constructor">> & { id: number }): UsuarioC2x {
  const vazio = Object.fromEntries(CAMPOS_C2X.map((campo) => [campo, null]));
  return { ...vazio, ...dados } as unknown as UsuarioC2x;
}

// Comprador do VOC (37): o C2X chama de "VALE DO OURO", o Panteon de "Vale do Ouro" (o pai).
const COMPRADOR_DO_VOC = usuarioC2x({
  cpf: "12345678909",
  display_name: "MARIA DA SILVA",
  id: 7001,
  latest_enterprise_id: "37",
  latest_enterprise_name: "VALE DO OURO",
  latest_paid_enterprise_code: "VOC",
  latest_paid_enterprise_id: "37",
  latest_paid_enterprise_name: "VALE DO OURO",
  latest_paid_unit_code: "VOC0104",
  latest_paid_unit_label: "VOC0104",
  payment_count: 3,
  person_type_id: 1,
  profile_id: 2,
  profile_name: "Usuario",
  request_count: 1,
});

// Em jornada (sem pagamento) no 43, que a Nívea renomeou no C2X em 24/09.
const EM_JORNADA_NO_43 = usuarioC2x({
  cpf: "98765432100",
  display_name: "JOAO SOUZA",
  id: 7002,
  latest_enterprise_id: "43",
  latest_enterprise_name: "PORTAL DO IBITURUNA",
  latest_stage_name: "Reserva",
  latest_unit_label: "Q1 L2",
  payment_count: 0,
  person_type_id: 1,
  profile_id: 2,
  profile_name: "Usuario",
  request_count: 1,
});

// Comprador de um empreendimento que nasceu no C2X e o Panteon ainda não cadastrou.
const COMPRADOR_DE_ID_DESCONHECIDO = usuarioC2x({
  cpf: "11122233344",
  display_name: "ANA LIMA",
  id: 7003,
  latest_enterprise_id: "44",
  latest_enterprise_name: "RESIDENCIAL NOVO",
  latest_paid_enterprise_id: "44",
  latest_paid_enterprise_name: "RESIDENCIAL NOVO",
  payment_count: 1,
  person_type_id: 1,
  profile_id: 2,
  profile_name: "Usuario",
  request_count: 1,
});

const NOMES = mapaDeNomesDeMercado([
  { c2x_enterprise_id: "35", id: "u-vlo", nome: "Vale do Ouro", pai_id: null },
  { c2x_enterprise_id: "37", id: "u-voc", nome: "Vale do Ouro · VOC", pai_id: "u-vlo" },
  { c2x_enterprise_id: "43", id: "u-pdi", nome: "Portal do Ibituruna", pai_id: null },
]);

// Cada teste grava UM cliente, e cada cliente destes tem UM vínculo comercial.
const vinculoDe = (banco: ReturnType<typeof bancoFake>) => banco.tabelas.apolo_commercial_links?.[0];

describe("persistApoloEntityBatch — o nome do empreendimento é o de mercado do Panteon", () => {
  it("comprador do VOC: grava 'Vale do Ouro' (o pai), não o nome do C2X nem a divisão", async () => {
    const banco = bancoFake();
    await persistApoloEntityBatch(banco.client, [COMPRADOR_DO_VOC], "run", "2026-09-24T21:00:00.000Z", NOMES);

    const vinculo = vinculoDe(banco);
    expect(vinculo?.enterprise_name).toBe("Vale do Ouro");
    expect((vinculo?.metadata as Linha).enterpriseId).toBe("37");
    // A sigla continua a do C2X na metadata: é o que o financeiro ainda casa.
    expect((vinculo?.metadata as Linha).enterpriseCode).toBe("VOC");
  });

  it("o mesmo nome vai para a linha do tempo e para o índice de busca", async () => {
    // O caso da fragmentação medida: o C2X escreve "ALDEIA DA CACHOEIRA DAS PEDRAS" desde 12/09, o
    // Panteon "Aldeia das Cachoeiras das Pedras". Grafias que a normalização da busca NÃO iguala.
    const compradorDaAldeia = usuarioC2x({
      ...COMPRADOR_DO_VOC,
      latest_enterprise_id: "42",
      latest_enterprise_name: "ALDEIA DA CACHOEIRA DAS PEDRAS",
      latest_paid_enterprise_code: "ACP",
      latest_paid_enterprise_id: "42",
      latest_paid_enterprise_name: "ALDEIA DA CACHOEIRA DAS PEDRAS",
    });
    const nomes = mapaDeNomesDeMercado([
      { c2x_enterprise_id: "42", id: "u-acp", nome: "Aldeia das Cachoeiras das Pedras", pai_id: null },
    ]);

    const banco = bancoFake();
    await persistApoloEntityBatch(banco.client, [compradorDaAldeia], "run", "2026-09-24T21:00:00.000Z", nomes);

    expect(vinculoDe(banco)?.enterprise_name).toBe("Aldeia das Cachoeiras das Pedras");

    const descricoes = (banco.tabelas.apolo_timeline_events ?? []).map((l) => String(l.description));
    expect(descricoes.some((d) => d.startsWith("Aldeia das Cachoeiras das Pedras /"))).toBe(true);
    expect(descricoes.some((d) => /cachoeira das pedras/i.test(d) && !/cachoeiras/i.test(d))).toBe(false);

    const busca = String((banco.tabelas.apolo_search_entries ?? [])[0]?.normalized_text);
    expect(busca).toContain("aldeia das cachoeiras das pedras");
    expect(busca).not.toContain("aldeia da cachoeira das pedras");
  });

  it("cliente em jornada no 43: grava 'Portal do Ibituruna' pelo id", async () => {
    const banco = bancoFake();
    await persistApoloEntityBatch(banco.client, [EM_JORNADA_NO_43], "run", "2026-09-24T21:00:00.000Z", NOMES);

    const vinculo = vinculoDe(banco);
    expect(vinculo?.enterprise_name).toBe("Portal do Ibituruna");
    expect((vinculo?.metadata as Linha).enterpriseId).toBe("43");
  });

  it("id que o Panteon não conhece: fica o nome do C2X", async () => {
    const banco = bancoFake();
    await persistApoloEntityBatch(
      banco.client,
      [COMPRADOR_DE_ID_DESCONHECIDO],
      "run",
      "2026-09-24T21:00:00.000Z",
      NOMES,
    );

    expect(vinculoDe(banco)?.enterprise_name).toBe("RESIDENCIAL NOVO");
  });

  it("sem o mapa (a leitura do cadastro falhou): grava o nome do C2X, como antes", async () => {
    const banco = bancoFake();
    await persistApoloEntityBatch(banco.client, [COMPRADOR_DO_VOC], "run", "2026-09-24T21:00:00.000Z");

    expect(vinculoDe(banco)?.enterprise_name).toBe("VALE DO OURO");
  });
});

describe("carteira AO VIVO da ficha (mapC2xPortfolioRowToCommercialLink)", () => {
  const linhaAoVivo = (enterpriseId: number, nome: string) =>
    ({
      acquisition_request_code: "AR-1",
      acquisition_request_id: 1,
      area: null,
      block: "1",
      broker_agency: null,
      enterprise_code: "LBF",
      enterprise_id: enterpriseId,
      enterprise_name: nome,
      lot: "2",
      signed_contract_document_id: null,
      signed_contract_status: null,
      signed_contract_url: null,
      stage_name: "Faturado",
      unit_price: null,
      unity_id: 10,
      unity_name: "LBF0102",
    }) as unknown as Parameters<typeof mapC2xPortfolioRowToCommercialLink>[0];

  const LAGOA = mapaDeNomesDeMercado([
    { c2x_enterprise_id: "31", id: "u-lab", nome: "Lagoa Bonita", pai_id: null },
    { c2x_enterprise_id: "33", id: "u-lbf", nome: "Lagoa Bonita · LBF", pai_id: "u-lab" },
  ]);

  it("o 'Lagoa Bonita - LBF' da expressão por sigla vira 'Lagoa Bonita': sem a divisão", () => {
    const link = mapC2xPortfolioRowToCommercialLink(linhaAoVivo(33, "Lagoa Bonita - LBF"), [], LAGOA);
    expect(link.enterprise).toBe("Lagoa Bonita");
    expect(link.enterpriseId).toBe("33");
  });

  it("id fora do cadastro, ou sem mapa: fica o que o C2X deu", () => {
    expect(mapC2xPortfolioRowToCommercialLink(linhaAoVivo(44, "RESIDENCIAL NOVO"), [], LAGOA).enterprise).toBe(
      "RESIDENCIAL NOVO",
    );
    expect(mapC2xPortfolioRowToCommercialLink(linhaAoVivo(33, "Lagoa Bonita - LBF"), []).enterprise).toBe(
      "Lagoa Bonita - LBF",
    );
  });
});

// ⚠️ LIDO COMO TEXTO, DE PROPÓSITO: as duas rotas de sync abrem o pool do C2X e o Supabase, e o que
// importa aqui é ONDE a leitura do cadastro acontece. O incremental roda a cada 5 minutos; uma leitura
// dentro do laço de lotes (ou dentro do lote) multiplicaria as idas ao banco por rodada.
describe("uma leitura do cadastro por rodada", () => {
  const SERVER = readFileSync(join(__dirname, "server.ts"), "utf8");

  const corpoDe = (inicio: string, fim: string) => {
    const de = SERVER.indexOf(inicio);
    const ate = SERVER.indexOf(fim, de + inicio.length);
    expect(de).toBeGreaterThan(-1);
    expect(ate).toBeGreaterThan(de);
    return SERVER.slice(de, ate);
  };

  it("o lote não lê o cadastro: recebe o mapa pronto", () => {
    const lote = corpoDe("export async function persistApoloEntityBatch(", "\nfunction ");
    expect(lote).not.toContain("lerNomesDeMercado(");
    expect(lote).toContain("comNomeDeMercado(user, nomesDeMercado)");
  });

  it("o sync completo e o incremental leem ANTES do laço de lotes", () => {
    for (const [inicio, fim] of [
      ["export async function syncApoloFromC2x(", "export async function syncApoloIncrementalFromC2x("],
      // Do ponto em que o incremental já sabe quem regravar até o fim dos lotes (o CRECI vem depois).
      ["const ids = Array.from(dirtyUserIds)", "O CRECI VEM JUNTO"],
    ] as const) {
      const corpo = corpoDe(inicio, fim);
      const leitura = corpo.indexOf("await lerNomesDeMercado(adminClient)");
      const laco = corpo.indexOf("index += SYNC_BATCH_SIZE");
      expect(leitura).toBeGreaterThan(-1);
      expect(laco).toBeGreaterThan(leitura);
      expect(corpo.split("lerNomesDeMercado(").length - 1).toBe(1);
    }
  });

  it("a consulta do C2X traz o id ao lado do nome, na mesma ordenação", () => {
    expect(SERVER).toContain(
      "substring_index(group_concat(coalesce(cast(e.id as char), '') order by ar.updated_at desc, ar.id desc separator '||'), '||', 1) as latest_enterprise_id,",
    );
    expect(SERVER).toMatch(/then coalesce\(cast\(e\.id as char\), ''\) else null end order by ar\.updated_at desc, ar\.id desc separator '\|\|'\), '\|\|', 1\) as latest_paid_enterprise_id,/);
    expect(SERVER).toContain("portfolio.latest_enterprise_id,");
    expect(SERVER).toContain("portfolio.latest_paid_enterprise_id,");
  });
});
