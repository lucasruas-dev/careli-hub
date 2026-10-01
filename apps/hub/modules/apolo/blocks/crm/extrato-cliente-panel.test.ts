import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// O PAINEL DO EXTRATO, LIDO COMO TEXTO — as três promessas do botão do termo de rescisão.
//
// ⚠️ ESTE TESTE LÊ O PRÓPRIO FONTE, e pela mesma razão de `modules/boletos/chamada-autenticada.test.ts`:
// não existe teste de componente neste app (sem jsdom, sem testing-library), e os três defeitos que
// ele barra passam por typecheck e lint:
//
//   1. um `fetch` de /api/ sem o Bearer responde 401 SEMPRE (o `proxy.ts` corta antes da rota), e o
//      botão viraria "Não foi possível gerar o termo" para todo mundo;
//   2. o termo aparecendo no Financeiro de imobiliária/corretor/incorporador, onde o extrato é o do
//      SPLIT e não existe contrato a desfazer;
//   3. o botão APAGADO SEM FRASE — defeito cobrado duas vezes pelo dono do produto em 15/09/2026.

const FONTE = readFileSync(join(__dirname, "extrato-cliente-panel.tsx"), "utf8");

describe("toda chamada à API interna leva o Bearer da sessão", () => {
  it("o painel chama a rota do termo e a do extrato", () => {
    // Se uma rota mudar de nome, o resto do teste vira falso-positivo silencioso.
    expect(FONTE).toContain("/api/apolo/rescisao/pdf?");
    expect(FONTE).toContain("/api/apolo/extrato-cliente/pdf?");
  });

  it("e manda Authorization em cada fetch de /api/", () => {
    const chamadas = [...FONTE.matchAll(/fetch\(\s*(`|")\/api\//g)];
    expect(chamadas.length).toBeGreaterThanOrEqual(3);

    for (const chamada of chamadas) {
      const janela = FONTE.slice(chamada.index!, chamada.index! + 400);
      expect(janela, `fetch em ${chamada.index} sem Authorization`).toMatch(/Authorization:\s*`Bearer /);
    }
  });

  it("e o token vem do helper da casa", () => {
    expect(FONTE).toContain("getApoloAccessToken");
  });

  it("o contrato vai sempre no pedido do termo", () => {
    const inicio = FONTE.indexOf("const baixarTermo");
    const bloco = FONTE.slice(inicio, FONTE.indexOf("}, [c2xId, relatorio]);", inicio));
    expect(bloco).toContain("contrato: String(relatorio.contrato.id)");
  });
});

describe("o termo só existe na ficha de comprador", () => {
  it("a régua é `buyerStatusLabel`, a mesma que abre o Financeiro", () => {
    // ⚠️ 16/09/2026: o termo subiu escondido (lib/apolo/termos-liberados.ts); a chave vem antes.
    expect(FONTE).toContain(
      'const ehComprador = TERMO_DE_RESCISAO_LIBERADO && buyerStatusLabel(entity) === "Comprador";',
    );
  });

  it("o botão e as frases do termo estão atrás dela", () => {
    expect(FONTE).toContain("{ehComprador ? (");
    expect(FONTE).toContain("{ehComprador && motivoSemTermo ? (");
    expect(FONTE).toContain("{ehComprador && erroTermo ? (");
  });
});

// ⚠️ O FORMULÁRIO DA CONFERÊNCIA DA CORRETAGEM (30/09/2026). Só abre com o CÓDIGO que a rota do PDF
// devolve (`motivo === "corretagem_zero"`), e não pela frase; e o fetch dele leva o Bearer como os
// outros (sem ele, o `proxy.ts` responde 401 e a coordenação veria "não foi possível" para sempre).
describe("o formulário de conferência da corretagem", () => {
  it("abre pelo código da rota, e não pelo texto da frase", () => {
    expect(FONTE).toContain('payload?.motivo === "corretagem_zero"');
    expect(FONTE).not.toContain("R$ 0,00 de intermediação");
  });

  it("só aparece para o contrato que recusou, e só na ficha de comprador", () => {
    expect(FONTE).toContain("{ehComprador && corretagemZeroDoContrato === contrato.id ? (");
  });

  it("limpa o motivo a cada nova tentativa de baixar o termo", () => {
    const inicio = FONTE.indexOf("const baixarTermo");
    const bloco = FONTE.slice(inicio, FONTE.indexOf("setCorretagemZeroDoContrato(relatorio", inicio));
    expect(bloco).toContain("setCorretagemZeroDoContrato(null)");
  });

  it("tem os dois resultados, a observação e o Salvar", () => {
    expect(FONTE).toContain("Registrar conferência da corretagem");
    expect(FONTE).toContain("Não houve corretagem");
    expect(FONTE).toContain("Houve corretagem de R$");
    expect(FONTE).toContain("Observação da conferência");
    expect(FONTE).toContain("Salvar");
  });

  it("grava na rota da conferência, com PUT, o Bearer e o contrato", () => {
    const inicio = FONTE.indexOf("const salvarConferencia");
    const bloco = FONTE.slice(inicio, FONTE.indexOf("}, [c2xId, observacaoDaConferencia", inicio));
    expect(bloco).toContain('"/api/apolo/rescisao/conferencia-corretagem"');
    expect(bloco).toContain('method: "PUT"');
    expect(bloco).toMatch(/Authorization:\s*`Bearer /);
    expect(bloco).toContain("contrato: relatorio.contrato.id");
  });

  it("a frase de erro da rota aparece escrita, e o sucesso manda clicar em Rescisão", () => {
    expect(FONTE).toContain("setErroDaConferencia(payload?.error ??");
    expect(FONTE).toContain("Clique em Rescisão para gerar a simulação.");
  });

  it("o Salvar fica apagado sem resultado, sem observação ou sem valor no 'houve'", () => {
    expect(FONTE).toContain("!observacaoDaConferencia.trim()");
    expect(FONTE).toContain('resultadoDaConferencia === "com_corretagem" && !valorDaConferencia.trim()');
  });
});

describe("botão apagado tem frase", () => {
  it("o motivo vem da MESMA função que a rota usa para recusar", () => {
    expect(FONTE).toContain('import { motivoParaNaoEmitirTermo } from "@/lib/apolo/termo-de-rescisao";');
    expect(FONTE).toContain("motivoParaNaoEmitirTermo(relatorio)");
  });

  it("o botão só apaga por carregar ou por motivo conhecido", () => {
    expect(FONTE).toContain("disabled={baixandoTermo || motivoSemTermo !== null}");
  });

  it("e o motivo é ESCRITO na tela, não só na dica do mouse", () => {
    // A dica não existe no celular, e botão desabilitado nem dispara o evento do mouse.
    expect(FONTE).toMatch(/id="termo-de-rescisao-motivo"\s*>\s*<Info[^>]*\/>\s*\{motivoSemTermo\}/);
  });

  it("a recusa da rota aparece com a frase dela", () => {
    expect(FONTE).toContain("setErroTermo(payload?.error ??");
  });
});
