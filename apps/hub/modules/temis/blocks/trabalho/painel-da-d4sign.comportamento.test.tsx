// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GESTOS_POR_OUTRO_CANAL, PROVEDOR_DE_OUTRO_CANAL } from "@/lib/assinatura/frase-para-o-portal";
import { ACOES_DA_D4SIGN_FICAM_NO_C2X } from "@/lib/assinatura/recusa-de-reenvio";

// O PAINEL DE ASSINATURA DO CARD QUE O C2X MANDOU PELA D4SIGN (02/10/2026).
//
// Lucas, no mesmo dia: *"tem com a gente trazer o esquema de assinatura que e criado pelo c2x? os card
// que estao pelo c2x nao tem nada na tela de assinatura"*. A tela mostrava o aviso "Não há signatários"
// sobre contratos com 6 a 10 pessoas no quadro. Agora o painel é o QUADRO do espelho: com o perfil (e
// "Testemunha", quando o C2X marcou) na linha, os compradores pela régua do perfil, NENHUM botão (os
// gestos ficam no C2X), sem log (a D4Sign não manda evento) e com a hora da última conferência.
//
// A montagem é a de `fila-de-degraus.comportamento.test.tsx`. Pessoas e e-mails fictícios.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/lib/supabase/client", () => ({
  getHubSupabaseClient: () => null,
  hubSupabaseConfig: { anonKey: "chave-publica", url: "https://projeto.supabase.co" },
}));

vi.mock("@/modules/apolo/data/apolo-operations", () => ({
  getApoloAccessToken: async () => "tok-do-hub",
}));

const { TelaDeTrabalho } = await import("./tela-de-trabalho");

const AGORA = "2026-10-02T15:00:00.000Z";

let raiz: Root;
let hospedeiro: HTMLDivElement;
let carga: { assinatura: unknown; estadoDoEnvelope: string; estagio: string };

/** Uma pessoa como `diarioDoQuadroDaD4Sign` a manda (hub: com e-mail e a chave `c2x:`). */
const pessoa = (chave: string, nome: string, perfil: string, patch: Record<string, unknown> = {}) => ({
  assinouEm: null as null | string,
  chave,
  comecouEm: null,
  convite: "sem_noticia",
  conviteDetalhe: null,
  conviteQuando: null,
  email: `${chave.replace(":", "")}@exemplo.test` as null | string,
  foiParaOFimEm: null,
  nome,
  papel: null as null | string,
  perfil,
  posicao: null,
  reenvioIndisponivel: { frase: ACOES_DA_D4SIGN_FICAM_NO_C2X, motivo: "sem_id_na_clicksign" },
  trocaVaiParaOFim: null,
  ...patch,
});

/** O VAL C L09 como ele está (nomes trocados): 4 de 7, sem ordem, duas testemunhas. */
const VALC09 = (conferidoEm = "2026-10-02T14:30:00.000Z") => {
  const signatarios = [
    pessoa("c2x:1", "ANA TESTEMUNHA", "Backoffice", { assinouEm: "2026-09-24T13:00:00.000Z", papel: "testemunha" }),
    pessoa("c2x:2", "BRUNO COMPRADOR", "Comprador", { assinouEm: "2026-09-24T14:00:00.000Z" }),
    pessoa("c2x:3", "CARLA COMPRADORA", "Comprador"),
    pessoa("c2x:4", "DIEGO COORDENADOR", "Coordenadora de venda", { assinouEm: "2026-09-23T18:00:00.000Z" }),
    pessoa("c2x:5", "EVA INCORPORADORA", "Incorporador", { assinouEm: "2026-09-25T12:00:00.000Z" }),
    pessoa("c2x:6", "FABIO IMOBILIARIA", "Imobiliária"),
    pessoa("c2x:7", "NINA TESTEMUNHA", "Backoffice", { papel: "testemunha" }),
  ];
  return {
    assinaram: signatarios.filter((s) => s.assinouEm).length,
    diario: [],
    envelope: {
      atualizadoEm: conferidoEm,
      conferidoEm,
      documentoId: null,
      envelopeId: null,
      estado: "parcial",
      estadoCru: "d4sign:3",
      id: "env-d4",
      provedor: "d4sign",
      provedorDocumentoId: "doc-fict",
      signatarios,
      venceEm: null,
    },
    total: signatarios.length,
  };
};

