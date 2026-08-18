import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AVISOS_DA_FONTE } from "./d4sign-assinaturas";
import { limparDivergencias } from "./d4sign-divergencias";
import { montarQuadroComD4Sign } from "./d4sign-quadro";
import type { LinhaAssinatura } from "./painel-assinatura";
import type { ContratoVivo } from "@/lib/apolo/incorporador/assinaturas";
import { limparCacheD4Sign } from "@/lib/guardian/d4sign-consulta";

// O QUE ESTE ARQUIVO PROTEGE: que a D4Sign mande de fato no que a TELA mostra — e não só no que a
// função de conciliação devolve. A conciliação isolada tem os testes dela em
// `d4sign-assinaturas.test.ts`; aqui a pergunta é outra, e é a que interessa ao dono: depois de
// montar o quadro, o contrato cancelado sumiu da cobrança? o aviso da fonte chegou na linha?

const AR_ID = 5000;

function linha(parcial: Partial<LinhaAssinatura> = {}): LinhaAssinatura {
  return {
    assinadoEm: null,
    assinou: false,
    contrato: 900,
    degrau: 1,
    // 30 dias sem assinar: bem além dos 7 do prazo do comprador. É o que faz a linha cair em
    // `compradorEmAtraso` se ninguém a tirar da conta.
    diasDesdeEnvio: 30,
    email: "comprador@exemplo.com.br",
    emp: "VAL",
    envio: "2026-07-01",
    lote: "1",
    perfil: "Comprador",
    prazo: null,
    quadra: "A",
    situacao: "aguardando",
    un: "VALA1",
    usuario: "José da Silva",
    valor: 100000,
    ...parcial,
  };
}

/** As duas linhas de um contrato com fila de verdade (dois degraus): é o que faz `fila` existir. */
const LINHAS = [
  linha({ assinadoEm: "2026-07-02", assinou: true, degrau: 1, email: "imob@exemplo.com", perfil: "Imobiliária", usuario: "Imobiliária Fulana" }),
  linha({ degrau: 2 }),
];

const VIVOS: ContratoVivo[] = [
  {
    arId: AR_ID,
    ficha: {
      comprador: "José da Silva",
      empreendimento: "VAL",
      faturadoEm: null,
      imobiliaria: "Imobiliária Fulana",
      temContrato: false,
      unidade: "VALA1",
      unitId: 77,
      valorTabela: 100000,
    },
    geradoEm: null,
  },
];

const AR_POR_ENVIO = new Map([[900, AR_ID]]);

/** Resposta do `/documents/{uuid}/list` com o statusId pedido e um signatário que não assinou. */
function respostaD4Sign(statusId: string, statusName: string) {
  return async () => ({
    json: async () => [
      {
        list: [
          {
            email: "comprador@exemplo.com.br",
            key_signer: "KEY-1",
            nomenclatura: "Assinar como parte",
            signed: "0",
            user_document: "12345678901",
            user_name: "José da Silva",
          },
        ],
        statusId,
        statusName,
        uuidDoc: "doc-a",
      },
    ],
    ok: true,
    status: 200,
  });
}

