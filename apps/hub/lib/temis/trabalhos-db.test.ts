import { beforeEach, describe, expect, it, vi } from "vitest";

// O DOCUMENTO GERADO CHEGA AO CARD DA TÊMIS.
//
// ⚠️ O ELO É `proposta_id`, NAS DUAS PONTAS. `temis_trabalhos.venda_id` aponta para
// `hercules_vendas`, que tem ZERO linhas — foi por isso que as duas vendas despachadas em
// 05/09/2026 não abriram card nenhum (migration 0134). Quem liga o board ao papel é a proposta.
//
// ⚠️ E ISSO É O QUE FAZ A ATIVIDADE "Gerar o contrato pela minuta do empreendimento" DEIXAR DE SER
// UMA CAIXINHA DE MEMÓRIA: sem esta ligação, o jurídico marcava o item e o card andava para "Em
// assinatura" sem nada para despachar.

const estado = vi.hoisted(() => ({
  documentos: [] as Record<string, unknown>[],
  filtrosDeDocumento: [] as Array<{ campo: string; valor: unknown }>,
  trabalhos: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => cliente(),
  hashIdentifier: (tipo: string, valor: string) => `${tipo}:${valor}`,
}));

function consulta(tabela: string) {
  const proprios: Record<string, unknown> = {
    in: (campo: string, valor: unknown) => {
      if (tabela === "hercules_documentos") estado.filtrosDeDocumento.push({ campo, valor });
      return builder;
    },
    maybeSingle: async () => resultado(),
    single: async () => resultado(),
    then: (aceitar: (v: unknown) => unknown, recusar?: (e: unknown) => unknown) =>
      Promise.resolve(resultado()).then(aceitar, recusar),
  };
  const resultado = () => ({
    data: tabela === "temis_trabalhos" ? estado.trabalhos : estado.documentos,
    error: null,
  });
  const builder: Record<string, unknown> = new Proxy(proprios, {
    get(alvo, prop) {
      if (prop in alvo) return alvo[prop as string];
      return () => builder;
    },
  });
  return builder;
}

function cliente() {
  return { from: (tabela: string) => consulta(tabela), storage: { from: () => ({}) } } as never;
}

import { contratoVigente } from "./contrato-guardado";
import { trabalhosDoBoard } from "./trabalhos-db";

const PROPOSTA = "641f22ac-6c4a-4133-afec-49fa7b7e1765";

function card(id: string, propostaId: null | string) {
  return {
    atividades_feitas: [],
    canal: "hercules",
    cliente_cpf: null,
    cliente_nome: "Henrique Sales do Vale",
    criado_em: "2026-09-06T18:19:11Z",
    enterprise_codigo: "TST",
    enterprise_id: "9001",
    enterprise_nome: "ZZ TESTE",
    estagio: "confeccao",
    estagio_desde: "2026-09-06T18:19:11Z",
    evidencia_path: null,
    id,
    iris_ticket_id: null,
    observacao: null,
    proposta_id: propostaId,
    tipo: "contrato",
    trabalho_origem_id: null,
    unidade: "Quadra 01 · Lote 05",
  };
}

beforeEach(() => {
  estado.documentos = [];
  estado.filtrosDeDocumento = [];
  estado.trabalhos = [];
});

describe("o contrato gerado aparece no card", () => {
  it("chega pelo proposta_id, com a versão lida do nome", async () => {
    estado.trabalhos = [card("card-1", PROPOSTA)];
    estado.documentos = [
      {
        criado_em: "2026-09-09T14:00:00Z",
        id: "doc-2",
        nome: "Contrato - TST - Q01 L05 - Henrique Sales do Vale - 2026-09-09 v2.pdf",
        observacao: null,
        proposta_id: PROPOSTA,
      },
      {
        criado_em: "2026-09-09T10:00:00Z",
        id: "doc-1",
        nome: "Contrato - TST - Q01 L05 - Henrique Sales do Vale - 2026-09-09 v1.pdf",
        observacao: "Substituído pela versão 2, gerada em 09/09/2026.",
        proposta_id: PROPOSTA,
      },
    ];

    const board = await trabalhosDoBoard();
    expect(board).toHaveLength(1);
    expect(board[0]!.contratos).toHaveLength(2);

    // ⚠️ AS DUAS FICAM NA GAVETA (nada se apaga), MAS SÓ UMA VALE. Mostrar as duas com o mesmo peso
    // é o caminho mais curto para despachar a versão errada para assinatura.
    const vigente = contratoVigente(board[0]!.contratos);
    expect(vigente?.id).toBe("doc-2");
    expect(vigente?.versao).toBe(2);
  });

  // ⚠️ CARD SEM PROPOSTA É O NORMAL DE HOJE: os quatro cards antigos do Garden e da Lavra nasceram
  // antes do elo. Lista vazia é a resposta certa para eles — não é erro, e não pode virar consulta.
  it("card sem proposta fica com lista vazia e não consulta documento nenhum", async () => {
    estado.trabalhos = [card("card-antigo", null)];

    const board = await trabalhosDoBoard();
    expect(board[0]!.contratos).toEqual([]);
    expect(estado.filtrosDeDocumento).toHaveLength(0);
  });

  it("não mistura o contrato de uma proposta no card de outra", async () => {
    estado.trabalhos = [card("card-1", PROPOSTA), card("card-2", "outra-proposta")];
    estado.documentos = [
      {
        criado_em: "2026-09-09T14:00:00Z",
        id: "doc-2",
        nome: "Contrato v1.pdf",
        observacao: null,
        proposta_id: PROPOSTA,
      },
    ];

    const board = await trabalhosDoBoard();
    expect(board.find((t) => t.id === "card-1")!.contratos).toHaveLength(1);
    expect(board.find((t) => t.id === "card-2")!.contratos).toEqual([]);

    // Uma consulta só para o board inteiro, e com os dois ids no mesmo `.in()`.
    expect(estado.filtrosDeDocumento).toHaveLength(1);
    expect(estado.filtrosDeDocumento[0]!.campo).toBe("proposta_id");
    expect(estado.filtrosDeDocumento[0]!.valor).toEqual([PROPOSTA, "outra-proposta"]);
  });
});
