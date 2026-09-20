import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GuardianCompromissoDetail } from "@/lib/guardian/compromissos";
import { MOTIVOS_DO_TERMO } from "@/lib/hades/dossie/termo-de-acordo-gate";

// A PORTA DO ENVIO, EXERCITADA DE VERDADE — revisão independente de 20/09/2026.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ NADA AQUI TOCA A CLICKSIGN. `@/lib/assinatura/clicksign/envelope` é um duplo e a contagem de
// chamadas dele é a prova: a conta é de PRODUÇÃO, cada envelope custa e o ativado não se apaga.
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// `route.test.ts`, do implementador, lê a rota como TEXTO (confere que o gate está escrito lá).
// Este arquivo CHAMA os métodos: a pergunta da revisão não é se a linha existe, é se um POST cru,
// sem tela nenhuma, consegue mandar um acordo que o gestor não aprovou.
//
// Os três casos que o Lucas pediu (20/09/2026, *"o acordo so pode ficar disponivel para envio
// depois da aprovacao"*) e mais o quarto, que é a corrida: a TELA foi carregada quando o acordo
// estava aprovado e o registro mudou depois.

const oAcordo = { atual: null as GuardianCompromissoDetail | null };
const chamadasDaClicksign: string[] = [];

/**
 * A CHAVE DA CASA, LIGÁVEL POR TESTE.
 *
 * ⚠️ ELA PRECISA SER MÓVEL AQUI, e é o único duplo deste arquivo que muda no meio do caminho.
 * `TERMO_DE_ACORDO_LIBERADO` está `false` no repositório por decisão do Lucas (16/09/2026), e
 * desde 20/09/2026 ela fecha o POST e o PATCH, e não só o botão. Com ela fixa em `false` todo teste
 * de aprovação deste arquivo mediria a chave, e não a régua; com ela fixa em `true`, ninguém provaria
 * que a porta está trancada. O getter resolve os dois: a rota lê a chave a cada chamada.
 */
const chave = { ligada: true };

vi.mock("@/lib/apolo/termos-liberados", () => ({
  get TERMO_DE_ACORDO_LIBERADO() {
    return chave.ligada;
  },
  TERMO_DE_RESCISAO_LIBERADO: false,
}));

vi.mock("@/lib/guardian/auth", () => ({
  authorizeHadesWrite: async () => ({
    ok: true,
    user: { displayName: "Operador da Revisão", email: null, id: "user-1", role: "operator" },
  }),
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => bancoDeTeste(),
}));

vi.mock("@/lib/guardian/compromissos", () => ({
  createGuardianMotorClient: () => ({}),
  // ⚠️ A ROTA RELÊ O ACORDO A CADA CHAMADA, e é isso que este duplo mede: o valor devolvido aqui é
  // o que o BANCO diria agora, não o que a tela guardou.
  getGuardianCompromissoDetail: async () => oAcordo.atual,
}));

vi.mock("@/lib/assinatura/clicksign/cliente", () => ({
  conferirConfiguracao: () => ({ faltando: [] as string[], ok: true }),
}));

vi.mock("@/lib/assinatura/clicksign/envelope", () => ({
  cancelarEnvelope: async () => {
    chamadasDaClicksign.push("cancelar");
    return { ok: true as const };
  },
  consultarEnvelope: async () => {
    chamadasDaClicksign.push("consultar");
    return { estado: "aguardando", ok: true as const };
  },
  enviarParaAssinatura: async () => {
    chamadasDaClicksign.push("enviar");
    return {
      documentoId: "doc-1",
      envelopeId: "env-1",
      nome: "Termo de Acordo - REVISAO.pdf",
      ok: true as const,
      signatarios: [],
    };
  },
}));

vi.mock("@/lib/hades/acordo/termo-em-pdf", () => ({
  montarTermoDoAcordoEmPdf: async () => ({
    bytes: new Uint8Array([37, 80, 68, 70]),
    nome: "Termo de Acordo - REVISAO.pdf",
    ok: true as const,
  }),
}));

vi.mock("@/lib/temis/dados-do-contrato", () => ({
  dadosDaProposta: async () => ({
    dados: {
      compradores: [
        {
          temConjuge: false,
          valores: {
            cpf_cliente: "444.555.666-17",
            email_cliente: "comprador@exemplo.test",
            nome_cliente: "Beltrano Exemplo Ferreira",
          },
        },
      ],
      gerais: { __empreendimento_id: "19", codigo_unidade: "VDO1301", empreendimento_codigo: "VDO" },
    },
  }),
}));

vi.mock("@/lib/assinatura/quadro-db", () => ({
  assinantesDoQuadro: async () => [
    {
      cpf: "111.222.333-44",
      email: "representante@incorporadora.test",
      nome: "Fulana Representante Legal",
      papel: "vendedora" as const,
      telefone: null,
    },
  ],
  empresasDoEmpreendimento: async () => ({ coordenador: null, vendedora: "ent-vendedora" }),
}));

vi.mock("@/lib/assinatura/diario-do-envelope-db", () => ({
  diarioDoCompromisso: async () => null,
}));

