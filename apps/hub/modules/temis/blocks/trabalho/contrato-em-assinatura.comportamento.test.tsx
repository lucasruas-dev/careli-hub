// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O CONTRATO CONTINUA À MÃO DEPOIS DO ENVIO PARA ASSINATURA.
//
// Nívea, 24/09/2026: *"Não consigo visualizar o contrato depois que enviamos para assinatura. Se
// precisamos validar alguma informação, não conseguimos ver."*
//
// ⚠️ AFIRMAÇÃO EM CAIXA ALTA: O DOCUMENTO SEMPRE ESTEVE NO BANCO; QUEM SUMIA ERA O BOTÃO. Medido em
// 24/09/2026 no card da MAURA MARIA PASSOS (Vale do Ouro VOC, Quadra 03 · Lote 06, trabalho
// `23dfb1e0-ef0f-4667-913a-50f7c3c27756`): `hercules_documentos` tem a linha
// `cd4325c1-bda5-4aa6-83a7-f6886feed5e7`, tipo `contrato`, 6.751.759 bytes, e o objeto existe no
// bucket `apolo-documents`. Nos 5 cards em "Em assinatura" de hoje, 5 têm contrato guardado e
// envelope. A lista de versões e o visor moravam dentro de `EtapaDoContrato`, que só desenha em
// `estagio === "contrato"`.
//
// A montagem é a de `aviso-do-hercules.comportamento.test.tsx`.

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

let raiz: Root;
let hospedeiro: HTMLDivElement;
let contratos: Array<Record<string, unknown>>;
let documentoDoEnvelope: null | string;
/** A etapa em que o card abre. O caminho do contrato é analise → contrato → assinatura →
 *  prazo_legal → faturado, e o PDF tem de continuar à mão nas TRÊS últimas. */
let estagio: string;
/** As URLs de `/contrato/gerar?documento=` que a tela pediu. */
let abertos: string[];

const V1 = {
  criadoEm: "2026-09-23T05:15:36.000Z",
  id: "doc-v1",
  nome: "Contrato - VOC - VOC0306 - MAURA MARIA PASSOS - 2026-09-23 v1.pdf",
  versao: 1,
};
const V2 = {
  criadoEm: "2026-09-24T10:00:00.000Z",
  id: "doc-v2",
  nome: "Contrato - VOC - VOC0306 - MAURA MARIA PASSOS - 2026-09-24 v2.pdf",
  versao: 2,
};

