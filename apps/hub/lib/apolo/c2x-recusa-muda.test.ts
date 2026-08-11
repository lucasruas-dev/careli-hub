import { describe, expect, it, vi } from "vitest";

import { interpretarResposta, motivoDaRecusaC2x } from "./c2x-write";

// 🔴 A RECUSA MUDA — O SILÊNCIO QUE SOBROU DEPOIS DE FECHAR OS OUTROS.
//
// Medido na `apolo_c2x_sync` de produção em 08/08: TRÊS CADs PJ (CNPJs 57846125000154,
// 66197606000177, 67847245000120) com `status = 'erro'` e `erro = ''`. A `resposta` guardada era
// `{"status":"failed","mensagem":"","erros":{},"duplicado":false}` — a API do C2X recusou e não
// disse por quê, e o servidor copiou o nada para a coluna.
//
// No card isso vira "Não subiu para o C2X: motivo não registrado." (o fallback do `SeloC2x`, em
// board-view.tsx). É exatamente a pergunta do dono — "por que não subiu?" — sem resposta, só que
// desta vez do lado de DEPOIS do POST: as fases anteriores cobriram as recusas NOSSAS, tomadas
// antes de falar com o C2X, e esta acontece quando o C2X já respondeu.
//
// As duas metades que este arquivo protege:
//   1. `errors` sem `errors_message` -> os motivos existiam e eram jogados fora;
//   2. os dois vazios               -> a linha CONFESSA que não veio motivo, em vez de ficar muda.

describe("motivoDaRecusaC2x: a coluna `erro` nunca fica em branco", () => {
  it("usa o errors_message quando ele vem (o texto que o time já sabe ler)", () => {
    const r = interpretarResposta({
      errors: { escolaridade: ["não pode ficar em branco"] },
      errors_message: "Escolaridade não pode ficar em branco",
      status: "failed",
    });
    expect(motivoDaRecusaC2x(r)).toBe("Escolaridade não pode ficar em branco");
  });

  it("sem errors_message, monta o motivo a partir de `errors` — que antes ia para o lixo", () => {
    const r = interpretarResposta({
      errors: { escolaridade: ["não pode ficar em branco"], porte: ["inválido", "obrigatório"] },
      status: "failed",
    });
    const motivo = motivoDaRecusaC2x(r);
    expect(motivo).toContain("escolaridade: não pode ficar em branco");
    expect(motivo).toContain("porte: inválido; obrigatório");
  });

  it("🔴 API muda (os dois vazios): a linha diz que NÃO veio motivo, em vez de ficar vazia", () => {
    // O corpo exato dos três casos de produção.
    const r = interpretarResposta({ errors: {}, errors_message: "", status: "failed" });
    const motivo = motivoDaRecusaC2x(r);
    expect(motivo).not.toBe("");
    expect(motivo).toContain("RECUSOU");
    expect(motivo).toContain("NÃO disse o motivo");
    // E manda para onde olhar: o corpo cru agora é guardado.
    expect(motivo).toContain("resposta.corpo");
  });

  it("guarda o corpo CRU da resposta: sem ele não há prova do que o C2X respondeu", () => {
    const cru = { algo: "que não sabemos ler", status: "failed" };
    const r = interpretarResposta(cru);
    expect(r.status === "failed" && r.corpo).toEqual(cru);
  });

  it("falha de transporte sem detalhe também não passa em branco", () => {
    expect(motivoDaRecusaC2x({ detalhe: "   ", status: "erro_transporte" })).toContain(
      "sem detalhe",
    );
  });
});

// ── O CAMINHO INTEIRO: recusa muda -> linha da fila com motivo legível ────
//
// O mock troca SÓ o transporte. Todo o resto é o código de verdade: é ele que precisa provar que
// não escreve `erro = ''` na tabela.
vi.mock("./c2x-write", async () => {
  const real = await vi.importActual<typeof import("./c2x-write")>("./c2x-write");
  return {
    ...real,
    // A resposta EXATA dos três PJ de 08/08.
    enviarUsuarioC2x: vi.fn(async () =>
      real.interpretarResposta({ errors: {}, errors_message: "", status: "failed" }),
    ),
  };
});

type Escrita = { tabela: string; tipo: "update" | "upsert"; valores: Record<string, unknown> };

function clienteFalso(linhas: Record<string, unknown[]>) {
  const escritas: Escrita[] = [];
  const consulta = (tabela: string) => {
    const dados = linhas[tabela] ?? [];
    const alvo: Record<string, unknown> = {
      then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data: dados, error: null }),
      maybeSingle: () => Promise.resolve({ data: dados[0] ?? null, error: null }),
      single: () =>
        Promise.resolve(
          dados[0] ? { data: dados[0], error: null } : { data: null, error: { message: "sem linha" } },
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

describe("envio recusado sem motivo pela API: a fila continua dizendo alguma coisa", () => {
  it("grava 'erro' com frase de verdade, e não a string vazia dos 3 PJ de produção", async () => {
    const { enviarEntidadeParaC2x } = await import("./c2x-write-server");
    const CPF = "111.444.777-35";
    const { client, escritas } = clienteFalso({
      apolo_entities: [
        {
          display_name: "FULANO DE TAL",
          document_masked: CPF,
          entity_kind: "pf",
          id: "11111111-1111-1111-1111-111111111111",
          legal_name: null,
          metadata: { bornRole: "prospect", cadastro: { nacionalidade: "Brasileira" }, source: "apolo" },
          trade_name: null,
        },
      ],
    });

    const r = await enviarEntidadeParaC2x({
      client,
      consultaC2x: {
        candidatos: new Map(),
        consultados: new Set(["11144477735"]),
        ids: new Map(),
        nomes: new Map(),
        ok: true,
      },
      entityId: "11111111-1111-1111-1111-111111111111",
      ficha: null,
      vinculedById: 4314,
    });

    expect(r.status).toBe("erro");
    expect(String(r.erro ?? "").trim()).not.toBe("");

    // A escrita que interessa é o UPDATE de depois do POST (o upsert antes dele é o 'pendente').
    const falha = escritas.filter((e) => e.tabela === "apolo_c2x_sync" && e.tipo === "update");
    expect(falha).toHaveLength(1);
    const erro = String(falha[0]?.valores.erro ?? "");
    expect(erro.trim()).not.toBe("");
    expect(erro).toContain("NÃO disse o motivo");
    expect(falha[0]?.valores.status).toBe("erro");
  });
});
