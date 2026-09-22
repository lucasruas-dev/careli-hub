// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A LINHA DO QUADRO DE ASSINATURA — o campo que fez a Nívea achar que só cabia uma testemunha.
//
// Nívea (22/09/2026), depois de digitar 4 na linha de uma segunda testemunha: *"Ele nao esta
// aceitando 02 testemunhas"*. A linha 4 já era da YASMIN, e cabem NOVE pessoas por papel. Nos logs
// do Postgres daquela madrugada são quatro recusas, todas da mesma constraint de posição — uma
// delas no bloco Vendedora, com o mesmo erro.
//
// ⚠️ O QUE ESTE ARQUIVO TRAVA:
//   • o campo Linha NASCE PREENCHIDO com a próxima livre daquele papel (era só placeholder cinza,
//     então o campo ia vazio e aceitava qualquer número repetido por cima);
//   • a próxima livre é POR PAPEL: testemunha na 4 não empurra a vendedora;
//   • a testemunha que assina cedo demais ganha aviso na tela.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/supabase/client", () => ({
  getHubSupabaseClient: () => null,
  hubSupabaseConfig: { anonKey: "chave-publica", url: "https://projeto.supabase.co" },
}));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: async () => "token",
}));

const { QuadroDeAssinaturaCard } = await import(
  "@/modules/apolo/blocks/empreendimentos/quadro-de-assinatura-card"
);

type LinhaDaTela = {
  cpf: null | string;
  email: null | string;
  id: null | string;
  nome: string;
  ordemAssinatura: null | number;
  origem: null | string;
  papel: string;
  posicao: number;
};

/** O quadro do VOC como ele estava em 22/09/2026, medido no banco. */
const YASMIN: LinhaDaTela = {
  cpf: "705.059.716-31",
  email: "financeiro02@ceciliorocha.com.br",
  id: "aaaaaaaa-0000-4000-8000-000000000004",
  nome: "YASMIN LOUIZE APARECIDA LOPES",
  ordemAssinatura: 1,
  origem: null,
  papel: "testemunha",
  posicao: 4,
};

const VITOR: LinhaDaTela = {
  cpf: "082.132.736-48",
  email: "vitorcecilio@hotmail.com",
  id: "bbbbbbbb-0000-4000-8000-000000000005",
  nome: "VITOR CECILIO DE OLIVEIRA ALMEIDA",
  ordemAssinatura: 1,
  origem: null,
  papel: "vendedora",
  posicao: 5,
};

let assinantes: LinhaDaTela[] = [];
let raiz: Root;
let hospedeiro: HTMLDivElement;

const esperar = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

function secao(titulo: string): HTMLElement {
  const achada = Array.from(hospedeiro.querySelectorAll("section")).find(
    (s) => s.querySelector("p")?.textContent?.trim() === titulo,
  );
  if (!achada) throw new Error(`Seção "${titulo}" não está na tela.`);
  return achada as HTMLElement;
}

function campo(dentro: HTMLElement, rotulo: string): HTMLInputElement | undefined {
  return Array.from(dentro.querySelectorAll("label")).find(
    (l) => l.querySelector("span")?.textContent?.trim() === rotulo,
  )?.querySelector("input") as HTMLInputElement | undefined;
}

beforeEach(() => {
  assinantes = [];
  hospedeiro = document.createElement("div");
  document.body.append(hospedeiro);
  raiz = createRoot(hospedeiro);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ assinantes }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
    ),
  );
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

async function montar() {
  act(() => {
    raiz.render(<QuadroDeAssinaturaCard enterpriseId="37" />);
  });
  await esperar();
}

describe("o campo Linha", () => {
  it("⚠️ nasce preenchido com a próxima livre, e não como sugestão cinza", async () => {
    assinantes = [YASMIN];
    await montar();

    // A YASMIN ocupa a 4; a próxima livre de Testemunhas é a 1.
    expect(campo(secao("Testemunhas"), "Linha")?.value).toBe("1");
  });

  it("a próxima livre é POR PAPEL: a testemunha na 4 não empurra a vendedora", async () => {
    assinantes = [YASMIN, VITOR];
    await montar();

    expect(campo(secao("Testemunhas"), "Linha")?.value).toBe("1");
    // O VITOR ocupa a 5 da Vendedora; lá a próxima livre também é a 1.
    expect(campo(secao("Vendedora"), "Linha")?.value).toBe("1");
  });

  it("quadro vazio começa na linha 1", async () => {
    await montar();
    expect(campo(secao("Testemunhas"), "Linha")?.value).toBe("1");
  });
});

describe("o aviso da ordem de assinatura", () => {
  it("⚠️ testemunha que assina junto com a vendedora ganha aviso", async () => {
    // É o quadro real do VOC: as duas com "Assina em 1".
    assinantes = [YASMIN, VITOR];
    await montar();

    const texto = secao("Testemunhas").textContent ?? "";
    expect(texto).toContain("YASMIN LOUIZE APARECIDA LOPES");
    expect(texto).toContain("assina em 1");
    expect(texto).toContain("junto ou antes de quem ela testemunha");
  });

  it("sem ordem digitada, nenhum aviso: a ordem do papel resolve", async () => {
    assinantes = [
      { ...YASMIN, ordemAssinatura: null },
      { ...VITOR, ordemAssinatura: null },
    ];
    await montar();

    expect(secao("Testemunhas").textContent ?? "").not.toContain("junto ou antes");
  });

  it("testemunha depois de todo mundo não é avisada", async () => {
    assinantes = [{ ...YASMIN, ordemAssinatura: 9 }, VITOR];
    await montar();

    expect(secao("Testemunhas").textContent ?? "").not.toContain("junto ou antes");
  });
});
