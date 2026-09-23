import { describe, expect, it } from "vitest";

import type { Pessoa } from "@/lib/assinatura/signatarios";

import { ASSINANTE_DA_CARELI, assinanteDaCareli } from "./assinante-da-careli";
import { signatariosDoAcordo } from "./signatarios-do-acordo";

// QUEM ASSINA O TERMO DE ACORDO, E EM QUE ORDEM.
//
// Lucas, 20/09/2026: *"quem vai, o comprador, o incorporador e a nivea careli"*, *"a nivea pode
// ficar como padrao"* e *"Assina como careli"*.
//
// ⚠️ O QUE ESTES TESTES PROTEGEM: a conta de PRODUÇÃO da Clicksign. Toda recusa aqui acontece ANTES
// de existir envelope — deixar a API recusar deixaria um envelope criado, pago e (depois de
// ativado) impossível de apagar, com metade dos signatários dentro.

const comprador: Pessoa = {
  cpf: "444.555.666-17",
  email: "comprador@exemplo.test",
  nome: "Beltrano Exemplo Ferreira",
  papel: "comprador",
  telefone: null,
};

const incorporador: Pessoa = {
  cpf: "111.222.333-44",
  email: "representante@incorporadora.test",
  nome: "Fulana Representante Legal",
  papel: "vendedora",
  telefone: null,
};

const careli = assinanteDaCareli({});

describe("as três partes, na ordem que o Lucas pediu", () => {
  it("comprador em 1, incorporador em 2, Careli em 3", () => {
    const { impedimento, signatarios } = signatariosDoAcordo({ careli, comprador, incorporador });

    expect(impedimento).toBeNull();
    expect(signatarios.map((s) => [s.papel, s.ordem])).toEqual([
      ["comprador", 1],
      ["vendedora", 2],
      ["careli", 3],
    ]);
  });

  // ⚠️ A ORDEM É COMPACTADA, E NÃO ESCRITA À MÃO. Os números canônicos dos três papéis são 1, 3 e 7
  // (a posição deles em `PAPEIS`); `ordenarSignatarios` compacta o CONJUNTO para 1, 2, 3 sem
  // desempatar ninguém. Escrever 1/2/3 na mão criaria uma segunda tabela de números que
  // envelheceria na primeira mudança de `PAPEIS`.
  it("a fila não tem buraco, mesmo com os papéis do meio ausentes", () => {
    const { signatarios } = signatariosDoAcordo({ careli, comprador, incorporador });

    expect(signatarios.map((s) => s.ordem)).toEqual([1, 2, 3]);
  });

  // ⚠️ A NÍVEA NÃO É DIGITADA A CADA ACORDO. É o ponto do `assinante-da-careli.ts`: na centésima
  // vez, alguém escreveria `nivea.carelli@` e o envelope nunca fecharia.
  it("a Careli entra com o nome e o e-mail da configuração, sem ninguém digitar", () => {
    const { signatarios } = signatariosDoAcordo({ careli, comprador, incorporador });
    const daCasa = signatarios.find((s) => s.papel === "careli");

    // ⚠️ EM CAIXA ALTA: ver `nomeDeSignatario`. A Careli chega do `display_name` do usuário do
    // hub ("Nivea Careli") e as outras duas partes do cadastro, que guarda em maiúsculas; o
    // documento é um só e sai num padrão só.
    expect(daCasa?.nome).toBe(ASSINANTE_DA_CARELI.nome.toUpperCase());
    expect(daCasa?.email).toBe(ASSINANTE_DA_CARELI.email);
  });
});

