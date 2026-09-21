// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A ALTERAÇÃO MANUAL DO CONTRATO TEM DE CHEGAR AO BANCO — E SÓ ELA.
//
// Lucas, 21/09/2026: *"o time não está conseguindo editar manualmente o contrato... ela abre,
// altera, fecha, depois que atualiza o valor que estava antes, ou seja, não está salvando"*.
//
// ⚠️ MEDIDO EM PRODUÇÃO NO MESMO DIA: `temis_contrato_edicoes` tinha ZERO linhas, com o recurso no
// ar desde 10/09. Nenhuma alteração manual jamais foi gravada.
//
// ⚠️ E O CONTRÁRIO TAMBÉM É DEFEITO: gravar sem ninguém ter alterado nada CONGELA o contrato. O
// texto salvo é uma FOTO (ver a migration 0152): a partir dele, corrigir o CPF no Apolo ou publicar
// minuta nova deixa de alcançar o papel. Abrir para ler não pode custar isso.

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

// ⚠️ O CONTRATO DE VERDADE TEM TAG VAZIA. O serializador do servidor escreve `<br />` (estilo
// XHTML, `lib/temis/documento-html.ts`) e o `innerHTML` do navegador devolve `<br>` — as duas
// formas nunca são iguais como texto. Um fixture sem tag vazia esconde isso.
const COM_TAG_VAZIA = "<p>Cláusula primeira.</p><p><br /></p><p>Cláusula segunda.</p>";

let chamadas: { body: unknown; metodo: string; url: string }[] = [];
let container: HTMLDivElement;
let root: Root;
let fechou = 0;
let recusar403 = false;
let derrubarRede = false;
let htmlDoServidor = DA_MINUTA;
let salvamentosLentos: (() => void)[] = [];
let segurarSalvamento = false;
let servidorDeixaAlterar = true;

