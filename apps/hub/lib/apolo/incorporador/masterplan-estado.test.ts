import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type {
  SituacaoDasUnidades,
  SituacaoDaUnidade,
  UnidadeComSituacao,
} from "@/lib/hercules/situacao-da-unidade";

import { situacoesDoArquivo } from "./masterplan-dois-estados";
import {
  aplicarEstadoAtual,
  corDoMapa,
  type EstadoDoLote,
  estadoDosLotes,
  type LoteDoC2x,
  MAPA,
} from "./masterplan-estado";
import { chaveDoLote, lerLinhasDoMapa, recortarMasterplan } from "./masterplan-recorte";

// O TESTE QUE IMPORTA É O DOS ARQUIVOS DE VERDADE. A reescrita acontece linha a linha dentro de um
// HTML gerado, e o perigo real não é errar a conta: é devolver uma linha que o RECORTE não consegue
// mais entender. O recorte é fail-closed — uma linha estragada por aqui derruba o mapa inteiro com
// "linha(s) em formato inesperado", e o sintoma seria "o mapa parou de abrir", não "o número está
// errado". Por isso todo caso abaixo termina passando o resultado pelo recorte.
const PASTA = path.join(process.cwd(), "masterplans-internos");

const REAIS = ["vale-do-ouro", "lagoa-bonita", "vista-alegre", "recanto-do-para", "garden"]
  .map((nome) => ({ html: leia(`${nome}.html`), nome }))
  .filter((item): item is { html: string; nome: string } => item.html !== null);

function leia(arquivo: string): null | string {
  const caminho = path.join(PASTA, arquivo);
  return fs.existsSync(caminho) ? fs.readFileSync(caminho, "utf8") : null;
}

/** Lê `[…,situação,área,valor,"comprador",…]` de volta, para conferir o que a reescrita gravou. */
function comoEstaNoHtml(
  html: string,
): Map<string, { comprador: string; situacao: number; valor: number }> {
  const fora = new Map<string, { comprador: string; situacao: number; valor: number }>();
  const bloco = lerLinhasDoMapa(html);

  for (const linha of bloco?.linhas ?? []) {
    const m = linha.miolo.match(
      /^\[(?:(\d+)|"([^"]*)"),"([^"]*)",(\d+),([\d.]+),([\d.]+),"([^"]*)"/,
    );
    if (!m) continue;
    fora.set(chaveDoLote(m[1] ?? m[2] ?? "", m[3] ?? ""), {
      comprador: m[7] ?? "",
      situacao: Number(m[4]),
      valor: Number(m[6]),
    });
  }

  return fora;
}

// ── A SITUAÇÃO VEM DA RÉGUA ÚNICA (Lucas, 18/09/2026: *"esses status tem que morar em um so lugar"*)
//
// Até aqui este arquivo tinha a própria régua (`situacaoDoMapa`, sobre o `sale_status_id` do C2X), e o
// lote reservado ou em proposta no Hércules abria verde no mapa. Os testes abaixo são a troca: a cor
// sai de `situacao-da-unidade.ts`, e o C2X entra só com escopo, comprador e preço.

function unidade(codigo: string, situacao: SituacaoDaUnidade): UnidadeComSituacao {
  return {
    codigo,
    enterpriseId: "37",
    id: `viva-${codigo}`,
    lote: null,
    origemC2xId: null,
    quadra: null,
    situacao,
  };
}

/** O que `lerSituacaoDasUnidades` devolveria: cada unidade respondendo pelos códigos e ids dados. */
function situacoes(
  entradas: Array<{ codigos?: string[]; origens?: string[]; unidade: UnidadeComSituacao }>,
): Pick<SituacaoDasUnidades, "porCodigo" | "porOrigemC2x"> {
  const porCodigo = new Map<string, UnidadeComSituacao>();
  const porOrigemC2x = new Map<string, UnidadeComSituacao>();
  for (const e of entradas) {
    for (const c of e.codigos ?? []) porCodigo.set(c, e.unidade);
    for (const o of e.origens ?? []) porOrigemC2x.set(o, e.unidade);
  }
  return { porCodigo, porOrigemC2x };
}

