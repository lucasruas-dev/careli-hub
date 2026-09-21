// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A ALTERAÇÃO MANUAL DO CONTRATO TEM DE CHEGAR AO BANCO.
//
// Lucas, 21/09/2026: *"o time não está conseguindo editar manualmente o contrato... ela abre,
// altera, fecha, depois que atualiza o valor que estava antes, ou seja, não está salvando"*.
//
// ⚠️ MEDIDO EM PRODUÇÃO NO MESMO DIA: `temis_contrato_edicoes` tem ZERO linhas, com o recurso no ar
// desde 10/09. Nenhuma alteração manual jamais foi gravada.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/modules/temis/api-da-temis", () => {
  const temisFetch = (subcaminho: string, init?: RequestInit) =>
    globalThis.fetch(`/api/temis${subcaminho}`, init);
  return { useApiDaTemis: () => ({ temisFetch }) };
});

const { PreviaDoContrato } = await import("./PreviaDoContrato");

const DA_MINUTA = "<p>Contrato com o valor ANTIGO.</p>";
const ESCRITO_A_MAO = "<p>Contrato com o valor NOVO, digitado pelo time.</p>";

let chamadas: { body: unknown; metodo: string; url: string }[] = [];

function montarFetch() {
  chamadas = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const endereco = String(url);
    chamadas.push({
      body: init?.body ? JSON.parse(String(init.body)) : null,
      metodo: init?.method ?? "GET",
      url: endereco,
    });
    if (endereco.includes("/contrato/gerar")) {
      return { json: async () => ({ data: { contratos: [] } }), ok: true } as unknown as Response;
    }
    if (endereco.includes("/contrato/edicao")) {
      if (recusar403) {
        return {
          json: async () => ({ error: "Usuario sem acesso ao Apolo." }),
          ok: false,
          status: 403,
        } as unknown as Response;
      }
      return { json: async () => ({ data: { removeu: [] } }), ok: true } as unknown as Response;
    }
    return {
      json: async () => ({
        baseImpressao: "a".repeat(64),
        html: DA_MINUTA,
        minuta: { id: "m-1", nome: "MINUTA", versao: 6 },
        semValor: [],
      }),
      ok: true,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

let container: HTMLDivElement;
let root: Root;
let fechou = 0;
let recusar403 = false;

function botao(rotulo: string): HTMLButtonElement {
  const achado = [...container.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === rotulo,
  );
  if (!achado) throw new Error(`Sem botão "${rotulo}". Tem: ${[...container.querySelectorAll("button")].map((b) => `"${(b.textContent ?? "").trim()}"`).join(", ")}`);
  return achado as HTMLButtonElement;
}

async function clicar(rotulo: string) {
  const alvo = botao(rotulo);
  await act(async () => {
    alvo.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function overlay(): HTMLElement {
  return container.firstElementChild as HTMLElement;
}

function folhaDoContrato(): HTMLDivElement {
  return container.querySelector(".previa-do-contrato") as HTMLDivElement;
}

/** O X do cabeçalho. */
function fecharNoX() {
  const x = container.querySelector('button[aria-label="Fechar"]') as HTMLButtonElement;
  return act(async () => {
    x.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function rerenderizar() {
  await act(async () => {
    root.render(
      <PreviaDoContrato
        aoFechar={() => {
          fechou += 1;
        }}
        podeEditar
        podeGerar
        propostaId="proposta-1"
      />,
    );
  });
}

beforeEach(async () => {
  fechou = 0;
  recusar403 = false;
  montarFetch();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <PreviaDoContrato
        aoFechar={() => {
          fechou += 1;
        }}
        podeEditar
        podeGerar
        propostaId="proposta-1"
      />,
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("alterar o contrato à mão e fechar", () => {
  it("manda para o servidor o texto QUE FOI DIGITADO, e não o da minuta", async () => {
    await clicar("Abrir o contrato");

    const folha = container.querySelector(".previa-do-contrato") as HTMLDivElement;
    expect(folha.getAttribute("contenteditable")).toBe("true");
    // O navegador é quem escreve no `contentEditable`; aqui isso é o innerHTML mudando fora do React.
    folha.innerHTML = ESCRITO_A_MAO;

    await clicar("Fechar o contrato");

    const salvamento = chamadas.find((c) => c.url.includes("/contrato/edicao"));
    expect(salvamento, "nenhum PUT para /contrato/edicao").toBeTruthy();
    expect(salvamento?.metodo).toBe("PUT");
    expect((salvamento?.body as { html?: string })?.html).toBe(ESCRITO_A_MAO);
  });
});

// ── FECHAR A JANELA NÃO PODE JOGAR O TEXTO FORA ─────────────────────────────
//
// ⚠️ SÃO DOIS "FECHAR" NA MESMA TELA, e um deles mentia. O botão do rodapé chama-se "Fechar o
// contrato" e salva (Lucas, 11/09/2026: *"não precisa de um botão de salvar, automaticamente ao
// fechar o contrato salva"*); o X do cabeçalho e o fundo escuro fechavam a JANELA e descartavam o
// que tinha sido digitado, sem avisar. Quem fecha pelo lugar errado perde o trabalho e só descobre
// ao reabrir — o relato do time em 21/09/2026.
describe("fechar a janela no meio da edição", () => {
  it("o X do cabeçalho SALVA o que foi digitado antes de fechar", async () => {
    await clicar("Abrir o contrato");
    folhaDoContrato().innerHTML = ESCRITO_A_MAO;

    await fecharNoX();

    const salvamento = chamadas.find((c) => c.url.includes("/contrato/edicao"));
    expect(salvamento, "o X fechou sem mandar o texto para o servidor").toBeTruthy();
    expect((salvamento?.body as { html?: string })?.html).toBe(ESCRITO_A_MAO);
    expect(fechou).toBe(1);
  });

  it("fora da edição o X fecha na hora, sem inventar salvamento", async () => {
    await fecharNoX();
    expect(chamadas.some((c) => c.url.includes("/contrato/edicao"))).toBe(false);
    expect(fechou).toBe(1);
  });

  // ⚠️ SELECIONAR TEXTO ARRASTANDO PARA FORA DA FOLHA É O GESTO DE QUEM EDITA. O clique nasce no
  // ancestral comum — o fundo escuro — e a janela fechava no meio da frase.
  it("o arrasto que começa no contrato e termina no fundo NÃO fecha a janela", async () => {
    await clicar("Abrir o contrato");
    folhaDoContrato().innerHTML = ESCRITO_A_MAO;

    await act(async () => {
      folhaDoContrato().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      overlay().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(fechou).toBe(0);
  });

  it("o clique que começa E termina no fundo fecha — salvando o que estava aberto", async () => {
    await clicar("Abrir o contrato");
    folhaDoContrato().innerHTML = ESCRITO_A_MAO;

    await act(async () => {
      overlay().dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      overlay().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect((chamadas.find((c) => c.url.includes("/contrato/edicao"))?.body as { html?: string })?.html).toBe(
      ESCRITO_A_MAO,
    );
    expect(fechou).toBe(1);
  });
});

// ── QUANDO O SERVIDOR RECUSA ────────────────────────────────────────────────
//
// ⚠️ A TELA OFERECE A EDIÇÃO A QUEM O SERVIDOR NÃO DEIXA EDITAR. `podeEditar` na Têmis olha só a
// etapa do card; quem grava é `autorizarEmissaoDeContrato` (admin + leader). Medido em 21/09/2026:
// existem 2 `operator` ATIVOS (entraram em 16/09), e para eles o PUT volta 403 — a nota de 08/09 em
// `lib/temis/autorizacao.ts` dizia "hoje isto não tira ninguém de dentro" porque naquela data havia
// ZERO operators. A premissa venceu.
describe("o servidor recusa a alteração", () => {
  it("diz o motivo em português e NÃO fecha a janela levando o texto embora", async () => {
    recusar403 = true;
    await clicar("Abrir o contrato");
    folhaDoContrato().innerHTML = ESCRITO_A_MAO;

    await fecharNoX();

    expect(fechou, "fechou mesmo sem ter salvado").toBe(0);
    expect(container.textContent).toContain("perfil");
    expect(folhaDoContrato().innerHTML).toBe(ESCRITO_A_MAO);
  });

  it("o segundo clique em fechar sai sem salvar, e a tela avisa disso antes", async () => {
    recusar403 = true;
    await clicar("Abrir o contrato");
    folhaDoContrato().innerHTML = ESCRITO_A_MAO;

    await fecharNoX();
    expect(container.textContent).toContain("fechar de novo");

    await fecharNoX();
    expect(fechou).toBe(1);
  });
});

// ── O RE-RENDER NAO PODE APAGAR O QUE FOI DIGITADO ──────────────────────────
//
// ⚠️ AQUI ESTAVA A CAUSA. A folha era `contentEditable` POR CIMA de
// `dangerouslySetInnerHTML`, e o comentário do arquivo apostava que *"o React só reescreve a folha
// quando o texto vem do servidor"*. Medido em 21/09/2026, em React 19: NÃO. Qualquer re-render do
// componente reaplica o `__html` da prop e o texto digitado à mão some — sem erro, sem aviso, e
// bastam um `setState` do pai, o `setSalvando` do próprio salvamento ou o relógio de outra parte
// da tela. Quem estava escrevendo via o contrato voltar sozinho ao texto da minuta.
describe("a folha sob re-render", () => {
  it("o texto digitado sobrevive a um render novo vindo do pai", async () => {
    await clicar("Abrir o contrato");
    folhaDoContrato().innerHTML = ESCRITO_A_MAO;

    await rerenderizar();

    expect(folhaDoContrato().innerHTML).toBe(ESCRITO_A_MAO);
  });

  it("e é ele que vai para o servidor depois do re-render", async () => {
    await clicar("Abrir o contrato");
    folhaDoContrato().innerHTML = ESCRITO_A_MAO;

    await rerenderizar();
    await clicar("Fechar o contrato");

    expect(
      (chamadas.find((c) => c.url.includes("/contrato/edicao"))?.body as { html?: string })?.html,
    ).toBe(ESCRITO_A_MAO);
  });

  it("fora da edição, o texto do servidor continua mandando na folha", async () => {
    // A folha não pode virar um DOM solto: quando não se está editando, o que o servidor manda é o
    // que tem de aparecer — é assim que o texto salvo (e o descarte) chegam à tela.
    expect(folhaDoContrato().innerHTML).toBe(DA_MINUTA);
    await rerenderizar();
    expect(folhaDoContrato().innerHTML).toBe(DA_MINUTA);
  });
});
