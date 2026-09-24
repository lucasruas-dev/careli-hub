import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A PORTA DO "MOVER CAD" (24/09/2026): casca fina sobre `lib/apolo/mover-cad.ts`.
//
// O que não pode mudar sem alguém perceber:
//   • só a COORDENAÇÃO (admin/leader) passa; o analista (operator) recebe o 403 da porta e o serviço
//     nem é chamado. Mover tira credenciado do credenciamento e dispara aviso de etapa;
//   • o `[id]` da rota é a ficha (entity_id), como nas rotas irmãs do Board;
//   • o corpo `{ de, para }` vai inteiro ao serviço, e a resposta volta como veio (status e corpo),
//     no formato que a tela consome: `{ data: { de, para, empreendimentoNovo, etapaAnterior,
//     etapaNova, credito, avisos, incompleto } }` ou `{ error }`.

const m = vi.hoisted(() => ({
  admin: vi.fn(() => ({ cliente: "admin" }) as unknown),
  coordenacao: vi.fn(),
  escrita: vi.fn(),
  mover: vi.fn(),
}));

vi.mock("@/lib/apolo/auth", () => ({
  authorizeApoloCoordenacao: m.coordenacao,
  authorizeApoloWrite: m.escrita,
}));
vi.mock("@/lib/apolo/server", () => ({ createApoloAdminClient: m.admin }));
vi.mock("@/lib/apolo/mover-cad", () => ({ moverCadDeEmpreendimento: m.mover }));

import { POST } from "./route";

const USER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ENTIDADE = "c34d4b6c-ac71-43ca-b7c2-6a7ec7f69c29";
const ok = { nome: "Nívea", ok: true, userId: USER };
const negado = () => ({
  ok: false,
  response: NextResponse.json({ error: "Usuario sem acesso ao Apolo." }, { status: 403 }),
});

const RESPOSTA = {
  data: {
    avisos: [],
    credito: { avaliado: false, motivo: "Sem consulta de crédito recente.", passou: null },
    de: "19",
    empreendimentoNovo: "VALE DO OURO",
    etapaAnterior: "credenciado",
    etapaNova: "credito",
    incompleto: false,
    para: "35",
  },
};

const chamar = (corpo: unknown = { de: "19", para: "37" }) =>
  POST(
    new Request(`https://c2x.app.br/api/apolo/board/${ENTIDADE}/mover-empreendimento`, {
      body: typeof corpo === "string" ? corpo : JSON.stringify(corpo),
      headers: { authorization: "Bearer x" },
      method: "POST",
    }),
    { params: Promise.resolve({ id: ENTIDADE }) },
  );

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockClear();
  m.coordenacao.mockResolvedValue(ok);
  m.escrita.mockResolvedValue(ok);
  m.admin.mockImplementation(() => ({ cliente: "admin" }));
  m.mover.mockResolvedValue({ corpo: RESPOSTA, status: 200 });
});

describe("POST /api/apolo/board/[id]/mover-empreendimento", () => {
  it("coordenação: o serviço recebe a ficha do [id], o corpo e o autor; a resposta volta como veio", async () => {
    const r = await chamar();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(RESPOSTA);
    expect(m.mover).toHaveBeenCalledWith({
      autor: { userId: USER },
      client: { cliente: "admin" },
      corpo: { de: "19", para: "37" },
      entityId: ENTIDADE,
      uploadedByName: "Board",
    });
    // A porta é a da coordenação, e não a de escrita comum.
    expect(m.coordenacao).toHaveBeenCalledTimes(1);
    expect(m.escrita).not.toHaveBeenCalled();
  });

  it("troca feita com passo que não saiu: 200 com `incompleto` e os `avisos`, do jeito que vieram", async () => {
    // (24/09/2026, terceira rodada) `incompleto` é só para passo de DADO (aqui, o vínculo); o aviso
    // ao coordenador entra em `avisos` e diz o que conferir, sem mandar "reenviar".
    const parcial = {
      data: {
        ...RESPOSTA.data,
        avisos: [
          "O vínculo com o novo empreendimento não foi criado.",
          "O aviso ao coordenador do novo empreendimento não saiu: Empreendimento sem coordenador de vendas no C2X. Confira o coordenador de vendas do empreendimento no C2X.",
        ],
        incompleto: true,
      },
    };
    m.mover.mockResolvedValueOnce({ corpo: parcial, status: 200 });
    const r = await chamar();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(parcial);
  });

  it("analista (sem coordenação): 403 da porta, sem serviço", async () => {
    m.coordenacao.mockResolvedValue(negado());
    const r = await chamar();
    expect(r.status).toBe(403);
    expect(m.mover).not.toHaveBeenCalled();
  });

  it("os erros do serviço saem com o status e a frase dele (409, 400, 404, 503)", async () => {
    for (const [status, error] of [
      [409, "Este cliente já tem CAD no novo empreendimento. Ajuste a CAD que já existe lá."],
      [400, "A CAD já está neste empreendimento."],
      [400, "Este empreendimento não recebe CAD."],
      [409, "A CAD mudou enquanto era movida. Nada foi alterado. Recarregue o Board e tente de novo."],
      [
        409,
        "Esta CAD já tem cobrança de pré-venda no empreendimento atual. Mover levaria a cobrança para outro empreendimento. Resolva a cobrança antes de mover.",
      ],
      [404, "Esta CAD não foi encontrada neste empreendimento."],
      [503, "Não foi possível mover a CAD agora. Nada foi alterado."],
      [503, "Não foi possível conferir os empreendimentos que recebem CAD agora. Nada foi alterado."],
    ] as const) {
      m.mover.mockResolvedValueOnce({ corpo: { error }, status });
      const r = await chamar();
      expect(r.status).toBe(status);
      expect(await r.json()).toEqual({ error });
    }
  });

  it("corpo que não é JSON vira objeto vazio (o serviço responde 400)", async () => {
    await chamar("isto não é json");
    expect(m.mover).toHaveBeenCalledWith(expect.objectContaining({ corpo: {} }));
  });

  it("sem Supabase server-side: 503, sem serviço", async () => {
    m.admin.mockImplementation(() => null);
    const r = await chamar();
    expect(r.status).toBe(503);
    expect(m.mover).not.toHaveBeenCalled();
  });

  it("ambiente local (usuário sintético): o PDF sai sem autor", async () => {
    m.coordenacao.mockResolvedValue({ nome: null, ok: true, userId: "local-hub-user" });
    await chamar();
    expect(m.mover).toHaveBeenCalledWith(expect.objectContaining({ uploadedByName: null }));
  });
});
