// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A FAIXA DE AÇÕES DO SIGNATÁRIO NÃO PODE DESAPARECER.
//
// Lucas, 12/09/2026: *"temos que conduzir o usuário na tela, ele tem que saber o que fazer"*.
//
// ⚠️ AFIRMAÇÃO EM CAIXA ALTA: `podeMexer` ENVOLVIA A FAIXA INTEIRA, E O "@" APAGAVA A LINHA. Em
// `tela-de-trabalho.tsx` (perto da 3028) a condição era
// `envelopeId !== null && !signerId.includes("@")`, e o ternário dela embrulhava TODO o bloco de
// ações: quando a `chave` da linha era o próprio e-mail — o que `juntarComOsCongelados` faz com quem
// só existe na lista congelada do envio (`diario-do-envelope-db.ts`) — a pessoa aparecia sem botão,
// sem tooltip e sem uma frase dizendo por quê. A regra do "@" vale só para o botão que manda o id
// CRU para o `DELETE /envelopes/{id}/signers/{id}` (a troca de e-mail), porque e-mail ali é 404 e o
// 404 da remoção segue em frente de propósito.
//
// ⚠️ E AS DUAS TELAS DO PAINEL DE ASSINATURA TÊM DE CONTAR A MESMA HISTÓRIA. A do Hades
// (`modules/guardian/attendance/components/PropostasPanel.tsx`) não barra mais "@" por conta própria:
// ela mostra o botão desabilitado com a mesma frase.
//
// A montagem é a de `contrato-em-assinatura.comportamento.test.tsx`.

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
const { fraseDeEnvelopeEncerrado, RECUSA_DE_REENVIO_SEM_ID } = await import(
  "@/lib/assinatura/recusa-de-reenvio"
);

let raiz: Root;
let hospedeiro: HTMLDivElement;
/** Os corpos que a tela mandou para `/assinatura/signatario`. */
let pedidos: unknown[];
/**
 * O bloqueio que o servidor manda na linha da MAURA, para o teste trocar.
 *
 * ⚠️ ELE VEM DO SERVIDOR, E A TELA NÃO O RECALCULA. `reenvioIndisponivel` virou motivo + frase em
 * 01/10/2026, porque um booleano com uma frase só dizia, num dos três motivos, o inverso do que
 * acontecia (`lib/assinatura/recusa-de-reenvio.ts`).
 */
let bloqueio: null | { frase: string; motivo: string };

/**
 * O id na forma MEDIDA: uuid.
 *
 * ⚠️ Medido em produção em 01/10/2026 (só SELECT, projeto bxgukywoxgivlrhjkwjx): das 55 chaves
 * congeladas e das 160 `signer.key` dos 29 envelopes da Clicksign, 55 e 160 têm forma de uuid, ZERO
 * têm "@" e ZERO começam com `tmp:` ou `c2x:`.
 */
const ID_DA_CLICKSIGN = "22222222-2222-4222-8222-222222222222";

const CARD = () => ({
  arrependimento_inicio: null,
  cliente_cpf: "111.222.333-44",
  cliente_nome: "MAURA MARIA PASSOS",
  contratos: [
    {
      criadoEm: "2026-09-23T05:15:36.000Z",
      id: "doc-v1",
      nome: "Contrato - VOC - VOC0306 v1.pdf",
      versao: 1,
    },
  ],
  enterprise_codigo: "VOC",
  enterprise_nome: "Vale do Ouro",
  estagio: "assinatura",
  estagio_desde: "2026-09-23T05:19:27.000Z",
  id: "card-maura",
  indeferido_motivo: null,
  indeferido_observacao: null,
  indeferido_por_nome: null,
  observacao: null,
  proposta_id: "venda-maura",
  tipo: "contrato",
  unidade: "Quadra 03 · Lote 06",
});

const signatario = (patch: Record<string, unknown>) => ({
  assinouEm: null,
  comecouEm: null,
  convite: "sem_noticia",
  conviteDetalhe: null,
  conviteQuando: null,
  papel: "comprador",
  ...patch,
});

const ASSINATURA = () => ({
  assinaram: 0,
  diario: [],
  envelope: {
    documentoId: "doc-v1",
    envelopeId: "3c277f58-1a53-4ed0-9761-906b95ecfb28",
    estado: "aguardando",
    signatarios: [
      // A linha dos 70: a `chave` é a `signer.key` do webhook, que É o signer id do reenvio.
      signatario({
        chave: ID_DA_CLICKSIGN,
        // ⚠️ CONVITE DEVOLVIDO: é assim que a linha ganha TAMBÉM o botão "Corrigir o e-mail", que é o
        // gesto irreversível — e o que o envelope encerrado tem de barrar junto.
        convite: "nao_entregue",
        conviteDetalhe: "550 5.1.1 The email account that you tried to reach does not exist",
        email: "maura@exemplo.test",
        nome: "MAURA MARIA PASSOS",
        reenvioIndisponivel: bloqueio,
      }),
      // A linha que o "@" apagava: quem só existe na lista congelada do envio.
      signatario({
        chave: "so-na-lista@exemplo.test",
        email: "so-na-lista@exemplo.test",
        nome: "HUBER DE ANDRADE LUSTOSA JUNIOR",
        papel: "testemunha",
        reenvioIndisponivel: { frase: RECUSA_DE_REENVIO_SEM_ID, motivo: "sem_id_na_clicksign" },
      }),
    ],
  },
  total: 2,
});

