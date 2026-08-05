import { describe, expect, it } from "vitest";

import { createApoloEntity } from "./cadastro-persist";

// A CAD É POR EMPREENDIMENTO (regra do Lucas). A migration 0080 trocou a chave de `apolo_esteira`
// de `entity_id` para `(entity_id, enterprise_id)` exatamente para isso: quem já comprou no Vale
// do Ouro precisa poder abrir CAD em outro loteamento sem passar pela central.
//
// Até 04/08 a trava era GLOBAL de propósito — com uma linha por pessoa, a segunda CAD entrava POR
// CIMA da primeira (empreendimento, corretor, imobiliária, origem e etapa eram substituídos) e a
// CAD original sumia do relatório do empreendimento dela. Aquele motivo acabou junto com a chave.
//
// O que estes testes cobram é o par de invariantes que sobrou:
//   1. CAD em OUTRO empreendimento PASSA (e anexa na ficha existente, sem criar CPF duplicado);
//   2. CAD no MESMO empreendimento CONTINUA BARRADA, com a mensagem que nomeia onde ela já existe.

type CadNaEsteira = {
  empreendimento: null | string;
  enterprise_id: null | string;
  entity_id: string;
};

const CPF = "529.982.247-25";
const ENTIDADE_EXISTENTE = "ent-existente";

// Client falso no mesmo espírito do de `credenciado-na-fila.test.ts`: o builder do supabase-js é
// encadeável e "thenable". Aqui `apolo_esteira` é a única tabela com dado de verdade — é dela que
// sai a decisão de barrar ou liberar.
function clienteFake(cads: CadNaEsteira[]) {
  const escritas: Array<{ tabela: string; valores: unknown }> = [];

  const client = {
    from(tabela: string) {
      const builder: Record<string, unknown> = {
        maybeSingle: async () => ({ data: linhas()[0] ?? null, error: null }),
        single: async () => ({ data: linhas()[0] ?? null, error: null }),
        then: (resolver: (valor: unknown) => unknown) =>
          Promise.resolve(resolver({ data: linhas(), error: null })),
      };

      function linhas(): Array<Record<string, unknown>> {
        if (operacao !== "select") return [];
        // DEDUP POR DOCUMENTO: o CPF já tem ficha. É o ponto de partida dos dois testes.
        if (tabela === "apolo_entity_identifiers") return [{ entity_id: ENTIDADE_EXISTENTE }];
        if (tabela === "apolo_entities") {
          return [{ display_name: "MARIA DA SILVA", id: ENTIDADE_EXISTENTE, metadata: {} }];
        }
        if (tabela === "apolo_esteira") return cads;
        return [];
      }

      let operacao: "insert" | "select" | "update" | "upsert" = "select";

      for (const metodo of ["eq", "in", "is", "limit", "neq", "not", "order", "range", "select"]) {
        builder[metodo] = () => builder;
      }
      const registrar = (op: typeof operacao, valores: unknown) => {
        operacao = op;
        escritas.push({ tabela, valores });
        return builder;
      };
      builder.insert = (valores: unknown) => registrar("insert", valores);
      builder.update = (valores: unknown) => registrar("update", valores);
      builder.upsert = (valores: unknown) => registrar("upsert", valores);

      return builder;
    },
  };

  return { client: client as never, escritas };
}

const CAD_VALE_DO_OURO: CadNaEsteira = {
  empreendimento: "VALE DO OURO",
  // 35 = master VLO, o id das 637 CADs que existem hoje em produção.
  enterprise_id: "35",
  entity_id: ENTIDADE_EXISTENTE,
};

function cadastrar(cads: CadNaEsteira[], enterpriseId: null | string) {
  const { client, escritas } = clienteFake(cads);
  return {
    escritas,
    resultado: createApoloEntity(client, {
      dedupPorDocumento: true,
      enterpriseId,
      identidade: { cpf: CPF, nome: "Maria da Silva" },
      persona: "pf",
      role: "prospect",
    }),
  };
}

