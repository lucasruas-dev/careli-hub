import { describe, expect, it } from "vitest";

import type { SituacaoDaUnidade, SituacaoDasUnidades, UnidadeComSituacao } from "../situacao-da-unidade";

import { contarPublicas, corPublica, situacaoPublicaDoLote } from "./situacao-publica";

// O QUE ESTE TESTE PROTEGE: verde e uma AFIRMACAO publica, "este lote esta a venda", feita num link
// que circula no WhatsApp, para gente que nao tem login. A situacao vem da regua unica
// (`situacao-da-unidade.ts`); aqui se prova que o espelho so a traduz em duas cores, e que toda
// duvida sai azul.

const TODAS: SituacaoDaUnidade[] = [
  "disponivel",
  "reservado",
  "reservada",
  "proposta",
  "contrato",
  "assinatura",
  "faturado",
  "vendida",
  "bloqueada",
];

describe("cor publica de uma situacao da regua unica", () => {
  it("verde se e so se a regua diz livre", () => {
    for (const s of TODAS) {
      expect(corPublica(s)).toBe(s === "disponivel" ? "disponivel" : "indisponivel");
    }
  });

  // ⚠️ FAIL-CLOSED. Nao conseguir ler nunca vira verde.
  it("azul quando a situacao nao veio", () => {
    expect(corPublica(undefined)).toBe("indisponivel");
  });
});

type Terreno = { id: string; situacao: SituacaoDaUnidade };

/**
 * Uma leitura da regua unica montada a mao: cada linha aponta para a unidade viva que responde por
 * ela. Os mapas por codigo e por id do legado vem PREENCHIDOS de proposito (codigo = id da viva,
 * legado = `c2x-<id>`), para os testes provarem que o espelho nao cai neles.
 */
function porLinha(linhas: Record<string, Terreno>): SituacaoDasUnidades {
  const leitura: SituacaoDasUnidades = {
    porCodigo: new Map(),
    porLinha: new Map(),
    porOrigemC2x: new Map(),
    terreno: () => undefined,
    unidades: [],
  };
  const vivas = new Map<string, UnidadeComSituacao>();
  for (const [linhaId, t] of Object.entries(linhas)) {
    const viva: UnidadeComSituacao = vivas.get(t.id) ?? {
      codigo: t.id,
      enterpriseId: "37",
      id: t.id,
      lote: null,
      origemC2xId: `c2x-${t.id}`,
      quadra: null,
      situacao: t.situacao,
    };
    vivas.set(t.id, viva);
    leitura.porLinha.set(linhaId, viva);
    leitura.porCodigo.set(viva.codigo.toUpperCase(), viva);
    if (viva.origemC2xId) leitura.porOrigemC2x.set(viva.origemC2xId, viva);
  }
  leitura.unidades = [...vivas.values()];
  return leitura;
}

