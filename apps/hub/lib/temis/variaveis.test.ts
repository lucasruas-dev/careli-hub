import { describe, expect, it } from "vitest";

import {
  acharVariavel,
  classificarVariaveis,
  codigosPartidos,
  conferirBlocos,
  extensosOrfaos,
  VARIAVEIS_DO_CONTRATO,
  variaveisDoTexto,
} from "./variaveis";

// ⚠️ OS CASOS AQUI SAÍRAM DE MINUTAS REAIS DO C2X e de um contrato que JÁ FOI ASSINADO com defeito.
// Não são hipóteses.

describe("o catálogo cobre o que as minutas realmente usam", () => {
  it("conhece as variáveis mais frequentes das 60 minutas medidas", () => {
    // As dez mais frequentes do levantamento (scripts/temis/variaveis-das-minutas.mjs).
    for (const nome of [
      "inicio_dados_conjuge",
      "fim_dados_conjuge",
      "fim_dados_cliente_pf_2",
      "inicio_dados_conjuge_2",
      "inicio_dados_cliente_2",
      "inicio_dados_cliente_pf",
      "nome_conjuge_2",
      "nome_cliente",
      "nome_fantasia_cliente_2",
      "email_cliente",
    ]) {
      expect(acharVariavel(nome), nome).toBeDefined();
    }
  });

  it("vai até o quinto comprador, com cônjuge", () => {
    expect(acharVariavel("nome_cliente_5")).toBeDefined();
    expect(acharVariavel("cpf_conjuge_5")).toBeDefined();
    expect(acharVariavel("cep_cliente_5")).toBeDefined();
    // E para no quinto: um sexto comprador não existe no legado.
    expect(acharVariavel("nome_cliente_6")).toBeUndefined();
  });

  it("o PRIMEIRO comprador não tem bloco condicional próprio", () => {
    // Ele sempre existe. O bloco é o que faz o trecho sumir quando a venda tem menos gente — e por
    // isso só nasce do segundo em diante. É como as minutas do C2X estão escritas.
    expect(acharVariavel("inicio_dados_cliente")).toBeUndefined();
    expect(acharVariavel("inicio_dados_cliente_2")).toBeDefined();
  });

  it("mas o par pessoa física / jurídica existe já no primeiro", () => {
    expect(acharVariavel("inicio_dados_cliente_pf")).toBeDefined();
    expect(acharVariavel("inicio_dados_cliente_pj")).toBeDefined();
  });

  it("os nomes de plano casam com os slots do cadastro", () => {
    // O slot do plano ("normal", "investidor", "curto") é o mesmo vocabulário da minuta. Se um dia
    // divergirem, o contrato imprime a linha do plano errado.
    expect(acharVariavel("plano_normal_valor_parcelas")).toBeDefined();
    expect(acharVariavel("plano_investidor_valor_sinal")).toBeDefined();
    expect(acharVariavel("plano_curto_quantidade_parcelas")).toBeDefined();
  });

  it("não tem nome repetido", () => {
    const nomes = VARIAVEIS_DO_CONTRATO.map((v) => v.nome);
    expect(new Set(nomes).size).toBe(nomes.length);
  });
});

describe("achar as variáveis no texto", () => {
  it("lê o formato do C2X, com colchetes", () => {
    const html = '<p>QUADRA <strong>[numero_quadra]</strong> - LOTE <strong>[numero_lote]</strong></p>';
    expect(variaveisDoTexto(html)).toEqual(["numero_quadra", "numero_lote"]);
  });

  it("ignora colchete com pontuação, que é texto e não variável", () => {
    // "[art. 26-A da Lei nº 6.766/1979]" aparece nas minutas: tem ponto, espaço e barra.
    expect(variaveisDoTexto("<p>[art. 26-A da Lei nº 6.766/1979]</p>")).toEqual([]);
  });

  it("mas uma palavra solta entre colchetes CONTA, e vira aviso", () => {
    // "[sic]" é português, não variável — e mesmo assim é apanhado. É deliberado: o preço de
    // avisar sobre um "[sic]" é uma linha a mais na tela; o preço de calar sobre um "[Nome]" é o
    // contrato sair com "[Nome]" impresso. Erra-se para o lado barato.
    const { conhecidas, desconhecidas } = classificarVariaveis("<p>ipsis litteris [sic]</p>");
    expect(conhecidas).toEqual([]);
    expect(desconhecidas.map((d) => d.nome)).toEqual(["sic"]);
  });

  it("conta as repetições", () => {
    const { conhecidas } = classificarVariaveis("[nome_cliente] e [nome_cliente] e [cpf_cliente]");
    expect(conhecidas[0]).toMatchObject({ nome: "nome_cliente", ocorrencias: 2 });
  });
});

describe("as variáveis que ninguém preenche", () => {
  it("separa [Nome] e [CPF], que saem impressas no papel", () => {
    // Existem de verdade em minutas antigas do C2X, seis ocorrências. Nenhum motor as conhece: o
    // contrato sai com "[Nome]" escrito. O aviso tem que aparecer antes da assinatura.
    const { conhecidas, desconhecidas } = classificarVariaveis("[nome_cliente] mas também [Nome] e [CPF]");
    expect(conhecidas.map((c) => c.nome)).toEqual(["nome_cliente"]);
    expect(desconhecidas.map((d) => d.nome).sort()).toEqual(["CPF", "Nome"]);
  });
});

