import { describe, expect, it } from "vitest";

import {
  enviarEntidadeParaC2x,
  processarLoteC2x,
  type ConsultaC2xPorDocumento,
} from "./c2x-write-server";

// A REGRA QUE ESTE ARQUIVO PROTEGE: o documento não casa pessoa sozinho.
//
// Reconciliar é gravar na nossa fila o `users.id` do C2X achado pelo DOCUMENTO. Quando o CPF do
// Apolo está errado por um dígito, esse id é de OUTRA PESSOA — e a CAD de um vira o cliente de
// outro, num sistema de CONTRATOS, sem nenhum alarme: o id volta, a gravação dá certo, o card fica
// verde. É o desfecho mais caro desta fase e o único sem sintoma.
//
// Então são TRÊS desfechos, não dois, e o terceiro é o que protege:
//   documento bate + nome bate -> RECONCILIA (grava o id, não envia nada);
//   documento bate + nome NÃO  -> NÃO reconcilia, NÃO envia, e vira TRABALHO (linha 'erro',
//                                 classe "identidade", com os dois nomes na mensagem);
//   documento não bate         -> segue o fluxo normal de envio.
//
// Nenhum teste toca rede: o Supabase é falso e o MySQL do C2X não tem env em teste. Isso, por si,
// prova uma segunda coisa importante — a consulta em bloco é REUSADA. Se o código perguntasse de
// novo por pessoa (o N+1 que o lote não pode ter), `getHadesDbPool` devolveria ok:false e todo caso
// abaixo cairia em "indisponível" em vez de "existe".

type Escrita = { tabela: string; tipo: "update" | "upsert"; valores: Record<string, unknown> };