function lote(parcial: Partial<LoteDoC2x>): LoteDoC2x {
  return {
    atualizadoEm: 0,
    chave: "3-05",
    codigo: "VOC0305",
    comprador: "FULANO DE TAL",
    enterpriseId: "37",
    origemC2xId: "5001",
    preco: 140401,
    ...parcial,
  };
}

describe("corDoMapa", () => {
  it("a régua única nas quatro cores do arquivo", () => {
    expect(corDoMapa("disponivel")).toBe(MAPA.DISPONIVEL);
    expect(corDoMapa("reservado")).toBe(MAPA.RESERVADO);
    expect(corDoMapa("reservada")).toBe(MAPA.RESERVADO);
    expect(corDoMapa("bloqueada")).toBe(MAPA.BLOQUEADO);
    // Proposta, contrato, assinatura e faturado pintam de vendido: o mesmo agrupamento que o mapa
    // sempre fez com o "em negociação" do legado.
    for (const s of ["proposta", "contrato", "assinatura", "faturado", "vendida"] as const) {
      expect(corDoMapa(s)).toBe(MAPA.VENDIDO);
    }
  });
});

describe("estadoDosLotes", () => {
  it("⚠️ a cor é a do Panteon: lote reservado no Hércules sai reservado, e o LoteDoC2x nem tem status", () => {
    const { estados, semSituacao } = estadoDosLotes(
      [lote({})],
      situacoes([{ codigos: ["VOC0305"], unidade: unidade("VOC0305", "reservado") }]),
    );
    expect(semSituacao).toBe(0);
    expect(estados.get("3-05")).toEqual({
      comprador: "FULANO DE TAL",
      situacao: MAPA.RESERVADO,
      valor: 140401,
    });
  });

  it("os bloqueados do Panteon deixam de sair verdes", () => {
    const { estados } = estadoDosLotes(
      [lote({ comprador: "" })],
      situacoes([{ codigos: ["VOC0305"], unidade: unidade("VOC0305", "bloqueada") }]),
    );
    // Bloqueado grava valor zero, que é a convenção do arquivo.
    expect(estados.get("3-05")).toEqual({ comprador: "", situacao: MAPA.BLOQUEADO, valor: 0 });
  });

  it("o código do pai e o da gleba respondem o mesmo terreno", () => {
    // O masterplan do produto dividido é do pai: a sessão com VLO lê `VLO0305` no C2X, e a proposta
    // mora na linha viva da gleba (`VOC0305`). `porCodigo` responde pelos dois.
    const terreno = unidade("VOC0305", "contrato");
    const { estados } = estadoDosLotes(
      [lote({ codigo: "VLO0305", enterpriseId: "35", origemC2xId: "9305" })],
      situacoes([{ codigos: ["VOC0305", "VLO0305"], unidade: terreno }]),
    );
    expect(estados.get("3-05")?.situacao).toBe(MAPA.VENDIDO);
  });

  it("sem código que case, acha pelo id do legado", () => {
    const { estados, semSituacao } = estadoDosLotes(
      [lote({ codigo: "RENOMEADO-NO-C2X", origemC2xId: "5001" })],
      situacoes([{ origens: ["5001"], unidade: unidade("VOC0305", "proposta") }]),
    );
    expect(semSituacao).toBe(0);
    expect(estados.get("3-05")?.situacao).toBe(MAPA.VENDIDO);
  });

  it("⚠️ lote que o Panteon não conhece NÃO sai livre", () => {
    const { estados, semSituacao } = estadoDosLotes([lote({ codigo: null })], situacoes([]));
    expect(semSituacao).toBe(1);
    // Nem verde, nem com nome: bloqueado, sem comprador e sem preço.
    expect(estados.get("3-05")).toEqual({ comprador: "", situacao: MAPA.BLOQUEADO, valor: 0 });
  });

  it("o nome do comprador só aparece em lote que o Panteon diz ter dono", () => {
    // O C2X ainda tem proposta viva com nome, mas o Panteon diz livre: o nome sai junto.
    const { estados } = estadoDosLotes(
      [lote({ comprador: "NOME QUE FICOU NO LEGADO" })],
      situacoes([{ codigos: ["VOC0305"], unidade: unidade("VOC0305", "disponivel") }]),
    );
    expect(estados.get("3-05")).toEqual({ comprador: "", situacao: MAPA.DISPONIVEL, valor: 140401 });
  });

  it("o R$ 1 do legado não vira preço no mapa", () => {
    const { estados } = estadoDosLotes(
      [lote({ comprador: "", preco: 1 })],
      situacoes([{ codigos: ["VOC0305"], unidade: unidade("VOC0305", "disponivel") }]),
    );
    expect(estados.get("3-05")?.valor).toBe(0);
  });

  it("pai e gleba no mesmo escopo: o nome vem da linha que tem proposta, mesmo sendo a mais antiga", () => {
    const terreno = unidade("VOC0305", "vendida");
    const { estados } = estadoDosLotes(
      [
        lote({ atualizadoEm: 100, comprador: "COMPRADOR DA GLEBA" }),
        // O pai foi tocado depois (a divisão) e não tem proposta nenhuma.
        lote({ atualizadoEm: 999, codigo: "VLO0305", comprador: "", enterpriseId: "35", origemC2xId: "9305" }),
      ],
      situacoes([{ codigos: ["VOC0305", "VLO0305"], unidade: terreno }]),
    );
    expect(estados.get("3-05")).toEqual({
      comprador: "COMPRADOR DA GLEBA",
      situacao: MAPA.VENDIDO,
      valor: 140401,
    });
  });

  it("colisão entre terrenos diferentes: quem tem dono ganha do mais recente", () => {
    const { estados } = estadoDosLotes(
      [
        lote({ atualizadoEm: 100 }),
        lote({ atualizadoEm: 999, codigo: "VLO0305", comprador: "" }),
      ],
      situacoes([
        { codigos: ["VOC0305"], unidade: unidade("VOC0305", "reservado") },
        { codigos: ["VLO0305"], unidade: unidade("VLO0305", "bloqueada") },
      ]),
    );
    expect(estados.get("3-05")?.situacao).toBe(MAPA.RESERVADO);
  });
});

