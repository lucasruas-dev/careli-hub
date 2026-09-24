import { describe, expect, it } from "vitest";

import { EMPREENDIMENTOS_DE_BOLETO } from "@/lib/apolo/boletos/empreendimentos";

import {
  CATEGORIA_E_O_EMPREENDIMENTO,
  ED_ESMERALDA,
  MANHATTAN,
  CATEGORIA_PATRIMONIO,
  classificarTitulo,
  empreendimentoDoTexto,
  ED_CRISTAL,
  ED_JADE,
  ED_RUBI,
  GARDEN,
  GIANT_TOWERS,
  GUAIMBE,
  MIRAGE,
  ON_SKY,
  VALE_DO_OURO,
  VALE_DO_SOL,
} from "./categorias";

// Todos os textos abaixo são observações REAIS da base, lidas em 24/09/2026. Inventar exemplo aqui
// é o jeito mais rápido de escrever uma regra que passa no teste e perde cliente na carga.
describe("o empreendimento que o texto livre denuncia", () => {
  it("lê os produtos da categoria 17, que é onde eles se misturam", () => {
    expect(empreendimentoDoTexto("APTO 1503 LUA/1508 SOL GIANT TOWERS 720.000")).toBe(GIANT_TOWERS);
    expect(empreendimentoDoTexto("APTO 307 GUAIMBE")).toBe(GUAIMBE);
    expect(empreendimentoDoTexto("APTO 404 BL 03 VALE DO SOL")).toBe(VALE_DO_SOL);
    expect(empreendimentoDoTexto("APTO 202 ED CRISTAL")).toBe(ED_CRISTAL);
    expect(empreendimentoDoTexto("APTO ON SKY 310/104/509 450.000 30 PARC")).toBe(ON_SKY);
    expect(empreendimentoDoTexto("VENDA APTO 705 MIRAGE")).toBe(MIRAGE);
  });

  it("aceita as três grafias de Guaimbê que existem na base", () => {
    // Uma regra estrita perde 41 títulos só na grafia "GUAIBE", e o cliente some da carteira.
    expect(empreendimentoDoTexto("APTO 307 GUAIMBE")).toBe(GUAIMBE);
    expect(empreendimentoDoTexto("APTO 808- GUIAMBE")).toBe(GUAIMBE);
    expect(empreendimentoDoTexto("APTO 706 GUAIBE")).toBe(GUAIMBE);
  });

  it("não confunde a torre SOL do Giant Towers com o Vale do Sol", () => {
    // ⚠️ É a armadilha que motivou a ordem das regras: as torres se chamam LUA e SOL.
    expect(empreendimentoDoTexto("APTO 610 SOL / 612 SOL GIANT TOWERS")).toBe(GIANT_TOWERS);
    // Sem o nome do prédio, o NÚMERO antes da torre é o que decide: 89 títulos vinham assim.
    expect(empreendimentoDoTexto("APTO 1211 SOL 613.089")).toBe(GIANT_TOWERS);
    expect(empreendimentoDoTexto("APTO 1512 SOL 1510 SOL 1303 LUA 36 PARC")).toBe(GIANT_TOWERS);
    // E o Vale do Sol continua sendo Vale do Sol: lá o texto nunca traz número colado na torre.
    expect(empreendimentoDoTexto("APTO 404 BL 03 VALE DO SOL")).toBe(VALE_DO_SOL);
    expect(empreendimentoDoTexto("VENDA AP 305 E 306 BLOCO 04 VALE DO SOL")).toBe(VALE_DO_SOL);
  });

  it("separa o Rubi do Jade, que dividem a mesma categoria no LSoft", () => {
    expect(empreendimentoDoTexto("APTO 402 ED RUBI")).toBe(ED_RUBI);
    expect(empreendimentoDoTexto("APTO 202 JADE")).toBe(ED_JADE);
  });

  it("aceita o nome antigo do Vale do Ouro", () => {
    expect(empreendimentoDoTexto("LOTEAMENTO JOSE LINO QUADRA 3")).toBe(VALE_DO_OURO);
    expect(empreendimentoDoTexto("LOTE 12 VALE DO OURO")).toBe(VALE_DO_OURO);
  });

  it("devolve nulo quando o texto não diz o produto", () => {
    expect(empreendimentoDoTexto("PARC. MENSAL")).toBeNull();
    expect(empreendimentoDoTexto("APTO 1003")).toBeNull();
    expect(empreendimentoDoTexto("40X 20.000")).toBeNull();
    expect(empreendimentoDoTexto("")).toBeNull();
    expect(empreendimentoDoTexto(null)).toBeNull();
  });
});

