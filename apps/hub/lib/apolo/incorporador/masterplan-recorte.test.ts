import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  chaveDoLote,
  lerLinhasDoMapa,
  recortarMasterplan,
} from "./masterplan-recorte";

// O teste que importa é o do ARQUIVO DE VERDADE: um recorte que passa num HTML inventado e falha
// no `vale-do-ouro.html` não protege ninguém.
const CAMINHO = path.join(process.cwd(), "masterplans-internos", "vale-do-ouro.html");
const REAL = fs.existsSync(CAMINHO) ? fs.readFileSync(CAMINHO, "utf8") : null;

// O segundo arquivo de verdade: a Lagoa Bonita, onde a quadra é o BLOCO com letra ("C01"/"L08").
const CAMINHO_LAGOA = path.join(process.cwd(), "masterplans-internos", "lagoa-bonita.html");
const REAL_LAGOA = fs.existsSync(CAMINHO_LAGOA) ? fs.readFileSync(CAMINHO_LAGOA, "utf8") : null;

// Os dois de empreendimento ÚNICO, com quadra de UMA letra: Vista Alegre ("A".."I") e Recanto do
// Pará ("A".."E", lote sequencial do loteamento inteiro, que passa de 99).
const CAMINHO_VAL = path.join(process.cwd(), "masterplans-internos", "vista-alegre.html");
const REAL_VAL = fs.existsSync(CAMINHO_VAL) ? fs.readFileSync(CAMINHO_VAL, "utf8") : null;
const CAMINHO_REP = path.join(process.cwd(), "masterplans-internos", "recanto-do-para.html");
const REAL_REP = fs.existsSync(CAMINHO_REP) ? fs.readFileSync(CAMINHO_REP, "utf8") : null;

const FALSO = [
  "<html><head><style>.a{color:red}</style></head><body>",
  '<svg><path id="f3"/><path id="f2"/></svg>',
  "<script>",
  "const DADOS=[",
  '[1,"01",2,426.31,140401,"EUDES ROBERTO ALVES RIBEIRO","10,10 20,10 20,20"],',
  '[1,"02",0,365.2,136561,"","30,10 40,10 40,20"],',
  '[2,"07",2,300,120000,"MARTA FLORIANO","50,10 60,10 60,20"],',
  "];",
  "</script></body></html>",
].join("\n");

// O mesmo mapa, no formato da Lagoa Bonita: a quadra vai ENTRE ASPAS porque o bloco tem letra.
const FALSO_LAGOA = [
  "<html><head><style>.a{color:red}</style></head><body>",
  '<svg><path id="f3"/><path id="f2"/></svg>',
  "<script>",
  "const DADOS=[",
  '["C01","11",2,426.31,140401,"EUDES ROBERTO ALVES RIBEIRO","10,10 20,10 20,20"],',
  '["C01","12",0,365.2,136561,"","30,10 40,10 40,20"],',
  '["L08","09",2,300,120000,"MARTA FLORIANO","50,10 60,10 60,20"],',
  "];",
  "</script></body></html>",
].join("\n");

describe("chaveDoLote", () => {
  it("normaliza os dois lados para o mesmo formato", () => {
    expect(chaveDoLote(1, "01")).toBe("1-01");
    expect(chaveDoLote("1", 1)).toBe("1-01");
    expect(chaveDoLote(" 12 ", " 7 ")).toBe("12-07");
  });

  it("⚠️ bloco com letra passa inteiro, em caixa alta — é o formato da Lagoa Bonita", () => {
    // O C2X guarda `block` como "C01"/"L08", e o mapa grava a mesma coisa. A caixa alta é a
    // normalização: uma diferença de caixa separaria o mesmo lote em duas chaves.
    expect(chaveDoLote("C01", "11")).toBe("C01-11");
    expect(chaveDoLote(" c01 ", 7)).toBe("C01-07");
    expect(chaveDoLote("L08", "09")).toBe("L08-09");
  });
});