const CARD = () => ({
  arrependimento_inicio: carga.estagio === "prazo_legal" ? "2026-10-01T13:12:00.000Z" : null,
  cliente_cpf: null,
  cliente_nome: "BRUNO COMPRADOR",
  contratos: [],
  enterprise_codigo: "VAL",
  enterprise_nome: "Vale",
  estagio: carga.estagio,
  estagio_desde: "2026-09-23T18:00:00.000Z",
  id: "card-val",
  indeferido_motivo: null,
  indeferido_observacao: null,
  indeferido_por_nome: null,
  observacao: null,
  proposta_id: "venda-val",
  tipo: "contrato",
  unidade: "Quadra C · Lote 09",
});

function responder(url: string): { corpo: unknown; status: number } {
  if (url.includes("/trabalho?id=")) {
    return {
      corpo: {
        data: {
          analise: null,
          assinatura: carga.assinatura,
          card: CARD(),
          envelopeVivo: { conferido: true, estado: carga.estadoDoEnvelope, id: null, rotulo: "Parcialmente assinado" },
          podeEmitir: true,
        },
      },
      status: 200,
    };
  }
  return { corpo: { data: { documentos: [], eventos: [], mensagens: [] } }, status: 200 };
}

async function montar(): Promise<void> {
  act(() => {
    raiz.render(<TelaDeTrabalho aoFechar={() => undefined} aoMudar={() => undefined} trabalhoId="card-val" />);
  });
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** O painel inteiro (o cabeçalho "Assinatura do contrato" e o que vem com ele). */
function painel(): HTMLElement {
  const titulo = Array.from(hospedeiro.querySelectorAll("h3")).find((h) => h.textContent === "Assinatura do contrato");
  const raizDoPainel = titulo?.closest("section")?.parentElement;
  if (!raizDoPainel) throw new Error("painel da assinatura não encontrado");
  return raizDoPainel;
}

function linhaDe(nome: string): HTMLElement {
  const linha = Array.from(hospedeiro.querySelectorAll<HTMLElement>("li")).find((el) => el.textContent?.includes(nome));
  if (!linha) throw new Error(`linha de ${nome} não encontrada`);
  return linha;
}

function quadro(rotulo: string): string {
  const titulo = Array.from(hospedeiro.querySelectorAll("header p")).find((p) => p.textContent === rotulo);
  return titulo?.parentElement?.textContent ?? "";
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(AGORA));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  carga = { assinatura: VALC09(), estadoDoEnvelope: "parcial", estagio: "assinatura" };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const { corpo, status } = responder(String(url));
      return Promise.resolve(
        new Response(JSON.stringify(corpo), { headers: { "content-type": "application/json" }, status }),
      );
    }),
  );
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("o painel da D4Sign em Em assinatura", () => {
  it("aparece no lugar do aviso 'Não há signatários', num grupo só (sem a marca de ordem), com perfil e Testemunha na linha", async () => {
    await montar();

    expect(hospedeiro.textContent).not.toContain("Não há signatários");
    const grupos = Array.from(hospedeiro.querySelectorAll<HTMLElement>("section[aria-label]")).map((s) => s.getAttribute("aria-label"));
    expect(grupos).toEqual(["Quem assina: Na vez"]);
    expect(linhaDe("ANA TESTEMUNHA").textContent).toContain("Testemunha");
    expect(linhaDe("ANA TESTEMUNHA").textContent).not.toContain("Backoffice");
    expect(linhaDe("CARLA COMPRADORA").textContent).toContain("Comprador");
    expect(linhaDe("FABIO IMOBILIARIA").textContent).toContain("Imobiliária");
    // O e-mail aparece no hub.
    expect(linhaDe("CARLA COMPRADORA").textContent).toContain("c2x3@exemplo.test");
  });

  it("conta os compradores pela régua do perfil e o contrato inteiro como o selo", async () => {
    await montar();

    expect(quadro("Compradores")).toContain("1 de 2");
    expect(quadro("Compradores")).toContain("falta CARLA COMPRADORA");
    expect(quadro("Contrato")).toContain("4 de 7");
  });

  it("nenhum botão de ação, nenhum log, e nenhuma frase da Clicksign", async () => {
    await montar();

    const p = painel();
    expect(p.querySelectorAll("li button")).toHaveLength(0);
    expect(p.querySelector('button[aria-label="Corrigir o e-mail"]')).toBeNull();
    expect(p.querySelector('button[aria-label="Reenviar o convite para este e-mail"]')).toBeNull();
    expect(p.querySelector('button[aria-label="Copiar o link de assinatura"]')).toBeNull();
    expect(p.textContent).not.toContain("Log do envelope");
    expect(p.querySelector("details")).toBeNull();
    expect(p.textContent).not.toContain("Clicksign");
    // Quem não assinou não está "Sem notícia" (frase da Clicksign): falta assinar.
    expect(linhaDe("CARLA COMPRADORA").textContent).toContain("Falta assinar");
    expect(linhaDe("CARLA COMPRADORA").textContent).not.toContain("Sem notícia");
  });

  it("o rodapé diz quando foi conferido com a D4Sign e que reenvio e troca de e-mail são no C2X", async () => {
    await montar();

    const p = painel();
    expect(p.textContent).toContain("Conferido com a D4Sign em 02/10");
    expect(p.textContent).toContain(ACOES_DA_D4SIGN_FICAM_NO_C2X);
    expect(p.textContent).not.toContain("há mais de 2 h");
  });

  it("com a conferência de mais de 2 h, um aviso discreto", async () => {
    carga.assinatura = VALC09("2026-10-02T12:30:00.000Z");
    await montar();

    expect(painel().textContent).toContain("há mais de 2 h");
  });

  it("a caixa do contrato diz que ele foi gerado pelo C2X, e não que o card chegou sem contrato", async () => {
    // Revisão de 02/10/2026: os 5 cards do C2X têm 0 contratos guardados, e a frase de sempre ("chegou
    // a esta etapa sem contrato gerado") contradizia o painel logo acima.
    await montar();

    const p = painel();
    expect(p.textContent).toContain("Este contrato foi gerado e enviado pelo C2X. O Panteon não guarda cópia dele.");
    expect(p.textContent).not.toContain("sem contrato gerado");
  });

  it("o nome longo é cortado sozinho: o perfil fica fora do corte, e o nome inteiro vai no title", async () => {
    // Revisão de 02/10/2026: nome e perfil moravam no mesmo `truncate`, e o nome longo levava o perfil.
    const longo = "MARIA DAS GRACAS APARECIDA DE SOUZA FERNANDES DOS SANTOS OLIVEIRA";
    const comNomeLongo = VALC09();
    comNomeLongo.envelope.signatarios[2] = pessoa("c2x:3", longo, "Comprador");
    carga.assinatura = comNomeLongo;
    await montar();

    const linha = linhaDe(longo);
    const cortado = linha.querySelector<HTMLElement>(".truncate");
    expect(cortado?.textContent).toBe(longo);
    expect(cortado?.getAttribute("title")).toBe(longo);
    expect(cortado?.textContent).not.toContain("Comprador");
    const perfil = Array.from(linha.querySelectorAll<HTMLElement>("span")).find((s) => s.textContent === " · Comprador");
    expect(perfil).toBeDefined();
    expect(perfil?.closest(".truncate")).toBeNull();
    expect(perfil?.className).toContain("shrink-0");
  });
});

