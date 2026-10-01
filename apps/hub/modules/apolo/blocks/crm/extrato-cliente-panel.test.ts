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

// ⚠️ A CONFERÊNCIA DA CORRETAGEM NO PAINEL (30/09/2026, ajustada em 01/10/2026). O formulário em si
// mora em `conferencia-corretagem-form.tsx` (e tem o teste dele); aqui se trava a FIAÇÃO: só a
// coordenação o vê, o código da recusa vem da rota (e não da frase), o header diz qual conferência o
// PDF usou, e trocar de contrato não deixa nada preso na tela.
describe("a conferência da corretagem no painel", () => {
  it("abre pelo código da rota, e não pelo texto da frase", () => {
    expect(FONTE).toContain('payload?.motivo === "corretagem_zero"');
    expect(FONTE).not.toContain("R$ 0,00 de intermediação");
  });

  it("o formulário é montado com a key do contrato, para trocar de contrato desmontar tudo", () => {
    expect(FONTE).toContain("<ConferenciaDaCorretagem");
    expect(FONTE).toContain("key={contrato.id}");
  });

  it("só admin e líder veem o formulário (useAuth), e os demais leem a frase", () => {
    expect(FONTE).toContain('import { useAuth } from "@/providers/auth-provider";');
    expect(FONTE).toContain('const ehCoordenacao = hubUser?.role === "admin" || hubUser?.role === "leader";');
    expect(FONTE).toContain("{ehComprador && ehCoordenacao ? (");
    expect(FONTE).toContain("{ehComprador && !ehCoordenacao && corretagemZeroDoContrato === contrato.id ? (");
    expect(FONTE).toContain(
      "Peça à coordenação (admin ou líder) para registrar a conferência da corretagem deste contrato.",
    );
  });

  it("a mensagem de sucesso também é só da coordenação, numa região role=status que já existia", () => {
    expect(FONTE).toContain("{ehComprador && ehCoordenacao ? (");
    expect(FONTE).toContain('<div role="status">');
    expect(FONTE).toContain("setMensagemDaConferencia(mensagem)");
  });

  it("limpa o motivo e a mensagem a cada nova tentativa de baixar o termo", () => {
    const inicio = FONTE.indexOf("const baixarTermo");
    const bloco = FONTE.slice(inicio, FONTE.indexOf("const response = await fetch(`/api/apolo/rescisao/pdf", inicio));
    expect(bloco).toContain("setCorretagemZeroDoContrato(null)");
    expect(bloco).toContain("setMensagemDaConferencia(null)");
  });

  // ⚠️ O "VER OU CORRIGIR" NÃO SOME NUMA RECUSA (01/10/2026): quem acabou de registrar continua
  // podendo corrigir mesmo que a simulação recuse por outro motivo. Só um PDF que SAIU sem o header
  // (a comissão do C2X não é zero) o tira.
  it("a conferência usada não é zerada ao pedir o PDF, só quando um PDF sai sem o header", () => {
    const inicio = FONTE.indexOf("const baixarTermo");
    const bloco = FONTE.slice(inicio, FONTE.indexOf("const response = await fetch(`/api/apolo/rescisao/pdf", inicio));
    expect(bloco).not.toContain("setConferenciaUsada(null)");
    expect(FONTE).toContain("? { contratoId: relatorio.contrato.id, resultado: usada }");
    expect(FONTE).toContain(": null,");
  });

  it("depois de gravar, o 'ver ou corrigir' vem do resultado da rota, sem esperar o PDF", () => {
    expect(FONTE).toContain("onSalva={(mensagem, gravada) => {");
    expect(FONTE).toContain("if (gravada) setConferenciaUsada({ contratoId: contrato.id, resultado: gravada });");
  });

  // ⚠️ O PAINEL É MONTADO COM key DO c2xId (01/10/2026): trocar de CLIENTE desmonta o estado todo.
  // O teste de comportamento (extrato-cliente-panel.comportamento.test.tsx) prova o efeito na tela.
  it("o painel exportado remonta o conteúdo por c2xId", () => {
    expect(FONTE).toContain(
      'return <ExtratoClienteConteudo entity={entity} key={entityC2xId(entity) ?? "sem-c2x"} />;',
    );
  });

  it("trocar de contrato no seletor limpa tudo o que era do anterior", () => {
    const inicio = FONTE.indexOf("setContratoId(Number(event.target.value))");
    const bloco = FONTE.slice(inicio, FONTE.indexOf("value={String(relatorio.contrato.id)}", inicio));
    expect(bloco).toContain("setErroTermo(null)");
    expect(bloco).toContain("setCorretagemZeroDoContrato(null)");
    expect(bloco).toContain("setConferenciaUsada(null)");
    expect(bloco).toContain("setMensagemDaConferencia(null)");
  });

  it("lê o header X-Conferencia-Corretagem do PDF para oferecer o 'ver ou corrigir'", () => {
    expect(FONTE).toContain('response.headers.get("X-Conferencia-Corretagem")');
    expect(FONTE).toContain("conferenciaUsada?.contratoId === contrato.id");
  });

  it("não guarda mais o estado do formulário aqui (ele é do componente)", () => {
    expect(FONTE).not.toContain("valorDaConferencia");
    expect(FONTE).not.toContain("salvarConferencia");
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
