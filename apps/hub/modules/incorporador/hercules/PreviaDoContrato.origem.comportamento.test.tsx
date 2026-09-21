// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A PRÉVIA DIZ DE ONDE VEIO O MODELO E O QUE VAI JUNTO.
//
// Regra do Lucas (21/09/2026), sobre a herança da minuta: quando a divisão (filho) ou a categoria
// não tem minuta própria, ela HERDA do nível de cima, e *"a TELA MOSTRA DE ONDE VEIO"*.
//
// ⚠️ O SERVIDOR JÁ MANDAVA, E A TELA DESCARTAVA NA PORTA. `contrato-servico.ts` devolve `anexos`,
// `marcadores`, `minuta.origemFrase` e `minuta.herdada` desde a mesma data; `PreviaDoContrato`
// tipava a resposta como `minuta?: { id, nome, versao }` e renderizava só `nome · vN`. E ela não é
// só do portal: é montada nas DUAS pontas — a tela de trabalho da Têmis (o jurídico) e a TelaVenda
// —, ou seja, a conferência do papel acontecia sem saber qual contrato estava sendo conferido.
//
// ⚠️ AS 189 PROPOSTAS QUE MUDAM DE COMPORTAMENTO SÃO EXATAMENTE ESTAS. Vale do Ouro: a proposta
// pendura no pai (35) e o lote mora no VOL (36), cuja v6 está publicada. O cabeçalho da venda diz
// "Vale do Ouro" e o modelo vem do VOL.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// O `temisFetch` do dúblê é ESTÁVEL, como o do provedor de verdade: uma função nova a cada render
// trocaria a identidade do `useCallback` que carrega, e o efeito recarregaria para sempre.
vi.mock("@/modules/temis/api-da-temis", () => {
  const temisFetch = (subcaminho: string, init?: RequestInit) =>
    globalThis.fetch(`/api/temis${subcaminho}`, init);
  return { useApiDaTemis: () => ({ temisFetch }) };
});

const { PreviaDoContrato } = await import("./PreviaDoContrato");

type Minuta = {
  herdada?: boolean;
  id: string;
  nome: string;
  origemFrase?: string;
  versao: null | number;
};

const resposta = {
  anexos: [] as { nome: string; posicao: number; rotuloDoNivel: string }[],
  avisos: [] as string[],
  html: "<p>Contrato</p>",
  minuta: { id: "m-1", nome: "VOL-MINUTA-COMPRA-VENDA-NORMAL", versao: 6 } as Minuta,
  semValor: [] as string[],
  vezesDoLaco: 1,
};

function montarFetch() {
  globalThis.fetch = vi.fn(async (url: unknown) =>
    ({
      json: async () =>
        String(url).includes("/contrato/gerar") ? { data: { contratos: [] } } : resposta,
      ok: true,
    }) as unknown as Response,
  ) as unknown as typeof fetch;
}

let container: HTMLDivElement;
let root: Root;

async function montar() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <PreviaDoContrato aoFechar={() => {}} podeGerar={false} propostaId="proposta-1" />,
    );
  });
}

beforeEach(() => {
  resposta.anexos = [];
  resposta.minuta = { id: "m-1", nome: "VOL-MINUTA-COMPRA-VENDA-NORMAL", versao: 6 };
  montarFetch();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("o cabeçalho da prévia", () => {
  it("mostra a frase da origem que o SERVIDOR montou, e não uma recalculada aqui", async () => {
    resposta.minuta.origemFrase = "modelo da divisão Vale do Ouro VOL";
    await montar();
    expect(container.textContent).toContain("modelo da divisão Vale do Ouro VOL");
  });

  it("quando o modelo veio de um nível ACIMA, a linha diz que foi herdado", async () => {
    resposta.minuta.herdada = true;
    resposta.minuta.origemFrase = "modelo herdado do Vale do Ouro";
    await montar();
    expect(container.textContent).toContain("herdado de um nível acima");
  });

  it("no caso normal a linha é discreta: não anuncia herança nenhuma", async () => {
    resposta.minuta.herdada = false;
    resposta.minuta.origemFrase = "modelo do empreendimento Veredas do Ouro";
    await montar();
    expect(container.textContent).toContain("modelo do empreendimento Veredas do Ouro");
    expect(container.textContent).not.toContain("herdado de um nível acima");
  });

  it("nomeia as peças que vão junto, com o nível de onde cada uma veio", async () => {
    // ⚠️ O CORPO NA TELA NÃO AS MOSTRA: quem costura a capa e os anexos no PDF é o montador. Sem
    // esta linha, quem confere lê o texto inteiro sem saber que a convenção vai atrás dele.
    resposta.anexos = [
      { nome: "Convenção de condomínio", posicao: 1, rotuloDoNivel: "Lagoa Bonita" },
      { nome: "Memorial descritivo", posicao: 2, rotuloDoNivel: "Condomínio" },
    ];
    await montar();
    expect(container.textContent).toContain("Convenção de condomínio (Lagoa Bonita)");
    expect(container.textContent).toContain("Memorial descritivo (Condomínio)");
  });

  it("sem anexo nenhum, a tela não inventa a linha", async () => {
    await montar();
    expect(container.textContent).not.toContain("Vai junto:");
  });
});
