import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// ⚠️ ESTE TESTE LÊ O PRÓPRIO FONTE, e isso é deliberado.
//
// O bug que ele existe para impedir passou por typecheck, lint e 1.872 testes verdes, e foi para
// produção: a tela chamava `/api/boletos/prontidao` com um `fetch` solto, sem o header
// `Authorization: Bearer`. A rota exige `authorizeApoloRead` e o `proxy.ts` corta antes mesmo de
// ela rodar, então a resposta era 401 SEMPRE — não numa corrida, não com sessão expirada: sempre.
//
// E o estrago não era um erro na tela. O 401 era engolido, a prontidão nunca chegava, e a barra
// afirmava "0 boletos · R$ 0,00 · 181 parados por falta de conta" com a tabela logo acima somando
// R$ 512.835,55. É esse número que o administrativo levaria para a conferência do financeiro.
//
// Não existe teste de componente neste app (sem jsdom, sem testing-library), e trazer essa infra
// só por isto seria caro. O que dá para garantir barato é o contrato: nenhuma chamada à API
// interna sai desta tela sem o cabeçalho. É o "grep por quem chama" virado rede automática.

const FONTE = readFileSync(join(__dirname, "EmissaoDeBoletos.tsx"), "utf8");

describe("toda chamada à API interna leva o Bearer da sessão", () => {
  it("a tela chama /api/boletos/prontidao", () => {
    // Se a rota mudar de nome, o resto do teste vira falso-positivo silencioso.
    expect(FONTE).toContain('"/api/boletos/prontidao"');
  });

  it("e manda Authorization em cada fetch de /api/", () => {
    const chamadas = [...FONTE.matchAll(/fetch\(\s*(`|")\/api\//g)];
    expect(chamadas.length).toBeGreaterThan(0);

    for (const chamada of chamadas) {
      // A janela cobre com folga o objeto de opções que vem logo depois da URL.
      const janela = FONTE.slice(chamada.index!, chamada.index! + 400);
      expect(janela, `fetch em ${chamada.index} sem Authorization`).toMatch(/Authorization:\s*`Bearer /);
    }
  });

  it("e o token vem do helper da casa, não de um lugar inventado", () => {
    expect(FONTE).toContain("getApoloAccessToken");
  });
});

describe("a tela distingue “não sei” de “não tem conta”", () => {
  // A segunda metade do mesmo defeito: com a prontidão ausente, `contaConfigurada` vinha
  // undefined e a tela tratava isso como fato — dizia "chave ausente" para um empreendimento com
  // a chave configurada, e zerava o total.
  it("existe um estado de carregando/erro separado do conteúdo", () => {
    expect(FONTE).toMatch(/"carregando"\s*\|\s*"erro"\s*\|\s*"pronta"/);
  });

  it("a classificação de liberado/travado só acontece sabendo das contas", () => {
    expect(FONTE).toContain("sabeDasContas");
    // A barra de ação precisa do sinal: sem ele, ela voltaria a afirmar "0 boletos · R$ 0,00".
    expect(FONTE).toMatch(/sabeDasContas=\{sabeDasContas\}/);
  });

  it("a falha da consulta aparece para o operador, em vez de sumir calada", () => {
    expect(FONTE).toContain("Não consegui consultar as contas do Asaas");
  });
});
