// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O AVISO DO HÉRCULES CHEGA À TELA: no envio para assinatura e na volta para correção.
//
// Lucas, 24/09/2026: *"preciso garantir que tudo que acontece na temis reflete no hercules"*. O
// servidor responde `ok` com `avisoDoHercules` quando o card andou e a venda não acompanhou (é aviso,
// não erro: o envelope já está ativo, ou já foi cancelado). A revisão de 24/09/2026 achou o campo
// sem leitor: nenhuma tela o mostrava, e quem enviou saía achando que a venda tinha ido junto.
//
// A montagem é a de `cancelar-contrato.comportamento.test.tsx` (React no global, `act` na mão, fetch
// dublado por URL).

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
const { OrganizacaoDaAssinatura } = await import("@/modules/temis/blocks/assinatura/organizacao-da-assinatura");

const AVISO =
  'O card andou, mas a venda no Hércules não acompanhou: a venda já foi desfeita. Ela continua em "distrato" no Hércules. Avise a Careli para conferir a etapa da venda.';

let raiz: Root;
let hospedeiro: HTMLDivElement;
let recados: Array<{ pedeAcao: boolean; texto: string }>;
let estagio: string;
let respostaDaVolta: Record<string, unknown>;
let respostaDoEnvio: Record<string, unknown>;

const CARD = () => ({
  arrependimento_inicio: null,
  cliente_cpf: "111.222.333-44",
  cliente_nome: "VITORIA DE TESTE",
  contratos: [],
  enterprise_codigo: "VOL",
  enterprise_nome: "Vale do Ouro",
  estagio,
  estagio_desde: "2026-09-23T12:00:00.000Z",
  id: "card-vitoria",
  indeferido_motivo: null,
  indeferido_observacao: null,
  indeferido_por_nome: null,
  observacao: null,
  proposta_id: "venda-vitoria",
  tipo: "contrato",
  unidade: "Quadra 01 · Lote 01",
});

const PREPARO = {
  ambiente: "https://app.clicksign.com",
  avisoDeAmbiente: null,
  avisos: [],
  configuracaoPendente: null,
  contrato: { criadoEm: "2026-09-23", documentoId: "doc-1", nome: "Contrato v1.pdf", unidadeId: "uni-1", versao: 1 },
  impedimento: null,
  ordem: {
    descricao: "todos ao mesmo tempo",
    ordenada: false,
    origem: "padrao",
    origemDescrita: "o padrão da casa",
    papeis: ["comprador"],
  },
  signatarios: [
    { email: "vitoria@exemplo.com", nome: "VITORIA DE TESTE", ordem: 1, papel: "comprador", papelRotulo: "Comprador" },
  ],
};

function responder(url: string, metodo: string): { corpo: unknown; status: number } {
  if (url.includes("/assinatura/enviar")) {
    return metodo === "POST"
      ? { corpo: { data: respostaDoEnvio }, status: 200 }
      : { corpo: { data: PREPARO }, status: 200 };
  }
  if (url.includes("/trabalho?id=")) {
    return {
      corpo: {
        data: {
          analise: null,
          assinatura: null,
          card: CARD(),
          envelopeVivo:
            estagio === "assinatura"
              ? { conferido: true, estado: "aguardando", id: "env-1", rotulo: "Aguardando assinatura" }
              : null,
          podeEmitir: true,
        },
      },
      status: 200,
    };
  }
  if (url.includes("/trabalho") && metodo === "POST") return { corpo: respostaDaVolta, status: 200 };
  return { corpo: { data: { documentos: [], historico: [], mensagens: [] } }, status: 200 };
}

async function esperarPromessas(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function montar(elemento: React.ReactElement): Promise<void> {
  act(() => {
    raiz.render(elemento);
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

const tela = () => (
  <TelaDeTrabalho
    // ⚠️ O PAR INTEIRO, E NÃO SÓ O TEXTO (revisão de 24/09/2026). Guardando só o primeiro argumento,
    // esquecer o `pedeAcao` dava o mesmo resultado no teste — e no quadro o aviso caía na faixa VERDE
    // de confirmação, com ícone de visto, e sumia sozinho em oito segundos (temis-kanban.tsx).
    aoConcluir={(texto, pedeAcao) => recados.push({ pedeAcao: Boolean(pedeAcao), texto })}
    aoFechar={() => undefined}
    aoMudar={() => undefined}
    trabalhoId="card-vitoria"
  />
);

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  recados = [];
  estagio = "assinatura";
  respostaDaVolta = { de: "assinatura", envelopeCancelado: "env-1", ok: true };
  respostaDoEnvio = { ...PREPARO, envelopeId: "env-novo", nome: "Contrato v1.pdf", registroId: "reg-1" };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const { corpo, status } = responder(String(url), init?.method ?? "GET");
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a volta para correção mostra o aviso do Hércules", () => {
  it("a venda não voltou junto: o recado da volta leva o aviso", async () => {
    respostaDaVolta = { ...respostaDaVolta, avisoDoHercules: AVISO };
    await montar(tela());
    await clicar("Voltar para análise");
    await clicar("Confirmo: voltar");
    expect(recados).toHaveLength(1);
    expect(recados[0]?.texto).toContain("card de volta na Análise");
    expect(recados[0]?.texto).toContain(AVISO);
    // O aviso PEDE AÇÃO: fica em âmbar até alguém fechar, em vez de sumir em oito segundos.
    expect(recados[0]?.pedeAcao).toBe(true);
  });

  it("a venda voltou junto: o recado de sempre, sem aviso", async () => {
    await montar(tela());
    await clicar("Voltar para análise");
    await clicar("Confirmo: voltar");
    expect(recados).toHaveLength(1);
    expect(recados[0]?.texto).not.toContain("Hércules");
    expect(recados[0]?.pedeAcao).toBe(false);
  });
});

describe("o envio para assinatura mostra o aviso do Hércules", () => {
  it("na tela de trabalho: o recado do envio leva o aviso", async () => {
    estagio = "contrato";
    respostaDoEnvio = { ...respostaDoEnvio, avisoDoHercules: AVISO };
    await montar(tela());
    await clicar("Enviar para assinatura");
    await clicar("Confirmo: enviar agora");
    expect(recados).toHaveLength(1);
    expect(recados[0]?.texto).toContain("Contrato enviado para assinatura");
    expect(recados[0]?.texto).toContain(AVISO);
    expect(recados[0]?.pedeAcao).toBe(true);
  });

  it("no painel da assinatura: a caixa de sucesso mostra o aviso, e quem recebe o envio também o recebe", async () => {
    const aoEnviar = vi.fn();
    respostaDoEnvio = { ...respostaDoEnvio, avisoDoHercules: AVISO };
    await montar(<OrganizacaoDaAssinatura aoEnviar={aoEnviar} propostaId="venda-vitoria" />);
    await clicar("Enviar para assinatura");
    await clicar("Confirmo: enviar agora");
    expect(hospedeiro.textContent).toContain("Enviado para assinatura.");
    expect(hospedeiro.textContent).toContain(AVISO);
    expect(aoEnviar).toHaveBeenCalledWith(expect.objectContaining({ avisoDoHercules: AVISO, envelopeId: "env-novo" }));
  });

  it("sem aviso: a caixa de sucesso não fala do Hércules", async () => {
    await montar(<OrganizacaoDaAssinatura propostaId="venda-vitoria" />);
    await clicar("Enviar para assinatura");
    await clicar("Confirmo: enviar agora");
    expect(hospedeiro.textContent).toContain("Enviado para assinatura.");
    expect(hospedeiro.textContent).not.toContain("Hércules");
  });
});