vi.mock("@/lib/temis/trocar-signatario", () => ({
  reenviarConvite: async () => {
    chamadasDaClicksign.push("reenviar-convite");
    return { ok: true as const };
  },
}));

const { DELETE, GET, PATCH, POST } = await import("./route");

const ID = "11111111-2222-3333-4444-555555555555";

/** O Supabase do Panteon, no recorte que a rota usa. Sem envelope nenhum gravado. */
function bancoDeTeste() {
  const from = (tabela: string) => {
    const builder: Record<string, unknown> = {};
    // `temis_envelopes` é aguardada como LISTA (a busca dos envelopes do acordo); as outras leituras
    // terminam em `maybeSingle`.
    const lista = { data: [] as unknown[], error: null };
    const linha = {
      data: tabela === "hercules_propostas" ? { id: "prop-1", unidade_id: "uni-1" } : { id: "registro-1" },
      error: null,
    };
    Object.assign(builder, {
      eq: () => builder,
      insert: () => builder,
      limit: () => builder,
      maybeSingle: () => Promise.resolve(linha),
      order: () => builder,
      select: () => builder,
      then: (resolver: (r: unknown) => unknown) => Promise.resolve(resolver(lista)),
      update: () => builder,
    });
    return builder;
  };
  return { from };
}

const acordo = (patch: Partial<GuardianCompromissoDetail> = {}): GuardianCompromissoDetail =>
  ({
    acquisitionRequestC2xId: 9001,
    approvalStatus: "aprovado",
    clientC2xId: 2508,
    id: ID,
    kind: "acordo",
    metadata: {},
    parcelas: [{ amount: 591.08, dueDate: "2026-07-15", id: "p1", sequence: 1 }],
    protocol: "AC-000042",
    status: "ativo",
    ...patch,
  }) as unknown as GuardianCompromissoDetail;

