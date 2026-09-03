import { describe, expect, it } from "vitest";

import { documentoParaHtml, type NoDoDocumento } from "./documento-html";
import { migrarAlinhamentoAntigo } from "./migrar-documento";

// A minuta salva pelo editor de 01/09 traz `textAlign`; o AlignKit só lê `align`.

describe("migrarAlinhamentoAntigo", () => {
  it("troca `textAlign` por `align` e apaga a chave antiga", () => {
    const antigo: NoDoDocumento[] = [{ children: [{ text: "TÍTULO" }], textAlign: "center", type: "h1" }];
    const [bloco] = migrarAlinhamentoAntigo(antigo);

    expect(bloco?.align).toBe("center");
    expect(bloco).not.toHaveProperty("textAlign");
    // O original não é tocado: quem chama ainda tem o JSON que veio do banco.
    expect(antigo[0]).toHaveProperty("textAlign", "center");
  });

  it("`align` presente manda — é o que o editor atual gravou", () => {
    const [bloco] = migrarAlinhamentoAntigo([
      { align: "justify", children: [{ text: "x" }], textAlign: "center", type: "p" },
    ]);

    expect(bloco?.align).toBe("justify");
    expect(bloco).not.toHaveProperty("textAlign");
    expect(documentoParaHtml(migrarAlinhamentoAntigo([bloco!]))).toBe('<p style="text-align:justify">x</p>');
  });

  it("desce na tabela: a célula alinhada da minuta antiga continua alinhada", () => {
    const [tabela] = migrarAlinhamentoAntigo([
      {
        children: [
          {
            children: [{ children: [{ children: [{ text: "R$" }], textAlign: "right", type: "p" }], type: "td" }],
            type: "tr",
          },
        ],
        type: "table",
      },
    ]);
    const paragrafo = (((tabela?.children?.[0] as NoDoDocumento).children?.[0] as NoDoDocumento).children?.[0]) as NoDoDocumento;

    expect(paragrafo.align).toBe("right");
    expect(paragrafo).not.toHaveProperty("textAlign");
  });

  it("não inventa `align` em quem nunca teve alinhamento", () => {
    const [bloco] = migrarAlinhamentoAntigo([{ children: [{ text: "x" }], type: "p" }]);
    expect(bloco).not.toHaveProperty("align");
    expect(bloco).not.toHaveProperty("textAlign");
  });
});