describe("o dado que falta vira FRASE, e o envio não sai", () => {
  // ⚠️ ESTE É O CASO DE HOJE, E ELE ESTÁ MEDIDO: em 20/09/2026, os 18 acordos aprovados chegam a
  // uma vendedora cadastrada, mas ZERO das vendedoras tem representante legal em
  // `apolo_relationships`, e `temis_assinantes` está vazia. Ou seja, nenhum acordo tem hoje pessoa
  // física para assinar pelo incorporador — e é esta frase que todo operador vai ler.
  it("sem quem assine pelo incorporador, a frase diz onde cadastrar", () => {
    const { impedimento } = signatariosDoAcordo({ careli, comprador, incorporador: null });

    expect(impedimento).toContain("INCORPORADOR");
    expect(impedimento).toContain("Quadro de assinatura do empreendimento");
    expect(impedimento).toContain("representante legal");
  });

  // ⚠️ A FRASE TEM DE NOMEAR O CAMPO NOVO, E DIZER QUE ELE NÃO EXIGE PROCURAÇÃO. Lucas
  // (20/09/2026): *"não precisa necessariamente ser os representantes legais, pode ser o juridico,
  // analista, enfim"*. Sem isso, o operador que lê "falta representante legal" vai atrás da
  // procuração da incorporadora — o caminho caro — em vez de apontar alguém no quadro, que é o
  // caminho que o Lucas desenhou.
  it("a frase manda apontar quem assina os TERMOS, e diz que não precisa ser o representante", () => {
    const { impedimento } = signatariosDoAcordo({ careli, comprador, incorporador: null });

    expect(impedimento).toContain("TERMOS");
    expect(impedimento).toContain("Assinatura de termos (vendedora)");
    expect(impedimento).toContain("não precisa ser o representante legal");
  });

  it("sem comprador no cadastro do Panteon, a frase manda conferir a venda", () => {
    const { impedimento } = signatariosDoAcordo({ careli, comprador: null, incorporador });

    expect(impedimento).toContain("comprador");
    expect(impedimento).toContain("cadastro do comprador");
  });

  // ⚠️ E-MAIL É O CAMPO POR ONDE O CONVITE SAI. Sem ele a Clicksign cadastra o signatário do mesmo
  // jeito, e a pessoa fica dentro do envelope sem NUNCA receber o link — travando o termo para
  // sempre, sem erro nenhum.
  it("comprador sem e-mail não vai, e a frase diz o nome de quem falta", () => {
    const { impedimento } = signatariosDoAcordo({
      careli,
      comprador: { ...comprador, email: "" },
      incorporador,
    });

    expect(impedimento).toContain("BELTRANO EXEMPLO FERREIRA");
    expect(impedimento).toContain("sem e-mail");
  });

  // ⚠️ NO CONTRATO A ARMADILHA É O CÔNJUGE QUE COMPARTILHA A CAIXA; NO ACORDO, É A EMPRESA. O
  // comprador que deu como contato o e-mail da imobiliária, ou o representante que usa o endereço
  // institucional, cairiam aqui — e a Clicksign recusaria DEPOIS, com o envelope já criado.
  it("dois signatários com o mesmo e-mail não vão", () => {
    const { impedimento } = signatariosDoAcordo({
      careli,
      comprador: { ...comprador, email: "MESMO@Exemplo.test " },
      incorporador: { ...incorporador, email: "mesmo@exemplo.test" },
    });

    expect(impedimento).toContain("MESMO e-mail");
  });

  it("nome de uma palavra só não vai, porque a Clicksign exige sobrenome", () => {
    const { impedimento } = signatariosDoAcordo({
      careli,
      comprador: { ...comprador, nome: "Beltrano" },
      incorporador,
    });

    expect(impedimento).toContain("sem sobrenome");
  });
});

describe("a configuração da Careli", () => {
  it("o nome e o e-mail da Nívea estão presos em um lugar só", () => {
    expect(ASSINANTE_DA_CARELI).toEqual({
      email: "nivea.careli@careli.adm.br",
      nome: "Nivea Careli",
    });
    expect(assinanteDaCareli({}).papel).toBe("careli");
  });

  // ⚠️ A ENV É SOCORRO, NÃO FONTE: ela resolve a troca de sábado sem esperar deploy.
  it("a env troca quem assina, quando ela vem preenchida", () => {
    const trocado = assinanteDaCareli({
      CARELI_ASSINANTE_EMAIL: "outra.pessoa@careli.adm.br",
      CARELI_ASSINANTE_NOME: "Outra Pessoa Da Casa",
    });

    expect(trocado.nome).toBe("Outra Pessoa Da Casa");
    expect(trocado.email).toBe("outra.pessoa@careli.adm.br");
  });

  // ⚠️ VARIÁVEL MARCADA "SENSITIVE" NA VERCEL CHEGA VAZIA, e não indefinida — é a armadilha que fez
  // nascer `/api/temis/assinatura/diagnostico`. Com `??` no lugar de `||`, o vazio passaria e o
  // envelope sairia com um signatário sem nome.
  it("env vazia NÃO apaga o assinante", () => {
    const daCasa = assinanteDaCareli({ CARELI_ASSINANTE_EMAIL: "", CARELI_ASSINANTE_NOME: "   " });

    expect(daCasa.nome).toBe(ASSINANTE_DA_CARELI.nome);
    expect(daCasa.email).toBe(ASSINANTE_DA_CARELI.email);
  });

  // ⚠️ CPF NÃO ENTRA: a Clicksign o valida contra a Receita e, sem ele, autentica só pelo e-mail.
  // Guardar o CPF de uma funcionária no repositório é dado pessoal em git para sempre.
  it("a Careli vai sem CPF", () => {
    expect(assinanteDaCareli({}).cpf).toBeNull();
  });
});
