import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Banco, criarBanco, type Linha } from "@/lib/hercules/banco-em-memoria.para-teste";
import { MOTIVOS_DE_CANCELAMENTO_DA_PROPOSTA } from "@/lib/hercules/proposta";

// CANCELAR A PROPOSTA NO HÉRCULES (PATCH) SOLTA O LOTE — e a resposta diz se soltou.
//
// Lucas, 24/09/2026: *"lembrando que quando tem cancelamento a unidade tem que ficar disponivel, tem
// que ter esse reflexo"*. Regra de ouro, Lucas 18/09/2026: *"eu não posso vender dois lotes para
// pessoas diferentes"*.
//
// ⚠️ O QUE MUDA: a devolução do cadastro passa por `soltarLoteDaVendaDesfeita` (a mesma sucessora que
// o motor da Têmis usa), e o desfecho vai para a resposta (`loteVoltou`, `porque`). Antes a rota
// ignorava o resultado e a tela não tinha como saber que a trava segurou o lote.
//
// O banco é o de memória, com a trava e a régua DE VERDADE; o resto (sessão, avisos, cadastro) é
// dublê, como em `route.test.ts`.

const estado = vi.hoisted(() => ({
  banco: null as null | { cliente: unknown },
  /**
   * O escopo da sessão, para o teste poder incluir o PAI.
   *
   * ⚠️ `idsDaSessao` INCLUI O ID DO GRUPO NA VIDA REAL (`lib/apolo/incorporador/escopo.ts`), e é por
   * isso que a linha espelho é alcançável por esta rota: o guarda de escopo não a barra. Por padrão
   * aqui só as glebas, como na maioria dos casos.
   */
  ids: ["37", "39"] as string[],
  sessao: { tipo: "comercial", usuarioId: "user-1", usuarioNome: "Lucas Ruas" } as Record<string, unknown>,
}));

vi.mock("@/lib/apolo/incorporador/escopo", async () => {
  const { NextResponse } = await import("next/server");
  return {
    foraDoEscopo: () => NextResponse.json({ error: "Não encontrado." }, { status: 404 }),
    idsDaSessao: async () => estado.ids,
  };
});

vi.mock("@/lib/apolo/incorporador/board-do-portal", () => ({
  autorizarOperacaoDeVenda: () => ({ ok: true, sessao: estado.sessao }),
  autorizarPortalQueOperaSozinho: async (_request: Request, sessao: unknown) => ({ ok: true, sessao }),
}));

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: async () => [
    { c2xEnterpriseId: "37", codigo: "VOC", id: "emp-voc", nome: "VOC", operadoPor: null, paiId: null, vendendo: true },
  ],
  lerCadastroDeEmpreendimentos: async () => ({ com0170: true, linhas: [] }),
}));

const avisos = vi.hoisted(() => ({ registrados: 0 }));

vi.mock("@/lib/hercules/avisos-da-venda", () => ({
  avisarSobreAVenda: async () => [],
  destinatariosDaVenda: async () => ({ coordenadores: [], corretor: null, imobiliaria: { nome: "GURGEL", telefone: null } }),
  registrarAvisoNaoEnviado: async () => {
    avisos.registrados += 1;
    return [];
  },
  vendaAvisaPeloWhatsapp: () => false,
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => estado.banco?.cliente ?? null,
  hashIdentifier: (tipo: string, valor: string) => `hash:${tipo}:${valor}`,
}));

const { PATCH } = await import("@/app/api/incorporador/venda/proposta/route");

const unidade = (id: string, codigo: string, enterpriseId: string, extra: Linha = {}): Linha => ({
  area: "250.00",
  atualizado_em: "2026-09-01T00:00:00.000Z",
  codigo,
  enterprise_id: enterpriseId,
  espelho_de: null,
  id,
  lote: "06",
  origem_c2x_id: null,
  preco_tabela: "178100.00",
  quadra: "03",
  situacao: "disponivel",
  workspace_id: "careli",
  ...extra,
});

let banco: Banco;

function montar(c: { reservas?: Linha[]; situacao?: string } = {}): void {
  banco = criarBanco({
    hercules_propostas: [
      {
        codigo: "000031",
        etapa: "proposta",
        id: "venda-31",
        // Com imobiliária, para o registro do aviso sair (a rota só avisa quem tem imobiliária).
        imobiliaria_entity_id: "imob-gurgel",
        origem: "panteon",
        protocolo_numero: 31,
        reserva_id: "res-31",
        unidade_id: "voc-0306",
        workspace_id: "careli",
      },
    ],
    hercules_reservas: [
      { id: "res-31", origem: "coordenador", situacao: "proposta", unidade_id: "voc-0306", workspace_id: "careli" },
      ...(c.reservas ?? []),
    ],
    hercules_unidades: [
      unidade("vlo-0306", "VLO0306", "35", { espelho_de: "voc-0306", origem_c2x_id: 9001 }),
      unidade("voc-0306", "VOC0306", "37", { origem_c2x_id: 9101, situacao: c.situacao ?? "reservada" }),
    ],
    prometeu_reservas: [],
  });
  estado.banco = banco;
}