const CARD = () => ({
  arrependimento_inicio: null,
  cliente_cpf: "111.222.333-44",
  cliente_nome: "MAURA MARIA PASSOS",
  contratos,
  enterprise_codigo: "VOC",
  enterprise_nome: "Vale do Ouro",
  estagio,
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

const ASSINATURA = () => ({
  assinaram: 1,
  diario: [],
  envelope: {
    documentoId: documentoDoEnvelope,
    envelopeId: "3c277f58-1a53-4ed0-9761-906b95ecfb28",
    estado: "aguardando",
    signatarios: [
      {
        assinouEm: "2026-09-23T17:48:00.000Z",
        chave: "s-1",
        comecouEm: null,
        convite: "sem_noticia",
        conviteDetalhe: null,
        conviteQuando: null,
        email: "huber@exemplo.com",
        nome: "HUBER DE ANDRADE LUSTOSA JUNIOR",
        papel: "vendedora",
      },
    ],
  },
  total: 11,
});

function responder(url: string): { corpo: unknown; status: number } {
  if (url.includes("/contrato/gerar?documento=")) {
    abertos.push(url);
    return { corpo: { data: { nome: "Contrato", url: "https://storage/assinada.pdf" } }, status: 200 };
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

function botaoQueContem(trecho: string): HTMLButtonElement | undefined {
  return Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
    b.textContent?.includes(trecho),
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
  contratos = [V1];
  documentoDoEnvelope = V1.id;
  estagio = "assinatura";
  abertos = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      Promise.resolve(
        (() => {
          const { corpo, status } = responder(String(url));
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

describe("em Em assinatura o contrato continua à mão", () => {
  it("a etapa oferece o contrato que foi para a Clicksign, e o clique pede a URL assinada", async () => {
    await montar();

    const botao = botaoQueContem("foi para a Clicksign");
    expect(botao, "o botão do contrato enviado").toBeTruthy();
    expect(botao?.textContent).toContain("versão 1");

    await act(async () => {
      botao?.click();
    });
    await esperarPromessas();

    // ⚠️ `modo=ver` OU O IFRAME BAIXA O ARQUIVO em vez de desenhar.
    expect(abertos).toHaveLength(1);
    expect(abertos[0]).toContain("documento=doc-v1");
    expect(abertos[0]).toContain("modo=ver");
  });

  it("a tela não promete o documento ASSINADO: ele não volta para o Panteon", async () => {
    await montar();
    expect(hospedeiro.textContent).toContain("não volta para o Panteon");
  });

  it("gerou v2 depois do envio: a tela avisa que quem assina está com a v1", async () => {
    contratos = [V1, V2];
    documentoDoEnvelope = V1.id;
    await montar();

    expect(hospedeiro.textContent).toContain("NÃO foi para a assinatura");
    // O botão em destaque continua sendo o ENVIADO, e não o mais recente.
    expect(botaoQueContem("foi para a Clicksign")?.textContent).toContain("versão 1");
  });

  it("envelope antigo, sem documento gravado: abre a geração mais recente e diz que não sabe qual foi", async () => {
    contratos = [V1, V2];
    documentoDoEnvelope = null;
    await montar();

    expect(hospedeiro.textContent).toContain("O envelope não diz qual versão levou");
    expect(botaoQueContem("versão 2"), "o botão da geração mais recente").toBeTruthy();
    expect(botaoQueContem("foi para a Clicksign")).toBeUndefined();
  });

  it("card sem contrato guardado: a etapa diz isso em vez de ficar muda", async () => {
    contratos = [];
    documentoDoEnvelope = null;
    await montar();
    expect(hospedeiro.textContent).toContain("Não há versão guardada nesta venda");
  });

  // ⚠️ AS QUATRO ETAPAS EM QUE O CONTRATO JÁ EXISTE, E NÃO SÓ A PRIMEIRA. O card de contrato segue
  // analise → contrato → assinatura → prazo_legal → faturado, e pode ser INDEFERIDO de qualquer uma
  // delas; o botão morava em `EtapaDoContrato` e sumia a partir da terceira. "Concluído" é
  // justamente onde se vai procurar um contrato para conferir um dado, e "Indeferido" é onde mais se
  // abre o papel para entender o motivo.
  //
  // ⚠️ MEDIDO EM 25/09/2026: `select t.estagio, count(*), count(*) filter (where exists (select 1
  // from hercules_documentos d where d.proposta_id = t.proposta_id and d.tipo = 'contrato')) from
  // temis_trabalhos t where t.tipo = 'contrato' group by 1` devolve 7 em análise (0 com contrato),
  // 1 em contrato (1), 5 em assinatura (5) e 3 em INDEFERIDO (0 com contrato). É por isso mesmo que
  // a etapa entra junto: o buraco só apareceria no primeiro que chegasse com papel guardado.
  it.each(["assinatura", "prazo_legal", "faturado", "indeferido"])(
    "em %s o contrato continua à mão",
    async (etapa) => {
      estagio = etapa;
      await montar();

      const botao = botaoQueContem("versão 1");
      expect(botao, `o botão do contrato em ${etapa}`).toBeTruthy();

      await act(async () => {
        botao?.click();
      });
      await esperarPromessas();

      expect(abertos).toHaveLength(1);
      expect(abertos[0]).toContain("documento=doc-v1");
    },
  );

  it("em indeferido SEM contrato guardado, a tela não promete PDF nenhum", async () => {
    estagio = "indeferido";
    contratos = [];
    documentoDoEnvelope = null;
    await montar();

    expect(botaoQueContem("versão 1")).toBeUndefined();
    expect(hospedeiro.textContent).toContain("Não há versão guardada nesta venda");
  });

  // ⚠️ A FRASE QUE NÃO PROMETE O ASSINADO TEM DE VALER NAS QUATRO. O documento assinado NÃO volta
  // para o Panteon (nenhuma rota baixa o arquivo da Clicksign): é esta frase que impede a Nívea de
  // abrir o PDF esperando encontrar rubrica.
  it.each(["assinatura", "prazo_legal", "faturado", "indeferido"])(
    "em %s a tela continua NÃO prometendo o documento assinado",
    async (etapa) => {
      estagio = etapa;
      await montar();
      expect(hospedeiro.textContent).toContain("não volta para o Panteon");
    },
  );
});
