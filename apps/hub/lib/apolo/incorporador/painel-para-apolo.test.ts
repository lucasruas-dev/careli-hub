import { describe, expect, it } from "vitest";

import {
  type Cenario,
  cenarioVazio,
  type LinhaDoPainel,
  type PainelDeProdutos,
} from "./painel-de-produtos";
import {
  indiceDoPainel,
  linhaDoFilho,
  linhaParaRow,
  painelParaApolo,
} from "./painel-para-apolo";

// ── Fábricas ────────────────────────────────────────────────────────────────

/** Cenário com `units` por balde e valor = units × 100, para conferir de cabeça. */
function cenario(units: Partial<Record<keyof Cenario, number>>): Cenario {
  const base = cenarioVazio();
  for (const [balde, n] of Object.entries(units) as Array<[keyof Cenario, number]>) {
    base[balde] = { units: n, value: n * 100 };
  }
  return base;
}

const linha = (p: Partial<LinhaDoPainel> & { id: string }): LinhaDoPainel => ({
  aviso: null,
  cidade: "Sete Lagoas",
  codigo: "XXX",
  codes: ["XXX"],
  etapas: 0,
  filhos: [],
  nome: "Produto",
  scenario: cenarioVazio(),
  uf: "MG",
  ...p,
});

// `noUncheckedIndexedAccess`: dizer em voz alta quando o item esperado não veio.
function item<T>(lista: T[], indice: number): T {
  const valor = lista[indice];
  if (valor === undefined) throw new Error(`esperava item ${indice}, a lista tem ${lista.length}`);
  return valor;
}

// ── linhaParaRow ────────────────────────────────────────────────────────────

describe("linhaParaRow", () => {
  it("linha simples (fora do cadastro) vira row com stages vazio e TODOS os campos do tipo", () => {
    const row = linhaParaRow(
      linha({
        cidade: "Lagoa Santa",
        codigo: "GDN",
        codes: ["GDN"],
        id: "39",
        nome: "Garden",
        scenario: cenario({ disponivel: 10, total: 12, vendido: 2 }),
        uf: "MG",
      }),
    );

    expect(row).toEqual({
      city: "Lagoa Santa",
      code: "GDN",
      codes: ["GDN"],
      id: "39",
      incorporador: null,
      mirror: false,
      mirrorLabel: null,
      name: "Garden",
      scenario: cenario({ disponivel: 10, total: 12, vendido: 2 }),
      stages: [],
      state: "MG",
    });
  });

  it("pai do cadastro mantém o id 'pai:<uuid>' — é o que a rota de Vendas aceita", () => {
    const row = linhaParaRow(linha({ id: "pai:abc-123", nome: "Vale do Ouro" }));

    expect(row.id).toBe("pai:abc-123");
    expect(row.name).toBe("Vale do Ouro");
  });

  it("filhos viram stages, cada um com a própria scenario, stages vazio e o endereço do pai", () => {
    const voc = cenario({ disponivel: 5, total: 8, vendido: 3 });
    const vol = cenario({ disponivel: 1, total: 4, vendido: 3 });

    const row = linhaParaRow(
      linha({
        cidade: "Sete Lagoas",
        codigo: "VOC + VOL",
        codes: ["VOC", "VOL"],
        etapas: 2,
        filhos: [
          { codigo: "VOC", id: "41", nome: "Vale do Ouro Central", scenario: voc },
          { codigo: "VOL", id: "42", nome: "Vale do Ouro Leste", scenario: vol },
        ],
        id: "pai:vlo",
        nome: "Vale do Ouro",
        scenario: cenario({ disponivel: 6, total: 12, vendido: 6 }),
        uf: "MG",
      }),
    );

    expect(row.code).toBe("VOC + VOL");
    expect(row.codes).toEqual(["VOC", "VOL"]);
    expect(row.stages).toHaveLength(2);

    const primeiro = item(row.stages, 0);
    expect(primeiro).toEqual({
      city: "Sete Lagoas",
      code: "VOC",
      codes: ["VOC"],
      id: "41",
      incorporador: null,
      mirror: false,
      mirrorLabel: null,
      name: "Vale do Ouro Central",
      scenario: voc,
      stages: [],
      state: "MG",
    });
    expect(item(row.stages, 1).id).toBe("42");
    expect(item(row.stages, 1).scenario).toBe(vol);
  });

  it("sem aviso não é espelho: a rota do painel já consumiu o espelho na soma", () => {
    const row = linhaParaRow(linha({ id: "pai:x", filhos: [] }));
    expect(row.mirror).toBe(false);
    expect(row.mirrorLabel).toBeNull();
  });

  it("o aviso da rota (número de espelho parado) vira mirror + mirrorLabel na row", () => {
    const row = linhaParaRow(
      linha({ aviso: "Histórico · mesmos lotes de VOC + VOL", id: "pai:vlo" }),
    );
    expect(row.mirror).toBe(true);
    expect(row.mirrorLabel).toBe("Histórico · mesmos lotes de VOC + VOL");
  });

  it("cidade e UF nulos passam como nulos (a tela filtra o vazio no rótulo)", () => {
    const row = linhaParaRow(linha({ cidade: null, id: "7", uf: null }));
    expect(row.city).toBeNull();
    expect(row.state).toBeNull();
  });
});