describe("montarQuadroComD4Sign", () => {
  const fetchOriginal = globalThis.fetch;

  beforeEach(() => {
    limparCacheD4Sign();
    limparDivergencias();
    process.env.D4SIGN_TOKEN_API = "token-de-teste";
    process.env.D4SIGN_CRYPT_KEY = "chave-de-teste";
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    limparCacheD4Sign();
    limparDivergencias();
    vi.restoreAllMocks();
  });

  it("CONTROLE: documento vivo continua cobrando — atraso, pendência e fila", async () => {
    // Sem este teste o de baixo não prova nada: um quadro vazio passaria nos dois.
    globalThis.fetch = respostaD4Sign("3", "Aguardando Assinaturas") as unknown as typeof fetch;

    const quadro = await montarQuadroComD4Sign({
      arPorEnvio: AR_POR_ENVIO,
      envios: [{ csId: 900, statusC2x: 7, uuidDoc: "doc-a" }],
      linhas: LINHAS,
      vivos: VIVOS,
    });

    expect(quadro.kpis.compradorEmAtraso).toBe(1);
    expect(quadro.kpis.compradorPendente).toBe(1);
    expect(quadro.fila).toHaveLength(2);
    expect(quadro.kpis.aguardandoEmissao).toBe(0);
    expect(quadro.unidades.map((u) => u.situacao)).toEqual(["em-assinatura"]);
  });

  it("documento CANCELADO no D4Sign some da cobrança: nem atraso, nem pendência, nem fila", async () => {
    // O caso do acervo: 1.161 cancelados (30%), e o filtro do C2X (`status <> 6`) não pega os que
    // estão com o status 7 furado — que são justamente os que a D4Sign diz cancelados. Sem este
    // ramo, cada um deles entra na fila do gargalo e, passados 7 dias, cobra assinatura de
    // contrato morto.
    globalThis.fetch = respostaD4Sign("6", "Cancelado") as unknown as typeof fetch;

    const quadro = await montarQuadroComD4Sign({
      arPorEnvio: AR_POR_ENVIO,
      envios: [{ csId: 900, statusC2x: 7, uuidDoc: "doc-a" }],
      linhas: LINHAS,
      vivos: VIVOS,
    });

    expect(quadro.cancelados).toEqual([900]);
    expect(quadro.kpis.compradorEmAtraso).toBe(0);
    expect(quadro.kpis.compradorPendente).toBe(0);
    expect(quadro.fila).toEqual([]);
    // E ninguém está "na vez" de assinar um contrato cancelado.
    expect(quadro.assinantes).toEqual([]);
  });

  it("a venda do contrato cancelado NÃO some da tela: volta como contrato a emitir", async () => {
    // A armadilha do meio do caminho: tirar as linhas e esquecer o `arPorEnvio` faria a unidade
    // sumir inteira — sem linha ela não entra na lista, e com o `ar` ainda apontando para o envio
    // ela também não cai em "aguardando emissão".
    globalThis.fetch = respostaD4Sign("6", "Cancelado") as unknown as typeof fetch;

    const quadro = await montarQuadroComD4Sign({
      arPorEnvio: AR_POR_ENVIO,
      envios: [{ csId: 900, statusC2x: 7, uuidDoc: "doc-a" }],
      linhas: LINHAS,
      vivos: VIVOS,
    });

    expect(quadro.kpis.aguardandoEmissao).toBe(1);
    expect(quadro.unidades).toHaveLength(1);
    expect(quadro.unidades[0]?.situacao).toBe("aguardando-emissao");
    expect(quadro.unidades[0]?.unidade).toBe("VALA1");
    // Os dados do contrato continuam na linha: valor, imobiliária, o unitId do PDF.
    expect(quadro.unidades[0]?.contrato?.unitId).toBe(77);
  });

  it("envio sem assinante registrado também sai quando o documento está cancelado", async () => {
    globalThis.fetch = respostaD4Sign("6", "Cancelado") as unknown as typeof fetch;

    const quadro = await montarQuadroComD4Sign({
      arPorEnvio: AR_POR_ENVIO,
      envios: [{ csId: 900, uuidDoc: "doc-a" }],
      linhas: [],
      semAssinante: [{ csId: 900, emp: "VAL", enviadoEm: "2026-07-01", un: "VALA1" }],
      vivos: VIVOS,
    });

    expect(quadro.unidades.map((u) => u.situacao)).toEqual(["aguardando-emissao"]);
    expect(quadro.kpis.unidadesComEnvio).toBe(0);
  });

  it("a D4Sign corrige a assinatura que o C2X não registrou, e o KPI acompanha", async () => {
    globalThis.fetch = (async () => ({
      json: async () => [
        {
          list: [
            {
              email: "comprador@exemplo.com.br",
              key_signer: "KEY-1",
              sign_info: { date_signed_atom: "2026-07-05T15:48:06-03:00" },
              signed: "1",
              user_name: "José da Silva",
            },
            {
              email: "imob@exemplo.com",
              key_signer: "KEY-2",
              sign_info: { date_signed_atom: "2026-07-02T10:00:00-03:00" },
              signed: "1",
              user_name: "Imobiliária Fulana",
            },
          ],
          statusId: "4",
          statusName: "Finalizado",
          uuidDoc: "doc-a",
        },
      ],
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;

    const quadro = await montarQuadroComD4Sign({
      arPorEnvio: AR_POR_ENVIO,
      envios: [{ csId: 900, statusC2x: 7, uuidDoc: "doc-a" }],
      linhas: LINHAS,
      vivos: VIVOS,
    });

    // O C2X dizia que o comprador não tinha assinado. A D4Sign diz que assinou — e é ela que manda.
    expect(quadro.kpis.compradorEmAtraso).toBe(0);
    expect(quadro.kpis.compradorOk).toBe(1);
    expect(quadro.kpis.unidadesTotalmenteAssinadas).toBe(1);
    expect(quadro.unidades[0]?.situacao).toBe("assinado");
    expect(quadro.unidades[0]?.fonte).toBe("d4sign");
    expect(quadro.unidades[0]?.aviso).toBeNull();
    expect(quadro.resumoDaFonte.assinaturasCorrigidas).toBe(1);
  });

  it("D4Sign fora do ar: a tela NÃO some, a linha vem marcada e o aviso chega junto", async () => {
    globalThis.fetch = (async () => {
      throw new Error("fora do ar");
    }) as unknown as typeof fetch;

    const quadro = await montarQuadroComD4Sign({
      arPorEnvio: AR_POR_ENVIO,
      envios: [{ csId: 900, uuidDoc: "doc-a" }],
      linhas: LINHAS,
      vivos: VIVOS,
    });

    expect(quadro.unidades).toHaveLength(1);
    // O dado do C2X seguiu para a tela — marcado, e com o aviso que diz o que pode estar errado.
    expect(quadro.unidades[0]?.fonte).toBe("c2x-legado");
    expect(quadro.unidades[0]?.aviso).toBe(AVISOS_DA_FONTE.indisponivel);
    expect(quadro.avisoDaFonte).toBe(AVISOS_DA_FONTE.indisponivel);
    // E o aviso do TETO continua sendo outro campo: um não pode esconder o outro.
    expect(quadro.aviso).toBeNull();
  });

  it("contrato que nunca saiu para assinar não carrega aviso de fonte nenhum", async () => {
    const espiao = vi.fn(async () => {
      throw new Error("não era para tocar na rede");
    });
    globalThis.fetch = espiao as unknown as typeof fetch;

    const quadro = await montarQuadroComD4Sign({
      arPorEnvio: new Map(),
      envios: [],
      linhas: [],
      vivos: VIVOS,
    });

    expect(espiao).not.toHaveBeenCalled();
    expect(quadro.unidades[0]?.situacao).toBe("aguardando-emissao");
    expect(quadro.unidades[0]?.aviso).toBeNull();
    // Nenhuma chamada, nenhuma queda: o banner fica apagado.
    expect(quadro.avisoDaFonte).toBeNull();
  });
});