describe("uma CAD por pessoa POR EMPREENDIMENTO", () => {
  it("libera a segunda CAD quando é em OUTRO empreendimento", async () => {
    // A pessoa já tem CAD no Vale do Ouro (35) e o corretor está abrindo CAD no 41.
    const { resultado } = cadastrar([CAD_VALE_DO_OURO], "41");

    const r = await resultado;
    expect(r.ok).toBe(true);
  });

  it("anexa na ficha que já existe, em vez de criar um segundo CPF", async () => {
    // O dedup por documento continua valendo: a CAD nova entra na MESMA entidade. Duas entidades
    // com o mesmo CPF foi o incidente dos "dois Pedro Alexandro".
    const { escritas, resultado } = cadastrar([CAD_VALE_DO_OURO], "41");

    const r = await resultado;
    expect(r.ok && r.entityId).toBe(ENTIDADE_EXISTENTE);
    // Nenhuma ENTIDADE NOVA: `workspace_id` só existe no payload de criação (`entityRow`).
    // Se ele aparecer numa escrita de `apolo_entities`, o CPF virou duas fichas.
    const criouEntidade = escritas.some(
      (e) => e.tabela === "apolo_entities" && "workspace_id" in Object(e.valores),
    );
    expect(criouEntidade).toBe(false);
  });

  it("continua barrando a segunda CAD no MESMO empreendimento", async () => {
    const { resultado } = cadastrar([CAD_VALE_DO_OURO], "35");

    const r = await resultado;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    // A mensagem NOMEIA o empreendimento: sem isso o corretor não sabe se é a CAD dele.
    expect(r.error).toContain("já tem CAD cadastrada");
    expect(r.error).toContain("VALE DO OURO");
    // E devolve o id da ficha existente, para a tela abrir em vez de duplicar a pessoa.
    expect(r.entityIdExistente).toBe(ENTIDADE_EXISTENTE);
  });

  it("compara o empreendimento por ID, não pelo texto do nome", async () => {
    // O nome do empreendimento é escrito de N formas na base ("VALE DO OURO", "Vale do Ouro",
    // "Vale do Ouro - VLO"). Se a comparação fosse por texto, a duplicata passaria.
    const grafiaDiferente = { ...CAD_VALE_DO_OURO, empreendimento: "Vale do Ouro - VLO" };
    const { resultado } = cadastrar([grafiaDiferente], "35");

    const r = await resultado;
    expect(r.ok).toBe(false);
  });

  it("com o MESMO empreendimento em texto mas id diferente, é CAD nova", async () => {
    // O espelho do teste acima: nome parecido NÃO barra. Quem decide é o id do C2X — é o que
    // permite abrir CAD no VOC/VOL sem esbarrar na do master.
    const { resultado } = cadastrar([CAD_VALE_DO_OURO], "36");

    const r = await resultado;
    expect(r.ok).toBe(true);
  });

  it("com CAD em dois empreendimentos, ainda barra o terceiro pedido de um deles", async () => {
    // Coexistência de verdade: duas CADs vivas na mesma pessoa, e a trava continua sabendo qual é
    // qual. É o cenário que a chave composta habilitou.
    const cads = [
      CAD_VALE_DO_OURO,
      { empreendimento: "RECANTO DO PARÁ", enterprise_id: "41", entity_id: ENTIDADE_EXISTENTE },
    ];

    const noRecanto = await cadastrar(cads, "41").resultado;
    expect(noRecanto.ok).toBe(false);

    const numTerceiro = await cadastrar(cads, "42").resultado;
    expect(numTerceiro.ok).toBe(true);
  });

  // SEM EMPREENDIMENTO NÃO DÁ PARA DIZER SE É A MESMA CAD. Barrar continua sendo o certo aqui: é
  // o único ramo em que a trava segue global, e é raro (o portal público exige o empreendimento,
  // derivado do token, e o wizard interno só grava esteira quando o operador escolheu um).
  it("sem empreendimento no pedido, barra se já existir qualquer CAD", async () => {
    const { resultado } = cadastrar([CAD_VALE_DO_OURO], null);

    const r = await resultado;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toContain("já tem CAD cadastrada");
  });

  it("ficha existente SEM nenhuma CAD não é recusa: a CAD anexa nela", async () => {
    // 3.920 CPFs vivem na base vindos do sync C2X/backfill SEM nenhuma CAD. Eles tomavam um 409
    // falso ("já existe uma CAD") no último passo do portal.
    const { resultado } = cadastrar([], "35");

    const r = await resultado;
    expect(r.ok).toBe(true);
  });

  // FAIL-CLOSED: uma leitura da esteira que FALHA (blip de rede, RLS) não pode ser lida como
  // "pessoa sem CAD". O contraste é direto com o teste "libera a segunda CAD em OUTRO
  // empreendimento": lá, com enterpriseId "41" e a esteira RESPONDENDO, o resultado é ok:true. Aqui,
  // MESMO enterpriseId "41", mas a esteira FALHA — e o certo é ok:false (não libera às cegas), senão
  // o upsert entraria por cima de uma CAD viva.
  it("NÃO libera a duplicidade se a leitura da esteira falhar", async () => {
    // Fake igual ao `clienteFake`, mas a leitura de `apolo_esteira` devolve error (as leituras de
    // identificador/entidade continuam OK — é o que faz o fluxo chegar até o dedup da esteira).
    const escritas: Array<{ tabela: string; valores: unknown }> = [];
    const client = {
      from(tabela: string) {
        let operacao: "insert" | "select" | "update" | "upsert" = "select";
        const esteiraFalha = tabela === "apolo_esteira";
        const resposta = () =>
          esteiraFalha
            ? { data: null, error: { message: "network blip" } }
            : { data: linhas(), error: null };

        function linhas(): Array<Record<string, unknown>> {
          if (operacao !== "select") return [];
          if (tabela === "apolo_entity_identifiers") return [{ entity_id: ENTIDADE_EXISTENTE }];
          if (tabela === "apolo_entities") {
            return [{ display_name: "MARIA DA SILVA", id: ENTIDADE_EXISTENTE, metadata: {} }];
          }
          return [];
        }

        const builder: Record<string, unknown> = {
          maybeSingle: async () =>
            esteiraFalha
              ? { data: null, error: { message: "network blip" } }
              : { data: linhas()[0] ?? null, error: null },
          single: async () =>
            esteiraFalha
              ? { data: null, error: { message: "network blip" } }
              : { data: linhas()[0] ?? null, error: null },
          then: (resolver: (valor: unknown) => unknown) => Promise.resolve(resolver(resposta())),
        };
        for (const metodo of ["eq", "in", "is", "limit", "neq", "not", "order", "range", "select"]) {
          builder[metodo] = () => builder;
        }
        const registrar = (op: typeof operacao, valores: unknown) => {
          operacao = op;
          escritas.push({ tabela, valores });
          return builder;
        };
        builder.insert = (valores: unknown) => registrar("insert", valores);
        builder.update = (valores: unknown) => registrar("update", valores);
        builder.upsert = (valores: unknown) => registrar("upsert", valores);
        return builder;
      },
    };

    const r = await createApoloEntity(client as never, {
      dedupPorDocumento: true,
      enterpriseId: "41",
      identidade: { cpf: CPF, nome: "Maria da Silva" },
      persona: "pf",
      role: "prospect",
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.toLowerCase()).toContain("verificar cadastros");
    // E não escreveu NADA na esteira: não sobrescreveu a CAD viva do empreendimento.
    expect(escritas.some((e) => e.tabela === "apolo_esteira")).toBe(false);
  });
});
