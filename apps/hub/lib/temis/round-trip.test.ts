// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BaseBasicBlocksPlugin, BaseBasicMarksPlugin } from "@platejs/basic-nodes";
import {
  BaseFontBackgroundColorPlugin,
  BaseFontColorPlugin,
  BaseFontFamilyPlugin,
  BaseFontSizePlugin,
  BaseLineHeightPlugin,
  BaseTextAlignPlugin,
  BaseTextIndentPlugin,
} from "@platejs/basic-styles";
import { BaseIndentPlugin } from "@platejs/indent";
import { BaseListPlugin } from "@platejs/list";
import { BaseTablePlugin } from "@platejs/table";
import { createSlateEditor, deserializeHtml } from "platejs";
import { beforeAll, describe, expect, it } from "vitest";

import {
  documentoParaHtml,
  documentoParaTexto,
  type NoDoDocumento,
} from "./documento-html";
import { classificarVariaveis, conferirBlocos, variaveisDoTexto } from "./variaveis";

// A VOLTA COMPLETA, COM A MINUTA QUE ESTÁ NO AR.
//
// ⚠️ ESTE É O TESTE QUE FALTAVA, e a falta era grave: os números de fidelidade viviam num comentário
// ("244 marcadores entram, 244 saem"), o que não impede nada. Um plugin novo, uma mudança no
// serializador, e a formatação do contrato mudaria sem ninguém ver. Aqui os números são asserção.
//
// O percurso testado é o REAL: o HTML da minuta do C2X entra no editor, é convertido no documento do
// Plate, e volta ao HTML pelo nosso serializador — que é o que gera o contrato assinado.
//
// O fixture é a `JDG-MINUTA-COMPRA-VENDA-NORMAL` (draft_contract #85), a minuta que emite os
// contratos do Jardim das Gerais hoje: 41.827 bytes, 244 marcadores, 7 contratos já assinados.

const MINUTA = readFileSync(join(__dirname, "fixtures/minuta-jdg-c2x.html"), "utf8");

let documento: NoDoDocumento[];
let htmlDeVolta: string;

beforeAll(() => {
  // Os MESMOS plugins do editor. Se esta lista divergir de `editor-de-minuta.tsx`, o teste passa a
  // medir outra coisa — é o único ponto de manutenção manual deste arquivo.
  const editor = createSlateEditor({
    plugins: [
      BaseBasicBlocksPlugin,
      BaseBasicMarksPlugin,
      BaseTextAlignPlugin,
      BaseFontFamilyPlugin,
      BaseFontSizePlugin,
      BaseFontColorPlugin,
      BaseFontBackgroundColorPlugin,
      BaseLineHeightPlugin,
      BaseTextIndentPlugin,
      BaseIndentPlugin,
      BaseListPlugin,
      BaseTablePlugin,
    ],
  });

  documento = deserializeHtml(editor, { element: MINUTA }) as NoDoDocumento[];
  htmlDeVolta = documentoParaHtml(documento);
});

describe("as variáveis — nenhuma pode se perder no caminho", () => {
  it("as 244 ocorrências entram e as 244 saem", () => {
    const antes = variaveisDoTexto(MINUTA);
    const depois = variaveisDoTexto(htmlDeVolta);

    expect(antes).toHaveLength(244);
    expect(depois).toHaveLength(antes.length);
  });

  it("os 171 nomes distintos sobrevivem, um a um", () => {
    const antes = new Set(variaveisDoTexto(MINUTA));
    const depois = new Set(variaveisDoTexto(htmlDeVolta));

    expect(antes.size).toBe(171);
    const perdidas = [...antes].filter((nome) => !depois.has(nome));
    expect(perdidas).toEqual([]);
  });

  it("e o catálogo reconhece TODAS elas — nenhum marcador órfão", () => {
    // Se uma variável desta minuta não estivesse no catálogo, ela sairia impressa no contrato como
    // "[nome_da_variavel]", que é o defeito que já existe nas minutas antigas com "[Nome]".
    const { desconhecidas } = classificarVariaveis(htmlDeVolta);
    expect(desconhecidas).toEqual([]);
  });
});

