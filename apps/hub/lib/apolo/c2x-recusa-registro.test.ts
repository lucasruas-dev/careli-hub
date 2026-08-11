import { describe, expect, it } from "vitest";

import {
  enviarEntidadeParaC2x,
  processarLoteC2x,
  recusaPorImobiliaria,
  type ConsultaC2xPorDocumento,
  type ImobiliariaDaCad,
} from "./c2x-write-server";

// A REGRA QUE ESTE ARQUIVO PROTEGE: toda TENTATIVA REAL que termina em recusa vira LINHA na
// `apolo_c2x_sync`, com o motivo real e com a classe que diz de quem é o conserto.
//
// O bug de 08/08: ~8 CADs recusadas com "Cliente sem imobiliária vinculada no C2X" e, na tabela,
// `where erro ilike '%imobili%'` devolvendo ZERO. A recusa acontecia num early-return ANTES do
// upsert 'pendente' (que fica colado no POST), então ela só existia no valor de retorno — e os
// quatro disparadores (botão do card, lote, gancho de credenciar, PIX pago) jogam esse retorno
// fora. Erro que não vira registro não vira trabalho.
//
// As duas metades da regra estão testadas aqui, e a segunda importa tanto quanto a primeira:
//   1. recusa em envio REAL  -> grava;
//   2. recusa em ENSAIO      -> NÃO grava (diagnóstico não pode mudar o estado);
//   3. envio EM VOO          -> NÃO grava (sobrescrever a linha 'pendente' mataria a trava
//                               anti-duplicado do envio que está viajando).
//
// Nenhum teste toca rede: o Supabase é um cliente falso e o MySQL do C2X não tem env em teste
// (`getHadesDbPool` devolve ok:false antes de abrir conexão). O POST nunca é alcançado — todos os
// caminhos aqui são recusas ANTES dele.

type Escrita = { tabela: string; tipo: "update" | "upsert"; valores: Record<string, unknown> };

// Cliente Supabase falso: cada tabela devolve as linhas que o teste plantou, e toda escrita é
// registrada em vez de ir para o banco. Os filtros (.eq/.ilike/.in...) são no-ops de propósito —
// cada fixture já contém só o que aquele caminho deve enxergar.
function clienteFalso(linhas: Record<string, unknown[]>) {
  const escritas: Escrita[] = [];

  const consulta = (tabela: string) => {
    const dados = linhas[tabela] ?? [];
    // Uma mesma tabela é lida de dois jeitos no lote (a LISTA de candidatas e o `single()` da
    // imobiliária). `tabela#single` deixa o teste responder coisas diferentes para cada leitura,
    // que é o que o banco de verdade faz — sem isso a imobiliária seria a própria candidata.
    const doSingle = linhas[`${tabela}#single`] ?? dados;
    const alvo: Record<string, unknown> = {
      // Thenable: `await` em qualquer ponto da corrente devolve o formato do PostgREST.
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data: dados, error: null }),
      maybeSingle: () => Promise.resolve({ data: dados[0] ?? null, error: null }),
      single: () =>
        Promise.resolve(
          doSingle[0]
            ? { data: doSingle[0], error: null }
            : { data: null, error: { message: "sem linha" } },
        ),
      upsert: (valores: Record<string, unknown>) => {
        escritas.push({ tabela, tipo: "upsert", valores });
        return Promise.resolve({ error: null });
      },
      update: (valores: Record<string, unknown>) => {
        escritas.push({ tabela, tipo: "update", valores });
        return alvo;
      },
    };
    for (const metodo of [
      "eq",
      "ilike",
      "in",
      "limit",
      "neq",
      "not",
      "order",
      "select",
    ] as const) {
      alvo[metodo] = () => alvo;
    }
    return alvo;
  };

  const client = { from: (tabela: string) => consulta(tabela) };
  return { client: client as unknown as Parameters<typeof processarLoteC2x>[0]["client"], escritas };
}

const CPF = "111.444.777-35";
const DOC = "11144477735";

// A pessoa NÃO está no C2X, e a pergunta FOI feita (documento em `consultados`). Sem isto o código
// faz a consulta unitária no MySQL — que em teste devolve "indisponível" e desviaria o caminho.
const naoExisteNoC2x: ConsultaC2xPorDocumento = {
  candidatos: new Map(),
  consultados: new Set([DOC]),
  ids: new Map(),
  nomes: new Map(),
  ok: true,
};

const entidadeCliente = {
  display_name: "FULANO DE TAL",
  document_masked: CPF,
  entity_kind: "pf",
  id: "11111111-1111-1111-1111-111111111111",
  legal_name: null,
  metadata: { bornRole: "prospect", cadastro: { nacionalidade: "Brasileira" }, source: "apolo" },
  trade_name: null,
};

const filaDaRecusa = (escritas: Escrita[]) =>
  escritas.filter((e) => e.tabela === "apolo_c2x_sync");

