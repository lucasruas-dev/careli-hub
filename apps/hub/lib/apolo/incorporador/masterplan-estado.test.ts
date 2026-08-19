import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { aplicarEstadoAtual, type EstadoDoLote, MAPA, situacaoDoMapa } from "./masterplan-estado";
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

describe("situacaoDoMapa", () => {
  it("usa a mesma régua da tela de Vendas", () => {
    // Os cinco status do C2X caindo nas quatro cores do mapa.
    expect(situacaoDoMapa(1, 0)).toBe(MAPA.DISPONIVEL);
    expect(situacaoDoMapa(2, 0)).toBe(MAPA.RESERVADO);
    // "Em negociação" pinta de vendido: é assim que a tela de Vendas conta os 91 do VOL.
    expect(situacaoDoMapa(3, 0)).toBe(MAPA.VENDIDO);
    expect(situacaoDoMapa(4, 0)).toBe(MAPA.VENDIDO);
    expect(situacaoDoMapa(5, 0)).toBe(MAPA.BLOQUEADO);
  });

  it("bloqueia pelo flag E pelo status, cada um por si", () => {
    // O flag sozinho basta, mesmo com o status dizendo disponível.
    expect(situacaoDoMapa(1, 1)).toBe(MAPA.BLOQUEADO);
    // E o status 5 sozinho também: quem edita o legado à mão pode limpar um e esquecer o outro.
    expect(situacaoDoMapa(5, 0)).toBe(MAPA.BLOQUEADO);
    // O bloqueio ganha da venda — é o que tira o lote da oferta.
    expect(situacaoDoMapa(4, 1)).toBe(MAPA.BLOQUEADO);
  });

  it("trata status ausente como disponível, sem quebrar", () => {
    expect(situacaoDoMapa(null, null)).toBe(MAPA.DISPONIVEL);
    expect(situacaoDoMapa(0, 0)).toBe(MAPA.DISPONIVEL);
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
    // Situação fora das quatro cores cai no estado neutro, em vez de sumir da legenda.
    expect(depois?.situacao).toBe(MAPA.DISPONIVEL);
    expect(lerLinhasDoMapa(atualizado.html)?.desconhecidas).toBe(0);
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

    // Uma linha por lote, sete campos cada, e nada de `undefined` no meio.
    expect(dados.length).toBe(linhas.length);
    dados.forEach((linha, i) => {
      expect(Array.isArray(linha)).toBe(true);
      const campos = linha as unknown[];
      expect(campos.length).toBe(7);
      expect(campos[2]).toBe(i % 4);
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