function clienteFalso(linhas: Record<string, unknown[]>) {
  const escritas: Escrita[] = [];

  const consulta = (tabela: string) => {
    const dados = linhas[tabela] ?? [];
    const doSingle = linhas[`${tabela}#single`] ?? dados;
    const alvo: Record<string, unknown> = {
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
    for (const metodo of ["eq", "ilike", "in", "limit", "neq", "not", "order", "select"] as const) {
      alvo[metodo] = () => alvo;
    }
    return alvo;
  };

  const client = { from: (tabela: string) => consulta(tabela) };
  return { client: client as unknown as Parameters<typeof processarLoteC2x>[0]["client"], escritas };
}

const CPF = "111.444.777-35";
const DOC = "11144477735";
const ID_NO_C2X = 4758;

// A pessoa ESTÁ no C2X, com este id e este nome. É o que a consulta em bloco do lote devolve.
const existeNoC2xComNome = (nome: string): ConsultaC2xPorDocumento => ({
  candidatos: new Map([[DOC, [{ id: ID_NO_C2X, nome }]]]),
  consultados: new Set([DOC]),
  ids: new Map([[DOC, ID_NO_C2X]]),
  nomes: new Map([[DOC, nome]]),
  ok: true,
});

const entidade = {
  display_name: "RAMON LEITE GASPAR",
  document_masked: CPF,
  entity_kind: "pf",
  id: "11111111-1111-1111-1111-111111111111",
  legal_name: null,
  metadata: { bornRole: "prospect", cadastro: { nacionalidade: "Brasileira" }, source: "apolo" },
  trade_name: null,
};

const naFila = (escritas: Escrita[]) => escritas.filter((e) => e.tabela === "apolo_c2x_sync");

describe("trava anti-duplicado no FUNIL (enviarEntidadeParaC2x)", () => {
  it("nome bate: reconcilia, grava o id e NÃO envia nada", async () => {
    const { client, escritas } = clienteFalso({ apolo_entities: [entidade] });

    const r = await enviarEntidadeParaC2x({
      client,
      consultaC2x: existeNoC2xComNome("RAMON LEITE GASPAR"),
      entityId: entidade.id,
      ficha: null,
      // Sem `vinculedById` de propósito: quem já está no C2X não precisa de imobiliária para nada,
      // porque não vamos criar ninguém. A trava tem que vir ANTES do gate da imobiliária.
    });

    // Nem sucesso de envio, nem erro: o terceiro desfecho.
    expect(r.status).toBe("ja_no_c2x");
    expect(r.c2xUserId).toBe(ID_NO_C2X);
    const linhas = naFila(escritas);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.valores).toMatchObject({ c2x_user_id: ID_NO_C2X, status: "ja_no_c2x" });
    // Nenhuma linha 'pendente' foi criada — 'pendente' é o carimbo de que um POST vai sair.
    expect(linhas.some((l) => l.valores.status === "pendente")).toBe(false);
    // E o selo do card apaga: a entidade recebe o id e o carimbo, por MERGE.
    const naEntidade = escritas.find((e) => e.tabela === "apolo_entities");
    expect((naEntidade?.valores.metadata as Record<string, unknown>).c2xUserId).toBe(ID_NO_C2X);
    expect((naEntidade?.valores.metadata as Record<string, unknown>).c2xReconciliado).toBe(true);
  });

  it("nome NÃO bate: não reconcilia, não envia, e vira linha de trabalho", async () => {
    const { client, escritas } = clienteFalso({ apolo_entities: [entidade] });

    const r = await enviarEntidadeParaC2x({
      client,
      // Mesmo CPF, outra pessoa: é exatamente o que um dígito errado no Apolo produz.
      consultaC2x: existeNoC2xComNome("MARCOS ANTONIO DA SILVA"),
      entityId: entidade.id,
      ficha: null,
    });

    expect(r.status).toBe("erro");
    // 🔴 O ponto do teste: NENHUM id foi gravado. Reconciliar aqui ligaria a CAD ao cliente errado.
    expect(r.c2xUserId).toBeUndefined();
    const linhas = naFila(escritas);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.valores.status).toBe("erro");
    expect(linhas[0]?.valores.c2x_user_id).toBeUndefined();
    expect((linhas[0]?.valores.resposta as Record<string, unknown>)._classe).toBe("identidade");
    // A mensagem carrega OS DOIS nomes e o id: conferência é de olho, não de fé.
    const erro = String(linhas[0]?.valores.erro);
    expect(erro).toContain("RAMON LEITE GASPAR");
    expect(erro).toContain("MARCOS ANTONIO DA SILVA");
    expect(erro).toContain(String(ID_NO_C2X));
    expect(erro).toContain("CONFERIR A IDENTIDADE");
    // A entidade NÃO é carimbada: nada de `c2xSynced` para quem não foi nem enviado nem casado.
    expect(escritas.some((e) => e.tabela === "apolo_entities")).toBe(false);
  });
});

