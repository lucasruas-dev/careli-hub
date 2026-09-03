// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createSlateEditor, deserializeHtml, type Value } from "platejs";
import { beforeAll, describe, expect, it } from "vitest";

import { BaseEditorKitTemis } from "@/modules/temis/editor-base-kit-temis";
import { promoverVariaveisNoValor, VARIAVEL_KEY } from "@/modules/temis/plugins/variavel-kit-base";

import {
  documentoParaHtml,
  documentoParaTexto,
  type NoDeTexto,
  type NoDoDocumento,
} from "./documento-html";
import { migrarAlinhamentoAntigo } from "./migrar-documento";
import { classificarVariaveis, codigosPartidos, conferirBlocos, variaveisDoTexto } from "./variaveis";

// A VOLTA COMPLETA, COM A MINUTA QUE ESTÁ NO AR.
//
// ⚠️ ESTE É O TESTE QUE FALTAVA, e a falta era grave: os números de fidelidade viviam num comentário
// ("244 marcadores entram, 244 saem"), o que não impede nada. Um plugin novo, uma mudança no
// serializador, e a formatação do contrato mudaria sem ninguém ver. Aqui os números são asserção.
//
// O percurso testado é o REAL: o HTML da minuta entra no editor, é convertido no documento do Plate,
// as variáveis viram NÓS (`{ type: "variavel", nome }`, como o editor faz desde 02/09/2026), e o
// documento volta ao HTML pelo nosso serializador — que é o que gera o contrato assinado.
//
// Os plugins são os MESMOS do editor: `BaseEditorKitTemis` é a lista única (Frente B), sem React.
// Não há mais ponto de manutenção manual aqui — se o editor ganhar um plugin com nó novo, ele
// chega ao teste sozinho, e o serializador precisa saber emiti-lo.
//
// O fixture é a `JDG-MINUTA-COMPRA-VENDA-NORMAL` (draft_contract #85 do legado), a minuta que emite
// os contratos do Jardim das Gerais hoje: 41.827 bytes, 244 marcadores, 7 contratos já assinados.
// Entrou no repo em 01/09/2026; é a última coisa que veio do legado — o valor de cada variável nasce
// do Panteon (Lucas, 02/09/2026: *"esquece c2x como consulta"*).

const MINUTA = readFileSync(join(__dirname, "fixtures/minuta-jdg-c2x.html"), "utf8");

/** O documento como o Plate o leu do HTML — as variáveis ainda são TEXTO `[nome]`. */
let lido: NoDoDocumento[];
let documento: NoDoDocumento[];
let htmlDeVolta: string;

beforeAll(() => {
  const editor = createSlateEditor({ plugins: BaseEditorKitTemis });

  lido = deserializeHtml(editor, { element: MINUTA }) as unknown as NoDoDocumento[];
  // É o que o editor faz ao abrir uma minuta: `[nome]` em texto vira nó de variável.
  documento = promoverVariaveisNoValor(lido as unknown as Value) as unknown as NoDoDocumento[];
  htmlDeVolta = documentoParaHtml(documento);
});

/** Conta os nós de um tipo, em qualquer profundidade. */
function contarNos(nos: (NoDeTexto | NoDoDocumento)[], tipo: string): number {
  let n = 0;
  for (const no of nos) {
    const bloco = no as NoDoDocumento;
    if (bloco.type === tipo) n += 1;
    if (bloco.children) n += contarNos(bloco.children, tipo);
  }
  return n;
}

