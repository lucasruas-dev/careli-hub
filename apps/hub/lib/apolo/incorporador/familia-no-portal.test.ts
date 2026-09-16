import { describe, expect, it } from "vitest";

import {
  credenciamentoParaOPortal,
  escopoDaEsteiraDoPortal,
  escopoDoTitular,
  type LinhaDaFamilia,
  recorteComEspelhoDoPai,
  recorteDeLeituraDoPortal,
  SEM_CAD_NO_EMPREENDIMENTO,
} from "./familia-no-portal";

// O cadastro real do Vale do Ouro e do Garden (hercules_empreendimentos, lido em 16/09/2026): o pai
// VLO (35) com os filhos VOL (36, do Lino), VOC (37, do Cecílio) e VOR (41); o Garden (39) sem pai.
const CADASTRO: LinhaDaFamilia[] = [
  { c2xEnterpriseId: "35", id: "vlo", paiId: null },
  { c2xEnterpriseId: "36", id: "vol", paiId: "vlo" },
  { c2xEnterpriseId: "37", id: "voc", paiId: "vlo" },
  { c2xEnterpriseId: "41", id: "vor", paiId: "vlo" },
  { c2xEnterpriseId: "39", id: "gdn", paiId: null },
];

const CATALOGO = [
  { id: "group:Vale do Ouro", stageIds: ["36", "37", "41"] },
  { id: "35", stageIds: ["35"] },
  { id: "39", stageIds: ["39"] },
];

describe("escopoDaEsteiraDoPortal", () => {
  it("o comercial continua lendo a família inteira, como antes", () => {
    const escopo = escopoDaEsteiraDoPortal({
      c2xId: "37",
      cadastro: CADASTRO,
      catalogo: CATALOGO,
      comercial: true,
      permitidos: new Set(["35", "36", "37", "41", "group:Vale do Ouro"]),
    });
    expect([...escopo.abertos].sort()).toEqual(["35", "36", "37", "41", "group:Vale do Ouro"]);
    expect(escopo.soComCpfInteiro).toEqual([]);
  });

  it("o Cecílio (sessão 37 e 39) abre só o 37; o espelho 35 exige o CPF inteiro; o 36 do Lino nunca", () => {
    const escopo = escopoDaEsteiraDoPortal({
      c2xId: "37",
      cadastro: CADASTRO,
      catalogo: CATALOGO,
      comercial: false,
      permitidos: new Set(["37", "39"]),
    });
    expect(escopo.abertos).toEqual(["37"]);
    expect(escopo.soComCpfInteiro).toEqual(["35"]);
    expect(escopoDoTitular(escopo)).not.toContain("36");
    expect(escopoDoTitular(escopo)).not.toContain("41");
    expect([...escopoDoTitular(escopo)].sort()).toEqual(["35", "37"]);
  });

  it("produto sem pai (Garden) fica só com ele mesmo", () => {
    const escopo = escopoDaEsteiraDoPortal({
      c2xId: "39",
      cadastro: CADASTRO,
      catalogo: CATALOGO,
      comercial: false,
      permitidos: new Set(["37", "39"]),
    });
    expect(escopo).toEqual({ abertos: ["39"], soComCpfInteiro: [] });
  });

  it("quem tem o grupo inteiro na sessão ganha o id do grupo nos abertos", () => {
    const escopo = escopoDaEsteiraDoPortal({
      c2xId: "37",
      cadastro: CADASTRO,
      catalogo: CATALOGO,
      comercial: false,
      permitidos: new Set(["36", "37", "41", "group:Vale do Ouro"]),
    });
    expect([...escopo.abertos].sort()).toEqual(["36", "37", "41", "group:Vale do Ouro"]);
    expect(escopo.soComCpfInteiro).toEqual(["35"]);
  });

  it("com o espelho na sessão, ele vira aberto e não se repete", () => {
    const escopo = escopoDaEsteiraDoPortal({
      c2xId: "37",
      cadastro: CADASTRO,
      catalogo: CATALOGO,
      comercial: false,
      permitidos: new Set(["35", "37"]),
    });
    expect([...escopo.abertos].sort()).toEqual(["35", "37"]);
    expect(escopo.soComCpfInteiro).toEqual([]);
  });

  it("empreendimento fora do cadastro fica só com o id da unidade, se a sessão o alcança", () => {
    expect(
      escopoDaEsteiraDoPortal({
        c2xId: "9001",
        cadastro: CADASTRO,
        catalogo: CATALOGO,
        comercial: false,
        permitidos: new Set(["9001"]),
      }),
    ).toEqual({ abertos: ["9001"], soComCpfInteiro: [] });
  });
});