describe("modo RECONCILIAÇÃO no lote (apenasReconciliar)", () => {
  const fixture = { apolo_entities: [entidade], apolo_esteira: [] };

  it("ENSAIO mostra o par lado a lado e NÃO grava nada", async () => {
    const { client, escritas } = clienteFalso(fixture);

    const r = await processarLoteC2x({
      client,
      consultaC2x: existeNoC2xComNome("RAMON LEITE GASPAR"),
      dryRun: true,
    });

    expect(r.resumo.jaNoC2x).toBe(1);
    // Os dois nomes e o id voltam no item: é o que a amostra do ensaio imprime para conferência.
    expect(r.itens[0]).toMatchObject({
      c2xUserId: ID_NO_C2X,
      nome: "RAMON LEITE GASPAR",
      nomeNoC2x: "RAMON LEITE GASPAR",
      status: "ja_no_c2x",
    });
    // Ensaio é ensaio: nenhuma escrita, nem na fila nem na entidade.
    expect(escritas).toHaveLength(0);
  });

  it("com --aplicar grava o id na fila, e NENHUM caminho leva a um envio", async () => {
    const { client, escritas } = clienteFalso(fixture);

    const r = await processarLoteC2x({
      apenasReconciliar: true,
      client,
      consultaC2x: existeNoC2xComNome("RAMON LEITE GASPAR"),
      dryRun: false,
    });

    expect(r.resumo.jaNoC2x).toBe(1);
    expect(r.resumo.enviadas).toBe(0);
    expect(naFila(escritas)[0]?.valores).toMatchObject({
      c2x_user_id: ID_NO_C2X,
      // Um erro antigo ("E-mail de acesso já cadastrado") tem que sair: a pendência acabou.
      erro: null,
      status: "ja_no_c2x",
    });
  });

  it("nome divergente vira SUSPEITO: sai como 'conferir' e não é reconciliado", async () => {
    const { client, escritas } = clienteFalso(fixture);

    const r = await processarLoteC2x({
      apenasReconciliar: true,
      client,
      consultaC2x: existeNoC2xComNome("MARCOS ANTONIO DA SILVA"),
      dryRun: false,
    });

    expect(r.resumo.jaNoC2x).toBe(0);
    expect(r.itens[0]?.status).toBe("conferir");
    // O par continua visível (é o que a lista de suspeitos mostra), mas NÃO foi gravado como vínculo.
    expect(r.itens[0]?.c2xUserId).toBe(ID_NO_C2X);
    expect(r.itens[0]?.nomeNoC2x).toBe("MARCOS ANTONIO DA SILVA");
    const linhas = naFila(escritas);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.valores.status).toBe("erro");
    expect(linhas[0]?.valores.c2x_user_id).toBeUndefined();
    expect((linhas[0]?.valores.resposta as Record<string, unknown>)._classe).toBe("identidade");
  });

  it("`tentarTodas` NÃO passa por cima da divergência de nome", async () => {
    // `tentarTodas` existe para os campos em que o nosso gate é um palpite sobre a regra da API.
    // Esta trava não é palpite: é leitura do banco de produção do C2X, e a API não tem como
    // refazê-la — para ela, o POST é sempre "criar mais um".
    const { client } = clienteFalso(fixture);

    const r = await processarLoteC2x({
      client,
      consultaC2x: existeNoC2xComNome("MARCOS ANTONIO DA SILVA"),
      dryRun: false,
      tentarTodas: true,
    });

    expect(r.itens[0]?.status).toBe("conferir");
    expect(r.resumo.enviadas).toBe(0);
  });

  it("ensaio com nome divergente também não grava nada", async () => {
    const { client, escritas } = clienteFalso(fixture);

    const r = await processarLoteC2x({
      client,
      consultaC2x: existeNoC2xComNome("MARCOS ANTONIO DA SILVA"),
      dryRun: true,
    });

    expect(r.itens[0]?.status).toBe("conferir");
    expect(escritas).toHaveLength(0);
  });
});

// ── O QUARTO DESFECHO: O DOCUMENTO ACHOU MAIS DE UM CADASTRO ────────────────────────────────────
//
// Medido no banco de produção do C2X em 08/08: 27 documentos aparecem em mais de um `users.id`
// (90 usuários no total). O critério antigo — "vence o maior id" — acertou 6 dos 12 grupos em que
// dá para saber qual é o certo (um irmão tem `acquisition_requests`, o outro não). Moeda ao ar.
// E o nome NÃO protege deste caso, que é o que o torna pior que a divergência: os gêmeos se chamam
// igual, a régua aprova, e o id errado entra na fila calado. Já aconteceu: RAFAEL GONCALVES LEITE
// (13261969601) está ligado ao 4776, que tem ZERO pedidos, enquanto o pedido está no 4068.
const doisCadastrosNoC2x = (a: string, b: string): ConsultaC2xPorDocumento => ({
  // Fora de ordem de propósito: a mensagem tem que listar por id crescente (o mais antigo
  // primeiro), venha o banco na ordem que vier.
  candidatos: new Map([[DOC, [{ id: 4776, nome: b }, { id: 4068, nome: a }]]]),
  consultados: new Set([DOC]),
  // O `ids`/`nomes` antigo aponta para o MAIOR id — é a escolha que este teste existe para impedir.
  ids: new Map([[DOC, 4776]]),
  nomes: new Map([[DOC, b]]),
  ok: true,
});

