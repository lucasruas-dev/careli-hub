import { describe, expect, it } from "vitest";

import { encerrarDia, iniciarEventoReal } from "./data";

// A trava mais importante do módulo (Lucas 19/jul): depois que o credenciamento abriu, NÃO
// existe reset. Zerar no meio do evento apagaria a fila física de centenas de pessoas já
// bipadas, sem reconstrução possível. Estes testes existem para que ninguém reintroduza um
// "forçar" por engano.

// Mock mínimo do client: responde ao getEvento e registra quem tentou apagar/atualizar o quê.
// Toda chamada de filtro devolve o MESMO objeto (o builder do supabase-js é encadeável), e o
// objeto é "thenable" para que `await` na consulta resolva sem precisar de .maybeSingle().
function clientFake(evento: Record<string, unknown>) {
  const apagou: string[] = [];
  const atualizou: string[] = [];

  const client = {
    from(tabela: string) {
      const resposta = { count: 0, data: evento, error: null };

      const builder: Record<string, unknown> = {
        maybeSingle: async () => resposta,
        single: async () => resposta,
        // Faz `await consulta` resolver como o supabase-js faz.
        then: (resolver: (valor: typeof resposta) => unknown) => Promise.resolve(resolver(resposta)),
      };

      for (const metodo of [
        "eq",
        "neq",
        "is",
        "not",
        "in",
        "order",
        "range",
        "limit",
        "select",
      ]) {
        builder[metodo] = () => builder;
      }

      builder.delete = () => {
        apagou.push(tabela);
        return builder;
      };
      builder.update = () => {
        atualizou.push(tabela);
        return builder;
      };

      return builder;
    },
  };

  return { apagou, atualizou, client: client as never };
}

describe("iniciarEventoReal — a trava", () => {
  it("NÃO reseta um evento que já está em andamento", async () => {
    const { apagou, client } = clientFake({
      config: {},
      data_evento: null,
      enterprise_code: null,
      enterprise_id: null,
      id: "evento-1",
      iniciado_em: "2026-08-01T11:00:00Z",
      nome: "Vale do Ouro",
      status: "em_andamento",
    });

    const resultado = await iniciarEventoReal({ client, eventoId: "evento-1" });

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toMatch(/bloqueado em definitivo/i);
    // O ponto central: nada foi apagado.
    expect(apagou).toEqual([]);
  });

  it("NÃO reseta mesmo se o status ainda for 'ativo' mas o evento já tiver sido iniciado", async () => {
    const { apagou, client } = clientFake({
      config: {},
      data_evento: null,
      enterprise_code: null,
      enterprise_id: null,
      id: "evento-1",
      // Status inconsistente (update parcial, edição manual): a marca de iniciado prevalece.
      iniciado_em: "2026-08-01T11:00:00Z",
      nome: "Vale do Ouro",
      status: "ativo",
    });

    const resultado = await iniciarEventoReal({ client, eventoId: "evento-1" });

    expect(resultado.ok).toBe(false);
    expect(apagou).toEqual([]);
  });

  it("NÃO reseta evento encerrado", async () => {
    const { apagou, client } = clientFake({
      config: {},
      data_evento: null,
      enterprise_code: null,
      enterprise_id: null,
      id: "evento-1",
      iniciado_em: null,
      nome: "Vale do Ouro",
      status: "encerrado",
    });

    const resultado = await iniciarEventoReal({ client, eventoId: "evento-1" });

    expect(resultado.ok).toBe(false);
    expect(apagou).toEqual([]);
  });

  it("não aceita mais um parâmetro de forçar", () => {
    // Trava de contrato: se alguém reintroduzir `forcar`, o TypeScript aqui passa a aceitar
    // a propriedade e este teste deixa de fazer sentido — por isso a checagem é explícita.
    const assinatura = iniciarEventoReal.toString();
    expect(assinatura).not.toMatch(/forcar/);
  });
});

describe("encerrarDia", () => {
  it("só encerra o dia de um evento em andamento", async () => {
    const { atualizou, client } = clientFake({
      config: {},
      data_evento: null,
      enterprise_code: null,
      enterprise_id: null,
      id: "evento-1",
      iniciado_em: null,
      nome: "Vale do Ouro",
      status: "ativo",
    });

    const resultado = await encerrarDia({ client, eventoId: "evento-1" });

    expect(resultado.ok).toBe(false);
    expect(atualizou).toEqual([]);
  });

  it("nunca apaga credenciado: encerrar o dia arquiva, não deleta", async () => {
    const { apagou, client } = clientFake({
      config: {},
      data_evento: null,
      enterprise_code: null,
      enterprise_id: null,
      id: "evento-1",
      iniciado_em: "2026-08-01T11:00:00Z",
      nome: "Vale do Ouro",
      status: "em_andamento",
    });

    await encerrarDia({ client, eventoId: "evento-1" });

    // Quantas pessoas não fecharam, e onde pararam, é dado de performance: não se apaga.
    expect(apagou).toEqual([]);
  });
});
