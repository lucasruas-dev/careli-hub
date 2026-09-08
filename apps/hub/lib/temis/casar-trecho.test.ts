import { describe, expect, it } from "vitest";

import { casarTrecho, normalizarParaBusca } from "./casar-trecho";

// ⚠️ O QUE ESTES TESTES PROTEGEM. Esta busca decide ONDE o agente age no contrato. Frouxa demais,
// ela "quase acha" o trecho e a substituição cai no lugar errado do instrumento. Estrita demais,
// ela joga fora metade do trabalho do modelo — que foi o que o Lucas viu em 08/09/2026: *"11
// propostas… 17 não casou com o texto e ficou de fora"*.

describe("normalizar para comparar", () => {
  it("colapsa espaços em sequência", () => {
    expect(normalizarParaBusca("a   b").texto).toBe("a b");
  });

  it("trata o espaço duro do Word como espaço comum", () => {
    expect(normalizarParaBusca("n.º 123").texto).toBe("n.º 123");
  });

  it("endireita aspas e traços que o Word curva sozinho", () => {
    expect(normalizarParaBusca("“a” – b ‘c’").texto).toBe('"a" - b \'c\'');
  });

  it("some com o espaço de largura zero e o BOM", () => {
    expect(normalizarParaBusca("a​b﻿c").texto).toBe("abc");
  });

  it("não come espaço do começo nem cria caractere do nada", () => {
    expect(normalizarParaBusca("   abc").texto).toBe("abc");
  });

  // ⚠️ O MAPA É O QUE PERMITE RECORTAR NO TEXTO DE VERDADE. Sem ele a posição encontrada seria a do
  // texto normalizado, e o recorte sairia deslocado de tantos caracteres quantos espaços foram
  // colapsados antes dele.
  it("lembra de onde veio cada caractere", () => {
    const { indices, texto } = normalizarParaBusca("a   b");
    expect(texto).toBe("a b");
    expect(indices).toEqual([0, 1, 4]);
  });
});

describe("achar o trecho", () => {
  it("acha e devolve as posições do texto ORIGINAL", () => {
    const r = casarTrecho("Eu,   JOÃO, casado", "Eu, JOÃO");
    expect(r.situacao).toBe("achou");
    if (r.situacao !== "achou") return;
    expect(r.casamento).toEqual({ fim: 10, inicio: 0 });
    expect("Eu,   JOÃO, casado".slice(0, 10)).toBe("Eu,   JOÃO");
  });

  it("acha apesar do espaço duro", () => {
    const r = casarTrecho("valor de R$ 100,00 pagos", "R$ 100,00");
    expect(r.situacao).toBe("achou");
  });

  it("acha um trecho partido por quebra de linha", () => {
    const r = casarTrecho("fim da cláusula\nII - INTERMEDIADORES", "cláusula II - INTERMEDIADORES");
    expect(r.situacao).toBe("achou");
  });

  // ⚠️ AMBÍGUO É RECUSA, NÃO ESCOLHA. Marcar a primeira ocorrência produz um contrato que parece
  // certo e qualifica a pessoa errada — o pior defeito, porque não tem sintoma.
  it("recusa quando o trecho aparece duas vezes", () => {
    expect(casarTrecho("CPF n.º 111 e CPF n.º 222", "CPF n.º").situacao).toBe("ambiguo");
  });

  it("recusa quando o trecho aparece duas vezes só depois de normalizar", () => {
    // Um com espaço duro, outro com espaço comum: literalmente diferentes, iguais para nós.
    expect(casarTrecho("CPF n.º 111 e CPF n.º 222", "CPF n.º").situacao).toBe("ambiguo");
  });

  it("recusa o que não existe", () => {
    expect(casarTrecho("COMPRADOR: JOÃO", "MARIA").situacao).toBe("nao_encontrado");
  });

  it("recusa trecho vazio ou só de espaços", () => {
    expect(casarTrecho("abc", "").situacao).toBe("nao_encontrado");
    expect(casarTrecho("abc", "   ").situacao).toBe("nao_encontrado");
  });

  // ⚠️ A TOLERÂNCIA PARA NA FORMA. Estas duas linhas são o limite do que a busca aceita: acento e
  // pontuação continuam valendo, porque "quase igual" num contrato é outro contrato.
  it("não confunde acento", () => {
    expect(casarTrecho("José da Silva", "Jose da Silva").situacao).toBe("nao_encontrado");
  });

  it("não confunde pontuação", () => {
    expect(casarTrecho("CPF n.º 111", "CPF no 111").situacao).toBe("nao_encontrado");
  });
});

describe("o contexto desambigua a lacuna", () => {
  // ⚠️ A MINUTA DO JARDIM DAS GERAIS, que o Lucas mandou em 08/09/2026, não vem preenchida: vem com
  // o lugar do dado em branco. A lacuna aparece dezenas de vezes, e sem âncora TODA proposta sobre
  // ela seria recusada como ambígua — justamente a metade da minuta que mais precisa de variável.
  const minuta =
    "NOME COMPLETO, nacionalidade, estado civil, profissão, inscrito no CPF sob o n.º ________________, " +
    "portador do documento de identidade _______________, expedido pela __________, residente e " +
    "domiciliado na Rua ________________, n.º _____, Bairro ______________";

  it("sem contexto, a lacuna é ambígua", () => {
    expect(casarTrecho(minuta, "________________").situacao).toBe("ambiguo");
  });

  it("com contexto, acha a lacuna certa", () => {
    const r = casarTrecho(minuta, "________________", "inscrito no CPF sob o n.º ________________, portador");
    expect(r.situacao).toBe("achou");
    if (r.situacao !== "achou") return;
    // ⚠️ SÓ A LACUNA É SUBSTITUÍDA. "inscrito no CPF sob o n.º" é texto do contrato e continua lá —
    // o contexto ancora, não alarga.
    expect(minuta.slice(r.casamento.inicio, r.casamento.fim)).toBe("________________");
    expect(minuta.slice(0, r.casamento.inicio)).toContain("inscrito no CPF sob o n.º ");
  });

  it("acha a OUTRA lacuna igual, com o contexto dela", () => {
    const r = casarTrecho(minuta, "________________", "domiciliado na Rua ________________, n.º");
    expect(r.situacao).toBe("achou");
    if (r.situacao !== "achou") return;
    expect(minuta.slice(0, r.casamento.inicio)).toContain("domiciliado na Rua ");
  });

  it("recusa quando o próprio contexto se repete", () => {
    const texto = "o CPF ____ do titular e o CPF ____ do titular";
    expect(casarTrecho(texto, "____", "o CPF ____ do titular").situacao).toBe("ambiguo");
  });

  it("recusa quando o contexto não existe no texto", () => {
    expect(casarTrecho(minuta, "________________", "inscrito no CNPJ sob o n.º").situacao).toBe(
      "nao_encontrado",
    );
  });

  it("recusa quando o trecho não está dentro do contexto", () => {
    expect(casarTrecho(minuta, "NOME COMPLETO", "domiciliado na Rua ________________, n.º").situacao).toBe(
      "nao_encontrado",
    );
  });
});
