import { describe, expect, it } from "vitest";

import { bipDaSecretaria, bipDoSalao, chamarCredenciado } from "./data";

// Os dois bips que faltavam no trilho fisico. A regra que mais importa e' a do SALAO: so' entra
// quem foi CHAMADO. Sem essa trava, qualquer um com a etiqueta na mao fura a fila no dia do
// lancamento — e a fila e' o que a pre-venda vendeu (quem pagou o PIX antes entra antes).
//
// O client e' dublado: cada teste descreve o que o banco responderia e conferimos a DECISAO,
// nao o SQL. Assim a regra fica travada mesmo que a consulta mude de forma.

type Resposta = { data: unknown };

function clientFalso(config: {
  chamadaAberta?: { id: string } | null;
  pessoa?: { etapa: string; evento_id: string; nome: string } | null;
  registrarUpdate?: (tabela: string, valores: Record<string, unknown>) => void;
}) {
  const construir = (tabela: string) => {
    const encadeavel = {
      eq: () => encadeavel,
      is: () => encadeavel,
      limit: () => encadeavel,
      maybeSingle: async (): Promise<Resposta> => {
        if (tabela === "prometeu_credenciados") {
          return { data: config.pessoa ?? null };
        }

        if (tabela === "prometeu_chamadas") {
          return { data: config.chamadaAberta ?? null };
        }

        return { data: null };
      },
      neq: () => encadeavel,
      order: () => encadeavel,
      select: () => encadeavel,
      then: undefined,
      update: (valores: Record<string, unknown>) => {
        config.registrarUpdate?.(tabela, valores);

        // Thenable encadeável: os updates reais variam entre `.eq()`, `.eq().is()`,
        // `.eq().is().is()` e `.eq().eq().select()` — o dublê aceita qualquer cadeia e resolve
        // sempre com uma linha afetada.
        type Upd = {
          eq: () => Upd;
          is: () => Upd;
          select: () => Upd;
          then: (
            resolver: (v: { data: { id: string }[]; error: null }) => unknown,
          ) => unknown;
        };
        const upd: Upd = {
          eq: () => upd,
          is: () => upd,
          select: () => upd,
          then: (resolver) => resolver({ data: [{ id: "linha" }], error: null }),
        };

        return upd;
      },
    };

    return {
      ...encadeavel,
      insert: async () => ({ error: null }),
    };
  };

  return { from: (tabela: string) => construir(tabela) } as never;
}

const PESSOA = { etapa: "recepcao", evento_id: "evento-1", nome: "Maria Souza" };

describe("bipDoSalao", () => {
  // A TRAVA. Bipar quem nao foi chamado nao pode mover ninguem.
  it("RECUSA quem nao foi chamado, e diz o nome pro organizador barrar", async () => {
    const r = await bipDoSalao({
      client: clientFalso({ chamadaAberta: null, pessoa: PESSOA }),
      credenciadoId: "c1",
      eventoId: "evento-1",
    });

    expect(r.ok).toBe(false);
    expect(r.recusadoPelaRegra).toBe(true);
    expect(r.error).toContain("Maria Souza");
    expect(r.error).toContain("não foi chamado");
  });

  // O ALERTA TEM QUE FALAR A VERDADE (caso real do Lucas, 27/07): ele chamou uma pessoa e
  // bipou outra que JÁ ESTAVA no salão. A tela acusou "não foi chamado" — mas essa tinha sido
  // chamada, entrou, e por isso a chamada dela já estava fechada. Recusar está certo; mentir
  // o motivo não, porque o organizador vai repetir a frase errada para o cliente.
  it("quem JA passou pelo salao ouve onde esta, nao 'nao foi chamado'", async () => {
    const r = await bipDoSalao({
      client: clientFalso({
        chamadaAberta: null,
        pessoa: { ...PESSOA, etapa: "negociacao" },
      }),
      credenciadoId: "c1",
      eventoId: "evento-1",
    });

    expect(r.ok).toBe(false);
    expect(r.recusadoPelaRegra).toBe(true);
    expect(r.error).toContain("já passou por aqui");
    expect(r.error).toContain("Negociação");
    expect(r.error).not.toContain("não foi chamado");
  });

  it("recusa QR de outro lancamento", async () => {
    const r = await bipDoSalao({
      client: clientFalso({ pessoa: { ...PESSOA, evento_id: "outro-evento" } }),
      credenciadoId: "c1",
      eventoId: "evento-1",
    });

    expect(r.ok).toBe(false);
    // Nao e' recusa por regra de chamada: e' QR errado. A tela trata diferente.
    expect(r.recusadoPelaRegra).toBeUndefined();
  });

  it("recusa credenciado inexistente", async () => {
    const r = await bipDoSalao({
      client: clientFalso({ pessoa: null }),
      credenciadoId: "nao-existe",
      eventoId: "evento-1",
    });

    expect(r.ok).toBe(false);
  });
});