const cancelar = () =>
  PATCH(
    new Request("https://c2x.app.br/api/incorporador/venda/proposta", {
      body: JSON.stringify({ motivo: MOTIVOS_DE_CANCELAMENTO_DA_PROPOSTA[0], propostaId: "venda-31", unidadeId: "voc-0306" }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    }),
  );

beforeEach(() => {
  avisos.registrados = 0;
  estado.ids = ["37", "39"];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  expect(banco.problemas).toEqual([]);
  vi.restoreAllMocks();
});

describe("PATCH cancelar proposta: o lote volta pela trava", () => {
  it("sem outro dono: a proposta cai, a reserva cai e o cadastro volta a disponível", async () => {
    montar();

    const r = await cancelar();

    expect(r.status).toBe(200);
    expect(banco.linha("hercules_propostas", "venda-31")?.etapa).toBe("cancelado");
    expect(banco.linha("hercules_reservas", "res-31")?.situacao).toBe("cancelada");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
  });

  it("com reserva viva de outra pessoa no terreno: o cadastro fica reservada", async () => {
    montar({
      reservas: [{ id: "res-outra", origem: "coordenador", situacao: "ativa", unidade_id: "vlo-0306", workspace_id: "careli" }],
    });

    const r = await cancelar();

    expect(r.status).toBe(200);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
    expect(banco.linha("hercules_reservas", "res-outra")?.situacao).toBe("ativa");
  });

  it("bloqueada fica bloqueada", async () => {
    montar({ situacao: "bloqueada" });
    const r = await cancelar();
    expect(r.status).toBe(200);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("bloqueada");
  });

  it("a resposta diz se o lote voltou (loteVoltou) e, quando não voltou, por quê", async () => {
    montar();
    const livre = (await (await cancelar()).json()) as { data: { loteVoltou?: boolean; porque?: null | string } };
    expect(livre.data.loteVoltou).toBe(true);
    expect(livre.data.porque ?? null).toBeNull();

    montar({
      reservas: [{ id: "res-outra", origem: "coordenador", situacao: "ativa", unidade_id: "vlo-0306", workspace_id: "careli" }],
    });
    const preso = (await (await cancelar()).json()) as { data: { loteVoltou?: boolean; porque?: null | string } };
    expect(preso.data.loteVoltou).toBe(false);
    expect(preso.data.porque).toContain("outro dono");
  });

  it("a reserva que não cai: 503 e o lote continua preso (a ordem não muda)", async () => {
    montar();
    banco.falhar((c) => c.tabela === "hercules_reservas" && c.operacao === "update");
    const r = await cancelar();
    expect(r.status).toBe(503);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
  });
});

// ── A NOVA TENTATIVA COMPLETA A SOLTURA ─────────────────────────────────────────
//
// ⚠️ A REVISÃO DE 24/09/2026 ACHOU O LOTE PRESO PARA SEMPRE. Quando a venda já foi para `cancelado` e
// a queda da reserva falha, a resposta é 503 "tente de novo". Mas a nova tentativa procurava só venda
// em `proposta` e devolvia 409 "Não há proposta aberta nesta unidade"; cancelar a reserva recusa
// reserva em `proposta` e bloquear exige `disponivel`. Nenhum botão soltava o lote.

describe("PATCH cancelar proposta: a nova tentativa depois da falha parcial", () => {
  it("a primeira falha na reserva (503); a segunda completa a soltura, o lote volta e os avisos saem uma vez", async () => {
    montar();
    let falhando = true;
    banco.falhar((c) => falhando && c.tabela === "hercules_reservas" && c.operacao === "update");

    const primeira = await cancelar();
    expect(primeira.status).toBe(503);
    expect(banco.linha("hercules_propostas", "venda-31")?.etapa).toBe("cancelado");
    expect(banco.linha("hercules_reservas", "res-31")?.situacao).toBe("proposta");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
    expect(avisos.registrados).toBe(0);

    falhando = false;
    const segunda = await cancelar();
    expect(segunda.status).toBe(200);
    const corpo = (await segunda.json()) as { data: { id?: string; loteVoltou?: boolean; porque?: null | string } };
    expect(corpo.data).toMatchObject({ id: "venda-31", loteVoltou: true, porque: null });
    expect(banco.linha("hercules_reservas", "res-31")?.situacao).toBe("cancelada");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
    // A primeira parou antes dos avisos: a segunda é quem avisa, e só ela.
    expect(avisos.registrados).toBe(1);
  });

  it("com outro dono vivo no terreno, a segunda completa a venda mas NÃO solta o lote", async () => {
    montar({
      reservas: [{ id: "res-outra", origem: "coordenador", situacao: "ativa", unidade_id: "vlo-0306", workspace_id: "careli" }],
    });
    let falhando = true;
    banco.falhar((c) => falhando && c.tabela === "hercules_reservas" && c.operacao === "update");
    expect((await cancelar()).status).toBe(503);

    falhando = false;
    const segunda = await cancelar();
    expect(segunda.status).toBe(200);
    const corpo = (await segunda.json()) as { data: { loteVoltou?: boolean; porque?: null | string } };
    expect(corpo.data.loteVoltou).toBe(false);
    expect(corpo.data.porque).toContain("outro dono");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
    expect(banco.linha("hercules_reservas", "res-outra")?.situacao).toBe("ativa");
  });

  it("depois de um cancelamento completo, cancelar de novo continua 409 e não avisa de novo", async () => {
    montar();
    expect((await cancelar()).status).toBe(200);
    expect(avisos.registrados).toBe(1);

    const de_novo = await cancelar();
    expect(de_novo.status).toBe(409);
    expect(avisos.registrados).toBe(1);
  });

  // ⚠️ A LEITURA DA TRAVA QUE FALHA TAMBÉM É FALHA PARCIAL (revisão de 24/09/2026). A reserva caiu, a
  // venda caiu, e a trava não conseguiu ler o terreno: o cadastro fica `reservada` sem dono nenhum. Com
  // 200, a modal fechava dizendo "não deu para conferir" e a tela não oferecia mais Cancelar proposta
  // (não há proposta aberta): o lote ficava preso sem botão. Com 503 a modal fica aberta, e o mesmo
  // botão termina a soltura. Os avisos saem na primeira (a venda caiu de fato) e não se repetem.
  it("a trava não consegue ler o terreno: 503 com os avisos já dados; a segunda solta o lote sem avisar de novo", async () => {
    montar();
    let falhando = true;
    banco.falhar(
      (c) =>
        falhando &&
        c.tabela === "hercules_unidades" &&
        c.operacao === "select" &&
        banco.linha("hercules_reservas", "res-31")?.situacao === "cancelada",
    );

    const primeira = await cancelar();
    expect(primeira.status).toBe(503);
    expect(((await primeira.json()) as { error?: string }).error).toContain("clique de novo");
    expect(banco.linha("hercules_propostas", "venda-31")?.etapa).toBe("cancelado");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
    expect(avisos.registrados).toBe(1);

    falhando = false;
    const segunda = await cancelar();
    expect(segunda.status).toBe(200);
    const corpo = (await segunda.json()) as { data: { loteVoltou?: boolean } };
    expect(corpo.data.loteVoltou).toBe(true);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
    expect(avisos.registrados).toBe(1);
  });

  it("lote preso de outro dono, com a venda cancelada já solta: 409, nada se escreve no cadastro", async () => {
    // A venda caiu inteira (reserva cancelada), e depois outra pessoa reservou a irmã do terreno.
    montar({
      reservas: [{ id: "res-outra", origem: "coordenador", situacao: "ativa", unidade_id: "vlo-0306", workspace_id: "careli" }],
    });
    expect((await cancelar()).status).toBe(200);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");

    const de_novo = await cancelar();
    expect(de_novo.status).toBe(409);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
    expect(avisos.registrados).toBe(1);
  });
});

// ── DE QUEM É A RETOMADA, E QUEM AVISA ──────────────────────────────────────────
//
// ⚠️ A REVISÃO DE 24/09/2026 ACHOU TRÊS BURACOS NA NOVA TENTATIVA:
//   1. o filtro `cancelamento_pedido_em` VAZIO não prova que o motor da Têmis não derrubou a venda —
//      o indeferimento de um pedido irmão LIMPA a marca (indeferimento-na-venda-server.ts), e o
//      motor trata o caso de marca nula (concluir-cancelamento-server.ts:333). A venda do motor
//      parada no meio caía aqui e saíam os WhatsApps de "proposta cancelada" pelo texto errado;
//   2. sem trava de vencedor único, duas tentativas juntas avisam duas vezes;
//   3. a retomada que NÃO avisa devolvia `avisos: []`, e a modal lia a lista vazia como "O aviso não
//      chegou a ser enviado" — o contrário do que aconteceu.

describe("a retomada é só do cancelamento DESTA rota", () => {
  const derrubadaPeloMotor = (card: Linha): void => {
    montar();
    const venda = banco.linha("hercules_propostas", "venda-31");
    if (venda) {
      venda.aberta = false;
      venda.cancelada_em = new Date().toISOString();
      venda.cancelada_motivo = "Cliente desistiu · Cancelamento concluído na Têmis por Nívea";
      // A marca do pedido está VAZIA porque um pedido irmão foi indeferido antes.
      venda.cancelamento_pedido_em = null;
      venda.etapa = "cancelado";
    }
    banco.semear("temis_trabalhos", card);
  };

  it("card de cancelamento vivo na Têmis: a rota não retoma, não avisa e não mexe na reserva", async () => {
    derrubadaPeloMotor({
      estagio: "analise",
      id: "card-do-pedido",
      proposta_id: "venda-31",
      tipo: "cancelamento",
      workspace_id: "careli",
    });

    const r = await cancelar();

    expect(r.status).toBe(409);
    expect(banco.linha("hercules_reservas", "res-31")?.situacao).toBe("proposta");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
    expect(avisos.registrados).toBe(0);
  });

  it("card de distrato vivo: idem", async () => {
    derrubadaPeloMotor({
      estagio: "contrato",
      id: "card-do-distrato",
      proposta_id: "venda-31",
      tipo: "distrato",
      workspace_id: "careli",
    });

    expect((await cancelar()).status).toBe(409);
    expect(avisos.registrados).toBe(0);
  });

  it("card de cancelamento INDEFERIDO não segura a retomada: ele já não é dono de nada", async () => {
    montar();
    banco.semear("temis_trabalhos", {
      estagio: "indeferido",
      id: "card-recusado",
      proposta_id: "venda-31",
      tipo: "cancelamento",
      workspace_id: "careli",
    });
    let falhando = true;
    banco.falhar((c) => falhando && c.tabela === "hercules_reservas" && c.operacao === "update");
    expect((await cancelar()).status).toBe(503);

    falhando = false;
    const segunda = await cancelar();

    expect(segunda.status).toBe(200);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
  });

  it("a leitura dos cards que falha é `tente de novo`, e não uma retomada às cegas", async () => {
    montar();
    let falhando = true;
    banco.falhar((c) => falhando && c.tabela === "hercules_reservas" && c.operacao === "update");
    expect((await cancelar()).status).toBe(503);

    falhando = false;
    banco.falhar((c) => c.tabela === "temis_trabalhos" && c.operacao === "select");
    const segunda = await cancelar();

    expect(segunda.status).toBe(503);
    expect(banco.linha("hercules_reservas", "res-31")?.situacao).toBe("proposta");
    expect(avisos.registrados).toBe(0);
  });
});

describe("quem avisa é UM só, e a resposta diz quem avisou", () => {
  it("outra tentativa tomou a vez de avisar no meio do caminho: esta solta o lote e NÃO avisa de novo", async () => {
    montar();
    let falhando = true;
    banco.falhar((c) => falhando && c.tabela === "hercules_reservas" && c.operacao === "update");
    expect((await cancelar()).status).toBe(503);
    expect(avisos.registrados).toBe(0);

    falhando = false;
    // A outra tentativa escreve na venda entre a leitura desta e a hora de avisar: é exatamente o
    // que a trava do vencedor único precisa enxergar.
    banco.depois(
      (c) => c.tabela === "hercules_reservas" && c.operacao === "update",
      (b) => {
        const venda = b.linha("hercules_propostas", "venda-31");
        if (venda) venda.atualizado_em = "2026-09-24T23:59:59.000Z";
      },
    );

    const segunda = await cancelar();
    const corpo = (await segunda.json()) as { data: { avisosJaSairam?: boolean; loteVoltou?: boolean } };

    expect(segunda.status).toBe(200);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
    expect(corpo.data.loteVoltou).toBe(true);
    expect(avisos.registrados).toBe(0);
    expect(corpo.data.avisosJaSairam).toBe(true);
  });

  it("a retomada que não avisa DIZ que os avisos já saíram (a lista vazia mentia na tela)", async () => {
    montar();
    let falhando = true;
    banco.falhar(
      (c) =>
        falhando &&
        c.tabela === "hercules_unidades" &&
        c.operacao === "select" &&
        banco.linha("hercules_reservas", "res-31")?.situacao === "cancelada",
    );
    expect((await cancelar()).status).toBe(503);
    expect(avisos.registrados).toBe(1);

    falhando = false;
    const segunda = await cancelar();
    const corpo = (await segunda.json()) as { data: { avisosJaSairam?: boolean } };

    expect(segunda.status).toBe(200);
    expect(corpo.data.avisosJaSairam).toBe(true);
    expect(avisos.registrados).toBe(1);
  });

  it("o cancelamento normal avisa e não diz que alguém já tinha avisado", async () => {
    montar();
    const corpo = (await (await cancelar()).json()) as { data: { avisosJaSairam?: boolean } };
    expect(avisos.registrados).toBe(1);
    expect(corpo.data.avisosJaSairam ?? false).toBe(false);
  });
});

// ⚠️ O 503 NÃO PROMETE O DIA SEGUINTE (revisão de 24/09/2026). A retomada só tem entrada por esta
// modal: recarregada a tela, a unidade presa aparece como `reservada` sem processo, e
// `acaoDeCancelamento` não oferece botão nenhum. Enquanto a tela não tiver a porta própria, o texto
// manda não fechar a janela.

describe("o 503 diz o que fazer com a tela", () => {
  it("a reserva que não cai: o recado manda NÃO fechar esta tela", async () => {
    montar();
    banco.falhar((c) => c.tabela === "hercules_reservas" && c.operacao === "update");
    const r = await cancelar();
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error?: string }).error).toContain("Não feche esta tela");
  });

  it("a trava que não lê o terreno: idem", async () => {
    montar();
    banco.falhar(
      (c) =>
        c.tabela === "hercules_unidades" &&
        c.operacao === "select" &&
        banco.linha("hercules_reservas", "res-31")?.situacao === "cancelada",
    );
    const r = await cancelar();
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error?: string }).error).toContain("Não feche esta tela");
  });
});