describe("recusa no funil (enviarEntidadeParaC2x)", () => {
  it("cliente sem imobiliária no C2X: grava linha 'erro' apontando para a IMOBILIÁRIA", async () => {
    const { client, escritas } = clienteFalso({ apolo_entities: [entidadeCliente] });

    const r = await enviarEntidadeParaC2x({
      client,
      consultaC2x: naoExisteNoC2x,
      entityId: entidadeCliente.id,
      ficha: null,
      // vinculedById ausente = a imobiliária não foi achada no C2X. É o caso de 08/08.
    });

    expect(r.status).toBe("erro");
    const linhas = filaDaRecusa(escritas);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.valores).toMatchObject({
      entity_id: entidadeCliente.id,
      // A fila é NOT NULL em `perfil`: sem ele o upsert falharia em silêncio.
      perfil: "cliente",
      status: "erro",
    });
    // O `select ... where erro ilike '%imobili%'` que devolvia ZERO agora acha esta linha.
    expect(String(linhas[0]?.valores.erro)).toMatch(/imobili/i);
    // E o card sabe PARA ONDE IR: não é a ficha do cliente.
    expect(String(linhas[0]?.valores.erro)).toContain("CADASTRO DA IMOBILIÁRIA");
    expect(r.erro).toBe(linhas[0]?.valores.erro);
    // Classe legível por máquina, para separar "não é culpa da ficha" numa consulta.
    expect((linhas[0]?.valores.resposta as Record<string, unknown>)._classe).toBe("imobiliaria");
    expect((linhas[0]?.valores.resposta as Record<string, unknown>)._origem).toBe("recusa_local");
  });

  it("papel que não sobe: grava linha mesmo sem perfil (a coluna é NOT NULL)", async () => {
    const corretor = {
      ...entidadeCliente,
      metadata: { bornRole: "corretor", cadastro: {}, source: "apolo" },
    };
    const { client, escritas } = clienteFalso({ apolo_entities: [corretor] });

    const r = await enviarEntidadeParaC2x({
      client,
      consultaC2x: naoExisteNoC2x,
      entityId: corretor.id,
      ficha: null,
    });

    expect(r.status).toBe("erro");
    const linhas = filaDaRecusa(escritas);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.valores.perfil).toBe("indefinido");
    expect((linhas[0]?.valores.resposta as Record<string, unknown>)._classe).toBe("papel");
  });

  it("C2X mudo: grava, e a classe diz que não é trabalho de ninguém", async () => {
    const { client, escritas } = clienteFalso({ apolo_entities: [entidadeCliente] });

    const r = await enviarEntidadeParaC2x({
      client,
      consultaC2x: { motivo: "connect ETIMEDOUT", ok: false },
      entityId: entidadeCliente.id,
      ficha: null,
      vinculedById: 4314,
    });

    expect(r.status).toBe("erro");
    const linhas = filaDaRecusa(escritas);
    expect(linhas).toHaveLength(1);
    expect((linhas[0]?.valores.resposta as Record<string, unknown>)._classe).toBe("indisponivel");
    expect(String(linhas[0]?.valores.erro)).toContain("connect ETIMEDOUT");
    // NADA foi enviado: o upsert é o da recusa, não o 'pendente' que antecede o POST.
    expect(linhas[0]?.valores.status).toBe("erro");
  });

  it("ficha sem CPF/CNPJ: cai na classe FICHA, não em 'C2X indisponível'", async () => {
    const semDoc = { ...entidadeCliente, document_masked: null };
    const { client, escritas } = clienteFalso({ apolo_entities: [semDoc] });

    await enviarEntidadeParaC2x({
      client,
      consultaC2x: naoExisteNoC2x,
      entityId: semDoc.id,
      ficha: null,
      vinculedById: 4314,
    });

    const linhas = filaDaRecusa(escritas);
    expect(linhas).toHaveLength(1);
    expect((linhas[0]?.valores.resposta as Record<string, unknown>)._classe).toBe("ficha");
    expect(String(linhas[0]?.valores.erro)).toContain("FICHA DO CLIENTE");
  });

  it("envio EM VOO: NÃO grava — a linha 'pendente' é do envio que está viajando", async () => {
    const { client, escritas } = clienteFalso({
      apolo_c2x_sync: [{ atualizado_em: new Date().toISOString(), status: "pendente" }],
      apolo_entities: [entidadeCliente],
    });

    const r = await enviarEntidadeParaC2x({
      client,
      consultaC2x: naoExisteNoC2x,
      entityId: entidadeCliente.id,
      ficha: null,
      vinculedById: 4314,
    });

    expect(r.status).toBe("erro");
    expect(r.erro).toContain("em andamento");
    // Nenhuma escrita: sobrescrever com 'erro' mataria a trava anti-duplicado do outro envio.
    expect(filaDaRecusa(escritas)).toHaveLength(0);
  });
});

