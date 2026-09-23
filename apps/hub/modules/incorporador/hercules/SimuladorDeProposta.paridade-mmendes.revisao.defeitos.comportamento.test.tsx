// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LoteDoEspelho } from "@/lib/hercules/espelho/estado-do-espelho";
import { planosPublicos, type PlanoPublico } from "@/lib/hercules/espelho/planos-publicos";
import type { PlanoDaVenda } from "@/lib/hercules/fluxo-de-venda";
import { comoPlano, type LinhaDoPlano } from "@/lib/hercules/planos-do-panteon";

import { EspelhoPublico } from "../../publico/espelho/EspelhoPublico";
import { type CondicoesDaProposta, SimuladorDeProposta } from "./SimuladorDeProposta";

// REVISÃO INDEPENDENTE (lente: PARIDADE COM A MMENDES E COERÊNCIA DE NÚMEROS), 18/09/2026.
//
// Os testes com DEFEITO no nome FALHAM DE PROPÓSITO: reproduzem o que a revisão achou, com número.
// Os outros reproduzem o item 4 (o polling não reinicia o simulador) de modo independente do
// implementador: Mesa e espelho, o plano mais curto (INVESTIDOR, 36x) e uma entrada digitada.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RESSALVA = "válido para as próximas 16 unidades";
/** As três linhas de temis_planos do 39 (SELECT de 18/09/2026), com o desconto da 0178.dados-garden. */
const LINHAS: LinhaDoPlano[] = [
  { anuais_quantidade: 5, anuais_valor: "25000.00", categoria_id: null, desconto_percentual: "0", enterprise_id: "39", entrada_percentual: "10.000", indice_correcao: "IPCA_ANUAL", juros_convencao: "equivalente", juros_periodicidade: "anual", juros_taxa: "6.000000", nome: "NORMAL", ordem: 1, parcelas: 60, ressalva: null, sistema_amortizacao: "sacoc", slot: null },
  { anuais_quantidade: 4, anuais_valor: "25000.00", categoria_id: null, desconto_percentual: "8", enterprise_id: "39", entrada_percentual: "8.000", indice_correcao: "IPCA_ANUAL", juros_convencao: "equivalente", juros_periodicidade: "anual", juros_taxa: "6.000000", nome: "INVESTIDOR PARCELADO", ordem: 2, parcelas: 84, ressalva: RESSALVA, sistema_amortizacao: "sacoc", slot: null },
  { anuais_quantidade: 3, anuais_valor: "30000.00", categoria_id: null, desconto_percentual: "12", enterprise_id: "39", entrada_percentual: "40.000", indice_correcao: "IPCA_ANUAL", juros_convencao: "equivalente", juros_periodicidade: "anual", juros_taxa: "0.000000", nome: "INVESTIDOR", ordem: 3, parcelas: 36, ressalva: null, sistema_amortizacao: "sacoc", slot: null },
];
const daMesa = () =>
  LINHAS.map((l) => comoPlano(l)) as unknown as Array<PlanoDaVenda & { ressalva?: null | string }>;

/** Como a rota da situação teria de entregar o plano ao espelho, COM a ressalva do cadastro. */
const publicos = (): Array<PlanoPublico & { ressalva: null | string }> =>
  LINHAS.map((l) => {
    const p = comoPlano(l);
    return {
      anuaisQuantidade: p.anuaisQuantidade ?? 0,
      anuaisValor: p.anuaisValor ?? 0,
      descontoPercentual: p.descontoPercentual,
      entradaPercentual: p.entradaPercentual,
      indiceCorrecao: p.indiceCorrecao,
      jurosConvencao: p.jurosConvencao,
      jurosPeriodicidade: p.jurosPeriodicidade,
      jurosTaxa: p.jurosTaxa,
      nome: p.nome,
      parcelas: p.parcelas,
      ressalva: p.ressalva ?? null,
      sistemaAmortizacao: p.sistemaAmortizacao,
    };
  });