// ── A VENDA HERDADA DO C2X SE CANCELA AQUI (Lucas, 25/09/2026) ──────────────────
//
// Lucas, 25/09/2026: *"As reservas que foram herdadas do c2x, nao estamos conseguindo cancelar ou
// dar seguimento na proposta. Essas reservas tem que comportar iguais as outras"*.
//
// ⚠️ A CAUSA MEDIDA: A CARGA TROUXE A PROPOSTA E NUNCA CRIOU A RESERVA. Em 25/09/2026, no projeto
// bxgukywoxgivlrhjkwjx (só SELECT): 13 propostas com `origem_c2x_id` preenchido, em etapa
// `reservado` ou `proposta`, numa linha VIVA de unidade (`espelho_de is null`), com `reserva_id`
// NULO em 13/13 e ZERO linhas em `hercules_reservas` para essas unidades. Quatro são do Veredas do
// Ouro (VDO0305, VDO0706, VDO1224, VDO1225), que é onde o time bateu.
//
// ⚠️ E QUEM CANCELA É ESTA ROTA, NÃO A DA RESERVA. No Panteon a herdada JÁ É uma linha viva de
// `hercules_propostas`: é ela que pinta a cor (`situacao-da-unidade.ts`) e é ela que a trava conta
// como dono (`trava-do-lote.ts`). Cancelar pela rota da reserva não tocaria em `hercules_propostas`,
// a herdada continuaria viva e o lote não soltaria.
//
// ⚠️ A PREMISSA VELHA MORREU. O filtro `origem = 'panteon'` existia porque "o C2X nunca saberia": a
// carga do legado foi ENCERRADA em 21/09/2026, e o Lucas já tinha revogado a regra para o contrato
// em 16/09/2026 (*"será feito aqui"*).