describe("as variáveis — nenhuma pode se perder no caminho", () => {
  it("as 244 ocorrências viram 244 nós de variável no documento", () => {
    // É o contrato C0.1: no editor a variável é um nó, não texto. Se a promoção deixasse alguma
    // como texto, ela continuaria funcionando no contrato (o texto atravessa), mas partiria com
    // uma marca no meio — o defeito do `[nome_cl</strong>iente]`.
    expect(contarNos(documento, VARIAVEL_KEY)).toBe(244);
    // ⚠️ NO TEXTO PURO SÃO 245: a `[nome_cliente]` partida por tag no legado (`[nome_cl` + `iente]`,
    // dois textos vizinhos) se junta quando os leaves são concatenados — é a mesma diferença
    // texto × HTML que `codigosPartidos` mede na tela. Ela não vira nó porque, no editor, os dois
    // pedaços são leaves distintos; fica como texto e continua acusada (ver o teste abaixo).
    expect(variaveisDoTexto(documentoParaTexto(documento))).toHaveLength(245);
  });

  it("as 244 ocorrências entram e as 244 saem — mais a que o legado tinha partido", () => {
    const antes = variaveisDoTexto(MINUTA);
    const depois = variaveisDoTexto(htmlDeVolta);

    expect(antes).toHaveLength(244);
    // ⚠️ 245 NA VOLTA, e é ganho, não perda: a `[nome_cliente]` que o legado partiu por tag
    // (`<strong>[nome_cl</strong></span><span…><strong>iente]`) chega ao editor como dois trechos
    // vizinhos com o MESMO estilo e a MESMA marca. O serializador agrupa esses dois num único
    // `<strong>` (é o que o Slate faz na normalização ao primeiro toque) e a variável sai inteira —
    // `[nome_cliente]` passa a ser preenchida em vez de impressa. Nenhuma das 244 se perde.
    expect(depois).toHaveLength(antes.length + 1);
    expect(new Set(depois)).toEqual(new Set(antes));
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

  it("a variável em negrito sai INTEIRA dentro do <strong>", () => {
    // O JDG escreve quadra e lote em negrito. Com a variável como nó, a marca veste o `[nome]`
    // inteiro — nunca `<strong>[numero_qu</strong>adra]`.
    expect(htmlDeVolta).toMatch(/<strong>\[numero_quadra\]<\/strong>/);
  });

  it("abrir e salvar sem mexer grava o MESMO HTML — a promoção não muda o contrato", () => {
    // ⚠️ ESTE É O TESTE QUE FALTAVA NA IDENTIDADE. As contagens acima passavam enquanto cada chip
    // partia o `<span style="font-family:…">` em três (texto, [variavel], texto): medido em
    // 02/09/2026, o `conteudo_html` da minuta do JDG ia de 65.514 para 87.401 bytes (+33%) só de
    // abrir e salvar, e qualquer diff entre versões acusava o documento inteiro. O serializador
    // agrupa os trechos vizinhos de mesmo estilo; aqui a igualdade é asserção, byte a byte.
    expect(documentoParaHtml(documento)).toBe(documentoParaHtml(lido));
  });

  it("a promoção não CRIA código partido — e o que veio partido do legado sai INTEIRO", () => {
    // ⚠️ O FIXTURE CARREGA O DEFEITO REAL: `<strong>[nome_cl</strong></span><span…><strong>iente]`
    // é a 245ª ocorrência, a que imprimiu "[nome_cliente]" no primeiro contrato do JDG. Ela chega
    // ao editor como DOIS textos, `[nome_cl` e `iente]`, e nenhum dos dois é variável — por isso
    // não vira nó na promoção. `codigosPartidos` a acusa no HTML de ENTRADA. Na volta, os dois
    // trechos têm o mesmo estilo e a mesma marca, e o serializador os junta num `<strong>` só
    // (ver `documento-html.ts`, "trechos vizinhos"): o HTML do contrato sai com `[nome_cliente]`
    // inteira e a conferência deixa de acusar — corretamente, porque o defeito deixou de existir.
    // O que este teste garante: a volta NUNCA tem mais partidos que a entrada.
    const partidosAntes = codigosPartidos(MINUTA).map((p) => p.nome);
    const partidosDepois = codigosPartidos(htmlDeVolta).map((p) => p.nome);

    expect(partidosAntes).toEqual(["nome_cliente"]);
    expect(partidosDepois).toEqual([]);
    expect(htmlDeVolta).toContain("[nome_cliente]");
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
    // significa conteúdo perdido, não formatação. As variáveis contam: `documentoParaTexto` as
    // escreve como `[nome]`.
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
    // ⚠️ O PLATE NORMALIZA A COR: o `#D9D9D9` do legado chega como `rgb(217, 217, 217)`. É o mesmo
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

describe("minuta salva pelo editor antigo — o alinhamento vinha na chave `textAlign`", () => {
  it("abre no editor novo com `align` e o HTML do contrato sai alinhado", () => {
    // O editor de 01/09 gravava `{ textAlign: "center" }` (KEYS.textAlign); o AlignKit lê `align`.
    // Sem a migração, o título abria à esquerda e realinhar não mudava o contrato.
    const antigo: NoDoDocumento[] = [
      { children: [{ text: "INSTRUMENTO PARTICULAR" }], textAlign: "center", type: "h1" },
      { children: [{ text: "Cláusula 1ª." }], textAlign: "justify", type: "p" },
    ];
    const editor = createSlateEditor({
      plugins: BaseEditorKitTemis,
      value: migrarAlinhamentoAntigo(antigo) as unknown as Value,
    });
    const blocos = editor.children as unknown as NoDoDocumento[];

    expect(blocos.map((b) => b.align)).toEqual(["center", "justify"]);
    expect(blocos.some((b) => "textAlign" in b)).toBe(false);
    expect(documentoParaHtml(blocos)).toBe(
      '<h1 style="text-align:center">INSTRUMENTO PARTICULAR</h1><p style="text-align:justify">Cláusula 1ª.</p>',
    );
  });
});

describe("o defeito que já está no ar", () => {
  it("a conferência acusa os blocos mal fechados desta minuta", () => {
    // Não é hipótese: a área de assinaturas do 2º comprador tem dois marcadores trocados, e esta
    // minuta já emitiu 7 contratos do JDG. O teste fixa o achado — se um dia a minuta for corrigida
    // e reimportada, este teste falha e nos obriga a atualizar o fixture conscientemente.
    const problemas = conferirBlocos(htmlDeVolta);

    expect(problemas.length).toBeGreaterThan(0);
    expect(problemas.map((p) => p.bloco)).toContain("dados_cliente_pf_2");
  });
});
