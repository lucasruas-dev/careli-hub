import { beforeEach, describe, expect, it, vi } from "vitest";

// O CÓDIGO HTTP DA BARRA DA CAD NA PORTA DA MARCAÇÃO.
//
// Lucas (26/09/2026): *"faz uma barra, para enviar para contrato precisa da cad validada"*.
//
// ⚠️ A MESMA BARRA RESPONDIA DE DOIS JEITOS DEPENDENDO DA PORTA, e é isso que este arquivo trava.
// `marcarAtividade` devolvia `{ erro, ok: false }` SEM o `status`, e esta camada traduzia todo `!ok`
// para HTTP 400. Resultado: a frase de fail-closed — *"Não foi possível conferir agora se a CAD do
// titular está aprovada. Nada foi movido; tente de novo em instantes"* — saía com código de erro DO
// CLIENTE. As outras três portas honram a distinção (`app/api/incorporador/venda/contrato/route.ts:227`,
// `lib/temis/contrato-servico.ts:561`, `lib/assinatura/envio-db.ts:117`).
//
// ⚠️ E 400 CONTINUA SENDO O PADRÃO: os erros que esta porta já tinha (trabalho não encontrado, a trava
// do Concluído do cancelamento) não trazem `status`, e nada neles muda.

const estado = vi.hoisted(() => ({
  resposta: { andou: true, estagio: "contrato", ok: true } as Record<string, unknown>,
}));

vi.mock("./trabalhos-db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./trabalhos-db")>()),
  marcarAtividade: async () => estado.resposta,
}));

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => null,
  hashIdentifier: () => "",
}));

import type { AtorDoHub } from "./ator";
import { agirNosTrabalhos } from "./trabalho-servico";

/** Ator do HUB: `recusaDoTrabalhoParaEscrever` devolve `null` na primeira linha para ele. */
const JURIDICO: AtorDoHub = {
  nome: "Jurídico",
  papel: "leitura",
  tipo: "hub",
  userId: "user-hub",
};

const marcar = () =>
  agirNosTrabalhos(
    JURIDICO,
    new Request("https://c2x.app.br/api/temis/trabalhos", {
      body: JSON.stringify({
        acao: "atividade",
        atividade: "Conferir a proposta e o plano vindos do Hércules",
        feita: true,
        id: "card-1",
      }),
      method: "POST",
    }),
  );

beforeEach(() => {
  estado.resposta = { andou: true, estagio: "contrato", ok: true };
});

describe("o status da barra da CAD chega à rota", () => {
  it("⚠️ o fail-closed da CAD sai 503, e não 400", async () => {
    estado.resposta = {
      erro: "Não foi possível conferir agora se a CAD do titular está aprovada. Nada foi movido; tente de novo em instantes.",
      ok: false,
      status: 503,
    };

    const resposta = await marcar();

    expect(resposta.status).toBe(503);
    expect((await resposta.json()).error).toContain("tente de novo em instantes");
  });

  it("a recusa da CAD sai 409", async () => {
    estado.resposta = {
      erro: "A CAD deste cliente está em validação de cadastro desde 26/09/2026.",
      ok: false,
      status: 409,
    };

    expect((await marcar()).status).toBe(409);
  });

  // ⚠️ O PADRÃO NÃO MUDOU: erro sem `status` continua 400, que é o que esta porta sempre respondeu.
  it("erro sem status continua 400", async () => {
    estado.resposta = { erro: "trabalho não encontrado", ok: false };

    expect((await marcar()).status).toBe(400);
  });

  it("com a CAD aprovada, a marcação responde 200", async () => {
    const resposta = await marcar();

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toMatchObject({ andou: true, estagio: "contrato", ok: true });
  });
});
