import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// ⚠️ ESTE TESTE LÊ O PRÓPRIO FONTE DA TELA, pelo mesmo motivo de `modules/boletos/chamada-autenticada.test.ts`.
//
// Não existe teste de componente neste app (sem jsdom, sem testing-library). O que dá para garantir
// barato são os três contratos que já quebraram em produção em outras telas, e que passam limpos
// por typecheck e lint:
//   1. o `fetch` para `/api/` sem `Authorization: Bearer` — 401 SEMPRE, engolido em silêncio
//      (a barra dos boletos afirmando "0 boletos" em cima de R$ 512.835,55);
//   2. o botão apagado sem frase — cobrado duas vezes pelo dono do produto em 15/09/2026;
//   3. a URL do blob revogada na mesma linha do clique — o download morre calado.

const FONTE = readFileSync(join(__dirname, "PropostasPanel.tsx"), "utf8");

/** O trecho do componente do termo, até a próxima função de topo. */
function componenteDoTermo(): string {
  const inicio = FONTE.indexOf("function TermoDeAcordoAcao(");
  const resto = FONTE.slice(inicio);
  const fim = resto.indexOf("\nfunction ", 1);
  return fim === -1 ? resto : resto.slice(0, fim);
}

describe("o botão do termo de acordo no card", () => {
  it("existe, só para acordo, e atrás da chave de liberação", () => {
    // ⚠️ 16/09/2026: o termo subiu escondido (lib/apolo/termos-liberados.ts). A chave vem ANTES do
    // componente, para o botão não existir enquanto ela estiver desligada.
    expect(FONTE).toContain(
      "{isAcordo && TERMO_DE_ACORDO_LIBERADO ? <TermoDeAcordoAcao item={item} /> : null}",
    );
  });

  it("chama a rota do termo com o Bearer do helper da casa", () => {
    const trecho = componenteDoTermo();
    const chamada = trecho.indexOf('fetch("/api/guardian/termo-de-acordo"');
    expect(chamada).toBeGreaterThan(-1);
    // A janela cobre com folga o objeto de opções que vem logo depois da URL.
    expect(trecho.slice(chamada, chamada + 400)).toMatch(/Authorization:\s*`Bearer /);
    expect(trecho).toContain("await getApoloAccessToken()");
  });

  it("apagado, ESCREVE a frase do gate na tela — não em tooltip", () => {
    const trecho = componenteDoTermo();
    expect(trecho).toContain("const motivo = motivoParaNaoEmitirOTermo(item);");
    expect(trecho).toContain("disabled={Boolean(motivo) || gerando}");
    // A frase é renderizada como texto, e o botão aponta para ela.
    expect(trecho).toMatch(/\{motivo \? \(\s*<p id=\{idDaFrase\}/);
    expect(trecho).toContain("aria-describedby={motivo ? idDaFrase : undefined}");
    expect(trecho).not.toContain("<Tooltip");
  });

  it("a recusa do servidor também vira frase", () => {
    const trecho = componenteDoTermo();
    expect(trecho).toContain("setErro(payload?.error ??");
    expect(trecho).toMatch(/role="alert"/);
  });

  it("a revogação do blob espera 60s", () => {
    expect(componenteDoTermo()).toContain("window.setTimeout(() => URL.revokeObjectURL(url), 60_000);");
  });

  it("o gate e o selo vêm da lib, e a régua antiga do card não voltou", () => {
    expect(FONTE).toContain('from "@/lib/hades/dossie/termo-de-acordo-gate"');
    expect(FONTE).toContain("situacaoDaAprovacao(item.approvalStatus, item.metadata)");
    expect(FONTE).not.toContain("function approvalFromStatus(");
  });
});
