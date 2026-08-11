import { describe, expect, it } from "vitest";

import { processarLoteC2x, registrarRecusaC2x } from "./c2x-write-server";

// 🔴 A RECUSA NÃO PODE APAGAR A TRAVA ANTI-DUPLICADO.
//
// `registrarRecusaC2x` faz upsert por `entity_id` e escreve `status = 'erro'`. `envioEmVooC2x`
// reconhece "tem envio viajando agora" por `status = 'pendente'`. Junte os dois: uma recusa
// disparada enquanto outro gatilho está no meio do POST apagava o 'pendente' e destravava a porta.
//
// Não é hipótese de laboratório — são QUATRO gatilhos e dois deles não passam por rota nenhuma
// (esteira.ts quando a etapa vira "credenciado" e prevenda-fluxo.ts quando o PIX é confirmado, este
// com teto de 8s: ele PARA DE ESPERAR e o envio segue no ar sem ninguém olhando). O atalho que
// existe na rota do botão não protege desses dois.
//
// O desfecho caro: destravado, o próximo disparo chama de novo o `POST /api/v1/users`, que é
// genérico, cria de novo a cada chamada e NÃO TEM DESFAZER — cliente duplicado num sistema de
// contratos. E não se perde registro nenhum ao pular: o envio que está no ar grava o desfecho dele
// quando voltar.

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
  return { client: { from: consulta } as never, escritas };
}

const ENTIDADE = {
  display_name: "FULANO DE TAL",
  document_masked: "111.444.777-35",
  entity_kind: "pf",
  id: "11111111-1111-1111-1111-111111111111",
  legal_name: null,
  metadata: { bornRole: "prospect", cadastro: {}, source: "apolo" },
  trade_name: null,
};

// A CAD sem imobiliária utilizável: o gate do lote recusa antes de qualquer POST.
const fixtureBase = {
  apolo_entities: [ENTIDADE],
  "apolo_entities#single": [
    { display_name: "IMOBILIARIA SEM CNPJ LTDA", document_masked: "Documento em revisao", legal_name: null },
  ],
  apolo_relationships: [{ related_entity_id: "22222222-2222-2222-2222-222222222222" }],
};

const naFila = (escritas: Escrita[]) => escritas.filter((e) => e.tabela === "apolo_c2x_sync");

describe("recusa x envio em voo", () => {
  it("🔴 com envio EM VOO, a recusa do lote NÃO sobrescreve o 'pendente'", async () => {
    const { client, escritas } = clienteFalso({
      ...fixtureBase,
      apolo_c2x_sync: [{ atualizado_em: new Date().toISOString(), status: "pendente" }],
    });

    const r = await processarLoteC2x({ client, dryRun: false });

    // A recusa continua sendo recusa (a ficha não sobe).
    expect(r.itens[0]?.status).toBe("faltando");
    // Mas a linha 'pendente' fica intacta: ela é a trava do envio que está viajando.
    expect(naFila(escritas)).toHaveLength(0);
  });

  it("'pendente' VELHO (execução que morreu) não trava nada: a recusa grava normalmente", async () => {
    const antigo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { client, escritas } = clienteFalso({
      ...fixtureBase,
      apolo_c2x_sync: [{ atualizado_em: antigo, status: "pendente" }],
    });

    await processarLoteC2x({ client, dryRun: false });

    const linhas = naFila(escritas);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.valores.status).toBe("erro");
    expect(String(linhas[0]?.valores.erro)).toContain("IMOBILIARIA SEM CNPJ LTDA");
  });

  it("sem linha nenhuma na fila: grava (é o caso normal, e o mais comum)", async () => {
    const { client, escritas } = clienteFalso(fixtureBase);

    const mensagem = await registrarRecusaC2x(client, {
      classe: "ficha",
      documento: "11144477735",
      entityId: ENTIDADE.id,
      motivo: "falta Escolaridade.",
      perfil: "cliente",
    });

    expect(mensagem).toContain("FICHA DO CLIENTE");
    expect(naFila(escritas)).toHaveLength(1);
  });

  // A tela montava a frase do jeito dela, a partir de `faltantes`: "Falta Imobiliária. Complete na
  // ficha e clique de novo." Só que o conserto NÃO é na ficha do cliente — é o cadastro da
  // imobiliária. A fila já dizia isso; o `ItemLote` não levava a frase, então a tela inventava a
  // dela e mandava o operador para o lugar errado.
  it("o ItemLote leva a MESMA frase que foi para a fila (tela e tabela não divergem)", async () => {
    const { client } = clienteFalso(fixtureBase);

    const r = await processarLoteC2x({ client, dryRun: false });

    expect(r.itens[0]?.status).toBe("faltando");
    expect(r.itens[0]?.erro).toContain("CADASTRO DA IMOBILIÁRIA");
    expect(r.itens[0]?.erro).toContain("IMOBILIARIA SEM CNPJ LTDA");
  });

  it("no ENSAIO a frase também volta — o que o ensaio não faz é GRAVAR", async () => {
    const { client, escritas } = clienteFalso(fixtureBase);

    const r = await processarLoteC2x({ client, dryRun: true });

    expect(r.itens[0]?.erro).toContain("CADASTRO DA IMOBILIÁRIA");
    expect(naFila(escritas)).toHaveLength(0);
  });

  it("mesmo pulando a gravação, a MENSAGEM volta para quem chamou (a tela não fica muda)", async () => {
    const { client } = clienteFalso({
      apolo_c2x_sync: [{ atualizado_em: new Date().toISOString(), status: "pendente" }],
    });

    const mensagem = await registrarRecusaC2x(client, {
      classe: "imobiliaria",
      entityId: ENTIDADE.id,
      motivo: "a imobiliária não tem cadastro no C2X.",
      perfil: "cliente",
    });

    expect(mensagem).toContain("CADASTRO DA IMOBILIÁRIA");
  });
});