describe("os nomes batem com o catálogo de boletos", () => {
  // ⚠️ POR QUE ESTE TESTE EXISTE: em 24/09/2026 esta regra nasceu com "Guaimbê" (circunflexo), e o
  // catálogo chama o prédio de "Guaimbé" (agudo). A tela de boletos casa por igualdade de texto: a
  // diferença de um acento não dá erro, devolve carteira vazia. Quem pegou foi a revisão adversarial,
  // não um teste. Agora é um teste.
  const doCatalogo = new Set(
    EMPREENDIMENTOS_DE_BOLETO.flatMap((e) => [e.nome, e.chaveLsoft].filter((x): x is string => Boolean(x))),
  );
  // Aparecem na categoria 17 e não estão na tela de boletos: precisam de nome, mas não de par.
  const foraDoCatalogo = new Set([MIRAGE, MANHATTAN]);

  it("todo empreendimento que a categoria decide existe no catálogo", () => {
    for (const nome of Object.values(CATEGORIA_E_O_EMPREENDIMENTO)) {
      expect(doCatalogo.has(nome), `"${nome}" não existe no catálogo de boletos`).toBe(true);
    }
  });

  it("todo empreendimento que o texto decide existe no catálogo, fora os dois que não emitem boleto", () => {
    const doTexto = [GIANT_TOWERS, ED_ESMERALDA, ED_CRISTAL, ED_RUBI, ED_JADE, GUAIMBE, ON_SKY, VALE_DO_OURO, VALE_DO_SOL, GARDEN];
    for (const nome of doTexto) {
      if (foraDoCatalogo.has(nome)) continue;
      expect(doCatalogo.has(nome), `"${nome}" não existe no catálogo de boletos`).toBe(true);
    }
  });
});

describe("a classificação do título", () => {
  it("usa a categoria quando ela responde sozinha, e ignora o texto", () => {
    // O Garden é 124 e não precisa de texto: o "GUAIMBE" aqui seria ruído de um lançamento antigo.
    const r = classificarTitulo({ categoria: 124, observacoes: "LOTE: 109 QUADRA: 08" });
    expect(r).toEqual({ empreendimento: GARDEN, origem: "categoria", patrimonio: false });
  });

  it("a 69 é o Vale do Ouro, embora o LSoft a chame de Loteamento José Lino", () => {
    const r = classificarTitulo({ categoria: 69, observacoes: "QUADRA 10 LOTE 2" });
    expect(r.empreendimento).toBe(VALE_DO_OURO);
    expect(r.origem).toBe("categoria");
  });

  it("a 126 (Enxoval On Sky) é o mesmo prédio, cobrado à parte", () => {
    expect(classificarTitulo({ categoria: 126, observacoes: "ENXOVAL" }).empreendimento).toBe(ON_SKY);
  });

  it("na categoria 17 o empreendimento vem do TEXTO e a tag de patrimônio vem junto", () => {
    const r = classificarTitulo({ categoria: CATEGORIA_PATRIMONIO, observacoes: "APTO 307 GUAIMBE" });
    expect(r).toEqual({ empreendimento: GUAIMBE, origem: "texto", patrimonio: true });
  });

  it("título da 17 sem pista fica indefinido, mas NÃO perde a tag", () => {
    // ⚠️ São 199 títulos, R$ 6,3 mi. Sem a tag eles sumiriam da conta do patrimônio enquanto o time
    // não classificasse, e o valor na tela ficaria menor do que a realidade.
    const r = classificarTitulo({ categoria: CATEGORIA_PATRIMONIO, observacoes: "PARC. MENSAL" });
    expect(r).toEqual({ empreendimento: null, origem: "indefinido", patrimonio: true });
  });

  it("na 115 o texto decide entre Rubi e Jade", () => {
    expect(classificarTitulo({ categoria: 115, observacoes: "APTO 402 RUBI" }).empreendimento).toBe(ED_RUBI);
    expect(classificarTitulo({ categoria: 115, observacoes: "APTO 202 JADE" }).empreendimento).toBe(ED_JADE);
    // Sem pista, nenhuma das duas: colar no Rubi por ser o primeiro da lista seria inventar.
    expect(classificarTitulo({ categoria: 115, observacoes: "PARCELA 3" }).empreendimento).toBeNull();
  });

  it("categoria desconhecida cai no texto, e sem texto fica indefinida", () => {
    expect(classificarTitulo({ categoria: 999, observacoes: "APTO 202 ED CRISTAL" }).empreendimento).toBe(ED_CRISTAL);
    const r = classificarTitulo({ categoria: 999, observacoes: "GALPAO" });
    expect(r).toEqual({ empreendimento: null, origem: "indefinido", patrimonio: false });
  });

  it("aguenta categoria vazia sem quebrar", () => {
    expect(() => classificarTitulo({ categoria: null, observacoes: null })).not.toThrow();
    expect(classificarTitulo({ categoria: "", observacoes: "" }).origem).toBe("indefinido");
  });
});