describe("lerLinhasDoMapa", () => {
  it("lê as linhas e o polígono de cada uma", () => {
    const bloco = lerLinhasDoMapa(FALSO);
    expect(bloco?.linhas.map((l) => l.chave)).toEqual(["1-01", "1-02", "2-07"]);
    expect(bloco?.linhas[0]?.poligono).toBe("10,10 20,10 20,20");
    expect(bloco?.desconhecidas).toBe(0);
  });

  it("devolve nulo quando o bloco não existe", () => {
    expect(lerLinhasDoMapa("<html></html>")).toBeNull();
  });

  it("conta a linha que não entendeu, em vez de ignorar", () => {
    const sujo = FALSO.replace('[2,"07",2,300,120000,"MARTA FLORIANO","50,10 60,10 60,20"],', "{oops:1},");
    expect(lerLinhasDoMapa(sujo)?.desconhecidas).toBe(1);
  });

  it("lê o formato da Lagoa Bonita: quadra entre aspas, com letra", () => {
    const bloco = lerLinhasDoMapa(FALSO_LAGOA);
    expect(bloco?.linhas.map((l) => l.chave)).toEqual(["C01-11", "C01-12", "L08-09"]);
    expect(bloco?.linhas[0]?.poligono).toBe("10,10 20,10 20,20");
    expect(bloco?.desconhecidas).toBe(0);
  });
});

