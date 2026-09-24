import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Opcoes } from "@/lib/assinatura/clicksign/cliente";

import {
  clienteEmMemoria,
  type EstadoDoBanco,
  type Linha,
  novoEstado,
} from "./fixtures/supabase-em-memoria";
import { pedidoDoTrabalho } from "./pedido-do-trabalho";

// CANCELAR O CONTRATO PELA TÊMIS — o caso da MAURA, contra um banco em memória.
//
// Lucas (23/09/2026): *"coloca por favor um botão de cancelamento de contrato na temis. o time vai
// precisar cancelar"*, com o print do contrato da MAURA MARIA PASSOS (VOC, Quadra 03 Lote 06) em
// "Em assinatura", 1 de 11 assinantes já tendo assinado.
//
// O que está travado aqui:
//   • o MOTIVO é obrigatório, e sem ele NADA é gravado;
//   • o ENVELOPE morre na Clicksign ANTES de a venda virar `cancelado` (o motor de verdade roda
//     neste teste, com a porta HTTP dublada);
//   • recusa da Clicksign não deixa metade feito: a venda continua em `contrato`, o contrato continua
//     valendo, e o pedido FICA ABERTO na fila com o motivo;
//   • o card sai da etapa certa: o de contrato vai para `indeferido`, o do pedido nasce e vai para
//     `faturado`;
//   • cancelar não é "voltar para análise": a venda cai;
//   • o que a porta RECUSA sem gravar nada: card que não é de contrato, contrato em Análise, venda
//     antes do contrato, pedido já na fila, distrato sem as duas declarações.
//
// ⚠️ O MOTOR NÃO É DUBLADO, DE PROPÓSITO. O que este teste precisa provar é a ORDEM entre a Clicksign
// e a queda da venda, e ela mora dentro de `concluirCancelamentoDoCard`. Com o motor mockado, o teste
// provaria só que uma função foi chamada.
//
// ⚠️ A VENDA DO CENÁRIO NÃO TEM `unidade_id`, e isso é escolha do teste: sem ele a trava do lote
// (`situacao-da-unidade.ts`, que lê o terreno inteiro) fica fora do caminho, e ela já tem teste
// próprio em `concluir-cancelamento-server.test.ts`. O que este arquivo mede é a porta nova.

const AGORA = "2026-09-23T18:00:00.000Z";

/**
 * Os valores que o BANCO preencheria por padrão no card novo.
 *
 * ⚠️ `abrirTrabalho` NÃO ESCREVE `estagio`, de propósito: quem decide é o DEFAULT da coluna
 * (`analise`, desde a 0150). O banco em memória não tem defaults, e sem isto o card nasceria sem
 * estágio — e o motor não encontraria o card para fechar, fazendo o teste medir o dublê e não a regra.
 */
const PADROES_DO_CARD: Linha = {
  atividades_feitas: [],
  criado_em: AGORA,
  estagio: "analise",
  estagio_desde: AGORA,
};

let estado: EstadoDoBanco;

function clienteComPadroes(): SupabaseClient {
  const cliente = clienteEmMemoria(estado);
  return {
    ...cliente,
    from: (tabela: string) => {
      const q = cliente.from(tabela) as Record<string, unknown>;
      if (tabela !== "temis_trabalhos") return q;
      const original = q.insert as (valores: unknown) => unknown;
      return {
        ...q,
        insert: (valores: unknown) =>
          original(
            Array.isArray(valores)
              ? valores.map((v) => ({ ...PADROES_DO_CARD, ...(v as Linha) }))
              : { ...PADROES_DO_CARD, ...(valores as Linha) },
          ),
      };
    },
  } as unknown as SupabaseClient;
}

// O admin client que `abrirTrabalho` monta por dentro é o MESMO banco em memória: o card do pedido
// nasce na mesma tabela que o motor vai ler em seguida.
vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => clienteComPadroes(),
}));

const { cancelarContratoDoCard, apurarCancelamentoDoContrato } = await import(
  "./cancelar-contrato-servico"
);

