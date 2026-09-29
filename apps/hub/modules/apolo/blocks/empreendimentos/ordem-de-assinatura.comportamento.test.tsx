// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O CARTÃO SÓ PODE DIZER "SALVO" DEPOIS DE RELER O SERVIDOR.
//
// Nívea (24/09/2026): *"A ordem de assinatura não está ficando salva."*
//
// ⚠️ AFIRMAÇÃO EM CAIXA ALTA: O DEFEITO DO GRAVAR JÁ ESTÁ CONSERTADO E NO AR — o que sobrou foi a
// TELA MENTIR. O commit b108e654 ("fix(assinatura): a ordem cadastrada volta a valer, o mapa
// parava de chegar ao banco", 23/09/2026 07:52, release 1.363.0) fez o mapa passar inteiro em
// `app/api/apolo/empreendimentos/settings/route.ts:217-227`. Medido no banco em 24/09/2026:
// `select enterprise_id, assinatura_ordenada, assinatura_ordem, updated_at from
// apolo_enterprise_settings order by updated_at desc` mostra VOL (36) e VOC (37) com
// `ordenada = true`, `ordem = NULL` e `updated_at = 2026-09-23 05:56` — uma hora e cinquenta e
// seis minutos ANTES do conserto subir. Ninguém salvou de novo desde então.
//
// Entre 13/09 e 23/09 este cartão escreveu "Salvo" em cima de uma coluna que gravava NULO, porque
// ele fazia `setSalvo(true)` a partir do 200 da rota e nunca relia o servidor. Foi essa mentira que
// manteve a queixa viva por dois dias. Isto vale para o PRÓXIMO defeito desta classe, não só para
// este.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: async () => "tok-do-hub",
}));

const { OrdemDeAssinaturaCard } = await import("./ordem-de-assinatura-card");
// ⚠️ A LEITURA DE VERDADE DO SERVIDOR, e não uma cópia dela. É o furo que o mock escondia: o GET
// falso devolvia o mapa de volta, e `listEnterpriseSettings` (o único consumidor da coluna nesta
// rota, em `app/api/apolo/empreendimentos/settings/route.ts:49`) o jogava fora. Com a peça de
// verdade no caminho, o caso novo mede a tela CONTRA o servidor, e não contra o dublê.
const { listEnterpriseSettings } = await import("@/lib/apolo/enterprise-settings");

let raiz: Root;
let hospedeiro: HTMLDivElement;
/** O que o servidor devolve no GET. Trocar isto é simular o que ficou gravado de verdade. */
let gravado: null | Record<string, number> | string[];
let ordenadaGravada: boolean;
/** O PATCH grava? `false` é o servidor de antes de b108e654: aceita e joga a lista fora. */
let oPatchGrava: boolean;
/** O GET passa pela leitura de VERDADE (`listEnterpriseSettings`), como a rota faz. */
let oGetEhODeVerdade: boolean;
let patches: Array<Record<string, unknown>>;

const VOL = "36";

/** O `adminClient` reduzido ao que `listEnterpriseSettings` usa: `from().select().limit()`. */
function bancoFalso(linhas: Array<Record<string, unknown>>) {
  const encadeia = () => ({
    limit: () => Promise.resolve({ data: linhas, error: null }),
    select: () => encadeia(),
  });
  return { from: () => encadeia() } as never;
}

async function responder(
  url: string,
  init?: RequestInit,
): Promise<{ corpo: unknown; status: number }> {
  if (init?.method === "PATCH") {
    const corpo = JSON.parse(String(init.body)) as Record<string, unknown>;
    patches.push(corpo);
    if (oPatchGrava) {
      gravado = (corpo.assinaturaOrdem as null | Record<string, number>) ?? null;
    }
    ordenadaGravada = corpo.assinaturaOrdenada === true;
    return { corpo: {}, status: 200 };
  }
  const settings = oGetEhODeVerdade
    ? await listEnterpriseSettings(
        bancoFalso([
          {
            analise_credito_habilitada: true,
            assinatura_ordem: gravado,
            assinatura_ordenada: ordenadaGravada,
            code: "VOL",
            comprovante_renda_habilitado: false,
            credenciamento_ativo: true,
            enterprise_id: VOL,
            limite_credito: null,
            prevenda_habilitada: true,
            recepcao_cad: true,
            recepcao_imobiliaria: true,
            valor_pix: null,
          },
        ]),
      )
    : { [VOL]: { assinaturaOrdem: gravado, assinaturaOrdenada: ordenadaGravada } };
  return { corpo: { data: { settings } }, status: 200 };
}

async function esperarPromessas(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function botaoQueContem(trecho: string): HTMLButtonElement | undefined {
  return Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    b.textContent?.includes(trecho),
  );
}

async function montar(): Promise<void> {
  act(() => {
    raiz.render(<OrdemDeAssinaturaCard code="VOL" enterpriseId={VOL} />);
  });
  await esperarPromessas();
}