describe("bipDaSecretaria", () => {
  // Aqui NAO ha chamada previa: a pessoa vai por conta propria. A chegada e' o sinal.
  it("aceita sem chamada previa e devolve o nome", async () => {
    const r = await bipDaSecretaria({
      client: clientFalso({ chamadaAberta: null, pessoa: PESSOA }),
      credenciadoId: "c1",
      eventoId: "evento-1",
    });

    expect(r.ok).toBe(true);
    expect(r.credenciado?.nome).toBe("Maria Souza");
    expect(r.credenciado?.etapa).toBe("secretaria");
  });

  // Rebipar nao pode acusar erro: o organizador as vezes passa o QR duas vezes conferindo.
  it("rebipar quem ja esta na secretaria devolve ok, sem mover nada", async () => {
    const r = await bipDaSecretaria({
      client: clientFalso({ pessoa: { ...PESSOA, etapa: "secretaria" } }),
      credenciadoId: "c1",
      eventoId: "evento-1",
    });

    expect(r.ok).toBe(true);
    expect(r.credenciado?.etapa).toBe("secretaria");
  });

  it("recusa QR de outro lancamento", async () => {
    const r = await bipDaSecretaria({
      client: clientFalso({ pessoa: { ...PESSOA, evento_id: "outro-evento" } }),
      credenciadoId: "c1",
      eventoId: "evento-1",
    });

    expect(r.ok).toBe(false);
    expect(r.error).toContain("lancamento");
  });
});

// UMA CHAMADA ABERTA POR PESSOA. No teste do Lucas (27/07) o mesmo cliente apareceu QUATRO
// vezes no painel de trânsito: cada toque em "Chamar" inseria uma linha nova. Rechamar é
// repetir o anúncio, não abrir outra chamada.
describe("chamarCredenciado", () => {
  it("NAO abre uma segunda chamada para quem ja esta em transito", async () => {
    const escritas: { tabela: string; tipo: string }[] = [];

    const client = clientFalso({
      chamadaAberta: { id: "chamada-1" },
      pessoa: PESSOA,
      registrarUpdate: (tabela) => escritas.push({ tabela, tipo: "update" }),
    });

    const r = await chamarCredenciado({
      client,
      credenciadoId: "c1",
      eventoId: "evento-1",
      zona: "salao",
    });

    expect(r.ok).toBe(true);
    // Atualizou a chamada existente (carimba a hora de novo) em vez de inserir outra.
    expect(escritas.some((e) => e.tabela === "prometeu_chamadas")).toBe(true);
  });

  it("abre a chamada quando ninguem foi chamado ainda", async () => {
    const r = await chamarCredenciado({
      client: clientFalso({ chamadaAberta: null, pessoa: PESSOA }),
      credenciadoId: "c1",
      eventoId: "evento-1",
      zona: "salao",
    });

    expect(r.ok).toBe(true);
  });
});