type Cenario = {
  /** O carimbo de última alteração da venda, para medir o que o desfazer devolve. */
  atualizadoEm?: string;
  /** A etapa da venda. `contrato` é a das 5 vendas em risco medidas em 23/09/2026. */
  etapaDaVenda?: string;
  estagioDoCard?: string;
  /** O estado gravado do envelope. Sem envelope, não passe nada. */
  estadoDoEnvelope?: null | string;
  marcaDoPedido?: null | string;
  motivoDaMarca?: null | string;
  pedidoNaFila?: null | Linha;
  tipoDoCard?: string;
};

function cenario(c: Cenario = {}): void {
  estado = novoEstado();
  estado.tabelas.temis_trabalhos = [
    {
      ...PADROES_DO_CARD,
      cliente_cpf: "111.222.333-44",
      cliente_nome: "MAURA MARIA PASSOS",
      enterprise_codigo: "VOC",
      enterprise_id: "37",
      enterprise_nome: "Vale do Ouro Central",
      estagio: c.estagioDoCard ?? "assinatura",
      id: "card-contrato",
      operado_por: null,
      proposta_id: "venda-maura",
      tipo: c.tipoDoCard ?? "contrato",
      unidade: "Quadra 03 · Lote 06",
      workspace_id: "careli",
    },
    ...(c.pedidoNaFila ? [{ ...PADROES_DO_CARD, ...c.pedidoNaFila }] : []),
  ];
  estado.tabelas.hercules_propostas = [
    {
      aberta: true,
      // ⚠️ `NOT NULL` COM DEFAULT `now()` NO BANCO (4.947 vendas, todas preenchidas): o cenário
      // nasce com carimbo porque é o que o desfazer tem de devolver.
      atualizado_em: c.atualizadoEm ?? "2026-09-01T10:00:00.000Z",
      cancelamento_pedido_em: c.marcaDoPedido ?? null,
      cancelamento_pedido_motivo: c.motivoDaMarca ?? null,
      cancelamento_pedido_por: c.marcaDoPedido ? "Lucas Ruas" : null,
      cancelamento_pedido_tipo: c.marcaDoPedido ? "cancelamento" : null,
      cliente_documento: "11122233344",
      cliente_nome: "MAURA MARIA PASSOS",
      codigo: "000021",
      data_assinatura: null,
      data_ato: null,
      data_faturamento: null,
      etapa: c.etapaDaVenda ?? "contrato",
      id: "venda-maura",
      origem: "panteon",
      protocolo_numero: 21,
      reserva_id: null,
      // Ver a nota do topo: sem unidade, a trava do lote fica fora deste teste.
      unidade_id: null,
      workspace_id: "careli",
    },
  ];
  estado.tabelas.hercules_proposta_eventos = [];
  estado.tabelas.hercules_proposta_etapas = [];
  estado.tabelas.temis_trabalho_etapas = [];
  estado.tabelas.temis_envelopes = c.estadoDoEnvelope
    ? [
        {
          criado_em: "2026-09-23T12:00:00.000Z",
          envelope_id: "env-maura",
          estado: c.estadoDoEnvelope,
          falha: null,
          id: "reg-env",
          proposta_id: "venda-maura",
          provedor: "clicksign",
          workspace_id: "careli",
        },
      ]
    : [];
}

/** O duplo da porta HTTP da Clicksign. Anota quantas consultas o banco já tinha recebido. */
function portaDeTeste(respostas: { get?: unknown; patch?: unknown } = {}) {
  const chamadas: { caminho: string; consultasAntes: number; metodo: string }[] = [];
  const porta = async <T = unknown>(caminho: string, opcoes: Opcoes = {}): Promise<T> => {
    const metodo = opcoes.metodo ?? "GET";
    chamadas.push({ caminho, consultasAntes: estado.consultas.length, metodo });
    const resposta = metodo === "GET" ? respostas.get : respostas.patch;
    if (resposta instanceof Error) throw resposta;
    return (resposta ?? {}) as T;
  };
  return { chamadas, porta };
}

const RODANDO = { data: { attributes: { status: "running" } } };

const pedido = (extra: Record<string, unknown> = {}) => ({
  motivo: "Cliente desistiu da compra",
  trabalhoId: "card-contrato",
  usuarioId: "u-nivea",
  usuarioNome: "Nivea Careli",
  ...extra,
});

/** As gravações, na ordem em que chegaram ao banco. */
function escritas(): Array<{ tabela: string; valores: unknown }> {
  return estado.consultas
    .filter((c) => c.tipo !== "select")
    .map((c) => ({ tabela: c.tabela, valores: c.valores }));
}