function pedidoDeEnvio() {
  return new Request("https://c2x.app.br/api/guardian/termo-de-acordo/assinatura", {
    body: JSON.stringify({ acordo: ID }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

beforeEach(() => {
  chamadasDaClicksign.length = 0;
  oAcordo.atual = acordo();
  chave.ligada = true;
});

// ── A CHAVE, ANTES DE QUALQUER RÉGUA ────────────────────────────────────────
//
// ⚠️ ESCONDER BOTÃO PROTEGE A TELA; QUEM PROTEGE A CONTA É A ROTA. Enquanto a chave estiver `false`
// (e ela está, no repositório), qualquer usuário de ESCRITA do Hades, ou um script com o token dele,
// chamaria este POST e criaria um envelope REAL na conta de PRODUÇÃO, pago, permanente, com convite
// por e-mail para o comprador. Os dois métodos medidos aqui são os dois que mandam e-mail.
describe("a chave TERMO_DE_ACORDO_LIBERADO fecha a porta, e não só o botão", () => {
  it("chave desligada: o POST recusa e a Clicksign não é chamada", async () => {
    chave.ligada = false;

    const resposta = await POST(pedidoDeEnvio());
    const corpo = (await resposta.json()) as { error?: string };

    expect(resposta.status).toBe(503);
    expect(corpo.error).toContain("não está liberado");
    expect(chamadasDaClicksign).toHaveLength(0);
  });

  it("chave desligada: o reenvio de convite também recusa", async () => {
    chave.ligada = false;

    const resposta = await PATCH(
      new Request("https://c2x.app.br/api/guardian/termo-de-acordo/assinatura", {
        body: JSON.stringify({ acordo: ID, signerId: "sig-1" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      }),
    );

    expect(resposta.status).toBe(503);
    expect(chamadasDaClicksign).toHaveLength(0);
  });

  // ⚠️ O GET E O DELETE FICAM DE FORA DE PROPÓSITO: o GET não cria nada e é como a tela MOSTRA um
  // envelope que já existe; o DELETE é o gesto corretivo, e trancá-lo deixaria um envelope vivo sem
  // como cancelar no dia em que a chave voltasse para `false`.
  it("chave desligada: o GET continua respondendo, porque ele não cria nada", async () => {
    chave.ligada = false;

    const resposta = await GET(
      new Request(`https://c2x.app.br/api/guardian/termo-de-acordo/assinatura?acordo=${ID}`),
    );

    expect(resposta.status).toBe(200);
    expect(chamadasDaClicksign).toHaveLength(0);
  });
});

// ── OS TRÊS CASOS DO LUCAS, PELA ROTA ───────────────────────────────────────

describe("um POST cru só sai com acordo aprovado", () => {
  it("SEM APROVAÇÃO: 409, a frase do gestor, e zero chamadas à Clicksign", async () => {
    oAcordo.atual = acordo({ approvalStatus: "pendente" });

    const resposta = await POST(pedidoDeEnvio());
    const corpo = (await resposta.json()) as { error?: string };

    expect(resposta.status).toBe(409);
    expect(corpo.error).toBe(MOTIVOS_DO_TERMO.pendente);
    expect(chamadasDaClicksign).toHaveLength(0);
  });

  it("EM ELABORAÇÃO: 409, e a frase manda enviar ao gestor antes", async () => {
    oAcordo.atual = acordo({ approvalStatus: "em_elaboracao" });

    const resposta = await POST(pedidoDeEnvio());
    const corpo = (await resposta.json()) as { error?: string };

    expect(resposta.status).toBe(409);
    expect(corpo.error).toBe(MOTIVOS_DO_TERMO.elaboracao);
    expect(chamadasDaClicksign).toHaveLength(0);
  });

  it("REPROVADO: 409, a frase da reprovação, e zero chamadas à Clicksign", async () => {
    oAcordo.atual = acordo({ approvalStatus: "reprovado" });

    const resposta = await POST(pedidoDeEnvio());
    const corpo = (await resposta.json()) as { error?: string };

    expect(resposta.status).toBe(409);
    expect(corpo.error).toBe(MOTIVOS_DO_TERMO.reprovado);
    expect(chamadasDaClicksign).toHaveLength(0);
  });

  it("APROVADO: 200 e o envelope nasce", async () => {
    const resposta = await POST(pedidoDeEnvio());
    const corpo = (await resposta.json()) as { data?: { envelopeId?: string } };

    expect(resposta.status).toBe(200);
    expect(corpo.data?.envelopeId).toBe("env-1");
    expect(chamadasDaClicksign).toEqual(["enviar"]);
  });
});

// ⚠️ A CORRIDA QUE O LUCAS DESCREVEU: a tela carregou com o acordo aprovado e o registro mudou
// ANTES do clique. Quem decide é o banco no momento do POST, e não o card que o navegador guardou.
describe("a tela velha não vence o banco", () => {
  it("aprovado na tela, reprovado no banco: a rota recusa e nada é criado", async () => {
    // O card do navegador ainda diz "aprovado"; o gestor mexeu no registro no meio do caminho.
    oAcordo.atual = acordo({ approvalStatus: "reprovado" });

    const resposta = await POST(pedidoDeEnvio());
    const corpo = (await resposta.json()) as { error?: string };

    expect(resposta.status).toBe(409);
    expect(corpo.error).toBe(MOTIVOS_DO_TERMO.reprovado);
    expect(chamadasDaClicksign).toHaveLength(0);
  });

  it("o reenvio de convite também é recusado quando a aprovação caiu", async () => {
    oAcordo.atual = acordo({ approvalStatus: "reprovado" });

    const resposta = await PATCH(
      new Request("https://c2x.app.br/api/guardian/termo-de-acordo/assinatura", {
        body: JSON.stringify({ acordo: ID, signerId: "sig-1" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      }),
    );
    const corpo = (await resposta.json()) as { error?: string };

    expect(resposta.status).toBe(409);
    expect(corpo.error).toBe(MOTIVOS_DO_TERMO.reprovado);
    expect(chamadasDaClicksign).toHaveLength(0);
  });
});

// ⚠️ O GET LISTA NOME E E-MAIL DE PESSOA. Para acordo que o gate barra, a lista tem de vir VAZIA:
// quem não pode mandar não precisa do cadastro de ninguém.
describe("o GET do acordo barrado não entrega dado de pessoa", () => {
  it("reprovado: devolve a frase e nenhum signatário", async () => {
    oAcordo.atual = acordo({ approvalStatus: "reprovado" });

    const resposta = await GET(
      new Request(`https://c2x.app.br/api/guardian/termo-de-acordo/assinatura?acordo=${ID}`),
    );
    const corpo = (await resposta.json()) as {
      data?: { impedimento?: null | string; signatarios?: unknown[] };
    };

    expect(resposta.status).toBe(200);
    expect(corpo.data?.impedimento).toBe(MOTIVOS_DO_TERMO.reprovado);
    expect(corpo.data?.signatarios).toEqual([]);
    expect(resposta.headers.get("Cache-Control")).toBe("no-store");
  });
});

// ⚠️ O CANCELAMENTO É O GESTO CORRETIVO e por isso NÃO é gateado — é o que o implementador
// escreveu, e está certo. O que esta revisão mede é que ele continua alcançável por quem precisa
// dele: justamente o acordo que perdeu a aprovação DEPOIS de o termo ter saído.
describe("cancelar o envelope continua possível sem aprovação", () => {
  it("acordo reprovado: o DELETE não é barrado pelo gate", async () => {
    oAcordo.atual = acordo({ approvalStatus: "reprovado" });

    const resposta = await DELETE(
      new Request("https://c2x.app.br/api/guardian/termo-de-acordo/assinatura", {
        body: JSON.stringify({ acordo: ID }),
        headers: { "content-type": "application/json" },
        method: "DELETE",
      }),
    );
    const corpo = (await resposta.json()) as { error?: string };

    // Sem envelope gravado ele para por falta de envelope, e NÃO pela frase da aprovação: é isso
    // que prova que o gate não está no caminho do cancelamento.
    expect(corpo.error).not.toBe(MOTIVOS_DO_TERMO.reprovado);
    expect(resposta.status).toBe(404);
  });
});
