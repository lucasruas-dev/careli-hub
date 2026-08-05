import { describe, expect, it } from "vitest";

import { persistApoloEntityBatch } from "./server";

// O SYNC NÃO PODE MAIS MANDAR NO CADASTRO.
//
// Decisão do Lucas (04/08/2026): o Apolo é dono de CLIENTE, IMOBILIÁRIA e CORRETOR; o C2X é dono
// do DINHEIRO. Antes disso, `persistApoloEntityBatch` fazia upsert de verdade em `apolo_entities`
// montando `metadata` do zero — e como o PostgREST substitui a coluna jsonb inteira, cada rodada
// do cron apagava `metadata.cadastro` e desfazia correção feita por gente. Foi o que derrubou 122
// CADs em 20/jul (etapa e analista perdidos na primeira rodada depois da importação).
//
// O que estes testes cobram, em cima da MESMA função onde as duas rotas de sync convergem:
//   1. ficha que já existe sai da rodada INTOCADA (metadata e nome corrigido continuam lá);
//   2. ficha que não existe NASCE — senão a carteira do C2X ficaria órfã (FK para apolo_entities);
//   3. a carteira continua atualizando normalmente, que é a metade que o C2X ainda manda;
//   4. o ÍNDICE DE BUSCA anda junto com a carteira: `apolo_search_entries` não é ficha, é
//      read-model, e metade do `normalized_text` é dado de compra (empreendimento, bloco/lote,
//      código da unidade e da solicitação, adimplente/inadimplente). Congelar essa tabela junto
//      com a identidade sumia com o cliente da busca do Apolo e da CACÁ quando ele comprava de
//      novo — sem erro nenhum, a busca só não achava.

type Linha = Record<string, unknown>;

type UsuarioC2x = Parameters<typeof persistApoloEntityBatch>[1][number];

// Banco em memória que imita a semântica das duas cláusulas do Postgres, porque é exatamente
// nisso que a mudança consiste: `ignoreDuplicates` (ON CONFLICT DO NOTHING) versus o upsert de
// sempre (ON CONFLICT DO UPDATE). Conferir só o parâmetro passado provaria menos: o que importa
// é o estado em que a linha fica.
function bancoFake() {
  const tabelas: Record<string, Linha[]> = {};

  const client = {
    from(tabela: string) {
      return {
        upsert(
          linhas: Linha[],
          opcoes?: { ignoreDuplicates?: boolean; onConflict?: string },
        ) {
          const chave = (opcoes?.onConflict ?? "id").split(",").map((coluna) => coluna.trim());
          const existentes = (tabelas[tabela] ??= []);
          const identidade = (linha: Linha) => chave.map((coluna) => String(linha[coluna])).join("::");

          for (const linha of linhas) {
            const atual = existentes.find((gravada) => identidade(gravada) === identidade(linha));

            if (!atual) {
              existentes.push({ ...linha });
              continue;
            }

            if (opcoes?.ignoreDuplicates) {
              continue; // ON CONFLICT DO NOTHING
            }

            Object.assign(atual, linha); // ON CONFLICT DO UPDATE (só as colunas enviadas)
          }

          return Promise.resolve({ error: null });
        },
      };
    },
  };

  return { client: client as never, tabelas };
}

// O C2X devolve NULL, não undefined, e algumas derivações do sync distinguem os dois
// (`profile_id === 2`, `person_type_id === 1`...). O fixture nasce todo nulo de propósito.
const CAMPOS_C2X = [
  "billed_request_count",
  "cellphone",
  "cnpj",
  "cpf",
  "display_name",
  "email",
  "fantasy_name",
  "latest_enterprise_name",
  "latest_paid_area",
  "latest_paid_contract_document_id",
  "latest_paid_contract_status",
  "latest_paid_contract_url",
  "latest_paid_enterprise_code",
  "latest_paid_enterprise_name",
  "latest_paid_request_id",
  "latest_paid_request_code",
  "latest_paid_stage_name",
  "latest_paid_unit_block",
  "latest_paid_unit_code",
  "latest_paid_unit_id",
  "latest_paid_unit_label",
  "latest_paid_unit_lot",
  "latest_paid_unit_price",
  "latest_request_code",
  "latest_stage_name",
  "latest_unit_label",
  "linked_party_name",
  "location_label",
  "overdue_amount",
  "overdue_installments",
  "paid_amount",
  "payment_count",
  "person_type_id",
  "person_type_name",
  "phone",
  "phone_list",
  "profile_id",
  "profile_name",
  "request_count",
  "social_name",
  "total_portfolio_amount",
  "unit_count",
  "updated_at",
  "user_name",
  "vinculed_by_id",
] as const;

// `Omit<..., "constructor">` porque a linha do C2X estende `RowDataPacket` do mysql2, que exige
// `constructor.name === "RowDataPacket"` — detalhe do driver que não interessa ao fixture.
function usuarioC2x(dados: Partial<Omit<UsuarioC2x, "constructor">> & { id: number }): UsuarioC2x {
  const vazio = Object.fromEntries(CAMPOS_C2X.map((campo) => [campo, null]));

  return { ...vazio, ...dados } as unknown as UsuarioC2x;
}