function montarFetch() {
  chamadas = [];
  salvamentosLentos = [];
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
      if (derrubarRede) throw new Error("Failed to fetch");
      if (recusar403) {
        return {
          json: async () => ({ error: "Usuario sem acesso ao Apolo." }),
          ok: false,
          status: 403,
        } as unknown as Response;
      }
      const resposta = { json: async () => ({ data: { removeu: [] } }), ok: true } as unknown as Response;
      if (segurarSalvamento) {
        return new Promise<Response>((resolve) => salvamentosLentos.push(() => resolve(resposta)));
      }
      return resposta;
    }
    return {
      json: async () => ({
        baseImpressao: "a".repeat(64),
        html: htmlDoServidor,
        minuta: { id: "m-1", nome: "MINUTA", versao: 6 },
        podeAlterar: servidorDeixaAlterar,
        semValor: [],
      }),
      ok: true,
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function botao(rotulo: string): HTMLButtonElement {
  const achado = [...container.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === rotulo,
  );
  if (!achado)
    throw new Error(
      `Sem botão "${rotulo}". Tem: ${[...container.querySelectorAll("button")].map((b) => `"${(b.textContent ?? "").trim()}"`).join(", ")}`,
    );
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

function salvamentos() {
  return chamadas.filter((c) => c.url.includes("/contrato/edicao") && c.metodo === "PUT");
}

function previas() {
  return chamadas.filter((c) => c.url.includes("/contrato/previa"));
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
  derrubarRede = false;
  segurarSalvamento = false;
  servidorDeixaAlterar = true;
  htmlDoServidor = DA_MINUTA;
  montarFetch();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await rerenderizar();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("alterar o contrato à mão e fechar", () => {
  it("manda para o servidor o texto QUE FOI DIGITADO, e não o da minuta", async () => {
    await clicar("Abrir o contrato");

    const folha = folhaDoContrato();
    expect(folha.getAttribute("contenteditable")).toBe("true");
    // O navegador é quem escreve no `contentEditable`; aqui isso é o innerHTML mudando fora do React.
    folha.innerHTML = ESCRITO_A_MAO;

    await clicar("Fechar o contrato");

    const salvamento = salvamentos()[0];
    expect(salvamento, "nenhum PUT para /contrato/edicao").toBeTruthy();
    expect((salvamento?.body as { html?: string })?.html).toBe(ESCRITO_A_MAO);
  });
});

// ── ABRIR PARA LER NÃO PODE VIRAR UMA ALTERAÇÃO ─────────────────────────────
//
// ⚠️ O TEXTO SALVO É UMA FOTO, E A FOTO CONGELA O CONTRATO. Gravar uma "alteração" idêntica à
// minuta faz a tela passar a dizer "Alterado à mão por Fulano" e, pior, desliga a atualização do
// cadastro: corrigir o CPF no Apolo ou publicar minuta nova deixa de alcançar aquele contrato.
// Quem abriu só para conferir uma cláusula não pediu nada disso.
describe("abrir e fechar sem digitar nada", () => {
  it("não grava alteração nenhuma", async () => {
    await clicar("Abrir o contrato");
    await clicar("Fechar o contrato");

    expect(salvamentos(), "gravou uma edição que ninguém fez").toHaveLength(0);
  });

  it("pelo X também não grava, e a janela fecha", async () => {
    await clicar("Abrir o contrato");
    await fecharNoX();

    expect(salvamentos()).toHaveLength(0);
    expect(fechou).toBe(1);
  });

  it("mas uma vírgula a mais já é alteração", async () => {
    await clicar("Abrir o contrato");
    folhaDoContrato().innerHTML = `${DA_MINUTA}<p>,</p>`;
    await clicar("Fechar o contrato");

    expect(salvamentos()).toHaveLength(1);
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

    const salvamento = salvamentos()[0];
    expect(salvamento, "o X fechou sem mandar o texto para o servidor").toBeTruthy();
    expect((salvamento?.body as { html?: string })?.html).toBe(ESCRITO_A_MAO);
    expect(fechou).toBe(1);
  });

  it("fora da edição o X fecha na hora, sem inventar salvamento", async () => {
    await fecharNoX();
    expect(salvamentos()).toHaveLength(0);
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

    expect((salvamentos()[0]?.body as { html?: string })?.html).toBe(ESCRITO_A_MAO);
    expect(fechou).toBe(1);
  });

  // ⚠️ O Esc É O TERCEIRO "FECHAR", e o mais traiçoeiro: quem escuta é a MOLDURA da tela de
  // trabalho (`modules/temis/blocks/trabalho`), que fecha o card inteiro e volta para o quadro.
  // Sem parar o Esc aqui, reescrever uma cláusula e apertar Esc perdia o texto E a tela.
  it("o Esc salva e fecha só a prévia, sem deixar a tecla chegar na tela de trás", async () => {
    const naTelaDeTras = vi.fn();
    document.addEventListener("keydown", naTelaDeTras);
    try {
      await clicar("Abrir o contrato");
      folhaDoContrato().innerHTML = ESCRITO_A_MAO;

      await act(async () => {
        // O Esc nasce onde o cursor esta: na folha. Quem escuta la embaixo e a Moldura da tela.
        folhaDoContrato().dispatchEvent(
          new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }),
        );
      });

      expect((salvamentos()[0]?.body as { html?: string })?.html).toBe(ESCRITO_A_MAO);
      expect(fechou).toBe(1);
      expect(naTelaDeTras, "o Esc vazou para quem está atrás").not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", naTelaDeTras);
    }
  });

  // ⚠️ FECHAR É FECHAR. Esperar a prévia inteira ser remontada (PUT + prévia + lista de guardados)
  // deixava a janela aberta mostrando o esqueleto "Montando o contrato" com o botão em "Salvando…"
  // — em contrato grande, segundos olhando uma tela que a pessoa já mandou sair.
  it("não espera a prévia recarregar para sair da frente", async () => {
    await clicar("Abrir o contrato");
    folhaDoContrato().innerHTML = ESCRITO_A_MAO;

    await fecharNoX();

    expect(fechou).toBe(1);
    expect(previas(), "recarregou a prévia de uma janela que já fechou").toHaveLength(1);
  });

  // ⚠️ DOIS CLIQUES NO X SÃO UM GESTO SÓ. Sem trava, saem dois PUT concorrentes, dois registros de
  // "alterou o contrato à mão" no log e um `aoFechar()` duplicado no pai.
  it("clique duplo no X manda um salvamento só", async () => {
    segurarSalvamento = true;
    await clicar("Abrir o contrato");
    folhaDoContrato().innerHTML = ESCRITO_A_MAO;

    const x = container.querySelector('button[aria-label="Fechar"]') as HTMLButtonElement;
    await act(async () => {
      x.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      x.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(salvamentos()).toHaveLength(1);

    await act(async () => {
      salvamentosLentos.forEach((liberar) => liberar());
    });
    expect(fechou).toBe(1);
  });
});

// ── QUANDO O SERVIDOR RECUSA ────────────────────────────────────────────────
//
// ⚠️ A TELA OFERECE A EDIÇÃO A QUEM O SERVIDOR NÃO DEIXA EDITAR. `podeEditar` na Têmis olha só a
// etapa do card; quem grava é `autorizarEmissaoDeContrato`. Medido em 21/09/2026: existem 2
// `operator` ATIVOS (entraram em 16/09), e para eles o PUT volta 403 — a nota de 08/09 em
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

  // ⚠️ CLICAR DE NOVO É "TENTA OUTRA VEZ", e a queda mais comum é a rede piscando. Sair calado na
  // segunda tentativa jogaria fora um texto que o servidor já estava pronto para aceitar.
  it("com a rede de volta, o segundo clique TENTA salvar antes de desistir", async () => {
    derrubarRede = true;
    await clicar("Abrir o contrato");
    folhaDoContrato().innerHTML = ESCRITO_A_MAO;

    await fecharNoX();
    expect(fechou).toBe(0);

    derrubarRede = false;
    await fecharNoX();

    expect(salvamentos(), "o segundo clique saiu sem tentar de novo").toHaveLength(2);
    expect((salvamentos().at(-1)?.body as { html?: string })?.html).toBe(ESCRITO_A_MAO);
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

    expect((salvamentos()[0]?.body as { html?: string })?.html).toBe(ESCRITO_A_MAO);
  });

  it("fora da edição, o texto do servidor continua mandando na folha", async () => {
    // A folha não pode virar um DOM solto: quando não se está editando, o que o servidor manda é o
    // que tem de aparecer — é assim que o texto salvo (e o descarte) chegam à tela.
    expect(folhaDoContrato().innerHTML).toBe(DA_MINUTA);
    await rerenderizar();
    expect(folhaDoContrato().innerHTML).toBe(DA_MINUTA);
  });

  // ⚠️ COMPARAR `innerHTML` COM O HTML DO SERVIDOR NUNCA DÁ IGUAL num contrato real: o servidor
  // escreve `<br />` e o navegador devolve `<br>`. Uma guarda que nunca fecha faz a folha inteira
  // (27 páginas) ser destruída e reparseada a cada render, e leva junto a seleção de quem estava
  // copiando um trecho.
  it("em leitura, um render novo NÃO recria os nós da folha", async () => {
    htmlDoServidor = COM_TAG_VAZIA;
    await act(async () => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await rerenderizar();

    const primeiroParagrafo = folhaDoContrato().firstElementChild;
    expect(primeiroParagrafo?.textContent).toContain("Cláusula primeira");

    await rerenderizar();
    await rerenderizar();

    expect(
      folhaDoContrato().firstElementChild,
      "a folha foi reescrita e os nós trocaram de identidade",
    ).toBe(primeiroParagrafo);
  });
});

// ── A TELA NÃO OFERECE O QUE O SERVIDOR RECUSA ──────────────────────────────
//
// Lucas, 21/09/2026: *"quem pode editar é a Nivea Careli e Northon Nascimento"*. A prop
// `podeEditar` só sabe a ETAPA do card; quem sabe QUEM está logado é o servidor, e ele responde
// isso em `podeAlterar`. Sem ler esse campo, cinco pessoas da coordenação abririam o contrato,
// reescreveriam uma cláusula e levariam 403 no fechamento.
describe("quem não pode alterar", () => {
  it("não vê o botão de abrir o contrato para edição", async () => {
    servidorDeixaAlterar = false;
    await act(async () => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await rerenderizar();

    const rotulos = [...container.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim());
    expect(rotulos).not.toContain("Abrir o contrato");
    // E a folha continua inteira na tela: conferir o contrato é de todo mundo.
    expect(folhaDoContrato().innerHTML).toBe(DA_MINUTA);
  });
});