/** Escreve um número no campo de um papel, como o operador escreve. */
async function numerar(rotulo: string, valor: string): Promise<void> {
  const alvo = hospedeiro.querySelector<HTMLInputElement>(`input[aria-label="Ordem de ${rotulo}"]`);
  if (!alvo) throw new Error(`O campo "Ordem de ${rotulo}" não está na tela.`);
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(alvo, valor);
    alvo.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** O número que a tela mostra para um papel. */
function numeroDe(rotulo: string): string {
  return (
    hospedeiro.querySelector<HTMLInputElement>(`input[aria-label="Ordem de ${rotulo}"]`)?.value ?? ""
  );
}

async function salvar(): Promise<void> {
  await act(async () => {
    botaoQueContem("Salvar a ordem")?.click();
  });
  await esperarPromessas();
}

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  gravado = null;
  ordenadaGravada = false;
  oPatchGrava = true;
  oGetEhODeVerdade = false;
  patches = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const { corpo, status } = await responder(String(url), init);
      return new Response(JSON.stringify(corpo), {
        headers: { "content-type": "application/json" },
        status,
      });
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

describe("a ordem de assinatura no Setup do empreendimento", () => {
  it("o cartão só escreve Salvo depois de RELER do servidor", async () => {
    await montar();
    await salvar();

    expect(patches).toHaveLength(1);
    // Duas leituras: a da montagem e a releitura de conferência.
    const leituras = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .length;
    expect(leituras).toBe(3);
    expect(hospedeiro.textContent).toContain("Salvo.");
  });

  it("servidor que devolve ordem nula depois de um salvamento com mapa faz a tela avisar", async () => {
    // O servidor de antes de b108e654: responde 200 e joga o mapa fora.
    oPatchGrava = false;
    await montar();
    await salvar();

    expect(hospedeiro.textContent).not.toContain("Salvo.");
    expect(hospedeiro.textContent).toContain("não voltou");
  });

  // ⚠️ O CASO QUE O MOCK ESCONDIA. Nos testes acima o GET falso devolve o mapa de volta; o servidor
  // de verdade passava a coluna por `listaDePapeis` e devolvia NULO para todo mapa. Aqui o GET é o
  // de verdade (`listEnterpriseSettings`), e é este caminho que a Nívea usa: salvar, reabrir e
  // encontrar o padrão canônico de novo — com "Salvo" escrito na tela em 23/09 e o aviso âmbar novo
  // acusando defeito em cima de um salvamento que deu certo.
  it("⚠️ com o GET de VERDADE, o empate volta do servidor e o aviso âmbar não acende", async () => {
    oGetEhODeVerdade = true;
    await montar();

    // "Comprador 1, o resto 2" — Lucas (13/09/2026): *"essa personalização é bem comum para gente"*.
    for (const papel of ["Vendedora", "Coordenador de Vendas", "Corretor / imobiliária", "Testemunha"]) {
      await numerar(papel, "2");
    }
    await salvar();

    expect(patches[0]?.assinaturaOrdem).toEqual({
      // A Careli vai no mapa com o número canônico dela: ela não é desenhada nesta tela (é parte do
      // TERMO do Hades, não do contrato), e o cartão manda o estado inteiro. Não é deste lote.
      careli: 7,
      comprador: 1,
      conjuge: 2,
      coordenadora: 2,
      corretor: 2,
      testemunha: 2,
      vendedora: 2,
    });
    // A releitura passou pelo servidor de verdade e trouxe o empate, e não a fila canônica 1..6.
    expect(numeroDe("Comprador")).toBe("1");
    expect(numeroDe("Testemunha")).toBe("2");
    expect(numeroDe("Vendedora")).toBe("2");
    expect(hospedeiro.textContent).not.toContain("não voltou");
    expect(hospedeiro.textContent).toContain("Salvo.");
    expect(hospedeiro.textContent).toContain("do Setup do empreendimento");
  });

  it("a tela mostra de onde a ordem lida veio", async () => {
    gravado = { comprador: 1, conjuge: 2 };
    ordenadaGravada = true;
    await montar();
    expect(hospedeiro.textContent).toContain("do Setup do empreendimento");

    // O caso do VOL e do VOC de hoje: ligada, sem lista nenhuma gravada.
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    gravado = null;
    ordenadaGravada = true;
    await montar();
    // ⚠️ AQUI A TELA NÃO PODE DIZER "PADRÃO DA CASA", E É O CASO DO VOL (36) E DO VOC (37) HOJE.
    // Quem decide a origem no envio é `foiCadastrada` (`lib/assinatura/ordem-db.ts`), que devolve
    // true também quando só `assinatura_ordenada` está true: o envio desses dois imprime "Veio do
    // Setup do empreendimento" (`envio-db.ts`, via `descreverOrigem`) e sai em FILA ESTRITA. E o
    // "padrão da casa" é `ORDEM_PADRAO`, que tem `ordenada: false` — "todos ao mesmo tempo". Dizer
    // "padrão da casa" aqui faria a Nívea concluir o CONTRÁRIO do que o contrato faz, na tela do
    // apontamento 4 dela.
    expect(hospedeiro.textContent).not.toContain("do padrão da casa");
    expect(hospedeiro.textContent).toContain("assina em ordem");
    expect(hospedeiro.textContent).toContain("ainda não foi salva");
  });

  // ⚠️ SEM NADA GRAVADO — a chave desligada E a lista nula —, o padrão da casa é a resposta certa: é
  // o estado de 16 dos 18 empreendimentos (medido em 24/09/2026), e ali o contrato sai em paralelo.
  it("com a chave desligada e nenhuma lista, a tela diz o padrão da casa", async () => {
    gravado = null;
    ordenadaGravada = false;
    await montar();
    expect(hospedeiro.textContent).toContain("do padrão da casa");
  });
});
