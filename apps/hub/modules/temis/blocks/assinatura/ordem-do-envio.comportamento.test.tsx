// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O EMPATE CADASTRADO NO SETUP SOBREVIVE AO ENVIO (25/09/2026).
//
// Nívea (24/09/2026), apontamento 4: *"A ordem de assinatura não está ficando salva."*
//
// ⚠️ AFIRMAÇÃO EM CAIXA ALTA: O MAPA ERA SALVO, EXIBIDO E DEPOIS DESMANCHADO NO ENVELOPE. A tela de
// envio mandava `ordem: { ordenada, papeis }` em TODO envio, mesmo sem o operador tocar em nada; o
// servidor passava isso por `lerRegraDeOrdem`, que cai no ramo de LISTA
// (`lib/assinatura/ordem.ts`, "o formato antigo continua sendo lido") e numera 1..N; e a lista já
// chegava ACHATADA do preparo (`gruposDaRegra(preparo.regra).flat()`). Resultado: a configuração que
// o cartão do Setup existe para permitir — Lucas, 13/09/2026: *"comprador 1 e o resto como 2"*,
// *"essa personalização é bem comum para gente"* — virava uma fila de seis degraus no envelope.
//
// ⚠️ E A FILA DE SEIS DEGRAUS É DIAS DE ESPERA REAL: a vendedora só recebe o convite depois do
// cônjuge, o coordenador depois da vendedora, e assim por diante. É exatamente o que o empate existe
// para evitar. A conta da Clicksign é de PRODUÇÃO e o envelope não se apaga (Lucas, 08/09/2026).

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/supabase/client", () => ({
  getHubSupabaseClient: () => null,
  hubSupabaseConfig: { anonKey: "chave-publica", url: "https://projeto.supabase.co" },
}));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: async () => "tok-do-hub",
}));

const { OrganizacaoDaAssinatura } = await import("./organizacao-da-assinatura");

let raiz: Root;
let hospedeiro: HTMLDivElement;
let corposEnviados: Array<Record<string, unknown>>;

/**
 * O PREPARO DO VOL COM O EMPATE QUE A NÍVEA CADASTRARIA: comprador 1, o resto 2.
 *
 * ⚠️ `papeis` CHEGA ACHATADO, como o servidor o monta hoje (`gruposDaRegra(...).flat()`): é dele que
 * a tela desenha a fila, e é por isso que o empate precisa vir no MAPA ao lado.
 */
const PREPARO = {
  ambiente: "https://app.clicksign.com",
  avisoDeAmbiente: null,
  avisos: [],
  configuracaoPendente: null,
  contrato: {
    criadoEm: "2026-09-23",
    documentoId: "doc-1",
    nome: "Contrato v1.pdf",
    unidadeId: "uni-1",
    versao: 1,
  },
  impedimento: null,
  ordem: {
    descricao: "Comprador → Cônjuge, Vendedora",
    ordenada: true,
    ordens: {
      careli: 7,
      comprador: 1,
      conjuge: 2,
      coordenador_vendas: 2,
      corretor: 2,
      testemunha: 2,
      vendedora: 2,
    },
    origem: "empreendimento",
    origemDescrita: "do Setup do empreendimento",
    papeis: ["comprador", "conjuge", "vendedora"],
  },
  signatarios: [
    {
      email: "maura@exemplo.com",
      nome: "MAURA MARIA PASSOS",
      ordem: 1,
      papel: "comprador",
      papelRotulo: "Comprador",
    },
    {
      email: "conjuge@exemplo.com",
      nome: "CÔNJUGE DE TESTE",
      ordem: 2,
      papel: "conjuge",
      papelRotulo: "Cônjuge",
    },
    {
      email: "vendedora@exemplo.com",
      nome: "CARELI EMPREENDIMENTOS",
      ordem: 2,
      papel: "vendedora",
      papelRotulo: "Vendedora",
    },
  ],
};

async function esperarPromessas(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function montar(): Promise<void> {
  act(() => {
    raiz.render(<OrganizacaoDaAssinatura propostaId="venda-maura" />);
  });
  await esperarPromessas();
}

function botaoQueContem(trecho: string): HTMLButtonElement | undefined {
  return Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    b.textContent?.includes(trecho),
  );
}