describe("a cor de um quadrado do espelho", () => {
  it("uma linha so: a cor da regua unica", () => {
    const livre = porLinha({ VOC0105: { id: "VOC0105", situacao: "disponivel" } });
    expect(situacaoPublicaDoLote([{ doPai: false, id: "VOC0105" }], livre)).toBe("disponivel");

    const emContrato = porLinha({ VOC0105: { id: "VOC0105", situacao: "contrato" } });
    expect(situacaoPublicaDoLote([{ doPai: false, id: "VOC0105" }], emContrato)).toBe("indisponivel");
  });

  // ⚠️ O PAI APONTA PARA A GLEBA (espelho_de), e a regua unica ja devolve a mesma resposta para as
  // duas linhas. O cadastro parado do pai nao tem voz propria.
  it("pai que aponta para a gleba: o terreno da gleba responde pelas duas linhas", () => {
    const gleba = { id: "VOC0305", situacao: "reservado" as const };
    expect(
      situacaoPublicaDoLote(
        [
          { doPai: true, id: "VLO0305" },
          { doPai: false, id: "VOC0305" },
        ],
        porLinha({ VLO0305: gleba, VOC0305: gleba }),
      ),
    ).toBe("indisponivel");
  });

  // ⚠️ OS LOTES QUE VOC E VOR DISPUTAM (migration 0162). O pai aponta para a gleba que vende; a
  // linha bloqueada da outra carteira e outra unidade para a regua unica e nao apaga o verde.
  it("pai que aponta para a gleba que vende: a linha bloqueada da outra carteira nao conta", () => {
    const vor = { id: "VOR0410", situacao: "disponivel" as const };
    expect(
      situacaoPublicaDoLote(
        [
          { doPai: true, id: "VLO0410" },
          { doPai: false, id: "VOC0410" },
          { doPai: false, id: "VOR0410" },
        ],
        porLinha({
          VLO0410: vor,
          VOC0410: { id: "VOC0410", situacao: "bloqueada" },
          VOR0410: vor,
        }),
      ),
    ).toBe("disponivel");
  });

  // Os 83 lotes da Lagoa Bonita que so existem no pai: ele responde por si.
  it("pai sem gleba responde pelo proprio terreno", () => {
    expect(
      situacaoPublicaDoLote(
        [{ doPai: true, id: "LABC0901" }],
        porLinha({ LABC0901: { id: "LABC0901", situacao: "disponivel" } }),
      ),
    ).toBe("disponivel");
  });

  // ⚠️ SEM O PONTEIRO, o quadrado junta linhas que o Panteon nao diz serem o mesmo terreno. Se uma
  // delas esta em processo, o lote nao pode sair verde so porque a outra diz livre.
  it("linhas de terrenos diferentes sem ponteiro: verde so se todas estiverem livres", () => {
    const linhas = [
      { doPai: true, id: "PAI01" },
      { doPai: false, id: "FIL01" },
    ];
    expect(
      situacaoPublicaDoLote(
        linhas,
        porLinha({
          FIL01: { id: "FIL01", situacao: "proposta" },
          PAI01: { id: "PAI01", situacao: "disponivel" },
        }),
      ),
    ).toBe("indisponivel");
    expect(
      situacaoPublicaDoLote(
        linhas,
        porLinha({
          FIL01: { id: "FIL01", situacao: "disponivel" },
          PAI01: { id: "PAI01", situacao: "disponivel" },
        }),
      ),
    ).toBe("disponivel");
  });

  // ⚠️ FAIL-CLOSED: linha que a regua unica nao trouxe, ou quadrado sem linha nenhuma.
  it("azul quando alguma linha do quadrado nao tem resposta da regua unica", () => {
    expect(
      situacaoPublicaDoLote(
        [
          { doPai: true, id: "VLO0105" },
          { doPai: false, id: "VOC0105" },
        ],
        porLinha({ VOC0105: { id: "VOC0105", situacao: "disponivel" } }),
      ),
    ).toBe("indisponivel");
    expect(situacaoPublicaDoLote([], porLinha({}))).toBe("indisponivel");
  });

  // ⚠️ A BUSCA E SO PELO ID DA LINHA. Linha que a regua nao leu nao herda a resposta de outra que
  // por acaso tenha o mesmo codigo: o processo pendurado nela nao foi lido.
  it("linha desconhecida nao cai para o codigo nem para o id do legado", () => {
    const leitura = porLinha({ VOC0105: { id: "VOC0105", situacao: "disponivel" } });
    // "VOC0105" existe em `porCodigo`; a linha "c2x-VOC0105" existiria em `porOrigemC2x`.
    leitura.porLinha.delete("VOC0105");
    expect(situacaoPublicaDoLote([{ doPai: false, id: "VOC0105" }], leitura)).toBe("indisponivel");
    expect(situacaoPublicaDoLote([{ doPai: false, id: "c2x-VOC0105" }], leitura)).toBe("indisponivel");
  });
});

