import { describe, expect, it } from "vitest";

import { classificarVariaveis, conferirBlocos } from "./variaveis";

// A MINUTA QUE ESTÁ NO AR, MEDIDA.
//
// Este arquivo não testa um caso imaginado: os trechos abaixo foram COPIADOS de
// `JDG-MINUTA-COMPRA-VENDA-NORMAL` (draft_contract #85 do C2X), a minuta que gera os contratos do
// Jardim das Gerais hoje — 41.343 caracteres, 244 marcadores, 7 contratos já emitidos.
//
// A medição completa (01/09/2026) passou a minuta inteira pelo editor e pelo serializador:
//   • 244 marcadores entram, 244 saem — nenhuma variável se perde na conversão;
//   • 171 nomes distintos, TODOS reconhecidos pelo catálogo (nenhum "[Nome]" solto);
//   • 20.328 caracteres de texto contra 20.295 no HTML original — o documento atravessa inteiro;
//   • MAS a área de assinaturas do 2º comprador tem DOIS marcadores trocados.
//
// O último item é o motivo deste arquivo existir. É o mesmo defeito que, no Villa Paris, imprimiu o
// parágrafo de pessoa jurídica num contrato de pessoa física.

// Trecho copiado da área de assinaturas da minuta #85, sem as tags de formatação.
const ASSINATURAS_DO_JDG = `
[inicio_dados_cliente_2] [inicio_dados_cliente_pf_2](Assinado eletronicamente)[nome_cliente_2]
[inicio_dados_conjuge_2][fim_dados_conjuge_2] [fim_dados_cliente_pf_2] [inicio_dados_cliente_pj_2]
[nome_fantasia_cliente_2][fim_dados_cliente_pj_2]COMPROMISSÁRIO(A) COMPRADOR(A)[fim_dados_cliente_pf_2]
[inicio_dados_cliente_2] [inicio_dados_cliente_pf_2][inicio_dados_conjuge_2](Assinado eletronicamente)
[nome_conjuge_2]CONJUGE[fim_dados_conjuge_2][fim_dados_cliente_pf_2][fim_dados_cliente_2]
`;

// O mesmo bloco para o 3º ao 5º comprador está CORRETO na minuta — é o padrão que o 2º deveria
// seguir. Serve de contraprova: a conferência não reprova o documento inteiro, só o trecho torto.
const ASSINATURAS_CORRETAS = `
[inicio_dados_cliente_4] [inicio_dados_cliente_pf_4](Assinado eletronicamente)[nome_cliente_4]
[inicio_dados_conjuge_4][fim_dados_conjuge_4][fim_dados_cliente_pf_4]
[inicio_dados_cliente_pj_4][nome_fantasia_cliente_4][fim_dados_cliente_pj_4][fim_dados_cliente_4]
`;

describe("a minuta do JDG que está no ar", () => {
  it("acusa os dois marcadores trocados na assinatura do 2º comprador", () => {
    // O que está escrito: quem fecha o `[inicio_dados_cliente_2]` é um `[fim_dados_cliente_pf_2]`,
    // e logo depois um segundo `[inicio_dados_cliente_2]` abre sem nunca fechar em ordem. Numa
    // venda com dois compradores, o motor decide sozinho onde o trecho do segundo termina.
    const problemas = conferirBlocos(ASSINATURAS_DO_JDG);

    expect(problemas.length).toBeGreaterThan(0);
    expect(problemas.map((p) => p.bloco)).toContain("dados_cliente_pf_2");
  });

  it("não reprova o bloco do 4º comprador, que segue o padrão certo", () => {
    // A contraprova importa: uma conferência que reclamasse de tudo seria ignorada em uma semana.
    expect(conferirBlocos(ASSINATURAS_CORRETAS)).toEqual([]);
  });

  it("reconhece todos os nomes usados no trecho — nenhum marcador órfão", () => {
    const { desconhecidas } = classificarVariaveis(ASSINATURAS_DO_JDG);
    expect(desconhecidas).toEqual([]);
  });
});

describe("o cônjuge do 5º comprador aponta para o bloco do 1º", () => {
  it("está balanceado, e mesmo assim está errado", () => {
    // ⚠️ ESTE PASSA NA CONFERÊNCIA DE BLOCOS, e é o achado mais sutil da medição: dentro do trecho
    // do 5º comprador a minuta abre `[inicio_dados_conjuge]` SEM SUFIXO, e fecha com
    // `[fim_dados_conjuge]`. O par existe, então a pilha fecha certo — mas o trecho do cônjuge do
    // QUINTO comprador passa a depender de o PRIMEIRO ter cônjuge.
    //
    // Balanceamento não é correção semântica. Conferir isso exige saber em que bloco cada marcador
    // está, e é a próxima peça a construir; por ora o caso fica registrado aqui para não se perder.
    const trecho =
      "[inicio_dados_cliente_pf_5][nacionalidade_cliente_5][inicio_dados_conjuge][fim_dados_conjuge][fim_dados_cliente_pf_5]";
    expect(conferirBlocos(trecho)).toEqual([]);
  });
});
