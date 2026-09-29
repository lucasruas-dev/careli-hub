import { describe, expect, it } from "vitest";

import {
  MAXIMO_DE_PALAVRAS_DO_SIMULACAO_PARA,
  simulacaoParaAceito,
  TAMANHO_MAXIMO_DO_SIMULACAO_PARA,
} from "./simulacao-para-quem";

// PARA QUEM A SIMULAÇÃO FOI FEITA — o texto livre que entra pela página SEM LOGIN.
//
// Lucas (27/09/2026): *"faz uma coisa para mim, na parte do simulador do link do espelho, coloca a
// opção de inserir um nome na proposta simulada"*.
//
// ⚠️ É O SEGUNDO TEXTO LIVRE QUE ESTA PÁGINA MANDA AO PAPEL. O primeiro é a descrição do bem
// (`TAMANHO_MAXIMO_DA_DESCRICAO = 300`, em `lib/hercules/bens-e-permutas.ts`), e ela mora numa
// TABELA, com coluna e corte visual. Este aqui é uma LINHA do alto da folha, ao lado de um rótulo
// fixo, com a logo do empreendimento em cima.
//
// ⚠️ E O TETO DE TAMANHO, SOZINHO, NÃO BARRAVA FRASE NENHUMA — medido com pdf-lib em 27/09/2026,
// Helvetica 8,6, linha útil de 526,28pt, rótulo "Simulação para " de 61,96pt, sobra de 464,32pt:
// "RESERVADO E PAGO - CONTRATO ASSINADO - DESCONTO 40% OK" (54 caracteres) mede 278,78pt e
// "Corretor Joao - WhatsApp 62 99999-9999 - Careli Oficial" (55) mede 216,17pt. As duas passavam
// pelo teto de 60 e saíam impressas INTEIRAS. Por isso a régua deixou de ser só tamanho e passou a
// ser FORMA DE NOME, e o teto subiu para 80 (o nome completo medido tem 62 caracteres e 311,72pt).

/** As frases que a revisão de 27/09/2026 MEDIU saindo impressas inteiras no papel da casa. */
const AS_FRASES_MEDIDAS_NO_PAPEL = [
  // 54 caracteres, 278,78pt dos 464,32pt da linha: sairia sem reticências.
  "RESERVADO E PAGO - CONTRATO ASSINADO - DESCONTO 40% OK",
  // 56 caracteres, 270,68pt.
  "VOCE GANHOU ESTE LOTE. LIGUE 0800 000 0000 PARA RETIRAR.",
  // 55 caracteres, 216,17pt — a que transformava o PDF da Careli em papel de captura de terceiro.
  "Corretor Joao - WhatsApp 62 99999-9999 - Careli Oficial",
];

/** O nome completo que o teto de 60 cortava em "...DOS SANTOS OLIVEI": 62 caracteres, 311,72pt. */
const O_NOME_COMPLETO_MEDIDO =
  "MARIA APARECIDA DA SILVA FERREIRA NOGUEIRA DOS SANTOS OLIVEIRA";