describe("o painel da D4Sign com a marca de ordem do C2X", () => {
  /** O mesmo quadro, com `ordenada` no C2X: o servidor numera os degraus (`posicao`). */
  const ORDENADO = () => {
    const base = VALC09();
    const degrau: Record<string, number> = {
      "c2x:1": 4,
      "c2x:2": 2,
      "c2x:3": 2,
      "c2x:4": 1,
      "c2x:5": 5,
      "c2x:6": 3,
      "c2x:7": 4,
    };
    const signatarios = base.envelope.signatarios
      .map((s) => ({ ...s, posicao: degrau[s.chave] as number }))
      .sort((a, b) => a.posicao - b.posicao);
    // Um degrau que mistura perfis: a incorporadora e alguém do backoffice.
    signatarios.push({ ...pessoa("c2x:8", "OTAVIO BACKOFFICE", "Backoffice"), posicao: 5 });
    return { ...base, envelope: { ...base.envelope, signatarios }, total: signatarios.length };
  };

  it("cada degrau tem o nome do perfil de quem está nele; 'Assinam juntos' só quando os perfis diferem", async () => {
    // Revisão de 02/10/2026: no quadro da D4Sign o papel é nulo, e todo degrau sem testemunha saía
    // "Assinam juntos", até o de uma pessoa só (18 envelopes vivos com a ordem marcada, 90 degraus assim).
    carga.assinatura = ORDENADO();
    await montar();

    const grupos = Array.from(hospedeiro.querySelectorAll<HTMLElement>("section[aria-label]")).map((s) => s.getAttribute("aria-label"));
    expect(grupos).toEqual([
      "Coordenação: Concluído",
      "Compradores: Na vez",
      "Imobiliária: Aguardando",
      "Testemunhas: Aguardando",
      "Assinam juntos: Aguardando",
    ]);
    expect(painel().textContent).toContain("Na vez: Compradores");
  });
});

