import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// O FORMULÁRIO DA CONFERÊNCIA DA CORRETAGEM, LIDO COMO TEXTO — as promessas que o typecheck não vê.
//
// ⚠️ MESMA RAZÃO DE `extrato-cliente-panel.test.ts`: não há teste de componente neste app (sem jsdom),
// e os defeitos que isto barra passam por typecheck e lint: fetch sem Bearer (o `proxy.ts` responde
// 401 sempre), valor enviado sem passar pela mesma leitura da rota, e sucesso escrito com o que a
// tela digitou em vez do que a rota gravou. A regra do valor em si tem teste de comportamento em
// `lib/apolo/valor-em-reais-br.test.ts`.
const FONTE = readFileSync(join(__dirname, "conferencia-corretagem-form.tsx"), "utf8");
/** O arquivo SEM as linhas de comentário: o cabeçalho cita justamente o que o código não faz. */
const CODIGO = FONTE.split("\n")
  .filter((linha) => !/^\s*(\/\/|\/\*|\*)/.test(linha))
  .join("\n");

/** O trecho de uma função `useCallback`, até o fim da sua lista de dependências. */
function bloco(nome: string): string {
  const inicio = FONTE.indexOf(`const ${nome} = useCallback`);
  expect(inicio, `${nome} não encontrado`).toBeGreaterThanOrEqual(0);
  return FONTE.slice(inicio, FONTE.indexOf("  }, [", inicio));
}

describe("o formulário da conferência", () => {
  it("tem os dois resultados, a observação, o contador e o Salvar", () => {
    expect(FONTE).toContain("Registrar conferência da corretagem");
    expect(FONTE).toContain("Não houve corretagem");
    expect(FONTE).toContain("Houve corretagem de R$");
    expect(FONTE).toContain("Observação da conferência");
    expect(FONTE).toContain("Salvar");
  });

  it("a observação tem teto de 1000 (maxLength) e contador, do mesmo limite da rota e da 0202", () => {
    expect(FONTE).toContain("maxLength={LIMITE_DA_OBSERVACAO_DA_CONFERENCIA}");
    expect(FONTE).toContain("{observacao.length}/{LIMITE_DA_OBSERVACAO_DA_CONFERENCIA}");
  });

  it("o Salvar fica apagado sem resultado, sem observação ou sem valor no 'houve'", () => {
    expect(FONTE).toContain("!resultado ||");
    expect(FONTE).toContain("!observacao.trim() ||");
    expect(FONTE).toContain('(resultado === "com_corretagem" && !valor.trim())');
  });
});

describe("a confirmação antes de enviar", () => {
  it("o Salvar só prepara: lê o valor com a MESMA função da rota e abre a confirmação", () => {
    const preparar = bloco("preparar");
    expect(preparar).toContain('resultado === "com_corretagem" && lerValorEmReaisBr(valor) === null');
    expect(preparar).toContain("setErro(FRASE_DO_FORMATO_DO_VALOR)");
    expect(preparar).toContain("setConfirmando(true)");
    // Preparar NÃO chama a rota.
    expect(preparar).not.toContain("fetch(");
  });

  it("a confirmação escreve o resultado por extenso, com Confirmar e Voltar, sem window.confirm", () => {
    expect(FONTE).toContain("Confirmar: {descreverConferencia(resultado, valorLido)}");
    expect(CODIGO).toMatch(/\n\s*Confirmar\s*\n\s*<\/button>/);
    expect(CODIGO).toMatch(/>\s*Voltar\s*<\/button>/);
    expect(CODIGO).not.toContain("window.confirm");
    expect(CODIGO).not.toMatch(/\bconfirm\(/);
  });

  it("o texto por extenso vem de lib/apolo/valor-em-reais-br (a lib pura compartilhada)", () => {
    expect(FONTE).toContain('from "@/lib/apolo/valor-em-reais-br"');
    expect(FONTE).toContain("lerValorEmReaisBr");
    expect(FONTE).toContain("descreverConferencia");
  });
});

describe("a gravação", () => {
  it("manda o PUT com o Bearer, o contrato e o NÚMERO já lido (não o texto digitado)", () => {
    const enviar = bloco("enviar");
    expect(enviar).toContain('"/api/apolo/rescisao/conferencia-corretagem"');
    expect(enviar).toContain('method: "PUT"');
    expect(enviar).toMatch(/Authorization:\s*`Bearer /);
    expect(enviar).toContain("contrato: contratoId");
    expect(enviar).toContain("valorLido !== null ? { valor: valorLido } : {}");
    expect(enviar).not.toContain("valor: valor,");
  });

  it("a mensagem de sucesso usa o que a rota DEVOLVEU (data.valor), e manda clicar em Rescisão", () => {
    const enviar = bloco("enviar");
    expect(enviar).toContain("payload?.data?.valor ?? null");
    expect(enviar).toContain("Conferência registrada: ${descreverConferencia(");
    expect(enviar).toContain("Clique em Rescisão para gerar a simulação.");
  });

  it("a frase de erro da rota aparece escrita", () => {
    expect(bloco("enviar")).toContain("setErro(payload?.error ??");
  });
});

describe("ver e corrigir", () => {
  it("o link só existe com uma conferência usada pelo PDF, e diz 'Ver ou corrigir'", () => {
    expect(FONTE).toContain("if (!conferenciaUsada) return null;");
    expect(FONTE).toContain("Corretagem conferida no contrato assinado.");
    expect(FONTE).toContain("Ver ou corrigir");
  });

  it("carrega o GET com o Bearer e abre o formulário preenchido com o registro atual", () => {
    const abrir = bloco("abrirParaCorrigir");
    expect(abrir).toContain("/api/apolo/rescisao/conferencia-corretagem?");
    expect(abrir).toMatch(/Authorization:\s*`Bearer /);
    expect(abrir).toContain("setResultado(resultadoConhecido(atual?.resultado ?? null) ?? \"\")");
    expect(abrir).toContain("setObservacao(atual?.observacao ?? \"\")");
    expect(abrir).toContain("valorParaOCampo(atual.valor)");
  });

  it("mostra o histórico compacto (data, quem, resultado e valor)", () => {
    expect(FONTE).toContain("Histórico");
    expect(FONTE).toContain("linhaDoHistorico(registro)");
    expect(FONTE).toContain("`${quando} · ${quem} · ${oQue}`");
  });

  it("corrigir grava um registro NOVO: é o mesmo PUT, sem rota de edição", () => {
    expect(FONTE).not.toContain('method: "PATCH"');
    expect(FONTE).not.toContain('method: "DELETE"');
  });
});