describe("recortarMasterplan", () => {
  it("tira do HTML os lotes que não são do portal, com nome e preço junto", () => {
    const r = recortarMasterplan(FALSO, new Set(["1-01", "1-02"]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.dentro).toBe(2);
    expect(r.fora).toBe(1);
    // ⚠️ O TESTE QUE VALE: o nome do comprador de fora não sobrou em lugar nenhum do arquivo.
    expect(r.html).not.toContain("MARTA FLORIANO");
    expect(r.html).not.toContain("120000");
    expect(r.html).not.toContain("300");
    // E o que é dele continua inteiro.
    expect(r.html).toContain("EUDES ROBERTO ALVES RIBEIRO");
  });

  it("desenha o polígono de fora em cinza, e só o polígono", () => {
    const r = recortarMasterplan(FALSO, new Set(["1-01", "1-02"]));
    if (!r.ok) throw new Error("recorte falhou");

    expect(r.html).toContain('<path id="fFora"/>');
    // Tom escurecido a pedido do Lucas (18/08/2026): "tem como escurecer mais esse cinza,
    // ainda dá para confundir" — o lote de fora tem que ser inconfundível com o disponível.
    expect(r.html).toContain("#fFora{fill:#475569");
    // O desenho do lote de fora está lá; o dado dele, não.
    expect(r.html).toContain("M50,10L60,10L60,20Z");
  });

  it("não mexe nos LOTES quando o portal alcança o loteamento inteiro", () => {
    // O arquivo não é mais devolvido byte a byte: a moldura interna sai SEMPRE (18/08/2026).
    // O que este teste crava é que os DADOS não são tocados no caminho de escopo total.
    const r = recortarMasterplan(FALSO, new Set(["1-01", "1-02", "2-07"]));
    if (!r.ok) throw new Error("recorte falhou");
    expect(r.fora).toBe(0);
    const antes = lerLinhasDoMapa(FALSO);
    const depois = lerLinhasDoMapa(r.html);
    expect(depois?.linhas).toEqual(antes?.linhas);
  });

  it("RECUSA quando o escopo não cobre nenhum lote — nunca serve o arquivo cru", () => {
    const r = recortarMasterplan(FALSO, new Set(["99-99"]));
    expect(r.ok).toBe(false);
  });

  it("RECUSA quando alguma linha não foi entendida", () => {
    const sujo = FALSO.replace('[2,"07",2,300,120000,"MARTA FLORIANO","50,10 60,10 60,20"],', "{oops:1},");
    const r = recortarMasterplan(sujo, new Set(["1-01"]));
    expect(r.ok).toBe(false);
  });

  it("RECUSA um HTML sem o bloco de dados", () => {
    expect(recortarMasterplan("<html></html>", new Set(["1-01"])).ok).toBe(false);
  });

  it("recorta o formato da Lagoa Bonita igual ao do Vale do Ouro", () => {
    const r = recortarMasterplan(FALSO_LAGOA, new Set(["C01-11", "C01-12"]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.dentro).toBe(2);
    expect(r.fora).toBe(1);
    expect(r.html).not.toContain("MARTA FLORIANO");
    expect(r.html).toContain("EUDES ROBERTO ALVES RIBEIRO");
    // O polígono do lote de fora vira desenho cinza, sem dado.
    expect(r.html).toContain("M50,10L60,10L60,20Z");
  });
});

describe("o arquivo real do Vale do Ouro", () => {
  it.skipIf(!REAL)("tem os 298 lotes e todos são entendidos", () => {
    const bloco = lerLinhasDoMapa(REAL as string);
    expect(bloco?.linhas).toHaveLength(298);
    expect(bloco?.desconhecidas).toBe(0);
    expect(new Set(bloco?.linhas.map((l) => l.chave)).size).toBe(298);
  });

  // A divisão medida no C2X em 17/08/2026: VOC 157, VOL 141, e zero lote sem dono.
  it.skipIf(!REAL)("recortado para o VOC, não sobra nenhum lote do Lino", () => {
    const bloco = lerLinhasDoMapa(REAL as string);
    const todas = bloco?.linhas ?? [];
    // Metade arbitrária serve para o teste: o número real vem do C2X em produção.
    const doVoc = new Set(todas.slice(0, 157).map((l) => l.chave));
    const doVol = todas.slice(157);

    const r = recortarMasterplan(REAL as string, doVoc);
    if (!r.ok) throw new Error(`recorte falhou: ${r.erro}`);

    expect(r.dentro).toBe(157);
    expect(r.fora).toBe(141);

    // Nenhuma linha do Lino sobreviveu — a comparação é sobre a LINHA INTEIRA, com nome e preço.
    for (const item of doVol) {
      expect(r.html).not.toContain(item.miolo);
    }

    // E os nomes: nenhum comprador que só existe do lado do Lino aparece no arquivo servido.
    // O comprador é o 6º campo: `[q,"lote",sit,area,valor,"NOME","poligono"]`.
    const nomeDe = (linha: string): string =>
      linha.match(/^\[\d+,"[^"]*",\d+,[\d.]+,\d+,"([^"]*)"/)?.[1] ?? "";
    const nomesVoc = new Set(todas.slice(0, 157).map((l) => nomeDe(l.miolo)).filter(Boolean));
    const soDoLino = [...new Set(doVol.map((l) => nomeDe(l.miolo)).filter(Boolean))]
      .filter((nome) => !nomesVoc.has(nome));

    expect(soDoLino.length).toBeGreaterThan(0);
    for (const nome of soDoLino) {
      expect(r.html).not.toContain(nome);
    }
  });
});

describe("o arquivo real da Lagoa Bonita", () => {
  // AS 47 UNIDADES DO LBF (enterprise 33, a gleba do Fernando), lidas do C2X em 17/08/2026.
  // O portal piloto é o dele: o recorte tem que casar EXATAMENTE estas 47 como "dentro" e as
  // outras 448 (LBR + LBP + as 83 só do espelho) como desenho cinza sem dado.
  const LBF = [
    "C01-11", "C01-12", "C02-04", "C02-12", "C03-08", "C03-09", "C03-10", "C04-08",
    "C05-06", "C06-12", "C06-13", "C07-01", "C07-02", "C07-03", "C08-09", "C09-07",
    "C09-08", "C09-09", "C10-16", "C10-17", "C10-18", "C10-19", "C11-26", "C11-27",
    "C11-28", "C12-08", "C12-09", "C12-10", "C13-01", "C13-02", "C13-03", "C14-08",
    "C15-17", "C16-01", "C16-02", "C16-03", "C17-06", "C17-07", "C18-01", "L02-14",
    "L02-15", "L03-11", "L03-12", "L04-07", "L05-03", "L07-07", "L08-09",
  ];

  it.skipIf(!REAL_LAGOA)("tem os 495 lotes e todos são entendidos", () => {
    const bloco = lerLinhasDoMapa(REAL_LAGOA as string);
    expect(bloco?.linhas).toHaveLength(495);
    expect(bloco?.desconhecidas).toBe(0);
    expect(new Set(bloco?.linhas.map((l) => l.chave)).size).toBe(495);
  });

  it.skipIf(!REAL_LAGOA)("⚠️ recortado para o LBF, entram os 47 dele e nenhum lote do vizinho", () => {
    expect(LBF).toHaveLength(47);

    const r = recortarMasterplan(REAL_LAGOA as string, new Set(LBF));
    if (!r.ok) throw new Error(`recorte falhou: ${r.erro}`);

    expect(r.dentro).toBe(47);
    expect(r.fora).toBe(448);

    // Nenhuma linha de fora sobreviveu — a comparação é sobre a LINHA INTEIRA, com nome e preço.
    const todas = lerLinhasDoMapa(REAL_LAGOA as string)?.linhas ?? [];
    const permitidas = new Set(LBF);
    const deFora = todas.filter((l) => !permitidas.has(l.chave));
    expect(deFora).toHaveLength(448);
    for (const item of deFora) {
      expect(r.html).not.toContain(item.miolo);
    }

    // E os nomes: nenhum comprador que só existe fora do LBF aparece no arquivo servido.
    // O comprador é o 6º campo: `["bloco","lote",sit,area,valor,"NOME","poligono"]`.
    const nomeDe = (linha: string): string =>
      linha.match(/^\["[^"]+","[^"]*",\d+,[\d.]+,\d+,"([^"]*)"/)?.[1] ?? "";
    const nomesLbf = new Set(
      todas.filter((l) => permitidas.has(l.chave)).map((l) => nomeDe(l.miolo)).filter(Boolean),
    );
    const soDeFora = [...new Set(deFora.map((l) => nomeDe(l.miolo)).filter(Boolean))]
      .filter((nome) => !nomesLbf.has(nome));

    expect(soDeFora.length).toBeGreaterThan(0);
    for (const nome of soDeFora) {
      expect(r.html).not.toContain(nome);
    }
  });
});

describe("integridade do HTML servido (recorte com lotes de fora)", () => {
  // A regressão que este bloco impede (18/08/2026): o script da camada cinza era inserido antes
  // do PRIMEIRO </body>, que na Lagoa Bonita fica DENTRO de uma string JS do exportador de
  // planilha. O </script> injetado ali matava o app no meio: painéis vazios, sem camada de cor,
  // e código vazando como TEXTO na tela ("blob=new"). Só acontece quando há lote de fora
  // (escopo parcial): o caminho de escopo total não injeta nada.
  it.skipIf(!REAL_LAGOA)("recorte parcial da Lagoa não vira texto nem desequilibra scripts", () => {
    const bloco = lerLinhasDoMapa(REAL_LAGOA as string);
    const algumas = new Set((bloco?.linhas ?? []).slice(0, 40).map((l) => l.chave));
    const r = recortarMasterplan(REAL_LAGOA as string, algumas);
    if (!r.ok) throw new Error(`recorte falhou: ${r.erro}`);
    expect(r.fora).toBeGreaterThan(0);

    const abre = (r.html.match(/<script[\s>]/g) ?? []).length;
    const fecha = (r.html.match(/<\/script>/g) ?? []).length;
    expect(fecha, "scripts abertos vs fechados").toBe(abre);

    const semScripts = r.html.replace(/<script[\s\S]*?<\/script>/g, "");
    for (const pedaco of ["blob=new", "const DADOS", "function(", "=>{"]) {
      expect(semScripts, `código vazando como texto: ${pedaco}`).not.toContain(pedaco);
    }

    // O script injetado fica no </body> REAL: depois do falso do exportador.
    const posInjetado = r.html.indexOf('getElementById("fFora")');
    const posFalso = r.html.indexOf("</body></html>'");
    expect(posInjetado).toBeGreaterThan(posFalso);
  });
});

describe("o arquivo real do Vista Alegre", () => {
  // AS 126 UNIDADES DO VAL (enterprise 29), lidas do C2X em 17/08/2026 — a contagem por quadra
  // bate 1:1 com o SVG (VALA01..VALI10), e o lote reinicia em 01 a cada quadra.
  const VAL = (
    [["A", 4], ["B", 3], ["C", 24], ["D", 14], ["E", 16], ["F", 17], ["G", 17], ["H", 21], ["I", 10]] as const
  ).flatMap(([quadra, lotes]) =>
    Array.from({ length: lotes }, (_, i) => `${quadra}-${String(i + 1).padStart(2, "0")}`),
  );

  it.skipIf(!REAL_VAL)("tem os 126 lotes e todos são entendidos", () => {
    const bloco = lerLinhasDoMapa(REAL_VAL as string);
    expect(bloco?.linhas).toHaveLength(126);
    expect(bloco?.desconhecidas).toBe(0);
    expect(new Set(bloco?.linhas.map((l) => l.chave)).size).toBe(126);
  });

  it.skipIf(!REAL_VAL)("⚠️ a moldura do Panteon NÃO sai para o cliente", () => {
    // O rail decorativo de módulos (Íris, Hades, Prometeu, Hermes) é ambientação do Apolo
    // interno. No portal ele é ruído com vazamento: o tooltip entrega "Hades · cobrança".
    // Lucas, 18/08/2026: "isso aqui não faz sentido". A remoção é do FONTE, não por CSS.
    const r = recortarMasterplan(REAL_VAL as string, new Set(VAL));
    if (!r.ok) throw new Error(`recorte falhou: ${r.erro}`);

    expect(REAL_VAL).toContain('<nav class="rail"');
    expect(r.html).not.toContain('<nav class="rail"');
    for (const interno of ["Íris · atendimento", "Hades · cobrança", "Prometeu · lançamento", "Hermes · mensagens"]) {
      expect(r.html).not.toContain(interno);
    }
    // O grid perde a coluna dos 54px para o mapa não ficar com uma régua vazia à esquerda.
    expect(r.html).toContain("body{grid-template-columns:0 318px");
  });

  it.skipIf(!REAL_VAL)("⚠️ o portal do Bill (VAL inteiro) enxerga as 126 dentro, e os lotes seguem intactos", () => {
    // O Vista Alegre é empreendimento único: a sessão com o enterprise 29 tem direito a TUDO, e
    // o recorte com escopo total não mexe no arquivo — nada vira cinza.
    expect(VAL).toHaveLength(126);

    const r = recortarMasterplan(REAL_VAL as string, new Set(VAL));
    if (!r.ok) throw new Error(`recorte falhou: ${r.erro}`);

    expect(r.dentro).toBe(126);
    expect(r.fora).toBe(0);
    // Byte a byte não vale mais: a moldura interna sai sempre. Os LOTES é que não mudam.
    expect(lerLinhasDoMapa(r.html)?.linhas).toEqual(lerLinhasDoMapa(REAL_VAL as string)?.linhas);
    expect(r.html).not.toContain('<nav class="rail"');
  });

  it.skipIf(!REAL_VAL)("recortado para uma quadra qualquer, nenhuma linha das outras sobrevive", () => {
    // O VAL não tem divisão hoje, mas o arquivo precisa continuar RECORTÁVEL: se um dia o
    // loteamento for dividido (o caminho do Vale do Ouro), a rota já sabe tirar o que não é do
    // portal. A quadra C (24 lotes) serve de divisão de mentira.
    const soQuadraC = VAL.filter((chave) => chave.startsWith("C-"));
    const r = recortarMasterplan(REAL_VAL as string, new Set(soQuadraC));
    if (!r.ok) throw new Error(`recorte falhou: ${r.erro}`);

    expect(r.dentro).toBe(24);
    expect(r.fora).toBe(102);

    // Nenhuma linha de fora sobreviveu — a comparação é sobre a LINHA INTEIRA, com nome e preço.
    const todas = lerLinhasDoMapa(REAL_VAL as string)?.linhas ?? [];
    const permitidas = new Set(soQuadraC);
    for (const item of todas.filter((l) => !permitidas.has(l.chave))) {
      expect(r.html).not.toContain(item.miolo);
    }
  });
});

describe("o arquivo real do Recanto do Pará", () => {
  // AS 199 UNIDADES DO REP (enterprise 20), lidas do C2X em 17/08/2026. O lote é a numeração
  // SEQUENCIAL do loteamento (A 1..38, B 39..66, C 67..123, D 124..175, E 176..199): dois
  // dígitos até o 99 e três a partir do 100 — a faixa que quebraria uma ordenação de texto.
  const REP = (
    [["A", 1, 38], ["B", 39, 66], ["C", 67, 123], ["D", 124, 175], ["E", 176, 199]] as const
  ).flatMap(([quadra, de, ate]) =>
    Array.from({ length: ate - de + 1 }, (_, i) => `${quadra}-${String(de + i).padStart(2, "0")}`),
  );

  it.skipIf(!REAL_REP)("tem os 199 lotes e todos são entendidos", () => {
    const bloco = lerLinhasDoMapa(REAL_REP as string);
    expect(bloco?.linhas).toHaveLength(199);
    expect(bloco?.desconhecidas).toBe(0);
    expect(new Set(bloco?.linhas.map((l) => l.chave)).size).toBe(199);
  });

  it.skipIf(!REAL_REP)("⚠️ o portal com o REP inteiro enxerga as 199 dentro, e os lotes seguem intactos", () => {
    expect(REP).toHaveLength(199);

    const r = recortarMasterplan(REAL_REP as string, new Set(REP));
    if (!r.ok) throw new Error(`recorte falhou: ${r.erro}`);

    expect(r.dentro).toBe(199);
    expect(r.fora).toBe(0);
    // Byte a byte não vale mais: a moldura interna sai sempre. Os LOTES é que não mudam.
    expect(lerLinhasDoMapa(r.html)?.linhas).toEqual(lerLinhasDoMapa(REAL_REP as string)?.linhas);
    expect(r.html).not.toContain('<nav class="rail"');
  });

  it.skipIf(!REAL_REP)("recortado para uma quadra qualquer, nenhuma linha das outras sobrevive", () => {
    // A quadra C atravessa o 99 -> 100: é exatamente a faixa onde o lote muda de largura, e onde
    // uma chave mal normalizada separaria o mesmo lote em dois.
    const soQuadraC = REP.filter((chave) => chave.startsWith("C-"));
    const r = recortarMasterplan(REAL_REP as string, new Set(soQuadraC));
    if (!r.ok) throw new Error(`recorte falhou: ${r.erro}`);

    expect(r.dentro).toBe(57);
    expect(r.fora).toBe(142);

    const todas = lerLinhasDoMapa(REAL_REP as string)?.linhas ?? [];
    const permitidas = new Set(soQuadraC);
    for (const item of todas.filter((l) => !permitidas.has(l.chave))) {
      expect(r.html).not.toContain(item.miolo);
    }
  });
});