// Cliente (profile 2) que o C2X conhece com o nome mal digitado do jeito que foi cadastrado lá.
const MARIA_NO_C2X = usuarioC2x({
  cpf: "12345678909",
  display_name: "MARIA D SILVA",
  email: "maria@exemplo.com.br",
  id: 2508,
  linked_party_name: "IMOB VALE LTDA",
  location_label: "Goiania/GO",
  payment_count: 3,
  person_type_id: 1,
  profile_id: 2,
  profile_name: "Usuario",
  request_count: 1,
  vinculed_by_id: 41,
});

// O que uma pessoa arrumou no Apolo depois: nome de gente, ficha preenchida, marca do sync.
const EDICAO_HUMANA = {
  display_name: "Maria da Silva",
  legal_name: "MARIA DA SILVA",
  metadata: {
    c2xSynced: true,
    cadastro: { estadoCivilId: 2, profissao: "Enfermeira", rendaId: 4 },
    profileNames: ["Usuario"],
  },
  next_action: "Coletar comprovante de renda",
  primary_city: "Aparecida de Goiania",
  status: "active",
};

async function fichaJaExistente() {
  const banco = bancoFake();

  // Rodada 1: a ficha nasce do C2X (é o caminho que continua valendo — venda registrada direto
  // no legado precisa de onde pendurar a carteira).
  await persistApoloEntityBatch(banco.client, [MARIA_NO_C2X], "run-1", "2026-08-02T09:00:00.000Z");

  const ficha = banco.tabelas.apolo_entities?.[0];

  if (!ficha) {
    throw new Error("o sync deveria ter criado a ficha da Maria na primeira rodada");
  }

  Object.assign(ficha, EDICAO_HUMANA);

  return { banco, ficha };
}