describe("aplicarEstadoAtual", () => {
  it.each(REAIS)("reescreve o $nome sem quebrar o recorte", ({ html }) => {
    const bloco = lerLinhasDoMapa(html);
    expect(bloco).not.toBeNull();
    const chaves = (bloco?.linhas ?? []).map((l) => l.chave);
    expect(chaves.length).toBeGreaterThan(0);

    // Todo lote vira vendido, com um dono e um preço redondo: se alguma linha sair torta, o
    // recorte abaixo recusa e o teste falha.
    const estados = new Map<string, EstadoDoLote>(
      chaves.map((chave) => [
        chave,
        { comprador: "FULANO DE TAL", situacao: MAPA.VENDIDO, valor: 123456 },
      ]),
    );

    const atualizado = aplicarEstadoAtual(html, estados);
    expect(atualizado.escrito).toBe(true);
    expect(atualizado.semEstado).toBe(0);

    const depois = comoEstaNoHtml(atualizado.html);
    expect(depois.size).toBe(chaves.length);
    for (const chave of chaves) {
      expect(depois.get(chave)).toEqual({
        comprador: "FULANO DE TAL",
        situacao: MAPA.VENDIDO,
        valor: 123456,
      });
    }

    // O que este teste existe para provar: o recorte ainda entende o arquivo depois da reescrita.
    const recorte = recortarMasterplan(atualizado.html, new Set(chaves));
    expect(recorte.ok).toBe(true);
  });

  it("não encosta no desenho: polígono, quadra, lote e área ficam de pé", () => {
    const html = REAIS.find((r) => r.nome === "vale-do-ouro")?.html;
    if (!html) return;

    const antes = lerLinhasDoMapa(html);
    const chaves = (antes?.linhas ?? []).map((l) => l.chave);

    const atualizado = aplicarEstadoAtual(
      html,
      new Map(chaves.map((c) => [c, { comprador: "", situacao: MAPA.DISPONIVEL, valor: 1 }])),
    );

    const depois = lerLinhasDoMapa(atualizado.html);
    // Mesmas chaves, mesma ordem, mesmos polígonos: só o miolo mudou.
    expect((depois?.linhas ?? []).map((l) => l.chave)).toEqual(chaves);
    expect((depois?.linhas ?? []).map((l) => l.poligono)).toEqual(
      (antes?.linhas ?? []).map((l) => l.poligono),
    );

    // A área é geometria e continua a do arquivo, ainda que o valor tenha virado 1.
    const areaDe = (h: string) =>
      (lerLinhasDoMapa(h)?.linhas ?? []).map((l) => l.miolo.match(/,(\d[\d.]*),[\d.]+,"/)?.[1]);
    expect(areaDe(atualizado.html)).toEqual(areaDe(html));
  });

  it("conta os lotes cuja situação MUDOU, que é o que estava errado no mapa", () => {
    const html = REAIS.find((r) => r.nome === "vale-do-ouro")?.html;
    if (!html) return;

    const linhas = lerLinhasDoMapa(html)?.linhas ?? [];
    const atual = comoEstaNoHtml(html);

    // Espelho fiel do arquivo: nada mudou, nada a corrigir.
    const igual = new Map<string, EstadoDoLote>(
      linhas.map((l) => [l.chave, { ...atual.get(l.chave)!, comprador: atual.get(l.chave)!.comprador }]),
    );
    expect(aplicarEstadoAtual(html, igual).corrigidos).toBe(0);

    // Um único lote muda de cor: um único corrigido.
    const umSo = new Map(igual);
    const alvo = linhas[0]!.chave;
    umSo.set(alvo, { ...igual.get(alvo)!, situacao: MAPA.RESERVADO });
    expect(aplicarEstadoAtual(html, umSo).corrigidos).toBe(1);
  });

  it("degrada para o arquivo quando o C2X não conhece o lote", () => {
    const html = REAIS.find((r) => r.nome === "vale-do-ouro")?.html;
    if (!html) return;

    const linhas = lerLinhasDoMapa(html)?.linhas ?? [];
    const antes = comoEstaNoHtml(html);

    // Só o primeiro lote tem estado; os outros 297 o C2X não devolveu.
    const parcial = new Map<string, EstadoDoLote>([
      [linhas[0]!.chave, { comprador: "NOVO DONO", situacao: MAPA.VENDIDO, valor: 999 }],
    ]);

    const atualizado = aplicarEstadoAtual(html, parcial);
    expect(atualizado.semEstado).toBe(linhas.length - 1);

    const depois = comoEstaNoHtml(atualizado.html);
    expect(depois.get(linhas[0]!.chave)?.comprador).toBe("NOVO DONO");
    // Os demais seguem palavra por palavra como estavam — o pior caso é o comportamento de hoje.
    for (const linha of linhas.slice(1)) {
      expect(depois.get(linha.chave)).toEqual(antes.get(linha.chave));
    }

    expect(recortarMasterplan(atualizado.html, new Set(linhas.map((l) => l.chave))).ok).toBe(true);
  });

  it("tira o nome do comprador do lote que voltou a ficar livre", () => {
    const html = REAIS.find((r) => r.nome === "vale-do-ouro")?.html;
    if (!html) return;

    // O caso do Lucas: cancelamento em lote que o arquivo ainda mostra vendido, com nome dentro.
    const vendidoComNome = [...comoEstaNoHtml(html)].find(
      ([, v]) => v.situacao === MAPA.VENDIDO && v.comprador !== "",
    );
    expect(vendidoComNome).toBeDefined();
    const [chave] = vendidoComNome!;

    const atualizado = aplicarEstadoAtual(
      html,
      new Map([[chave, { comprador: "", situacao: MAPA.DISPONIVEL, valor: 140401 }]]),
    );

    const depois = comoEstaNoHtml(atualizado.html).get(chave);
    expect(depois?.situacao).toBe(MAPA.DISPONIVEL);
    // O nome tem que SAIR junto: lote livre exibindo comprador é o erro que se está corrigindo.
    expect(depois?.comprador).toBe("");
  });

  // ⚠️ ESTE TESTE JÁ FALHOU, E O QUE ELE ACHOU VIROU CÓDIGO. A versão anterior esperava que o
  // RECORTE recusasse uma linha com aspas soltas no nome — e ele aceitou: o recorte confere a
  // cabeça (quadra e lote) e a cauda (o polígono), e o miolo passa intacto entre os dois. Ou seja,
  // não existe rede embaixo: um nome com aspas viraria `DADOS` inválido e o mapa abriria EM
  // BRANCO, sem erro nenhum no servidor. A proteção passou a morar na ESCRITA.
  it("neutraliza aspas do nome, que quebrariam o DADOS e abririam o mapa em branco", () => {
    const html = REAIS.find((r) => r.nome === "vale-do-ouro")?.html;
    if (!html) return;

    const linhas = lerLinhasDoMapa(html)?.linhas ?? [];
    const chave = linhas[0]!.chave;
    const atualizado = aplicarEstadoAtual(
      html,
      new Map([[chave, { comprador: 'JOAO "JOAZINHO" DA SILVA', situacao: MAPA.VENDIDO, valor: 1000 }]]),
    );

    // O nome continua legível; só as aspas saíram.
    expect(comoEstaNoHtml(atualizado.html).get(chave)?.comprador).toBe("JOAO JOAZINHO DA SILVA");

    // E o arquivo segue íntegro: uma linha por lote, todas reconhecidas.
    const bloco = lerLinhasDoMapa(atualizado.html);
    expect(bloco?.desconhecidas).toBe(0);
    expect(bloco?.linhas.length).toBe(linhas.length);
    expect(recortarMasterplan(atualizado.html, new Set(linhas.map((l) => l.chave))).ok).toBe(true);
  });

  it("não escreve número inválido no lugar do valor", () => {
    const html = REAIS.find((r) => r.nome === "vale-do-ouro")?.html;
    if (!html) return;

    const chave = (lerLinhasDoMapa(html)?.linhas ?? [])[0]!.chave;
    // `NaN` viraria o texto "NaN" dentro do array e mataria o parse do mesmo jeito que a aspas.
    const atualizado = aplicarEstadoAtual(
      html,
      new Map([[chave, { comprador: "", situacao: 99, valor: Number.NaN }]]),
    );

    const depois = comoEstaNoHtml(atualizado.html).get(chave);
    expect(depois?.valor).toBe(0);
    // ⚠️ Situação fora da régua vai para o ÚLTIMO slot (ocupado), nunca para o 0: valor que não se
    // entende não pode virar lote livre.
    expect(depois?.situacao).toBe(MAPA.BLOQUEADO);
    expect(lerLinhasDoMapa(atualizado.html)?.desconhecidas).toBe(0);

    for (const invalida of [-1, 1.5, Number.NaN]) {
      const outro = aplicarEstadoAtual(
        html,
        new Map([[chave, { comprador: "", situacao: invalida, valor: 1 }]]),
      );
      expect(comoEstaNoHtml(outro.html).get(chave)?.situacao).toBe(MAPA.BLOQUEADO);
    }
  });

  // ⚠️ O GARDEN TEM TRÊS SITUAÇÕES, E NÃO QUATRO: `['Disponível','Reservado','Vendido']`. Gravar `3`
  // nele fazia o lote SUMIR do mapa (o `pintar()` de lá percorre `s<3` e `F.sit[3]` é `undefined`).
  it("no Garden, o bloqueado vai para o último slot que o arquivo tem, e não some", () => {
    const html = REAIS.find((r) => r.nome === "garden")?.html;
    if (!html) return;
    expect(situacoesDoArquivo(html)).toBe(3);

    const chaves = (lerLinhasDoMapa(html)?.linhas ?? []).map((l) => l.chave);
    const atualizado = aplicarEstadoAtual(
      html,
      new Map(chaves.map((c) => [c, { comprador: "", situacao: MAPA.BLOQUEADO, valor: 0 }])),
    );

    expect(atualizado.escrito).toBe(true);
    for (const estado of comoEstaNoHtml(atualizado.html).values()) {
      expect(estado.situacao).toBe(2);
    }
    expect(recortarMasterplan(atualizado.html, new Set(chaves)).ok).toBe(true);
  });

  it("arquivo que não declara quantas situações conhece não é escrito, e quem chama recusa", () => {
    const semSlots = [
      "<script>",
      "const DADOS=[",
      '[1,"01",0,426.31,140401,"","10,10 20,10 20,20"]];',
      "</script>",
    ].join("\n");

    const atualizado = aplicarEstadoAtual(
      semSlots,
      new Map([["1-01", { comprador: "X", situacao: MAPA.VENDIDO, valor: 1 }]]),
    );
    expect(atualizado.escrito).toBe(false);
    expect(atualizado.html).toBe(semSlots);
  });
});

// A PROVA QUE NENHUM REGEX DÁ: o `DADOS` reescrito ainda é JavaScript válido.
//
// Os testes acima conferem campo a campo com expressão regular, e uma expressão regular acha o que
// ela procura — não o que sobrou. Se a reescrita deixar o array sintaticamente quebrado, o erro não
// aparece no servidor: o navegador morre no parse e o mapa abre EM BRANCO. Aqui o array volta a
// virar dado de verdade (`JSON.parse`, que o formato do arquivo permite) e é conferido lote a lote.
describe("o DADOS reescrito continua sendo um array válido", () => {
  /** Extrai `const DADOS=[…];` e devolve o array já parseado. */
  function parseDados(html: string): unknown[] {
    const inicio = html.indexOf("const DADOS=[");
    expect(inicio).toBeGreaterThanOrEqual(0);
    const corpo = html.slice(inicio + "const DADOS=".length);
    const fim = corpo.indexOf("];");
    expect(fim).toBeGreaterThan(0);
    return JSON.parse(corpo.slice(0, fim + 1)) as unknown[];
  }

  it.each(REAIS)("$nome sobrevive ao parse com nomes de gente de verdade", ({ html }) => {
    const linhas = lerLinhasDoMapa(html)?.linhas ?? [];

    // Nomes que existem em cartório e já quebraram parser: apóstrofo, acento, cedilha, hífen — e
    // uma aspas, que é o caso que a escrita tem que neutralizar sozinha.
    const nomes = [
      "MARIA D'ÁVILA GONÇALVES",
      "JOSÉ ANTÔNIO SILVA-JÚNIOR",
      'ANA "NANI" ASSUNÇÃO',
      "FRANÇOIS ÑUÑEZ",
      "",
    ];

    const estados = new Map<string, EstadoDoLote>(
      linhas.map((l, i) => [
        l.chave,
        { comprador: nomes[i % nomes.length]!, situacao: i % 4, valor: i * 1000 },
      ]),
    );

    const dados = parseDados(aplicarEstadoAtual(html, estados).html);
    // O Garden tem três situações: o `3` dele cai no último slot (ver o teste do Garden acima).
    const ultimo = (situacoesDoArquivo(html) ?? 4) - 1;

    // Uma linha por lote, sete campos cada, e nada de `undefined` no meio.
    expect(dados.length).toBe(linhas.length);
    dados.forEach((linha, i) => {
      expect(Array.isArray(linha)).toBe(true);
      const campos = linha as unknown[];
      expect(campos.length).toBe(7);
      expect(campos[2]).toBe(Math.min(i % 4, ultimo));
      expect(campos[4]).toBe(i * 1000);
      expect(typeof campos[5]).toBe("string");
      // O polígono é o desenho e não pode ter sido tocado.
      expect(String(campos[6])).toBe(linhas[i]!.poligono);
    });

    // A aspas do "NANI" saiu, e o resto do nome ficou.
    const comAspas = dados.map((l) => (l as unknown[])[5]).filter((n) => n === "ANA NANI ASSUNÇÃO");
    expect(comAspas.length).toBeGreaterThan(0);
  });
});
