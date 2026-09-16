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