describe("persistApoloEntityBatch — o Apolo é dono do cadastro", () => {
  it("não sobrescreve a ficha que já existe: metadata.cadastro e correção humana sobrevivem", async () => {
    const { banco, ficha } = await fichaJaExistente();

    // Rodada 2: o cron passa de novo com o mesmo dado velho do legado.
    await persistApoloEntityBatch(banco.client, [MARIA_NO_C2X], "run-2", "2026-08-02T18:00:00.000Z");

    expect(ficha.metadata).toEqual(EDICAO_HUMANA.metadata);
    expect(ficha.display_name).toBe("Maria da Silva");
    expect(ficha.next_action).toBe("Coletar comprovante de renda");
    expect(ficha.primary_city).toBe("Aparecida de Goiania");
    expect(ficha.status).toBe("active");
    expect(banco.tabelas.apolo_entities).toHaveLength(1);
  });

  it("também não sobrescreve o resto da identidade (perfis, origem, contatos, endereço)", async () => {
    const { banco } = await fichaJaExistente();

    const contato = banco.tabelas.apolo_contacts?.[0];
    const origem = banco.tabelas.apolo_source_links?.[0];
    const endereco = banco.tabelas.apolo_addresses?.[0];

    if (!contato || !origem || !endereco) {
      throw new Error("a primeira rodada deveria ter criado contato, origem e endereço");
    }

    Object.assign(contato, { status: "verified" });
    Object.assign(origem, { metadata: { corretorEmail: "corretor@imob.com.br" } });
    // Endereço digitado no CRM (cadastro-editar.ts grava na linha PRINCIPAL, que numa ficha vinda
    // do C2X é esta mesma): upsert aqui devolveria o placeholder "Endereco cadastral".
    Object.assign(endereco, { number: "120", street: "Rua das Acacias" });

    await persistApoloEntityBatch(banco.client, [MARIA_NO_C2X], "run-2", "2026-08-02T18:00:00.000Z");

    expect(contato.status).toBe("verified");
    expect(origem.metadata).toEqual({ corretorEmail: "corretor@imob.com.br" });
    expect(endereco.street).toBe("Rua das Acacias");
    expect(endereco.number).toBe("120");
    expect(banco.tabelas.apolo_entity_profiles).toHaveLength(2); // usuario + pessoa_fisica
  });

  it("cliente com ficha que compra unidade nova vira achável pelos termos da compra — e a ficha continua intacta", async () => {
    const { banco, ficha } = await fichaJaExistente();

    const buscaAntes = banco.tabelas.apolo_search_entries?.[0];

    if (!buscaAntes) {
      throw new Error("a primeira rodada deveria ter criado a linha de busca");
    }

    // Antes da compra nada do Vale do Ouro está indexado, e ela ainda está em dia.
    expect(String(buscaAntes.normalized_text)).not.toContain("vale do ouro");
    expect(String(buscaAntes.normalized_text)).toContain("comprador adimplente");

    // Rodada 2: a MESMA Maria, agora com a unidade nova e duas parcelas vencidas no legado.
    const comCompraNova = usuarioC2x({
      ...MARIA_NO_C2X,
      latest_paid_enterprise_name: "Vale do Ouro Central",
      latest_paid_request_code: "SOL-9931",
      latest_paid_unit_block: "Q10",
      latest_paid_unit_code: "VOC-Q10-L07",
      latest_paid_unit_label: "Quadra 10 Lote 07",
      overdue_installments: 2,
    });

    await persistApoloEntityBatch(banco.client, [comCompraNova], "run-2", "2026-08-02T18:00:00.000Z");

    const busca = banco.tabelas.apolo_search_entries?.[0];
    const texto = String(busca?.normalized_text ?? "");

    // É por este texto que a busca do Apolo, a rota da Iris e a CACÁ fazem ilike.
    expect(texto).toContain("vale do ouro central");
    expect(texto).toContain("voc-q10-l07");
    expect(texto).toContain("sol-9931");
    expect(texto).toContain("quadra 10 lote 07");
    expect(texto).toContain("comprador inadimplente");
    expect(texto).not.toContain("comprador adimplente");
    expect(busca?.last_synced_at).toBe("2026-08-02T18:00:00.000Z");
    // Atualizou a linha que já existia, não criou uma segunda.
    expect(banco.tabelas.apolo_search_entries).toHaveLength(1);

    // E o cadastro mantido no Apolo NÃO pagou por isso — a mesma rodada preserva a ficha.
    expect(ficha.metadata).toEqual(EDICAO_HUMANA.metadata);
    expect(ficha.display_name).toBe("Maria da Silva");
    expect(ficha.status).toBe("active");
  });

  it("cria a ficha de quem ainda não existe — sem ela a carteira do C2X fica órfã", async () => {
    const { banco } = await fichaJaExistente();

    const novo = usuarioC2x({
      cnpj: "12345678000195",
      display_name: "IMOB VALE LTDA",
      id: 9001,
      person_type_id: 2,
      profile_id: 6,
      profile_name: "Imobiliaria",
    });

    await persistApoloEntityBatch(banco.client, [novo], "run-2", "2026-08-02T18:00:00.000Z");

    const fichas = banco.tabelas.apolo_entities ?? [];

    expect(fichas).toHaveLength(2);
    expect(fichas[1]?.display_name).toBe("IMOB VALE LTDA");
    // A carteira só consegue apontar pra cá porque a ficha nasceu.
    expect(banco.tabelas.apolo_financial_snapshots?.some((linha) => linha.entity_id === fichas[1]?.id)).toBe(true);
  });

  it("a decisão vale pra TODOS os perfis, não só cliente/imobiliária/corretor", async () => {
    const banco = bancoFake();
    const perfis = [
      { id: 101, profile_id: 1 }, // colaborador
      { id: 102, profile_id: 3 }, // incorporador
      { id: 103, profile_id: 4 }, // acesso incorporador
      { id: 104, profile_id: 7 }, // corretor
      { id: 105, profile_id: null }, // user sem perfil: num filtro por perfil ficaria em limbo
    ];
    const lote = perfis.map((perfil) => usuarioC2x({ display_name: "NOME NO LEGADO", ...perfil }));

    await persistApoloEntityBatch(banco.client, lote, "run-1", "2026-08-02T09:00:00.000Z");

    for (const ficha of banco.tabelas.apolo_entities ?? []) {
      Object.assign(ficha, { display_name: "Nome arrumado no Apolo" });
    }

    await persistApoloEntityBatch(banco.client, lote, "run-2", "2026-08-02T18:00:00.000Z");

    expect(banco.tabelas.apolo_entities).toHaveLength(5);
    expect(
      (banco.tabelas.apolo_entities ?? []).map((ficha) => ficha.display_name),
    ).toEqual(Array.from({ length: 5 }, () => "Nome arrumado no Apolo"));
  });

  it("CARTEIRA continua vindo do C2X: financeiro e vínculo comercial atualizam na rodada", async () => {
    const { banco } = await fichaJaExistente();

    const comAtraso = usuarioC2x({
      ...MARIA_NO_C2X,
      latest_paid_enterprise_name: "Vale do Ouro",
      latest_paid_unit_block: "Q10",
      latest_paid_unit_lot: "07",
      overdue_amount: 1500,
      overdue_installments: 2,
      paid_amount: 4500,
      total_portfolio_amount: 90000,
    });

    // Mesmo DIA da rodada 1 de propósito: o id do snapshot é por data, então esta é a única
    // forma de provar que a linha de dinheiro é REESCRITA e não apenas somada.
    await persistApoloEntityBatch(banco.client, [comAtraso], "run-2", "2026-08-02T18:00:00.000Z");

    const snapshots = banco.tabelas.apolo_financial_snapshots ?? [];

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.overdue_amount).toBe(1500);
    expect(snapshots[0]?.paid_amount).toBe(4500);
    expect(snapshots[0]?.total_portfolio_amount).toBe(90000);
    expect(
      (banco.tabelas.apolo_commercial_links ?? []).some(
        (linha) => linha.enterprise_name === "Vale do Ouro",
      ),
    ).toBe(true);
  });
});