async function clicar(trecho: string): Promise<void> {
  const botao = botaoQueContem(trecho);
  expect(botao, `botão "${trecho}"`).toBeTruthy();
  await act(async () => {
    botao?.click();
  });
  await esperarPromessas();
}

/** A ordem que o corpo do POST levou, como o servidor a vai ler. */
const ordemEnviada = () =>
  corposEnviados.at(-1)?.ordem as
    | undefined
    | { ordenada: boolean; ordens?: Record<string, number>; papeis?: string[] };

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  corposEnviados = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const metodo = init?.method ?? "GET";
      if (String(url).includes("/assinatura/enviar") && metodo === "POST") {
        corposEnviados.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                ...PREPARO,
                envelopeId: "env-novo",
                nome: "Contrato v1.pdf",
                registroId: "reg-1",
              },
            }),
            { headers: { "content-type": "application/json" }, status: 200 },
          ),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ data: PREPARO }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
      );
    }),
  );
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("o envio não desmancha o empate do cadastro", () => {
  it("⚠️ sem o operador tocar na fila, o corpo leva o MAPA do cadastro", async () => {
    await montar();
    await clicar("Enviar para assinatura");
    await clicar("Confirmo: enviar agora");

    const ordem = ordemEnviada();
    expect(ordem?.ordenada).toBe(true);
    // ⚠️ O MAPA, e não uma lista: é ele que o servidor lê pelo ramo NOVO de `lerRegraDeOrdem`.
    expect(ordem?.ordens).toBeTruthy();
    expect(ordem?.ordens?.comprador).toBe(1);
    expect(ordem?.ordens?.conjuge).toBe(2);
    expect(ordem?.ordens?.vendedora).toBe(2);
    expect(ordem?.ordens?.coordenador_vendas).toBe(2);
  });

  it("⚠️ a tela DESENHA o empate: cônjuge e vendedora no mesmo degrau", async () => {
    await montar();
    // `ordenarSignatarios` numera 1, 2, 2 — quem empata assina junto. A tela mostra o número.
    const linhas = hospedeiro.textContent ?? "";
    expect(linhas).toContain("MAURA MARIA PASSOS");
    expect(linhas).toContain("CARELI EMPREENDIMENTOS");
    // O nome que recebe o convite AGORA é só o comprador, e a confirmação promete isso.
    await clicar("Enviar para assinatura");
    expect(hospedeiro.textContent).toContain("MAURA MARIA PASSOS");
    expect(hospedeiro.textContent).not.toContain("CARELI EMPREENDIMENTOS, MAURA");
  });

  // ⚠️ E QUANDO O OPERADOR MEXE, ELE VENCE — é a exceção deste envio, que Lucas pediu em 08/09/2026
  // (*"claro que temos que ter a opção de alterar antes de enviar o contrato, mas vem preenchido por
  // padrão"*) e que NÃO volta para o cadastro do empreendimento.
  it("mexer na fila manda a fila estrita que o operador montou", async () => {
    await montar();
    // ⚠️ DESCER O COMPRADOR: é o gesto que desempata de verdade. A seta de SUBIR do primeiro item não
    // move nada (não há degrau acima), e clicá-la mediria o teste, não a tela.
    const descerOComprador = Array.from(
      hospedeiro.querySelectorAll<HTMLButtonElement>("button"),
    ).find((b) => (b.getAttribute("aria-label") ?? "").match(/^Descer Comprador/i));
    expect(descerOComprador, "a seta de descer o comprador").toBeTruthy();
    await act(async () => {
      descerOComprador?.click();
    });
    await esperarPromessas();

    await clicar("Enviar para assinatura");
    await clicar("Confirmo: enviar agora");

    const ordens = ordemEnviada()?.ordens ?? {};
    // Depois de mover, não há mais empate entre os presentes: é a fila que ele desenhou.
    const dosPresentes = [ordens.comprador, ordens.conjuge, ordens.vendedora];
    expect(new Set(dosPresentes).size).toBe(dosPresentes.length);
  });
});