function montarHerdada(c: { etapa?: string; outraViva?: Linha; situacao?: string } = {}): void {
  banco = criarBanco({
    hercules_propostas: [
      {
        aberta: true,
        cliente_nome: "NIVEA CARELI PEREIRA DE AVELAR",
        // O que a carga deixou: sem código, sem protocolo, sem reserva.
        codigo: null,
        etapa: c.etapa ?? "reservado",
        id: "venda-c2x",
        imobiliaria_entity_id: "imob-raiane",
        origem: "c2x",
        origem_c2x_id: 4234,
        protocolo_numero: null,
        reserva_id: null,
        unidade_id: "voc-0306",
        workspace_id: "careli",
      },
      ...(c.outraViva ? [c.outraViva] : []),
    ],
    // ⚠️ VAZIO DE PROPÓSITO: é o retrato do banco. Não há reserva do Hércules para estas vendas.
    hercules_reservas: [],
    hercules_unidades: [
      unidade("vlo-0306", "VLO0306", "35", { espelho_de: "voc-0306", origem_c2x_id: 9001 }),
      unidade("voc-0306", "VOC0306", "37", { origem_c2x_id: 9101, situacao: c.situacao ?? "reservada" }),
    ],
    prometeu_reservas: [],
  });
  estado.banco = banco;
}