describe("recusa no lote (processarLoteC2x)", () => {
  // A imobiliária da CAD: PJ sem CNPJ utilizável, que é o caso real da RICAJ NEGOCIOS
  // IMOBILIARIOS LTDA (`document_masked = "Documento em revisao"`). Sem dígitos, o código nem
  // pergunta ao C2X — o teste continua hermético e a recusa é determinística.
  const fixture = {
    apolo_entities: [
      {
        ...entidadeCliente,
        metadata: { bornRole: "prospect", cadastro: {}, source: "apolo" },
      },
    ],
    "apolo_entities#single": [
      {
        display_name: "IMOBILIARIA SEM CNPJ LTDA",
        document_masked: "Documento em revisao",
        legal_name: null,
      },
    ],
    apolo_relationships: [{ related_entity_id: "22222222-2222-2222-2222-222222222222" }],
  };

  it("ENSAIO não grava nada: diagnóstico que muda o estado é o outro lado do mesmo bug", async () => {
    const { client, escritas } = clienteFalso(fixture);

    const r = await processarLoteC2x({ client, dryRun: true });

    expect(r.resumo.faltando).toBe(1);
    expect(filaDaRecusa(escritas)).toHaveLength(0);
  });

  it("envio real: grava, nomeia a imobiliária e leva junto o que falta na ficha", async () => {
    const { client, escritas } = clienteFalso(fixture);

    const r = await processarLoteC2x({ client, dryRun: false });

    expect(r.resumo.faltando).toBe(1);
    const linhas = filaDaRecusa(escritas);
    expect(linhas).toHaveLength(1);
    const erro = String(linhas[0]?.valores.erro);
    // Para onde ir, com nome: "sem imobiliária no C2X" vira uma tarefa com endereço.
    expect(erro).toContain("CADASTRO DA IMOBILIÁRIA");
    expect(erro).toContain("IMOBILIARIA SEM CNPJ LTDA");
    // E o que falta NA FICHA vai junto, para não descobrir o segundo problema só na próxima vez.
    expect(erro).toContain("falta preencher na ficha");
    expect(erro).toContain("Escolaridade");
    expect((linhas[0]?.valores.resposta as Record<string, unknown>)._classe).toBe("imobiliaria");
  });

  it("`tentarTodas` NÃO passa por cima da imobiliária: seria trocar recusa com nome por recusa cega", async () => {
    const { client, escritas } = clienteFalso(fixture);

    const r = await processarLoteC2x({ client, dryRun: false, tentarTodas: true });

    // Sem `vinculed_by_id` a API do C2X nem chega a ser chamada (o funil recusa antes), então
    // deixar passar aqui só perderia o nome da imobiliária.
    expect(r.itens[0]?.status).toBe("faltando");
    expect(String(filaDaRecusa(escritas)[0]?.valores.erro)).toContain("IMOBILIARIA SEM CNPJ LTDA");
  });
});

describe("recusaPorImobiliaria: cada desfecho tem um conserto diferente", () => {
  const base: ImobiliariaDaCad = {
    c2xUserId: null,
    conferida: true,
    documento: "44.988.977/0001-34",
    entityId: "33333333-3333-3333-3333-333333333333",
    nome: "BELTRAO IMOVEIS",
  };

  it("sem vínculo no Apolo: o conserto é vincular a imobiliária na CAD", () => {
    const r = recusaPorImobiliaria({ ...base, documento: null, entityId: null, nome: null });
    expect(r.classe).toBe("imobiliaria");
    expect(r.motivo).toContain("não tem imobiliária vinculada no Apolo");
  });

  it("imobiliária sem CNPJ: o conserto é o cadastro DELA, e o nome vai junto", () => {
    const r = recusaPorImobiliaria({ ...base, documento: "Documento em revisao" });
    expect(r.classe).toBe("imobiliaria");
    expect(r.motivo).toContain("BELTRAO IMOVEIS");
    expect(r.motivo).toContain("sem CNPJ utilizável");
  });

  it("imobiliária existe no Apolo e não no C2X: acusa o cadastro dela, não a ficha do cliente", () => {
    const r = recusaPorImobiliaria(base);
    expect(r.classe).toBe("imobiliaria");
    expect(r.motivo).toContain("não tem cadastro no C2X");
    expect(r.motivo).toContain("não na ficha do cliente");
  });

  it("🔴 C2X mudo: NÃO acusa a imobiliária — 'não perguntei' nunca pode virar 'não existe'", () => {
    // Sem este ramo, uma queda do MySQL do legado mandaria o time consertar 24 imobiliárias que
    // estão perfeitas: `c2xUserId: null` é o mesmo valor nos dois casos.
    const r = recusaPorImobiliaria({ ...base, conferida: false });
    expect(r.classe).toBe("indisponivel");
    expect(r.motivo).toContain("não deu para conferir");
    expect(r.motivo).not.toContain("não tem cadastro no C2X");
  });
});