function responder(url: string, init?: RequestInit): { corpo: unknown; status: number } {
  if (url.includes("/assinatura/signatario")) {
    pedidos.push(JSON.parse(String(init?.body ?? "{}")));
    return { corpo: { data: { ok: true } }, status: 200 };
  }
  if (url.includes("/trabalho?id=")) {
    return {
      corpo: {
        data: {
          analise: null,
          assinatura: ASSINATURA(),
          card: CARD(),
          envelopeVivo: {
            conferido: true,
            estado: "aguardando",
            id: "3c277f58-1a53-4ed0-9761-906b95ecfb28",
            rotulo: "Aguardando assinatura",
          },
          podeEmitir: true,
        },
      },
      status: 200,
    };
  }
  return { corpo: { data: { documentos: [], eventos: [], mensagens: [] } }, status: 200 };
}

async function esperarPromessas(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** A linha (o `li`) de um signatário, pelo nome dele. */
function linhaDe(nome: string): HTMLLIElement | undefined {
  return Array.from(hospedeiro.querySelectorAll<HTMLLIElement>("li")).find((l) =>
    l.textContent?.includes(nome),
  );
}

function botaoDeReenvio(nome: string): HTMLButtonElement | null {
  return (
    linhaDe(nome)?.querySelector<HTMLButtonElement>(
      'button[aria-label="Reenviar o convite para este e-mail"]',
    ) ?? null
  );
}

async function montar(): Promise<void> {
  act(() => {
    raiz.render(
      <TelaDeTrabalho aoFechar={() => undefined} aoMudar={() => undefined} trabalhoId="card-maura" />,
    );
  });
  await esperarPromessas();
}

beforeEach(() => {
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  pedidos = [];
  bloqueio = null;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) =>
      Promise.resolve(
        (() => {
          const { corpo, status } = responder(String(url), init);
          return new Response(JSON.stringify(corpo), {
            headers: { "content-type": "application/json" },
            status,
          });
        })(),
      ),
    ),
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

describe("a faixa de ações do signatário na tela da Têmis", () => {
  // ⚠️ ESTE É O TESTE DO PEDIDO DO LUCAS. Com a `chave` sendo o próprio e-mail, a faixa inteira
  // sumia: sem botão, sem tooltip, sem frase. Agora o botão está lá, DESABILITADO, com a explicação.
  it("chave que é um e-mail NÃO apaga a faixa: o botão fica desabilitado, com a frase", async () => {
    await montar();

    const botao = botaoDeReenvio("HUBER DE ANDRADE LUSTOSA JUNIOR");
    expect(botao, "o botão de reenviar da linha cuja chave é o e-mail").toBeTruthy();
    expect(botao?.disabled).toBe(true);
    expect(botao?.title).toBe(RECUSA_DE_REENVIO_SEM_ID);
  });

  // ⚠️ E QUEM TEM A KEY DO WEBHOOK CLICA. São 68 pessoas nos 18 envelopes vivos sem chave congelada
  // (medido em 01/10/2026, só SELECT), e todas elas têm `signer.key` no payload.
  //
  // ⚠️ E O PEDIDO NÃO LEVA E-MAIL NENHUM. Ele chegou a levar (`emailDoSignatario`), como "ajuda" para
  // o servidor casar a linha do quadro congelado, e era o ÚNICO ponto em que o navegador influenciava
  // a trava de quem já assinou: quando o payload do webhook traz a `signer.key` SEM e-mail, era o
  // endereço do navegador que escolhia QUAL linha do quadro era auditada. Quem diz de quem é a linha
  // é o nosso quadro (pela `chave`) ou o payload deste envelope (pela `signer.key`).
  it("chave com forma de id da Clicksign manda o reenvio, e SEM e-mail no corpo", async () => {
    await montar();

    const botao = botaoDeReenvio("MAURA MARIA PASSOS");
    expect(botao?.disabled).toBe(false);

    await act(async () => {
      botao?.click();
    });
    await esperarPromessas();

    expect(pedidos).toEqual([
      {
        acao: "reenviar",
        envelopeId: "3c277f58-1a53-4ed0-9761-906b95ecfb28",
        signerId: ID_DA_CLICKSIGN,
      },
    ]);
  });

  /**
   * ⚠️ ENVELOPE ENCERRADO NÃO OFERECE GESTO NENHUM, NEM REENVIO NEM "CORRIGIR O E-MAIL".
   *
   * Medido em produção em 01/10/2026 (só SELECT, projeto bxgukywoxgivlrhjkwjx): 3 dos 21 envelopes da
   * Clicksign sem nenhuma `chave` no quadro estão `cancelado`, e dentro deles 16 linhas têm
   * `signer.key` em forma de uuid, linha no quadro e `assinado_em` nulo. O servidor recusa as duas
   * ações com 409, e a tela precisa dizer isso ANTES do clique: *"O BOTÃO QUE TENTA E FALHA É PIOR DO
   * QUE O BOTÃO DESABILITADO"* (`PropostasPanel.tsx`).
   */
  it("envelope encerrado desabilita o reenvio E a correção de e-mail, com a frase do envelope", async () => {
    const frase = fraseDeEnvelopeEncerrado("cancelado", "3c277f58-1a53-4ed0-9761-906b95ecfb28");
    bloqueio = { frase, motivo: "envelope_encerrado" };
    await montar();

    const reenviar = botaoDeReenvio("MAURA MARIA PASSOS");
    expect(reenviar?.disabled).toBe(true);
    expect(reenviar?.title).toBe(frase);

    const corrigir = Array.from(
      linhaDe("MAURA MARIA PASSOS")?.querySelectorAll<HTMLButtonElement>("button") ?? [],
    ).find((b) => b.textContent?.includes("Corrigir o e-mail"));
    expect(corrigir, "o botão de corrigir o e-mail da linha com convite devolvido").toBeTruthy();
    expect(corrigir?.disabled).toBe(true);
    expect(corrigir?.title).toBe(frase);
  });
});