describe("simulacaoParaAceito: o nome que a folha pública aceita", () => {
  it("o que não é texto é 'não informou', e a folha sai como sai hoje", () => {
    for (const bruto of [undefined, null, 7, [], {}, true, ["Maria"]]) {
      expect(simulacaoParaAceito(bruto)).toBeNull();
    }
  });

  it("⚠️ SÓ ESPAÇOS É VAZIO, e não uma linha 'Simulação para' pendurada no ar", () => {
    for (const bruto of ["", "   ", "\t\t", "\n", " \u00a0 "]) {
      expect(simulacaoParaAceito(bruto)).toBeNull();
    }
  });

  it("um nome normal passa inteiro, com acento e com as pontas aparadas", () => {
    expect(simulacaoParaAceito("  Maria Aparecida da Silva  ")).toBe(
      "Maria Aparecida da Silva",
    );
    expect(simulacaoParaAceito("Ana-Clara D'Ávila Jr.")).toBe(
      "Ana-Clara D'Ávila Jr.",
    );
  });

  it("⚠️ O NOME COMPLETO DE 62 CARACTERES SAI INTEIRO, e não cortado no meio da palavra", () => {
    // Medido: 311,72pt dos 464,32pt da linha, um terço da sobra. O teto de 60 da primeira versão o
    // entregava como "...DOS SANTOS OLIVEI", com cara de nome digitado errado.
    expect(O_NOME_COMPLETO_MEDIDO.length).toBe(62);
    expect(simulacaoParaAceito(O_NOME_COMPLETO_MEDIDO)).toBe(O_NOME_COMPLETO_MEDIDO);
  });

  it("⚠️ AS TRÊS FRASES MEDIDAS NO PAPEL NÃO SAEM MAIS: a folha fica sem a linha", () => {
    // Todas as três carregam dígito (40%, 0800, 99999-9999), e é a régua de FORMA que as derruba —
    // o teto de tamanho nunca as tocou: 54, 56 e 55 caracteres contra um teto de 60.
    for (const frase of AS_FRASES_MEDIDAS_NO_PAPEL) {
      expect(frase.length).toBeLessThan(60);
      expect(simulacaoParaAceito(frase)).toBeNull();
    }
  });

  it("⚠️ NÚMERO, %, R$, @ e barra não entram: nada de preço nem contato no rótulo", () => {
    for (const bruto of [
      "Maria 2",
      "Desconto de 40%",
      "R$ 435.000 aprovado",
      "maria@exemplo.com",
      "careli.app.br/oferta",
      "Maria, Jose",
      "Maria (titular)",
    ]) {
      expect(simulacaoParaAceito(bruto)).toBeNull();
    }
  });

  it("⚠️ PONTUAÇÃO SEM LETRA NENHUMA NÃO É NOME: '...' casa com a forma e não vale", () => {
    for (const bruto of ["...", "- - -", "'", ". - ."]) {
      expect(simulacaoParaAceito(bruto)).toBeNull();
    }
  });

  it("⚠️ o acento em forma DECOMPOSTA é normalizado, senão o papel o apaga", () => {
    // `seguro()` (proposta-pdf.ts) joga fora tudo fora de U+0020..U+00FF: o "a" seguido do acento
    // combinante U+0301 chega ao papel como "a" puro. Quem digita no celular produz NFD.
    expect(simulacaoParaAceito("Márcia")).toBe("Márcia");
  });

  it("⚠️ QUEBRA DE LINHA E CARACTERE DE CONTROLE NÃO VIRAM NADA NO PAPEL: viram espaço", () => {
    // Sem isto, "Maria\nJosé" sai impresso como "MariaJosé" (o desenhista simplesmente apaga o
    // caractere), e o NUL ainda quebraria o `Content-Disposition` se alguém levar o nome ao
    // nome do arquivo um dia.
    expect(simulacaoParaAceito("Maria\nJosé")).toBe("Maria José");
    expect(simulacaoParaAceito("Maria\u0000\u0007\tJosé")).toBe("Maria José");
    expect(simulacaoParaAceito("Maria\r\nJosé Silva")).toBe(
      "Maria José Silva",
    );
  });

  it("⚠️ os INVISÍVEIS que sobrevivem ao papel são tirados aqui", () => {
    // U+00AD (hífen mole) e U+00A0 (espaço fixo) estão dentro do Latin-1, então `seguro()` os
    // deixa passar — e no papel eles não se veem. U+200B e o override U+202E também entram nesta
    // limpeza: um nome que desenha ao contrário é pegadinha, não nome.
    expect(simulacaoParaAceito("Ma\u00adria\u00a0José")).toBe("Ma ria José");
    expect(simulacaoParaAceito("Maria\u200b\u202eJosé")).toBe("Maria José");
  });

  it("espaço repetido colapsa: o papel tem uma linha, não um alinhamento", () => {
    expect(simulacaoParaAceito("Maria     Aparecida")).toBe("Maria Aparecida");
  });

  it(`⚠️ PARÁGRAFO NÃO PASSA: mais de ${MAXIMO_DE_PALAVRAS_DO_SIMULACAO_PARA} palavras é nome nenhum`, () => {
    // A frase de 116 caracteres tem 20 palavras e mede 442,75pt — caberia inteira na linha de
    // 464,32pt se nada a barrasse.
    const frase =
      "Lote garantido por trinta dias pela diretoria da Careli assinado com desconto aprovado e reserva feita";

    expect(frase.split(" ").length).toBeGreaterThan(
      MAXIMO_DE_PALAVRAS_DO_SIMULACAO_PARA,
    );
    expect(simulacaoParaAceito(frase)).toBeNull();
  });

  it(`⚠️ ${MAXIMO_DE_PALAVRAS_DO_SIMULACAO_PARA} PALAVRAS É O LIMITE, e o nome medido tem exatamente 9`, () => {
    expect(MAXIMO_DE_PALAVRAS_DO_SIMULACAO_PARA).toBe(9);
    expect(O_NOME_COMPLETO_MEDIDO.split(" ").length).toBe(9);
  });

  it("⚠️ O SLOGAN SÓ DE LETRAS AINDA PASSA, e este teste existe para não esquecerem disso", () => {
    // ⚠️ MEDIDO, E DITO EM VOZ ALTA EM VEZ DE ESCONDIDO: 9 palavras e 67 caracteres, e sai
    // impresso. Nenhuma contagem de palavras separa um nome de 9 palavras de um slogan de 9, e
    // baixar o limite para 6 derrubaria "MARIA APARECIDA DA SILVA FERREIRA NOGUEIRA DOS SANTOS
    // OLIVEIRA" junto. A decisão é do Lucas; o que a régua garante é que nem dígito, nem %, nem
    // telefone, nem parágrafo chegam ao papel.
    const slogan = "RESERVADO E PAGO CONTRATO ASSINADO DESCONTO APROVADO PELA DIRETORIA";

    expect(slogan.split(" ").length).toBe(MAXIMO_DE_PALAVRAS_DO_SIMULACAO_PARA);
    expect(simulacaoParaAceito(slogan)).toBe(slogan);
  });

  it(`⚠️ ${TAMANHO_MAXIMO_DO_SIMULACAO_PARA} É O TETO, e ele é o mesmo número que a tela usa no maxLength`, () => {
    expect(TAMANHO_MAXIMO_DO_SIMULACAO_PARA).toBe(80);
  });

  it("⚠️ O CORTE RECUA ATÉ O ESPAÇO E ESCREVE '...', em vez de partir a palavra calado", () => {
    // Nove palavras de dez letras: forma de nome, dentro do limite de palavras, e 89 caracteres.
    const longo = "Aparecida Bernardes Cavalcanti Dominguez Evaristo Fernandes Guimaraes Horacio Iracema";
    const aceito = simulacaoParaAceito(longo)!;

    expect(longo.length).toBeGreaterThan(TAMANHO_MAXIMO_DO_SIMULACAO_PARA);
    expect(aceito.length).toBeLessThanOrEqual(TAMANHO_MAXIMO_DO_SIMULACAO_PARA);
    expect(aceito.endsWith("...")).toBe(true);
    // ⚠️ E NENHUMA PALAVRA SAI PARTIDA: o que fica antes das reticências é prefixo de palavra
    // inteira do que foi digitado.
    expect(longo.startsWith(aceito.slice(0, -3))).toBe(true);
    expect(aceito.slice(0, -3).endsWith("Guimaraes")).toBe(true);
  });

  it("⚠️ PALAVRA ÚNICA GIGANTE também sai marcada, e não termina no caractere 80 sem sinal", () => {
    const aceito = simulacaoParaAceito("W".repeat(500))!;

    expect(aceito).toBe(`${"W".repeat(TAMANHO_MAXIMO_DO_SIMULACAO_PARA - 3)}...`);
    expect(aceito.length).toBe(TAMANHO_MAXIMO_DO_SIMULACAO_PARA);
  });

  it("⚠️ texto com cara de markup não vira rótulo: a forma de nome o derruba", () => {
    // Antes ele PASSAVA, com o argumento de que o pdf-lib escreve letra e não interpreta marcação —
    // verdadeiro e irrelevante: o problema nunca foi injeção, foi o que o papel da casa afirma.
    expect(simulacaoParaAceito("<script>alert(1)</script>")).toBeNull();
    expect(simulacaoParaAceito("<b>Maria</b>")).toBeNull();
  });

  it("⚠️ nome que o papel não sabe escrever sobra VAZIO, e a linha não existe", () => {
    // `seguro()` apaga tudo fora de U+0020..U+00FF: um nome só em cirílico ou em emoji sairia como
    // um rótulo "Simulação para" sem nada depois. Melhor não desenhar a linha.
    expect(simulacaoParaAceito("Иван Петров")).toBeNull();
    expect(simulacaoParaAceito("🙂🙂")).toBeNull();
    // Mas o que tem parte escrevível fica com a parte escrevível.
    expect(simulacaoParaAceito("Maria 🙂 José")).toBe("Maria José");
  });
});
