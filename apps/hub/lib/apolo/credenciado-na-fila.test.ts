import { beforeEach, describe, expect, it, vi } from "vitest";

import { aplicarVinculos } from "./asana-import";
import { atualizarEtapa } from "./esteira";
import { aoConfirmarPagamentoPrevenda, aoEnviarPixPrevenda } from "./prevenda-fluxo";

// A REGRA DO DIA DO LANÇAMENTO (Lucas, 01/08): quem está em "credenciado" no Board TEM que estar
// na fila do Prometeu — é de lá que sai a impressão de etiqueta e a chamada no telão. Não existe
// credenciado invisível.
//
// O problema é que "virar credenciado" acontece por CAMINHOS DIFERENTES, e só um deles passava
// por `atualizarEtapa` (que tem o gancho da fila). Os outros gravam `etapa: "credenciado"` direto
// na tabela. Cada teste aqui percorre UM desses caminhos de ponta a ponta e cobra o mesmo
// desfecho: a pessoa aparece em `prometeu_credenciados`.
//
// Subir para o C2X é a outra consequência de credenciar e tem caminho próprio (fala com o legado
// por MySQL + API Rails): o ENVIO fica de fora daqui de propósito, senão o teste viraria teste de
// integração. O que os testes do fim do arquivo cobram é só que a CHAMADA acontece em cada
// caminho, que é onde estava o furo: o envio ao C2X morava apenas no gancho de `atualizarEtapa`.
const c2x = vi.hoisted(() => ({
  subir: vi.fn(async () => ({ detalhe: "fora do teste", enviado: false })),
}));
vi.mock("./credenciado-para-c2x", () => ({ subirParaC2xAoCredenciar: c2x.subir }));

type Linha = Record<string, unknown>;

// Client falso no mesmo espírito do de `lib/prometeu/reset-bloqueado.test.ts`: o builder do
// supabase-js é encadeável e "thenable", então todo filtro devolve o mesmo objeto e `await` na
// consulta resolve sem precisar de `.maybeSingle()`.
//
// ⚠️ Só `prometeu_eventos` RESPEITA os filtros (`eq`/`in` de status). Isso é de propósito: o bug
// achado em 01/08 foi exatamente um filtro de status errado, e sem isto o teste não perceberia a
// volta dele. Nas demais tabelas o fixture já é a linha procurada.
function clienteFake(
  cfg: {
    credenciado?: { id: string; pago_em: string | null } | null;
    entidade?: Linha | null;
    esteira?: Linha | null;
    eventos?: Array<{ id: string; status: string }>;
  } = {},
) {
  const fila: Linha[] = [];
  const esteiraGravada: Linha[] = [];

  const client = {
    from(tabela: string) {
      let operacao: "insert" | "select" | "update" | "upsert" = "select";
      const filtros: Array<{ coluna: string; valores: unknown[] }> = [];

      const linhas = (): Linha[] => {
        if (tabela === "prometeu_eventos") {
          return (cfg.eventos ?? []).filter((evento) =>
            filtros.every(
              (f) => f.coluna !== "status" || f.valores.includes(evento[f.coluna as "status"]),
            ),
          );
        }
        if (tabela === "prometeu_credenciados") {
          if (operacao === "insert") return [{ id: `cred-${fila.length}` }];
          return cfg.credenciado ? [cfg.credenciado] : [];
        }
        if (tabela === "apolo_entities") return cfg.entidade ? [cfg.entidade] : [];
        // Vale para o `select` E para o `update(...).select()`: no PostgREST o segundo devolve as
        // LINHAS AFETADAS, e é assim que o fluxo do pagamento sabe se acabou de credenciar alguém
        // (e portanto se tem ficha nova para subir ao C2X).
        if (tabela === "apolo_esteira") return cfg.esteira ? [cfg.esteira] : [];
        return [];
      };

      const builder: Record<string, unknown> = {
        maybeSingle: async () => ({ data: linhas()[0] ?? null, error: null }),
        single: async () => ({ data: linhas()[0] ?? null, error: null }),
        then: (resolver: (valor: unknown) => unknown) =>
          Promise.resolve(resolver({ data: linhas(), error: null })),
      };

      for (const metodo of ["neq", "is", "not", "order", "range", "limit", "select"]) {
        builder[metodo] = () => builder;
      }
      builder.eq = (coluna: string, valor: unknown) => {
        filtros.push({ coluna, valores: [valor] });
        return builder;
      };
      builder.in = (coluna: string, valores: unknown[]) => {
        filtros.push({ coluna, valores });
        return builder;
      };

      const registrar = (op: typeof operacao, valores: Linha) => {
        operacao = op;
        if (tabela === "prometeu_credenciados" && op === "insert") fila.push(valores);
        if (tabela === "apolo_esteira" && op !== "select") esteiraGravada.push(valores);
        return builder;
      };
      builder.insert = (valores: Linha) => registrar("insert", valores);
      builder.update = (valores: Linha) => registrar("update", valores);
      builder.upsert = (valores: Linha) => registrar("upsert", valores);

      return builder;
    },
  };

  return { client: client as never, esteiraGravada, fila };
}