// ── painelParaApolo ─────────────────────────────────────────────────────────

describe("painelParaApolo", () => {
  it("rows na ORDEM do painel (quem ordena é a rota) e totals = cards", () => {
    const cards = cenario({ disponivel: 11, total: 20, vendido: 9 });
    const painel: PainelDeProdutos = {
      cards,
      linhas: [
        linha({ id: "pai:a", nome: "A" }),
        linha({ id: "55", nome: "B" }),
        linha({ id: "pai:c", nome: "C" }),
      ],
    };

    const data = painelParaApolo(painel);

    expect(data.rows.map((row) => row.id)).toEqual(["pai:a", "55", "pai:c"]);
    expect(data.totals).toBe(cards);
  });

  it("painel vazio vira rows vazio (a tela mostra 'Nenhum empreendimento encontrado.')", () => {
    const data = painelParaApolo({ cards: cenarioVazio(), linhas: [] });
    expect(data.rows).toEqual([]);
    expect(data.totals).toEqual(cenarioVazio());
  });
});

// ── linhaDoFilho / indiceDoPainel ───────────────────────────────────────────

describe("linhaDoFilho", () => {
  it("o filho vira linha simples: id do C2X, codes só dele, sem filhos, endereço do pai", () => {
    const pai = linha({ cidade: "Sete Lagoas", id: "pai:vlo", uf: "MG" });
    const voc = cenario({ total: 8, vendido: 3 });

    expect(
      linhaDoFilho({ codigo: "VOC", id: "41", nome: "Vale do Ouro Central", scenario: voc }, pai),
    ).toEqual({
      aviso: null,
      cidade: "Sete Lagoas",
      codigo: "VOC",
      codes: ["VOC"],
      etapas: 0,
      filhos: [],
      id: "41",
      nome: "Vale do Ouro Central",
      scenario: voc,
      uf: "MG",
    });
  });
});

describe("indiceDoPainel", () => {
  it("indexa pais E filhos: a row de uma etapa aberta no 'Ver mais' acha a própria linha", () => {
    const painel: PainelDeProdutos = {
      cards: cenarioVazio(),
      linhas: [
        linha({
          filhos: [
            { codigo: "VOC", id: "41", nome: "VOC", scenario: cenarioVazio() },
            { codigo: "VOL", id: "42", nome: "VOL", scenario: cenarioVazio() },
          ],
          id: "pai:vlo",
          nome: "Vale do Ouro",
        }),
        linha({ id: "39", nome: "Garden" }),
      ],
    };

    const indice = indiceDoPainel(painel);

    expect([...indice.keys()]).toEqual(["pai:vlo", "41", "42", "39"]);
    expect(indice.get("pai:vlo")?.nome).toBe("Vale do Ouro");
    expect(indice.get("pai:vlo")?.filhos).toHaveLength(2);
    expect(indice.get("41")?.codes).toEqual(["VOC"]);
    expect(indice.get("41")?.filhos).toEqual([]);
    expect(indice.get("39")?.nome).toBe("Garden");
  });

  it("a linha do painel é a MESMA referência (não copia o pai)", () => {
    const pai = linha({ id: "pai:x" });
    const indice = indiceDoPainel({ cards: cenarioVazio(), linhas: [pai] });
    expect(indice.get("pai:x")).toBe(pai);
  });
});