describe("os blocos condicionais — o defeito que já chegou ao cliente", () => {
  it("aceita blocos bem fechados", () => {
    const texto = "[inicio_dados_cliente_pf] fulano [fim_dados_cliente_pf]";
    expect(conferirBlocos(texto)).toEqual([]);
  });

  it("aceita blocos aninhados", () => {
    const texto =
      "[inicio_dados_cliente_2][inicio_dados_cliente_pf_2]x[fim_dados_cliente_pf_2][fim_dados_cliente_2]";
    expect(conferirBlocos(texto)).toEqual([]);
  });

  it("acusa abertura sem fechamento — o caso do Villa Paris", () => {
    // No contrato real, o trecho de pessoa JURÍDICA saiu impresso num comprador pessoa FÍSICA.
    // Um bloco que abre e não fecha faz exatamente isso: o motor não sabe onde parar de esconder.
    const problemas = conferirBlocos("[inicio_dados_cliente_pj] razão social [fim_dados_cliente_pf]");
    expect(problemas).toHaveLength(2);
    expect(problemas.map((p) => p.problema).sort()).toEqual(["abre_sem_fechar", "fecha_sem_abrir"]);
  });

  it("acusa fechamento sem abertura", () => {
    const problemas = conferirBlocos("texto solto [fim_dados_conjuge]");
    expect(problemas).toEqual([
      {
        bloco: "dados_conjuge",
        problema: "fecha_sem_abrir",
        texto: "Existe [fim_dados_conjuge] sem o [inicio_dados_conjuge] correspondente.",
      },
    ]);
  });

  it("acusa blocos cruzados", () => {
    // Abre A, abre B, fecha A, fecha B: o motor decide sozinho onde cada trecho termina.
    const problemas = conferirBlocos(
      "[inicio_dados_cliente_2][inicio_dados_conjuge_2][fim_dados_cliente_2][fim_dados_conjuge_2]",
    );
    expect(problemas.some((p) => p.problema === "fora_de_ordem")).toBe(true);
  });

  it("uma minuta inteira com dezenas de blocos passa se estiver correta", () => {
    const blocos = ["dados_cliente_pf", "dados_conjuge", "dados_cliente_pj"];
    const texto = blocos.map((b) => `[inicio_${b}] conteudo [fim_${b}]`).join(" ");
    expect(conferirBlocos(texto)).toEqual([]);
  });
});

describe("o par valor / por extenso", () => {
  it("acusa o extenso que ficou sozinho", () => {
    // Sobra clássica de copiar e colar: o extenso de um valor que não está mais no texto.
    expect(extensosOrfaos("[valor_imovel_venda_extenso] sem o número")).toEqual([
      "valor_imovel_venda_extenso",
    ]);
  });

  it("não reclama quando os dois estão presentes", () => {
    expect(extensosOrfaos("[valor_imovel_venda] ([valor_imovel_venda_extenso])")).toEqual([]);
  });

  it("a área tem par, e é o caso que produziu o erro no contrato", () => {
    // "300,00 m² (trezentos metros quadrados metros quadrados)" — a unidade saiu duas vezes porque o
    // dado guardado já a trazia. O par existe; quem escreve a unidade é o por-extenso.ts, uma vez só.
    expect(acharVariavel("area_lote_extenso")?.extensoDe).toBe("area_lote");
  });
});

describe("o código partido por tag — o defeito que imprimiu [nome_cliente] no contrato", () => {
  it("acha o código quebrado no meio por uma tag", () => {
    // Copiado da minuta do JDG que estava no C2X. Na tela lia-se "[nome_cliente]"; no HTML havia
    // "[nome_cl" fechando um span e "iente]" abrindo outro. O motor procura a string no HTML, não
    // acha, e imprime o marcador no contrato — foi o que saiu no primeiro teste do Jardim das Gerais.
    const html =
      '<strong>[nome_cl</strong></span><span style="font-family:Lucida"><strong>iente]</strong>, de nacionalidade <strong>[nacionalidade_cliente]</strong>';

    const partidos = codigosPartidos(html);
    expect(partidos).toHaveLength(1);
    expect(partidos[0]).toMatchObject({ nome: "nome_cliente", noHtml: 0, noTexto: 1 });
  });

  it("não acusa código inteiro, mesmo cercado de tags", () => {
    const html = '<p><span style="color:red"><strong>[nome_cliente]</strong></span></p>';
    expect(codigosPartidos(html)).toEqual([]);
  });

  it("acha quando SÓ UMA das ocorrências está partida", () => {
    // O caso real: o mesmo código aparecia duas vezes na minuta, inteiro na área de assinatura e
    // partido na qualificação. Contar só "existe no HTML" não pegaria.
    const html = "<p>[nome_cliente]</p><p><strong>[nome_cl</strong><em>iente]</em></p>";
    const partidos = codigosPartidos(html);
    expect(partidos).toHaveLength(1);
    expect(partidos[0]).toMatchObject({ noHtml: 1, noTexto: 2 });
  });

  it("texto sem código nenhum não acusa nada", () => {
    expect(codigosPartidos("<p>contrato sem variáveis</p>")).toEqual([]);
  });
});