const lote = (): LoteDoEspelho =>
  ({
    andar: null,
    apartamento: null,
    area: 420,
    codigo: "GDN1110",
    grupo: "Quadra 11",
    lote: "10",
    numero: "10",
    preco: 435_000,
    quadra: "11",
    rotulo: "Quadra 11 · Lote 10",
    situacao: "disponivel",
    tipoProduto: "loteamento",
  }) as unknown as LoteDoEspelho;
const situacao = () => ({
  atualizadoEm: "2026-09-18T12:00:00.000Z",
  contagem: { disponivel: 1, indisponivel: 0 },
  empreendimento: { codigo: "garden", nome: "Garden" },
  entradaMinimaPercentual: 8,
  lotes: [lote()],
  planos: publicos(),
  temMapa: false,
});

let alvo: HTMLDivElement;
let raiz: Root;
let ultima: CondicoesDaProposta | null = null;
const aoMudar = (c: CondicoesDaProposta | null) => {
  ultima = c;
};

beforeEach(() => {
  alvo = document.createElement("div");
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
  ultima = null;
});
afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function clicar(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
function cartao(nome: string): HTMLButtonElement {
  const b = [...alvo.querySelectorAll("button")].find(
    (x) => x.querySelector('[data-cartao="nome"]')?.textContent?.trim() === nome,
  );
  if (!b) throw new Error(`cartão ${nome} ausente`);
  return b;
}
function campoDaEntrada(): HTMLInputElement {
  const secao = [...alvo.querySelectorAll("section")].find(
    (s) => s.firstElementChild?.textContent?.trim() === "Entrada",
  );
  const input = secao?.querySelector("input");
  if (!input) throw new Error("campo da entrada ausente");
  return input;
}
function digitar(campo: HTMLInputElement, texto: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function montarSimulador(
  vocabulario: "proposta" | "simulacao",
  planos: Array<PlanoDaVenda & { ressalva?: null | string }>,
  unidade = "11 10",
  valor = 435_000,
) {
  act(() => {
    raiz.render(
      <SimuladorDeProposta
        aoMudarCondicoes={aoMudar}
        entradaMinimaPercentual={8}
        planos={planos}
        unidade={unidade}
        valorDaUnidade={valor}
        vocabulario={vocabulario}
      />,
    );
  });
}
function montarEspelho() {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", (q: string) => ({
    addEventListener() {},
    matches: false,
    media: q,
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "fetch",
    async () => new Response(JSON.stringify({ data: situacao() }), { status: 200 }),
  );
  act(() => {
    raiz.render(<EspelhoPublico inicial={situacao() as never} token="tok" />);
  });
  const quadradinho = [...alvo.querySelectorAll("button")].find((b) =>
    b.title.includes("Disponível"),
  );
  if (!quadradinho) throw new Error("lote disponível ausente no espelho");
  clicar(quadradinho);
}
function prazoNaTela(): string {
  const label = [...alvo.querySelectorAll("label")].find(
    (l) => l.querySelector("span")?.textContent?.trim() === "Parcelas",
  );
  return label?.querySelector("input")?.value ?? "";
}

describe("REVISÃO paridade: a ressalva do INVESTIDOR PARCELADO no espelho público", () => {
  // ⚠️ OS DOIS PRIMEIROS ERAM DEFEITO (vermelhos de propósito) e foram corrigidos na rodada 3
  // (18/09/2026): `planosPublicos` passou a ler a coluna `ressalva` (tolerante à 0168, como a Mesa) e
  // o `PainelDoLote` a passa ao simulador. Antes, o cartão do espelho saía sem a etiqueta nos 87
  // cartões do INVESTIDOR PARCELADO, enquanto a Mesa e o mapa da MMendes a mostravam.
  it("o cartão do espelho público mostra 'válido para as próximas 16 unidades' (o PainelDoLote passa a ressalva)", () => {
    montarEspelho();
    const ip = cartao("INVESTIDOR PARCELADO");
    // Na Mesa a mesma etiqueta existe (medido no teste de paridade: 261 de 261); aqui não.
    expect(ip.querySelector('[data-cartao="ressalva"]')?.textContent?.trim() ?? null).toBe(RESSALVA);
  });

  it("planosPublicos lê a coluna ressalva de temis_planos (é por ela que a rota da situação a manda)", async () => {
    let colunas = "";
    const consulta = {
      eq: () => consulta,
      in: () => consulta,
      is: () => consulta,
      order: async () => ({ data: LINHAS, error: null }),
      select: (c: string) => {
        colunas = c;
        return consulta;
      },
    };
    const planos = await planosPublicos({ from: () => consulta } as never, ["39"]);
    expect(planos).toHaveLength(3);
    expect(colunas).toContain("ressalva");
    expect((planos[1] as unknown as { ressalva?: string }).ressalva).toBe(RESSALVA);
  });

  it("controle: na Mesa de Venda a ressalva aparece ao lado do nome", () => {
    montarSimulador("proposta", daMesa());
    expect(cartao("INVESTIDOR PARCELADO").querySelector('[data-cartao="ressalva"]')?.textContent?.trim()).toBe(RESSALVA);
  });
});

describe("REVISÃO paridade: produção HOJE, sem a 0178 aplicada (coluna desconto_percentual ausente)", () => {
  it("medição: o cartão do INVESTIDOR PARCELADO no lote de R$ 435.000 sai sem desconto e sem a linha do à vista", () => {
    const semColuna = LINHAS.map(({ desconto_percentual: _d, ...l }) => comoPlano(l as LinhaDoPlano)) as unknown as Array<
      PlanoDaVenda & { ressalva?: null | string }
    >;
    montarSimulador("proposta", semColuna);
    const ip = cartao("INVESTIDOR PARCELADO");
    const l = (k: string) => ip.querySelector(`[data-cartao="${k}"]`)?.textContent?.replace(/\s+/g, " ").trim();
    // A MMendes: R$ 400.200, "de R$ 435.000 · −8%", R$ 3.192,67 e entrada R$ 32.016.
    expect(l("valor-do-lote")).toBe("R$ 435.000");
    expect(l("origem-do-valor")).toBe("sem desconto");
    expect(l("parcela")).toBe("R$ 3.573,81");
    expect(l("resumo")).toBe("entrada R$ 34.800 (8%) · 4 × R$ 25.000 · 84 meses");
    expect(alvo.querySelector('[data-cartao="a-vista"]')).toBeNull();
  });
});

describe("REVISÃO coerência: o 'Total pago' do cartão grande fecha com o valor negociado", () => {
  function totalPago(): { nota: string; valor: string } {
    const rotulo = [...alvo.querySelectorAll("div")].find(
      (d) => d.textContent === "Total pago" && d.childElementCount === 0,
    );
    const bloco = rotulo?.parentElement;
    return {
      nota: bloco?.children[2]?.textContent ?? "",
      valor: bloco?.children[1]?.textContent ?? "",
    };
  }
  const numero = (t: string) => Number(t.replace(/[^\d,]/g, "").replace(",", "."));

  // ⚠️ ERA DEFEITO (vermelho de propósito) e foi corrigido: o % era calculado sobre o valor já com o
  // desconto do plano. O INVESTIDOR dizia "+0% sobre a tabela" pagando menos que a tabela.
  //
  // ⚠️ E A RÉGUA MUDOU DE NOVO EM 22/09/2026, a pedido do Lucas: o total deixou de somar o degrau do
  // SACOC (*"não calculamos juros nessa etapa, é somente informativo"*). Com os juros fora, este
  // teste media um número que virou cópia do desconto do plano — medido nesta mesma suíte, os três
  // cartões do Garden diziam exatamente "−12%", "−8%" e "0% sobre a tabela", que são os descontos
  // de 12, 8 e 0 do cadastro. A nota passou a comparar com o VALOR NEGOCIADO, e o que este teste
  // guarda agora é o que o Lucas pediu: no Garden, o total pago É o valor do lote.
  const ESPERADO = { INVESTIDOR: 382_800, "INVESTIDOR PARCELADO": 400_200, NORMAL: 435_000 };
  for (const nome of ["INVESTIDOR", "INVESTIDOR PARCELADO", "NORMAL"] as const) {
    it(`${nome} no lote de R$ 435.000: o Total pago é o preço do plano, e a nota diz isso`, () => {
      montarSimulador("proposta", daMesa());
      clicar(cartao(nome));
      const { nota, valor } = totalPago();
      expect(numero(valor)).toBe(ESPERADO[nome]);
      expect(nota).toBe("igual ao valor negociado");
    });
  }
});

describe("REVISÃO item 4: o polling não reinicia o simulador (reprodução independente)", () => {
  for (const vocabulario of ["proposta", "simulacao"] as const) {
    it(`${vocabulario}: escolhido o INVESTIDOR (36x) e digitada a entrada, a lista nova de conteúdo igual mantém os dois`, () => {
      montarSimulador(vocabulario, daMesa());
      expect(ultima?.planoNome).toBe("INVESTIDOR PARCELADO");
      clicar(cartao("INVESTIDOR"));
      digitar(campoDaEntrada(), "200.000,00");
      expect(ultima?.planoNome).toBe("INVESTIDOR");
      expect(ultima?.entradaValor).toBe(200_000);
      const antes = ultima;

      for (let volta = 0; volta < 3; volta += 1)
        montarSimulador(vocabulario, daMesa().map((p) => ({ ...p })));

      expect(ultima?.planoNome).toBe("INVESTIDOR");
      expect(ultima?.entradaValor).toBe(200_000);
      expect(ultima).toEqual(antes);
    });
  }

  it("controle: outro lote (outra unidade) reabre no plano mais longo, como antes", () => {
    montarSimulador("simulacao", daMesa());
    clicar(cartao("NORMAL"));
    expect(ultima?.planoNome).toBe("NORMAL");
    montarSimulador("simulacao", daMesa().map((p) => ({ ...p })), "11 11", 435_000);
    expect(ultima?.planoNome).toBe("INVESTIDOR PARCELADO");
  });

  it("medição: o desconto do plano escolhido muda de verdade (8% → 10%); o preço acompanha, a entrada do cockpit fica a do preço antigo", () => {
    montarSimulador("simulacao", daMesa());
    clicar(cartao("INVESTIDOR PARCELADO"));
    expect(ultima?.valorNegociado).toBe(400_200);
    expect(ultima?.entradaValor).toBe(32_016);
    const novos = daMesa().map((p) =>
      p.nome === "INVESTIDOR PARCELADO" ? { ...p, descontoPercentual: 10 } : { ...p },
    );
    montarSimulador("simulacao", novos);
    // Medido: o valor vai para 391.500 e a escolha fica; a entrada continua 32.016 (8% de 400.200),
    // enquanto o cartão do mesmo plano, na mesma tela, anuncia 31.320 (8% de 391.500).
    expect(ultima?.planoNome).toBe("INVESTIDOR PARCELADO");
    expect(ultima?.valorNegociado).toBe(391_500);
    expect(ultima?.entradaValor).toBe(32_016);
    expect(cartao("INVESTIDOR PARCELADO").querySelector('[data-cartao="resumo"]')?.textContent).toContain("R$ 31.320");
    expect(ultima?.parcela.toFixed(2)).toBe(((391_500 - 32_016 - 100_000) / 84).toFixed(2));
  });

  it("espelho de ponta a ponta: INVESTIDOR escolhido sobrevive a três voltas de 60 s", async () => {
    montarEspelho();
    expect(prazoNaTela()).toBe("84");
    clicar(cartao("INVESTIDOR"));
    expect(prazoNaTela()).toBe("36");
    for (let volta = 1; volta <= 3; volta += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(prazoNaTela()).toBe("36");
    }
  });
});