const MARIA = {
  display_name: "Maria da Silva",
  document_masked: "***.456.789-**",
  legal_name: "MARIA DA SILVA",
};

// O evento do dia: quando o lançamento ABRE, o status deixa de ser "ativo" (preparo) e vira
// "em_andamento". Este é o estado em que o Prometeu passa o dia inteiro.
const EVENTO_DO_DIA = [{ id: "ev-1", status: "em_andamento" }];

// ⚠️ `enterprise_id` ENTRA EM TODA LINHA DE ESTEIRA, e não é decoração: desde a migration 0080 a
// chave da tabela é `(entity_id, enterprise_id)` — uma CAD por pessoa POR EMPREENDIMENTO. Sem ele
// a linha não existe, e as funções abaixo se recusam a gravar (é a trava contra CAD órfã).
// 35 = master do Vale do Ouro, o mesmo id das 637 CADs em produção.
const VALE_DO_OURO = "35";

function fake(
  esteira: Linha | null,
  eventos = EVENTO_DO_DIA,
  credenciado: { id: string; pago_em: string | null } | null = null,
) {
  const linha = esteira ? { enterprise_id: VALE_DO_OURO, ...esteira } : null;
  return clienteFake({ credenciado, entidade: MARIA, esteira: linha, eventos });
}

describe("caminho 1 · o operador move o card no Board (atualizarEtapa)", () => {
  it("credenciar coloca na fila do lançamento", async () => {
    const { client, fila } = fake({ corretor: "João", etapa: "prevenda", imobiliaria: "Imob X" });

    await atualizarEtapa(client, "ent-1", "credenciado");

    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({
      corretor: "João",
      entity_id: "ent-1",
      evento_id: "ev-1",
      imobiliaria: "Imob X",
      nome: "MARIA DA SILVA",
    });
  });

  // REGRA DO DIA DO EVENTO (Lucas, 01/08): "hoje tudo liberado, entrou no board vai para
  // etiquetas". Antes este teste cobrava o contrário — só `credenciado` entrava na fila — e era
  // por isso que quem estava em revisão ou correção ficava no salão sem conseguir imprimir.
  it("mover para QUALQUER outra etapa também coloca na fila", async () => {
    const { client, fila } = fake({ corretor: "João", etapa: "credito", imobiliaria: "Imob X" });

    await atualizarEtapa(client, "ent-1", "revisao");

    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ entity_id: "ent-1", evento_id: "ev-1", nome: "MARIA DA SILVA" });
  });

  it("quem já está na fila não entra de novo", async () => {
    const { client, fila } = fake({ etapa: "validacao" }, EVENTO_DO_DIA, {
      id: "cred-existente",
      pago_em: null,
    });

    await atualizarEtapa(client, "ent-1", "prevenda");

    expect(fila).toEqual([]);
  });
});

describe("caminho 2 · importação do Asana (aplicarVinculos grava a etapa direto)", () => {
  const item = { entityId: "ent-1", gid: "task-1", secao: "Finalizado" };

  it("importar a seção Finalizado como credenciado coloca na fila", async () => {
    const { client, fila } = fake({ etapa: "validacao" });

    await aplicarVinculos({ client, etapa: "credenciado", itens: [item] });

    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ entity_id: "ent-1", evento_id: "ev-1" });
  });

  // Reimportar é justamente a chance de consertar quem já estava credenciado e ficou fora da fila
  // — foi assim que os 3 casos de 01/08 apareceram. `etapaMaisAvancada` mantém "credenciado", e a
  // regra continua valendo mesmo sem nenhuma etapa ter mudado.
  it("reimportação de quem JÁ era credenciado também garante a fila", async () => {
    const { client, fila } = fake({ etapa: "credenciado" });

    await aplicarVinculos({ client, etapa: "validacao", itens: [item] });

    expect(fila).toHaveLength(1);
  });

  it("importar para validação não coloca ninguém na fila", async () => {
    const { client, fila } = fake({ etapa: null });

    await aplicarVinculos({ client, etapa: "validacao", itens: [item] });

    expect(fila).toEqual([]);
  });
});

describe("caminho 3 · fluxo do PIX de pré-venda", () => {
  it("enviar o PIX credencia e coloca na fila", async () => {
    const { client, fila } = fake({ corretor: null, etapa: "prevenda", imobiliaria: null });

    const saida = await aoEnviarPixPrevenda({ client, entityId: "ent-1", paymentId: "pay_1" });

    expect(saida.etapa).toBe("credenciado");
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ entity_id: "ent-1", evento_id: "ev-1" });
  });

  it("pagamento confirmado entra na fila COM a hora do pagamento (não vai pro fim)", async () => {
    const { client, fila } = fake({ corretor: null, etapa: "prevenda", imobiliaria: null });

    await aoConfirmarPagamentoPrevenda({
      client,
      entityId: "ent-1",
      pagoEm: "2026-08-01T13:20:00Z",
      paymentId: "pay_1",
    });

    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({ pago_em: "2026-08-01T13:20:00Z" });
    // `ordem_fila` é o que reordena a fila: sem ela quem pagou ficaria atrás de quem não pagou.
    expect(fila[0]?.ordem_fila).toBeTruthy();
  });
});