describe("credenciamentoParaOPortal", () => {
  const semCadastro = {
    credenciado: false,
    desde: null,
    entityId: null,
    etapa: null,
    motivo: "Este CPF não tem cadastro no Apolo. Abra a CAD antes de gerar a proposta.",
  };

  it("fora do comercial, 'não tem cadastro no Apolo' vira a mesma frase de 'sem CAD aqui'", () => {
    expect(
      credenciamentoParaOPortal(semCadastro, { comercial: false, cpf: "529.982.247-25" }).motivo,
    ).toBe(SEM_CAD_NO_EMPREENDIMENTO);
  });

  it("o comercial continua recebendo a frase original", () => {
    expect(credenciamentoParaOPortal(semCadastro, { comercial: true, cpf: "52998224725" })).toBe(
      semCadastro,
    );
  });

  it("credenciado, ou com etapa, passa igual", () => {
    const emCredito = {
      credenciado: false,
      desde: "2026-09-02T10:00:00Z",
      entityId: "e1",
      etapa: "credito",
      motivo: "em análise de crédito desde 02/09/2026",
    };
    expect(credenciamentoParaOPortal(emCredito, { comercial: false, cpf: "52998224725" })).toBe(
      emCredito,
    );
  });

  it("CPF incompleto mantém a frase que pede o CPF", () => {
    const incompleto = { ...semCadastro, motivo: "Informe o CPF do titular para conferir o credenciamento." };
    expect(credenciamentoParaOPortal(incompleto, { comercial: false, cpf: "5299" }).motivo).toBe(
      incompleto.motivo,
    );
  });
});

describe("recorteComEspelhoDoPai", () => {
  it("a sessão do VOC (37) lê o 35, onde moram as CADs do Vale do Ouro", () => {
    expect([...recorteComEspelhoDoPai(new Set(["37"]), CADASTRO)].sort()).toEqual(["35", "37"]);
  });

  it("não traz irmão: o 36 do Lino continua fora", () => {
    expect(recorteComEspelhoDoPai(new Set(["37", "39"]), CADASTRO).has("36")).toBe(false);
  });

  it("sem filho no recorte, nada muda", () => {
    expect([...recorteComEspelhoDoPai(new Set(["39"]), CADASTRO)]).toEqual(["39"]);
  });

  it("não altera o conjunto recebido", () => {
    const recorte = new Set(["37"]);
    recorteComEspelhoDoPai(recorte, CADASTRO);
    expect([...recorte]).toEqual(["37"]);
  });

  it("com os empreendimentos da pessoa, o espelho só entra por uma divisão dela que está no recorte", () => {
    const sessao = new Set(["37", "39", "41"]);
    expect([...recorteComEspelhoDoPai(sessao, CADASTRO, ["35", "39"])].sort()).toEqual(["37", "39", "41"]);
    expect([...recorteComEspelhoDoPai(sessao, CADASTRO, ["35", "41"])].sort()).toEqual(["35", "37", "39", "41"]);
  });
});

describe("recorteDeLeituraDoPortal", () => {
  const sessao = new Set(["37", "39", "41"]);

  it("⚠️ portal que opera sozinho: CAD no Garden não abre o espelho do Vale do Ouro", () => {
    const recorte = recorteDeLeituraDoPortal({
      cadastro: CADASTRO,
      daPessoa: { esteira: ["35", "39"], vinculos: [] },
      operaSozinho: true,
      recorte: sessao,
    });
    expect(recorte.has("35")).toBe(false);
  });

  it("portal que opera sozinho: vínculo numa divisão do recorte abre o espelho", () => {
    const recorte = recorteDeLeituraDoPortal({
      cadastro: CADASTRO,
      daPessoa: { esteira: ["35"], vinculos: ["37"] },
      operaSozinho: true,
      recorte: sessao,
    });
    expect(recorte.has("35")).toBe(true);
  });

  it("comercial e portal padrão: o espelho de sempre, sem olhar a pessoa", () => {
    const recorte = recorteDeLeituraDoPortal({
      cadastro: CADASTRO,
      daPessoa: { esteira: ["35", "39"], vinculos: [] },
      operaSozinho: false,
      recorte: sessao,
    });
    expect(recorte.has("35")).toBe(true);
  });
});