// ⚠️ O LOTE QUE EXISTE EM DUAS GLEBAS (VOC e VOR no Vale do Ouro). O pai aponta para a VOR; a VOC
// da mesma quadra e lote segue com a linha dela. Dono em QUALQUER uma das duas: azul.
describe("o lote de duas glebas", () => {
  const quadrado = [
    { doPai: true, id: "VLO0410" },
    { doPai: false, id: "VOC0410" },
    { doPai: false, id: "VOR0410" },
  ];

  // Quando a regua reconhece a familia do pai, ela ja soma a proposta da VOC no terreno: a VOR para
  // onde o pai aponta responde "proposta" sozinha.
  it("regua que juntou o terreno: a VOR responde pela proposta da VOC, azul", () => {
    const vor = { id: "VOR0410", situacao: "proposta" as const };
    expect(
      situacaoPublicaDoLote(
        quadrado,
        porLinha({ VLO0410: vor, VOC0410: { id: "VOC0410", situacao: "proposta" }, VOR0410: vor }),
      ),
    ).toBe("indisponivel");
  });

  // O cinto: gleba para onde nenhuma linha do pai aponta fica fora da familia na regua, e a VOR diz
  // livre. O quadrado do espelho junta as duas linhas pela quadra e lote, e o dono da VOC aparece.
  it("regua que nao juntou: proposta, reserva ou venda na VOC ainda deixam o lote azul", () => {
    const vor = { id: "VOR0410", situacao: "disponivel" as const };
    for (const situacao of ["reservado", "reservada", "proposta", "contrato", "assinatura", "faturado", "vendida"] as const) {
      expect(
        situacaoPublicaDoLote(quadrado, porLinha({ VLO0410: vor, VOC0410: { id: "VOC0410", situacao }, VOR0410: vor })),
      ).toBe("indisponivel");
    }
  });

  // So o pai cala uma linha, e so a linha de gleba com o cadastro bloqueado (a forma da 0162).
  it("linha do PAI bloqueada nao cala, mesmo com outra linha do pai apontando para a gleba", () => {
    const vor = { id: "VOR0410", situacao: "disponivel" as const };
    expect(
      situacaoPublicaDoLote(
        [
          { doPai: true, id: "VLO0410" },
          { doPai: true, id: "VLO0410B" },
        ],
        porLinha({ VLO0410: vor, VLO0410B: { id: "VLO0410B", situacao: "bloqueada" } }),
      ),
    ).toBe("indisponivel");
  });

  it("a carteira bloqueada so cala quando o pai aponta para outra unidade", () => {
    // Sem ponteiro do pai, a linha bloqueada da gleba vale como qualquer outra: azul.
    expect(
      situacaoPublicaDoLote(
        [
          { doPai: true, id: "PAI01" },
          { doPai: false, id: "FIL01" },
        ],
        porLinha({ FIL01: { id: "FIL01", situacao: "bloqueada" }, PAI01: { id: "PAI01", situacao: "disponivel" } }),
      ),
    ).toBe("indisponivel");
    // O pai aponta para a propria linha bloqueada: e ela que responde, azul.
    const voc = { id: "VOC0410", situacao: "bloqueada" as const };
    expect(
      situacaoPublicaDoLote(
        [
          { doPai: true, id: "VLO0410" },
          { doPai: false, id: "VOC0410" },
        ],
        porLinha({ VLO0410: voc, VOC0410: voc }),
      ),
    ).toBe("indisponivel");
  });
});

describe("contagem da legenda", () => {
  it("conta as duas cores e nao inventa terceira", () => {
    expect(
      contarPublicas(["disponivel", "indisponivel", "disponivel"]),
    ).toEqual({ disponivel: 2, indisponivel: 1 });
  });

  it("devolve zeros para lista vazia", () => {
    expect(contarPublicas([])).toEqual({ disponivel: 0, indisponivel: 0 });
  });
});