const cancelarHerdada = () =>
  PATCH(
    new Request("https://c2x.app.br/api/incorporador/venda/proposta", {
      body: JSON.stringify({
        motivo: MOTIVOS_DE_CANCELAMENTO_DA_PROPOSTA[0],
        propostaId: "venda-c2x",
        unidadeId: "voc-0306",
      }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    }),
  );

describe("PATCH cancelar proposta: a herdada do C2X se cancela aqui", () => {
  it("⚠️ etapa `reservado` (as 11): a venda cai e o lote volta a disponível", async () => {
    montarHerdada({ etapa: "reservado" });

    const r = await cancelarHerdada();

    expect(r.status).toBe(200);
    expect(banco.linha("hercules_propostas", "venda-c2x")?.etapa).toBe("cancelado");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
    const corpo = (await r.json()) as { data: { loteVoltou?: boolean } };
    expect(corpo.data.loteVoltou).toBe(true);
  });

  it("⚠️ etapa `proposta` (CDJ0403 e MDB1306): idem", async () => {
    montarHerdada({ etapa: "proposta" });

    const r = await cancelarHerdada();

    expect(r.status).toBe(200);
    expect(banco.linha("hercules_propostas", "venda-c2x")?.etapa).toBe("cancelado");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
  });

  // ⚠️ A ARMADILHA DA CONDIÇÃO REPETIDA. O UPDATE conferia `.eq("etapa", "proposta")` literal; nas 11
  // em `reservado` isso nunca casaria, e a rota responderia "Esta proposta acabou de ser cancelada em
  // outra tela" sobre o cancelamento que ela mesma acabou de fazer.
  it("⚠️ em `reservado` a trava do clique duplo confere a ETAPA DA LINHA, e não a palavra proposta", async () => {
    montarHerdada({ etapa: "reservado" });
    const r = await cancelarHerdada();
    expect(((await r.clone().json()) as { error?: string }).error ?? "").not.toContain("em outra tela");
    expect(r.status).toBe(200);
  });

  it("⚠️ outra tela cancelou no meio do caminho: 409 e a frase certa", async () => {
    montarHerdada({ etapa: "reservado" });
    // Entre a leitura e a escrita, a outra sessão derruba a linha: a condição repetida tem de pegar.
    banco.depois(
      (c) => c.tabela === "hercules_propostas" && c.operacao === "select",
      (b) => {
        const venda = b.linha("hercules_propostas", "venda-c2x");
        if (venda) venda.etapa = "cancelado";
      },
    );

    const r = await cancelarHerdada();

    expect(r.status).toBe(409);
    expect(((await r.json()) as { error?: string }).error).toContain("em outra tela");
  });

  // ⚠️ A REGRA DE OURO CONTINUA DE PÉ COM A PORTA ABERTA (Lucas, 18/09/2026: *"eu não posso vender
  // dois lotes para pessoas diferentes"*). A herdada em `contrato` no mesmo chão é dono, e a trava
  // segura o cadastro: a venda cai, o lote NÃO volta, e a resposta diz por quê.
  it("⚠️ com outra venda viva no mesmo terreno: a venda cai, o lote NÃO volta", async () => {
    montarHerdada({
      etapa: "reservado",
      outraViva: {
        etapa: "contrato",
        id: "venda-c2x-irma",
        origem: "c2x",
        origem_c2x_id: 4235,
        reserva_id: null,
        unidade_id: "voc-0306",
        workspace_id: "careli",
      },
    });

    const r = await cancelarHerdada();

    expect(r.status).toBe(200);
    expect(banco.linha("hercules_propostas", "venda-c2x")?.etapa).toBe("cancelado");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
    const corpo = (await r.json()) as { data: { loteVoltou?: boolean; porque?: null | string } };
    expect(corpo.data.loteVoltou).toBe(false);
    expect(corpo.data.porque).toContain("outro dono");
  });
});

// ── AS 2 QUE O CADASTRO DIZ `vendida` (CDJ0403 e MDB1306) ───────────────────────
//
// ⚠️ SEM ISTO O BOTÃO ENTREGA O PIOR ESTADO POSSÍVEL: a proposta cai e o lote fica `vendida`, venda
// desfeita com lote preso. A etapa da proposta diz `proposta`, mas o cadastro da unidade diz
// `vendida` porque foi assim que a carga marcou. É a MESMA exceção que a conclusão de um
// cancelamento na Têmis já usa, e o comentário dela em `cancelar-reserva-server.ts` diz exatamente
// por quê: *a venda importada do C2X chega com o cadastro `vendida` pela carga*.

describe("a herdada com cadastro `vendida`", () => {
  it("⚠️ o lote volta a disponível: a saída do estado que a carga criou", async () => {
    montarHerdada({ etapa: "proposta", situacao: "vendida" });

    const r = await cancelarHerdada();

    expect(r.status).toBe(200);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
  });

  it("a proposta NATIVA com cadastro `vendida` continua NÃO devolvendo o lote", async () => {
    // A venda vendida nascida aqui é do jurídico: o alargamento não escapa para ela.
    montar({ situacao: "vendida" });

    const r = await cancelar();

    expect(r.status).toBe(200);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("vendida");
  });

  it("`bloqueada` nunca sai, nem na herdada", async () => {
    montarHerdada({ etapa: "reservado", situacao: "bloqueada" });

    const r = await cancelarHerdada();

    expect(r.status).toBe(200);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("bloqueada");
  });
});

// ── A RETOMADA TAMBÉM ALCANÇA A HERDADA EM `vendida` (revisão de 25/09/2026) ─────
//
// ⚠️ A EXCEÇÃO DO CADASTRO `vendida` TINHA ENTRADO SÓ NA IDA. O `aceitos` da soltura já aceitava
// `vendida` na herdada, mas o portão da retomada continuava exigindo a literal `reservada`: nas 2
// herdadas que a carga deixou em `vendida` (CDJ0403 e MDB1306, medido em 25/09/2026 no projeto
// bxgukywoxgivlrhjkwjx, só SELECT: `reserva_id` NULO e ZERO linhas em `hercules_reservas`), a reserva
// ligada NUNCA está viva, então a segunda tentativa devolvia `null`, a rota respondia 409 "Não há
// proposta aberta nesta unidade" e o lote ficava preso em `vendida` sem botão nenhum — exatamente o
// meio caminho que a exceção existe para evitar, deslocado para o segundo clique. E o texto do 503
// promete o contrário: *"Não feche esta tela e clique de novo em instantes"*.

describe("a retomada da herdada com cadastro `vendida`", () => {
  it("⚠️ 503 na primeira, e a SEGUNDA tentativa solta o lote", async () => {
    montarHerdada({ etapa: "proposta", situacao: "vendida" });
    // A leitura do terreno falha DEPOIS de a venda cair: é o caso para o qual o 503 existe.
    let falhando = true;
    banco.falhar(
      (c) =>
        falhando &&
        c.tabela === "hercules_unidades" &&
        c.operacao === "select" &&
        banco.linha("hercules_propostas", "venda-c2x")?.etapa === "cancelado",
    );

    const primeira = await cancelarHerdada();
    expect(primeira.status).toBe(503);
    expect(((await primeira.json()) as { error?: string }).error).toContain("Não feche esta tela");
    expect(banco.linha("hercules_propostas", "venda-c2x")?.etapa).toBe("cancelado");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("vendida");

    falhando = false;
    const segunda = await cancelarHerdada();

    expect(segunda.status).toBe(200);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
    // Os avisos saíram na primeira tentativa: a segunda não manda o segundo WhatsApp.
    expect(avisos.registrados).toBe(1);
    const corpo = (await segunda.json()) as { data: { avisosJaSairam?: boolean; loteVoltou?: boolean } };
    expect(corpo.data.loteVoltou).toBe(true);
    expect(corpo.data.avisosJaSairam).toBe(true);
  });
});

// ── A LINHA ESPELHO NÃO SE CANCELA POR AQUI (revisão de 25/09/2026) ──────────────
//
// ⚠️ O COMENTÁRIO PROMETIA UMA GUARDA QUE O CÓDIGO NÃO TINHA. Ele dizia que `unidadePorId` mantinha
// fora as 139 herdadas penduradas na sombra do pai; `unidadePorId` lê `hercules_unidades` por id e não
// filtrava `espelho_de` — nem selecionava a coluna. Quem as mantinha fora era só a TELA (a régua ignora
// a linha do pai). E `idsDaSessao` INCLUI o id do grupo, o pai, então o guarda de escopo não barra.
//
// ⚠️ MEDIDO EM 25/09/2026 (projeto bxgukywoxgivlrhjkwjx, só SELECT): 135 herdadas em `reservado` e 4 em
// `proposta` moram em unidade com `espelho_de` preenchido, 38 delas com o cadastro em `vendida` — que,
// por a linha ser herdada, a soltura passaria a aceitar.

describe("PATCH cancelar proposta: a linha espelho é recusada", () => {
  it("⚠️ 409 com a frase da casa, e nada é escrito", async () => {
    montarHerdada({
      etapa: "reservado",
      outraViva: {
        etapa: "reservado",
        id: "venda-c2x-do-pai",
        origem: "c2x",
        origem_c2x_id: 5001,
        reserva_id: null,
        unidade_id: "vlo-0306",
        workspace_id: "careli",
      },
    });
    // O pai está no escopo da sessão, como na vida real.
    estado.ids = ["35", "37", "39"];
    const espelho = banco.linha("hercules_unidades", "vlo-0306");
    if (espelho) espelho.situacao = "vendida";

    const r = await PATCH(
      new Request("https://c2x.app.br/api/incorporador/venda/proposta", {
        body: JSON.stringify({
          motivo: MOTIVOS_DE_CANCELAMENTO_DA_PROPOSTA[0],
          propostaId: "venda-c2x-do-pai",
          unidadeId: "vlo-0306",
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      }),
    );

    expect(r.status).toBe(409);
    expect(((await r.json()) as { error?: string }).error).toContain("registro antigo do terreno");
    expect(banco.linha("hercules_propostas", "venda-c2x-do-pai")?.etapa).toBe("reservado");
    expect(banco.linha("hercules_unidades", "vlo-0306")?.situacao).toBe("vendida");
    expect(avisos.registrados).toBe(0);
  });
});

// ── DUAS VENDAS VIVAS NA MESMA UNIDADE (revisão de 25/09/2026) ───────────────────
//
// ⚠️ O ÍNDICE SAIU DO CAMINHO E O `maybeSingle` FICOU. `hercules_propostas_uma_viva_por_unidade` é
// UNIQUE em `unidade_id` WHERE `origem = 'panteon'` (definição medida em 25/09/2026 no projeto
// bxgukywoxgivlrhjkwjx): com o filtro de origem fora, NADA no banco impede duas herdadas vivas na mesma
// unidade. Com duas, o PostgREST devolve erro e `data` nulo; com o `error` descartado a rota caía na
// retomada e respondia "Não há proposta aberta nesta unidade" sobre uma ficha que acabou de acender o
// botão Cancelar. Hoje são ZERO unidades nesse estado (medido no mesmo dia): é trava para o futuro.

describe("PATCH cancelar proposta: duas vendas vivas na mesma unidade", () => {
  it("⚠️ a resposta NÃO diz 'Não há proposta aberta', e ninguém escolhe pelo coordenador", async () => {
    montarHerdada({
      etapa: "reservado",
      outraViva: {
        etapa: "proposta",
        id: "venda-c2x-segunda",
        origem: "c2x",
        origem_c2x_id: 4235,
        reserva_id: null,
        unidade_id: "voc-0306",
        workspace_id: "careli",
      },
    });

    const r = await cancelarHerdada();
    const erro = ((await r.json()) as { error?: string }).error ?? "";

    expect(r.status).toBe(409);
    expect(erro).not.toContain("Não há proposta aberta");
    expect(erro).toContain("mais de uma venda viva");
    // Nenhuma das duas caiu, e o cadastro ficou como estava.
    expect(banco.linha("hercules_propostas", "venda-c2x")?.etapa).toBe("reservado");
    expect(banco.linha("hercules_propostas", "venda-c2x-segunda")?.etapa).toBe("proposta");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
  });

  it("o erro de LEITURA é 503 'tente de novo', e não 409 'não há proposta'", async () => {
    montarHerdada({ etapa: "reservado" });
    // ⚠️ SÓ A PRIMEIRA LEITURA FALHA, de propósito: a busca da retomada precisa funcionar, senão o 503
    // vem dela e o teste não prova nada. Com o `error` descartado, esta única falha virava 409 "Não há
    // proposta aberta nesta unidade" sobre uma unidade que TEM venda viva.
    let primeira = true;
    banco.falhar((c) => {
      if (c.tabela !== "hercules_propostas" || c.operacao !== "select" || !primeira) return false;
      primeira = false;
      return true;
    });

    const r = await cancelarHerdada();

    expect(r.status).toBe(503);
    expect(((await r.json()) as { error?: string }).error).toContain("Tente de novo");
    expect(banco.linha("hercules_propostas", "venda-c2x")?.etapa).toBe("reservado");
  });
});