describe("o texto — o documento atravessa inteiro", () => {
  it("nenhum parágrafo se perde", () => {
    // 75 parágrafos no HTML original, medidos em 01/09/2026.
    const paragrafosNoOriginal = (MINUTA.match(/<p[ >]/g) ?? []).length;
    const paragrafosDeVolta = (htmlDeVolta.match(/<p[ >]/g) ?? []).length;

    expect(paragrafosNoOriginal).toBe(75);
    expect(paragrafosDeVolta).toBeGreaterThanOrEqual(paragrafosNoOriginal);
  });

  it("o texto puro tem o mesmo tamanho, dentro da margem das quebras de linha", () => {
    const original = MINUTA.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ");
    const nosso = documentoParaTexto(documento);

    // A diferença aceitável são as quebras de linha que separam blocos no texto puro. Mais que 5%
    // significa conteúdo perdido, não formatação.
    const diferenca = Math.abs(nosso.length - original.length) / original.length;
    expect(diferenca).toBeLessThan(0.05);
  });

  it("as frases que abrem e fecham o contrato continuam lá", () => {
    expect(htmlDeVolta).toContain("INSTRUMENTO PARTICULAR DE PROMESSA DE COMPRA E VENDA");
    expect(htmlDeVolta).toContain("QUADRO-RESUMO");
    expect(htmlDeVolta).toContain("PRAIA EMPREENDIMENTOS IMOBILI");
  });
});

describe("a formatação que o contrato impresso depende", () => {
  it("a fonte do loteador sobrevive", () => {
    // 450 dos 485 trechos da minuta têm font-family, sempre a mesma. Normalizar mudaria a cara de
    // todas as linhas do contrato — e o jurídico compara com a versão que o loteador entregou.
    expect(htmlDeVolta).toContain("Lucida Sans Unicode");
    const spansComFonte = (htmlDeVolta.match(/font-family:/g) ?? []).length;
    expect(spansComFonte).toBeGreaterThan(100);
  });

  it("o alinhamento dos parágrafos sobrevive", () => {
    // 75 de 75 parágrafos são justificados ou centralizados; nenhum usa o padrão.
    expect(htmlDeVolta).toContain("text-align:justify");
    expect(htmlDeVolta).toContain("text-align:center");
  });

  it("o quadro-resumo continua sendo um quadro, com borda", () => {
    // ⚠️ A BORDA NÃO ATRAVESSA A IMPORTAÇÃO — o Plate a descarta. É o serializador que a devolve.
    // Sem ela, a tabela de 17 linhas que contém o contrato inteiro vira texto corrido.
    expect(htmlDeVolta).toContain("<table");
    expect(htmlDeVolta).toContain("border:1px solid");
    const celulas = (htmlDeVolta.match(/<td/g) ?? []).length;
    expect(celulas).toBe(17);
  });

  it("o fundo do box de CIÊNCIA PRÉVIA sobrevive", () => {
    // Uma ocorrência só na minuta inteira, e é o destaque legal do aviso sobre desfazimento.
    //
    // ⚠️ O PLATE NORMALIZA A COR: o `#D9D9D9` do C2X chega como `rgb(217, 217, 217)`. É o mesmo
    // cinza (217 = 0xD9) e o navegador e o PDF renderizam igual — mas quem for comparar o HTML
    // antigo com o novo lado a lado precisa saber disso, ou vai achar que a cor mudou.
    expect(htmlDeVolta).toContain("background-color:rgb(217, 217, 217)");

    const celulasComFundo = (htmlDeVolta.match(/background-color:/g) ?? []).length;
    expect(celulasComFundo).toBe(1);
  });

  it("o negrito das partes sobrevive", () => {
    // 209 <strong> no original: são os nomes das partes, os valores e os títulos das cláusulas.
    const negritos = (htmlDeVolta.match(/<strong>/g) ?? []).length;
    expect(negritos).toBeGreaterThan(150);
  });
});

describe("o defeito que já está no ar", () => {
  it("a conferência acusa os blocos mal fechados desta minuta", () => {
    // Não é hipótese: a área de assinaturas do 2º comprador tem dois marcadores trocados, e esta
    // minuta já emitiu 7 contratos do JDG. O teste fixa o achado — se um dia a minuta for corrigida
    // no C2X e reimportada, este teste falha e nos obriga a atualizar o fixture conscientemente.
    const problemas = conferirBlocos(htmlDeVolta);

    expect(problemas.length).toBeGreaterThan(0);
    expect(problemas.map((p) => p.bloco)).toContain("dados_cliente_pf_2");
  });
});