function linha(tabela: string, id: string): Linha | undefined {
  return (estado.tabelas[tabela] ?? []).find((l) => l.id === id);
}

/** O card do pedido que nasceu: o único de tipo cancelamento ou distrato. */
function cardDoPedido(): Linha | undefined {
  return (estado.tabelas.temis_trabalhos ?? []).find(
    (l) => l.tipo === "cancelamento" || l.tipo === "distrato",
  );
}

beforeEach(() => {
  cenario();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

// ── O CASO DA MAURA: 1 DE 11 ASSINADO ──────────────────────────────────────────

describe("o contrato da MAURA em Em assinatura, com envelope vivo", () => {
  it("o envelope morre na Clicksign ANTES de a venda virar cancelado", async () => {
    cenario({ estadoDoEnvelope: "parcial" });
    const { chamadas, porta } = portaDeTeste({ get: RODANDO });

    const r = await cancelarContratoDoCard(clienteComPadroes(), pedido(), porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Leu o estado real antes de cancelar: a ordem que impede matar contrato assinado por todos.
    expect(chamadas.map((c) => c.metodo)).toEqual(["GET", "PATCH"]);
    expect(chamadas[1]?.caminho).toBe("/envelopes/env-maura");
    expect(r.conclusao.envelopeCancelado).toBe("env-maura");
    expect(linha("temis_envelopes", "reg-env")).toMatchObject({
      estado: "cancelado",
      estado_cru: "panteon:conclusao_do_cancelamento",
    });

    // ⚠️ A PROVA DA ORDEM: o PATCH aconteceu antes da gravação que derruba a venda.
    const todas = estado.consultas;
    const ondeCaiuAVenda = todas.findIndex(
      (c) =>
        c.tabela === "hercules_propostas" &&
        c.tipo === "update" &&
        (c.valores as Linha | undefined)?.etapa === "cancelado",
    );
    expect(ondeCaiuAVenda).toBeGreaterThanOrEqual(0);
    expect(chamadas[1]?.consultasAntes).toBeLessThanOrEqual(ondeCaiuAVenda);
  });

  it("cancelar não é voltar para análise: a venda cai, o card de contrato é indeferido e o pedido fecha", async () => {
    cenario({ estadoDoEnvelope: "parcial" });

    const r = await cancelarContratoDoCard(
      clienteComPadroes(),
      pedido(),
      portaDeTeste({ get: RODANDO }).porta,
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(linha("hercules_propostas", "venda-maura")).toMatchObject({
      aberta: false,
      cancelada_por_nome: "Nivea Careli",
      etapa: "cancelado",
    });
    expect(String(linha("hercules_propostas", "venda-maura")?.cancelada_motivo)).toContain(
      "Cliente desistiu da compra",
    );
    // O card de contrato sai da etapa em que estava — e não volta para a análise.
    expect(linha("temis_trabalhos", "card-contrato")).toMatchObject({ estagio: "indeferido" });
    expect(r.conclusao.contratosIndeferidos).toEqual(["card-contrato"]);
    // O card do pedido nasceu e foi para Concluído, com o contrato como origem.
    expect(cardDoPedido()).toMatchObject({
      canal: "coordenador",
      estagio: "faturado",
      proposta_id: "venda-maura",
      tipo: "cancelamento",
      trabalho_origem_id: "card-contrato",
      unidade: "Quadra 03 · Lote 06",
    });
    expect(r.cardDoPedido).toBe(cardDoPedido()?.id);
  });

  it("o motivo escrito chega aos três lugares, e a observação do card é a que a tela sabe ler", async () => {
    cenario({ estadoDoEnvelope: "parcial" });

    await cancelarContratoDoCard(
      clienteComPadroes(),
      pedido({ motivo: "Cliente desistiu: financiamento negado" }),
      portaDeTeste({ get: RODANDO }).porta,
    );

    // 1. a marca do pedido na venda (e é ela que leva o motivo para `cancelada_motivo`).
    const marca = escritas().find(
      (e) => e.tabela === "hercules_propostas" && (e.valores as Linha)?.cancelamento_pedido_motivo,
    );
    expect((marca?.valores as Linha)?.cancelamento_pedido_motivo).toBe(
      "Cliente desistiu: financiamento negado",
    );
    // 2. a observação do card, no formato do pedido.
    const lido = pedidoDoTrabalho({
      observacao: String(cardDoPedido()?.observacao ?? ""),
      tipo: "cancelamento",
    });
    expect(lido?.itens).toEqual([
      { rotulo: "Origem", valor: "Trabalho da Têmis" },
      { rotulo: "Contrato", valor: "COD 000021" },
      { rotulo: "Motivo", valor: "Cliente desistiu: financiamento negado" },
      {
        rotulo: "Apuração",
        valor: "Nenhuma assinatura registrada, nenhum pagamento registrado",
      },
      {
        rotulo: "Classificação",
        valor: "as assinaturas não fecharam e nada foi pago: o contrato não chegou a se formar",
      },
    ]);
    // 3. o histórico do card do pedido.
    expect(
      (estado.tabelas.temis_trabalho_etapas ?? []).some((l) =>
        String(l.observacao ?? "").includes("env-maura"),
      ),
    ).toBe(true);
  });

  it("sem envelope vivo o cancelamento segue, e a Clicksign não é chamada", async () => {
    const { chamadas, porta } = portaDeTeste();

    const r = await cancelarContratoDoCard(clienteComPadroes(), pedido(), porta);

    expect(r.ok).toBe(true);
    expect(chamadas).toEqual([]);
    expect(linha("hercules_propostas", "venda-maura")).toMatchObject({ etapa: "cancelado" });
  });
});

// ── O MOTIVO ───────────────────────────────────────────────────────────────────

describe("o motivo escrito é obrigatório", () => {
  it("sem motivo: recusa 422 e NADA é gravado", async () => {
    const r = await cancelarContratoDoCard(
      clienteComPadroes(),
      pedido({ motivo: "" }),
      portaDeTeste({ get: RODANDO }).porta,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(422);
    expect(r.erro).toBe("Diga o motivo do cancelamento do contrato.");
    expect(escritas()).toEqual([]);
  });

  it("motivo de dois caracteres também é recusado", async () => {
    const r = await cancelarContratoDoCard(clienteComPadroes(), pedido({ motivo: " ab " }));

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(422);
    expect(escritas()).toEqual([]);
  });
});

// ── A CLICKSIGN QUE NÃO COOPERA ────────────────────────────────────────────────

describe("falha na Clicksign não deixa o contrato pela metade", () => {
  it("a Clicksign RECUSA o cancelamento: a venda fica em contrato e o pedido fica aberto na fila", async () => {
    cenario({ estadoDoEnvelope: "parcial" });
    const { porta } = portaDeTeste({
      get: RODANDO,
      patch: new Error("403 Forbidden"),
    });

    const r = await cancelarContratoDoCard(clienteComPadroes(), pedido(), porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(502);
    expect(r.erro).toContain("Clicksign");
    expect(r.erro).toContain("FICOU ABERTO");
    expect(r.cardDoPedido).toBe(cardDoPedido()?.id);
    // A venda NÃO caiu, o contrato continua valendo e o envelope não foi carimbado.
    expect(linha("hercules_propostas", "venda-maura")).toMatchObject({ etapa: "contrato" });
    expect(linha("temis_trabalhos", "card-contrato")).toMatchObject({ estagio: "assinatura" });
    expect(linha("temis_envelopes", "reg-env")).toMatchObject({ estado: "parcial" });
    // E o que sobrou é um pedido ABERTO, com o motivo, que o jurídico conclui ou indefere.
    expect(cardDoPedido()).toMatchObject({ estagio: "analise", tipo: "cancelamento" });
    expect(String(cardDoPedido()?.observacao)).toContain("Cliente desistiu da compra");
  });

  it("a Clicksign diz que o envelope está fechado: o contrato assinado por todos não cai por aqui", async () => {
    cenario({ estadoDoEnvelope: "parcial" });
    const { chamadas, porta } = portaDeTeste({
      get: { data: { attributes: { status: "closed" } } },
    });

    const r = await cancelarContratoDoCard(clienteComPadroes(), pedido(), porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("assinado por todos");
    expect(chamadas.some((c) => c.metodo === "PATCH")).toBe(false);
    expect(linha("hercules_propostas", "venda-maura")).toMatchObject({ etapa: "contrato" });
  });
});

// ── O DISTRATO ─────────────────────────────────────────────────────────────────

describe("quando a apuração diz distrato", () => {
  it("contrato assinado por todos no banco: sem as duas declarações não cancela, e nada é gravado", async () => {
    cenario({ estadoDoEnvelope: "assinado" });

    const r = await cancelarContratoDoCard(
      clienteComPadroes(),
      pedido(),
      portaDeTeste().porta,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(422);
    expect(r.erro).toContain("termo de distrato assinado");
    expect(r.erro).toContain("exige distrato");
    expect(escritas()).toEqual([]);
  });

  it("com as duas declarações: a venda vira distrato e o envelope assinado fica como está", async () => {
    cenario({ estadoDoEnvelope: "assinado" });
    const { chamadas, porta } = portaDeTeste();

    const r = await cancelarContratoDoCard(
      clienteComPadroes(),
      pedido({ declaracoes: { devolucaoAcertada: true, termoAssinado: true } }),
      porta,
    );

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.classificacao.tipo).toBe("distrato");
    expect(cardDoPedido()).toMatchObject({ tipo: "distrato" });
    expect(linha("hercules_propostas", "venda-maura")).toMatchObject({ etapa: "distrato" });
    // Assinatura não se desfaz: o envelope do contrato assinado não é cancelado.
    expect(chamadas).toEqual([]);
    expect(linha("temis_envelopes", "reg-env")).toMatchObject({ estado: "assinado" });
    // E o card de contrato assinado NÃO vira indeferido: é o documento que o distrato desfaz.
    expect(linha("temis_trabalhos", "card-contrato")).toMatchObject({ estagio: "assinatura" });
  });
});

// ── O QUE A PORTA RECUSA SEM GRAVAR NADA ───────────────────────────────────────

describe("as recusas que não deixam rastro", () => {
  it("card que não é de contrato: manda concluir pelo botão do pedido", async () => {
    cenario({ tipoDoCard: "cancelamento" });

    const r = await cancelarContratoDoCard(clienteComPadroes(), pedido());

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toContain("botão de concluir");
    expect(escritas()).toEqual([]);
  });

  it("contrato em Análise: o caminho é Indeferir, que devolve a venda sem gastar um cancelamento", async () => {
    cenario({ estagioDoCard: "analise" });

    const r = await cancelarContratoDoCard(clienteComPadroes(), pedido());

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("Indeferir");
    expect(escritas()).toEqual([]);
  });

  it("contrato já indeferido: não se cancela daqui", async () => {
    cenario({ estagioDoCard: "indeferido" });

    const r = await cancelarContratoDoCard(clienteComPadroes(), pedido());

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(escritas()).toEqual([]);
  });

  it("venda antes do contrato: o cancelamento dela é no Hércules", async () => {
    cenario({ etapaDaVenda: "proposta" });

    const r = await cancelarContratoDoCard(clienteComPadroes(), pedido());

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("Hércules");
    expect(escritas()).toEqual([]);
  });

  it("venda já desfeita: manda indeferir o card para sair da fila", async () => {
    cenario({ etapaDaVenda: "cancelado" });

    const r = await cancelarContratoDoCard(clienteComPadroes(), pedido());

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("já foi desfeita");
    expect(escritas()).toEqual([]);
  });

  it("já existe pedido na fila: recusa apontando o card, e não abre o segundo", async () => {
    cenario({
      pedidoNaFila: {
        estagio: "analise",
        id: "card-pedido-velho",
        proposta_id: "venda-maura",
        tipo: "cancelamento",
        workspace_id: "careli",
      },
    });

    const r = await cancelarContratoDoCard(clienteComPadroes(), pedido());

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.cardDoPedido).toBe("card-pedido-velho");
    expect(escritas()).toEqual([]);
  });

  it("trabalho que não existe: 404 sem gravar nada", async () => {
    const r = await cancelarContratoDoCard(clienteComPadroes(), pedido({ trabalhoId: "sumido" }));

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(404);
    expect(escritas()).toEqual([]);
  });
});

// ── A MARCA DE PEDIDO QUE SOBROU ───────────────────────────────────────────────

describe("a marca de pedido antiga na venda", () => {
  it("marca velha sem card na fila: a história do pedido antigo é guardada antes de substituir", async () => {
    cenario({
      marcaDoPedido: "2026-09-12T12:00:00.000Z",
      motivoDaMarca: "Pedido antigo do Lucas",
    });

    const r = await cancelarContratoDoCard(
      clienteComPadroes(),
      pedido(),
      portaDeTeste().porta,
    );

    expect(r.ok).toBe(true);
    expect(estado.tabelas.hercules_proposta_etapas).toEqual([
      expect.objectContaining({
        autor_nome: "Lucas Ruas",
        motivo: "Pedido antigo do Lucas",
        para: "pedido_de_cancelamento",
        quando: "2026-09-12T12:00:00.000Z",
      }),
    ]);
    expect(linha("hercules_propostas", "venda-maura")).toMatchObject({ etapa: "cancelado" });
  });

  it("marca recém-nascida: é pedido a caminho, e a porta recusa sem gravar nada", async () => {
    cenario({ marcaDoPedido: new Date(Date.now() - 60_000).toISOString() });

    const r = await cancelarContratoDoCard(clienteComPadroes(), pedido());

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toContain("acabou de ser aberto");
    expect(escritas()).toEqual([]);
  });
});

// ── A PRÉVIA ───────────────────────────────────────────────────────────────────

describe("a prévia que a tela mostra antes de perguntar o motivo", () => {
  it("conta a classificação, o COD e se há pedido na fila, sem gravar nada", async () => {
    cenario({ estadoDoEnvelope: "parcial" });

    const r = await apurarCancelamentoDoContrato(clienteComPadroes(), "card-contrato");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({
      classificacao: { devolveValores: false, tipo: "cancelamento" },
      codigo: "000021",
      pedidoAberto: null,
      vendaDoLegado: false,
    });
    expect(escritas()).toEqual([]);
  });

  it("contrato assinado por todos: a prévia já diz distrato", async () => {
    cenario({ estadoDoEnvelope: "assinado" });

    const r = await apurarCancelamentoDoContrato(clienteComPadroes(), "card-contrato");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.classificacao.tipo).toBe("distrato");
    expect(r.fatos.assinaturaCompleta).toBe(true);
  });
});

// ── DOIS CLIQUES AO MESMO TEMPO ────────────────────────────────────────────────
//
// ⚠️ ESTE BLOCO EXISTE PORQUE A PROTEÇÃO PODIA SER APAGADA SEM NENHUM TESTE CAIR. A revisão
// adversarial de 23/09/2026 trocou a comparação e troca de `marcarOPedido` por um `update` seco e os
// 48 testes do lote continuaram VERDES. Teste que não cai quando a proteção some não é teste, e o que
// está em jogo é a Clicksign chamada DUAS VEZES em conta de produção e um segundo card na fila.

/**
 * O CLIENTE DA REQUISIÇÃO IRMÃ: ela grava a marca do pedido na venda ENTRE a nossa leitura (que viu
 * `null`) e a nossa escrita.
 *
 * ⚠️ É O INSTANTE DO CLIQUE DUPLO, CRAVADO. Duas chamadas de verdade (o teste seguinte) dependem da
 * ordem em que duas promessas acordam; esta injeção não depende de nada: a irmã sempre vence a
 * corrida, e o que se mede é o que a NOSSA escrita faz ao encontrar a venda já marcada.
 */
function clienteComIrmaQueMarcouPrimeiro(marcaDaIrma: string): SupabaseClient {
  const cliente = clienteComPadroes() as unknown as {
    from: (t: string) => Record<string, unknown>;
  };
  let jaEntrou = false;
  return {
    ...cliente,
    from: (tabela: string) => {
      const q = cliente.from(tabela);
      if (tabela !== "hercules_propostas") return q;
      const original = q.update as (valores: unknown) => unknown;
      return {
        ...q,
        update: (valores: unknown) => {
          if (!jaEntrou) {
            jaEntrou = true;
            const venda = (estado.tabelas.hercules_propostas ?? [])[0];
            if (venda) {
              venda.cancelamento_pedido_em = marcaDaIrma;
              venda.cancelamento_pedido_motivo = "Pedido da requisição irmã";
              venda.cancelamento_pedido_por = "Northon Careli";
              venda.cancelamento_pedido_tipo = "cancelamento";
            }
          }
          return original(valores);
        },
      };
    },
  } as unknown as SupabaseClient;
}

describe("a proteção contra o clique duplo", () => {
  it("a requisição irmã grava a marca entre a nossa leitura e a nossa escrita: recusa 409, sem card e sem Clicksign", async () => {
    cenario({ estadoDoEnvelope: "parcial" });
    const { chamadas, porta } = portaDeTeste({ get: RODANDO });
    const marcaDaIrma = new Date(Date.now() - 1_000).toISOString();

    const r = await cancelarContratoDoCard(
      clienteComIrmaQueMarcouPrimeiro(marcaDaIrma),
      pedido(),
      porta,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toContain("chegou primeiro");
    // O SEGUNDO CARD NÃO NASCEU: é ele que deixa quem lê o quadro sem saber qual pedido vale.
    expect(cardDoPedido()).toBeUndefined();
    // A CLICKSIGN NÃO FOI CHAMADA: nem para ler, nem para cancelar o envelope da conta de produção.
    expect(chamadas).toEqual([]);
    // E a venda ficou com a marca DA IRMÃ, intacta, na etapa em que estava.
    expect(linha("hercules_propostas", "venda-maura")).toMatchObject({
      cancelamento_pedido_motivo: "Pedido da requisição irmã",
      cancelamento_pedido_por: "Northon Careli",
      etapa: "contrato",
    });
  });

  it("dois cliques ao mesmo tempo: um card, uma chamada de cancelamento na Clicksign, um ok", async () => {
    cenario({ estadoDoEnvelope: "parcial" });
    const { chamadas, porta } = portaDeTeste({ get: RODANDO });
    const sb = clienteComPadroes();

    // As duas requisições de verdade, na mesma volta do laço de eventos.
    const [a, b] = await Promise.all([
      cancelarContratoDoCard(sb, pedido(), porta),
      cancelarContratoDoCard(sb, pedido(), porta),
    ]);

    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(
      (estado.tabelas.temis_trabalhos ?? []).filter(
        (l) => l.tipo === "cancelamento" || l.tipo === "distrato",
      ),
    ).toHaveLength(1);
    expect(chamadas.filter((c) => c.metodo === "PATCH")).toHaveLength(1);
    expect(linha("hercules_propostas", "venda-maura")).toMatchObject({ etapa: "cancelado" });
  });
});

// ── O QUE A FRASE DO ROLLBACK PROMETE ──────────────────────────────────────────
//
// ⚠️ A FALHA DO CARD É FORÇADA PELA COLUNA `canal` AUSENTE (`colunasAusentes`), e não por um erro de
// tabela: erro na tabela `temis_trabalhos` derrubaria a LEITURA do card de contrato, antes de a marca
// ser gravada, e o teste mediria outro caminho. A coluna ausente só atinge gravação, e a única
// gravação em `temis_trabalhos` neste fluxo é o insert do card do pedido.

describe("o card do pedido não nasce: a frase diz o que ficou gravado", () => {
  it("sem marca antiga: a marca volta a NULO, o `atualizado_em` volta ao que era, e a frase 'Nada foi gravado' é verdade", async () => {
    cenario({ atualizadoEm: "2026-09-01T10:00:00.000Z" });
    estado.colunasAusentes = ["canal"];

    const r = await cancelarContratoDoCard(
      clienteComPadroes(),
      pedido(),
      portaDeTeste().porta,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(502);
    expect(r.erro).toContain("Nada foi gravado");
    expect(cardDoPedido()).toBeUndefined();
    // A VENDA VOLTOU EXATAMENTE AO QUE ERA, carimbo incluído: é isso que a frase afirma.
    expect(linha("hercules_propostas", "venda-maura")).toMatchObject({
      atualizado_em: "2026-09-01T10:00:00.000Z",
      cancelamento_pedido_em: null,
      cancelamento_pedido_motivo: null,
      cancelamento_pedido_por: null,
      cancelamento_pedido_tipo: null,
      etapa: "contrato",
    });
  });

  // ⚠️ ESTE É O CAMINHO QUE A REVISÃO DE 24/09/2026 REPRODUZIU, e que a primeira correção da frase
  // deixou de fora: o 409 e o 503 correm DEPOIS do insert da história, dentro de `marcarOPedido`,
  // e diziam "Nada foi gravado" com uma linha de história gravada e a marca antiga perdida. A
  // correção foi feita em UM dos três caminhos; estes dois são os outros.
  it("marca órfã mais a irmã chegando primeiro: o 409 também conta que a história ficou", async () => {
    cenario({
      estadoDoEnvelope: "parcial",
      marcaDoPedido: "2026-09-12T12:00:00.000Z",
      motivoDaMarca: "Pedido antigo do Lucas",
    });
    const { chamadas, porta } = portaDeTeste({ get: RODANDO });

    const r = await cancelarContratoDoCard(
      clienteComIrmaQueMarcouPrimeiro(new Date(Date.now() - 1_000).toISOString()),
      pedido(),
      porta,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toContain("chegou primeiro");
    // A frase não pode dizer que nada foi gravado: a história do pedido antigo foi arquivada.
    expect(r.erro).not.toContain("Nada foi gravado");
    expect(r.erro).toContain("arquivado no histórico da venda");
    expect(estado.tabelas.hercules_proposta_etapas).toEqual([
      expect.objectContaining({ motivo: "Pedido antigo do Lucas", para: "pedido_de_cancelamento" }),
    ]);
    // E o resto da promessa continua valendo: nem card, nem Clicksign.
    expect(cardDoPedido()).toBeUndefined();
    expect(chamadas).toEqual([]);
  });

  it("com marca órfã: a frase NÃO diz 'nada foi gravado', e conta que a história do pedido antigo ficou", async () => {
    cenario({
      marcaDoPedido: "2026-09-12T12:00:00.000Z",
      motivoDaMarca: "Pedido antigo do Lucas",
    });
    estado.colunasAusentes = ["canal"];

    const r = await cancelarContratoDoCard(
      clienteComPadroes(),
      pedido(),
      portaDeTeste().porta,
    );

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).not.toContain("Nada foi gravado");
    expect(r.erro).toContain("arquivado no histórico da venda");
    expect(r.erro).toContain("A marca dele não voltou");
    // E o que a frase afirma é o que o banco tem: a história ficou, a marca antiga não voltou.
    expect(estado.tabelas.hercules_proposta_etapas).toEqual([
      expect.objectContaining({
        motivo: "Pedido antigo do Lucas",
        para: "pedido_de_cancelamento",
        quando: "2026-09-12T12:00:00.000Z",
      }),
    ]);
    expect(linha("hercules_propostas", "venda-maura")).toMatchObject({
      cancelamento_pedido_em: null,
      etapa: "contrato",
    });
  });
});

// ── A VENDA EM ASSINATURA (O ESTADO NOVO DO REFLEXO) E O LOTE ────────────────────
//
// Desde 24/09/2026 o envio para assinatura leva a venda para `assinatura` (refletirCardNaVenda). Esta
// porta já aceitava venda em assinatura (DEPOIS_DO_CONTRATO); o teste trava que o cancelamento do
// contrato pela Têmis, com a venda nesse estado, conclui pelo motor e SOLTA o lote. Lucas,
// 24/09/2026: *"lembrando que quando tem cancelamento a unidade tem que ficar disponivel, tem que ter
// esse reflexo"*.

describe("venda em assinatura: cancelar o contrato solta o lote", () => {
  const LOTE = "3f1c2b4a-0000-4000-8000-000000000306";

  it("sem outro dono: a venda cai pelo motor e o cadastro volta a disponível", async () => {
    cenario({ estadoDoEnvelope: "parcial", etapaDaVenda: "assinatura" });
    const venda = linha("hercules_propostas", "venda-maura");
    if (venda) venda.unidade_id = LOTE;
    estado.tabelas.hercules_reservas = [];
    estado.tabelas.prometeu_reservas = [];
    estado.tabelas.hercules_unidades = [
      {
        atualizado_em: "2026-09-01T00:00:00.000Z",
        codigo: "VOC0306",
        enterprise_id: "37",
        espelho_de: null,
        id: LOTE,
        lote: "06",
        origem_c2x_id: 9101,
        quadra: "03",
        situacao: "reservada",
        workspace_id: "careli",
      },
    ];

    const r = await cancelarContratoDoCard(clienteComPadroes(), pedido(), portaDeTeste({ get: RODANDO }).porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(linha("hercules_propostas", "venda-maura")?.etapa).toBe("cancelado");
    expect(linha("hercules_unidades", LOTE)?.situacao).toBe("disponivel");
    expect(r.conclusao.unidade.voltou).toBe(true);
  });
});