describe("o painel da D4Sign no Pré-faturamento", () => {
  it("aparece com o envelope ainda não assinado", async () => {
    carga = { assinatura: VALC09(), estadoDoEnvelope: "parcial", estagio: "prazo_legal" };
    await montar();

    expect(hospedeiro.textContent).toContain("Prazo de arrependimento");
    expect(painel().textContent).toContain("Conferido com a D4Sign");
    expect(quadro("Contrato")).toContain("4 de 7");
  });

  it("não aparece com o envelope assinado", async () => {
    carga = { assinatura: VALC09(), estadoDoEnvelope: "assinado", estagio: "prazo_legal" };
    await montar();

    expect(hospedeiro.textContent).not.toContain("Assinatura do contrato");
  });
});

describe("o painel da D4Sign no portal", () => {
  /** O quadro como `quadroDaD4SignParaOPortal` o manda: sem e-mail, sem a chave, com o provedor neutro. */
  const NO_PORTAL = () => {
    const { id: _id, ...envelope } = VALC09().envelope;
    return {
      ...VALC09(),
      envelope: {
        ...envelope,
        estadoCru: null,
        provedor: PROVEDOR_DE_OUTRO_CANAL,
        provedorDocumentoId: null,
        signatarios: envelope.signatarios.map((s, i) => ({
          ...s,
          chave: `pessoa-${i + 1}`,
          email: null,
          reenvioIndisponivel: { frase: GESTOS_POR_OUTRO_CANAL, motivo: "sem_id_na_clicksign" },
        })),
      },
    };
  };

  it("sem e-mail (o servidor não manda), a linha some, e não diz 'sem e-mail no envelope'", async () => {
    carga.assinatura = NO_PORTAL();
    await montar();

    expect(painel().textContent).not.toContain("@");
    expect(painel().textContent).not.toContain("sem e-mail no envelope");
    expect(linhaDe("CARLA COMPRADORA").textContent).toContain("Comprador");
  });

  it("o mesmo quadro, sem botão e sem log, e sem escrever \"D4Sign\" nem \"C2X\" em lugar nenhum do painel", async () => {
    // Revisão de 02/10/2026: com o provedor "d4sign" no portal, a tela escrevia "Conferido com a D4Sign",
    // "são feitos no C2X" e "A D4Sign não conta ao Panteon" para o incorporador.
    carga.assinatura = NO_PORTAL();
    await montar();

    const p = painel();
    expect(p.querySelectorAll("li button")).toHaveLength(0);
    expect(p.querySelector("details")).toBeNull();
    expect(p.textContent).not.toMatch(/d4sign|c2x|clicksign/i);
    const dicas = Array.from(p.querySelectorAll("[title]")).map((el) => el.getAttribute("title") ?? "");
    expect(dicas.join(" ")).not.toMatch(/d4sign|c2x|clicksign/i);
    expect(p.textContent).toContain("Conferido em 02/10");
    expect(p.textContent).toContain(GESTOS_POR_OUTRO_CANAL);
    expect(linhaDe("CARLA COMPRADORA").textContent).toContain("Falta assinar");
    expect(dicas).toContain("Não há notícia de entrega do convite: o que se sabe é que esta pessoa ainda não assinou.");
    expect(p.textContent).toContain("Este contrato foi gerado e enviado por outro canal. O Panteon não guarda cópia dele.");
    // Os compradores continuam pela régua do perfil.
    expect(quadro("Compradores")).toContain("1 de 2");
  });
});