// REGRESSÃO 01/08: o fluxo do PIX procurava o evento com `status = 'ativo'`. "ativo" é o evento em
// PREPARO — assim que o dia começa ele vira "em_andamento", e a busca passava a não achar nada.
// Efeito: das 9h em diante, quem pagava virava credenciado no Board e NÃO entrava na fila nem
// saía na etiqueta. Os dois estados têm que funcionar.
describe("o evento é encontrado nos dois estados", () => {
  it("evento em preparo (ativo)", async () => {
    const { client, fila } = fake({ etapa: "prevenda" }, [{ id: "ev-1", status: "ativo" }]);

    await aoEnviarPixPrevenda({ client, entityId: "ent-1" });

    expect(fila).toHaveLength(1);
  });

  it("evento já aberto (em_andamento) — era aqui que a fila ficava vazia", async () => {
    const { client, fila } = fake({ etapa: "prevenda" }, [{ id: "ev-1", status: "em_andamento" }]);

    await aoEnviarPixPrevenda({ client, entityId: "ent-1" });

    expect(fila).toHaveLength(1);
  });

  it("evento encerrado não recebe ninguém", async () => {
    const { client, fila } = fake({ etapa: "prevenda" }, [{ id: "ev-1", status: "encerrado" }]);

    await aoEnviarPixPrevenda({ client, entityId: "ent-1" });

    expect(fila).toEqual([]);
  });
});

// CREDENCIOU → SOBE PARA O C2X, POR QUALQUER CAMINHO.
//
// O envio ao C2X (o sistema de CONTRATOS) só era disparado dentro de `atualizarEtapa`. Só que o
// fluxo real do negócio credencia por escrita direta na esteira, no PIX: enviou o PIX credencia,
// e pagou credencia. Resultado do furo: o cliente aparecia credenciado no Board e não existia no
// C2X, e ninguém percebia porque nada falhava.
describe("credenciar pelo PIX também sobe a ficha para o C2X", () => {
  beforeEach(() => c2x.subir.mockClear());

  it("enviar o PIX credencia e sobe", async () => {
    const { client } = fake({ etapa: "prevenda" });

    const saida = await aoEnviarPixPrevenda({ client, entityId: "ent-1", paymentId: "pay_1" });

    expect(saida.etapa).toBe("credenciado");
    expect(c2x.subir).toHaveBeenCalledWith(expect.anything(), "ent-1");
  });

  it("pagamento confirmado credencia e sobe", async () => {
    const { client } = fake({ etapa: "prevenda" });

    await aoConfirmarPagamentoPrevenda({
      client,
      entityId: "ent-1",
      pagoEm: "2026-08-01T13:20:00Z",
      paymentId: "pay_1",
    });

    expect(c2x.subir).toHaveBeenCalledWith(expect.anything(), "ent-1");
  });

  // Quem NÃO foi credenciado agora não sobe: mandar para o C2X ficha que está em outra etapa é
  // cadastrar cliente incompleto no lugar mais caro de consertar (é o contrato).
  it("quem não estava em pré-venda não sobe", async () => {
    const { client } = fake({ etapa: "validacao" });

    await aoEnviarPixPrevenda({ client, entityId: "ent-1", paymentId: "pay_1" });

    expect(c2x.subir).not.toHaveBeenCalled();
  });
});

// A entrada na fila é CONSEQUÊNCIA da etapa, nunca condição dela: se o Prometeu estiver fora do ar
// ou não houver evento, a ficha muda de etapa do mesmo jeito.
describe("a fila nunca segura a mudança de etapa", () => {
  it("sem evento nenhum, a etapa é gravada assim mesmo", async () => {
    const { client, esteiraGravada, fila } = fake({ etapa: "prevenda" }, []);

    const r = await atualizarEtapa(client, "ent-1", "credenciado");

    expect(r.error).toBeNull();
    expect(esteiraGravada.some((linha) => linha.etapa === "credenciado")).toBe(true);
    expect(fila).toEqual([]);
  });

  it("ficha sem nome não entra na fila, mas também não quebra o fluxo", async () => {
    const { client, fila } = clienteFake({
      entidade: { display_name: null, document_masked: null, legal_name: null },
      esteira: { enterprise_id: VALE_DO_OURO, etapa: "prevenda" },
      eventos: EVENTO_DO_DIA,
    });

    const r = await atualizarEtapa(client, "ent-1", "credenciado");

    expect(r.error).toBeNull();
    expect(fila).toEqual([]);
  });
});