describe("documento em MAIS DE UM cadastro do C2X: ninguém escolhe por nós", () => {
  it("funil: não reconcilia (nem com nomes idênticos), não envia, e vira trabalho", async () => {
    const { client, escritas } = clienteFalso({ apolo_entities: [entidade] });

    const r = await enviarEntidadeParaC2x({
      client,
      consultaC2x: doisCadastrosNoC2x("RAMON LEITE GASPAR", "RAMON LEITE GASPAR"),
      entityId: entidade.id,
      ficha: null,
    });

    expect(r.status).toBe("erro");
    // 🔴 O ponto: nenhum id foi escolhido. Com os dois nomes iguais, a régua de nome aprovaria — e
    // teria 50% de chance de gravar o gêmeo vazio.
    expect(r.c2xUserId).toBeUndefined();

    const linhas = naFila(escritas);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.valores).toMatchObject({ status: "erro" });
    // Nada de 'pendente': nenhum POST foi preparado (enviar criaria o TERCEIRO cadastro).
    expect(linhas.some((l) => l.valores.status === "pendente")).toBe(false);
    // E nenhum carimbo na entidade: o selo do card NÃO pode apagar com o vínculo indefinido.
    expect(escritas.some((e) => e.tabela === "apolo_entities")).toBe(false);

    // A mensagem entrega os DOIS ids, em ordem crescente, para a escolha ser de olho.
    expect(r.erro).toContain("4068");
    expect(r.erro).toContain("4776");
    expect(r.erro?.indexOf("4068")).toBeLessThan(r.erro?.indexOf("4776") ?? 0);
    expect(r.erro).toContain("2 cadastros");
  });

  it("lote: sai como 'conferir' e não vira reconciliação nem envio", async () => {
    const { client, escritas } = clienteFalso({ apolo_entities: [entidade] });

    const r = await processarLoteC2x({
      client,
      consultaC2x: doisCadastrosNoC2x("RAMON LEITE GASPAR", "RAMON LEITE GASPAR"),
      dryRun: false,
    });

    expect(r.itens).toHaveLength(1);
    expect(r.itens[0]?.status).toBe("conferir");
    expect(r.itens[0]?.erro).toContain("4068");
    expect(naFila(escritas).some((l) => l.valores.status === "ja_no_c2x")).toBe(false);
    expect(naFila(escritas).some((l) => l.valores.c2x_user_id != null)).toBe(false);
  });

  it("ENSAIO com documento ambíguo não grava nada", async () => {
    const { client, escritas } = clienteFalso({ apolo_entities: [entidade] });

    const r = await processarLoteC2x({
      client,
      consultaC2x: doisCadastrosNoC2x("RAMON LEITE GASPAR", "RAMON LEITE GASPAR"),
      dryRun: true,
    });

    expect(r.itens[0]?.status).toBe("conferir");
    expect(naFila(escritas)).toHaveLength(0);
  });
});

describe("cadastro SEM NOME no C2X: bloqueia, mas manda para o lugar certo", () => {
  it("não acusa 'OUTRA PESSOA' e não manda conferir o CPF da ficha", async () => {
    const { client } = clienteFalso({ apolo_entities: [entidade] });

    const r = await enviarEntidadeParaC2x({
      client,
      // 425 usuários do C2X estão assim, e isso respondia por 423 dos 471 vetos de nome.
      consultaC2x: existeNoC2xComNome(""),
      entityId: entidade.id,
      ficha: null,
    });

    expect(r.status).toBe("erro");
    expect(r.c2xUserId).toBeUndefined();
    expect(r.erro).toContain("SEM NOME");
    expect(r.erro).toContain(String(ID_NO_C2X));
    // 🔴 O beco sem saída da versão anterior: o CPF daqui está certo e não existe nome do outro
    // lado para "fazer bater" — mandar o operador mexer na ficha era mandá-lo caçar fantasma.
    expect(r.erro).not.toContain("OUTRA PESSOA");
    expect(r.erro).toContain("está CERTO");
  });
});
