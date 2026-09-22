import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// `data_faturamento` É PREVISÃO, E NÃO DECIDE ETAPA NENHUMA.
//
// ⚠️ ISTO JÁ FOI FEITO ERRADO UMA VEZ, POR MIM, E FOI AO AR (21/09/2026, v1.357.0). A régua
// `etapa-pelo-fato.ts` promovia para `faturado` toda venda com `data_faturamento` no passado. O
// pedido do Lucas era legítimo — três lotes do VOC faturaram em 17/09 e a tela dizia "Em
// assinatura" —, mas o campo escolhido para provar o faturamento não prova nada:
// `hercules_propostas.data_faturamento` guarda `acquisition_requests.billing_date` do C2X, que é a
// data PREVISTA de faturamento, preenchida quando a venda é montada.
//
// A PROVA, medida nos dois bancos em 22/09/2026: das 60 vendas vivas que a promoção alcançava,
// **36 NÃO tinham faturado** no legado — 35 do Cidade Jardim, em assinatura, com previsão entre
// 22 e 30/09/2025, e 1 do RDP em "Contrato gerado", com previsão de 23/12/2024. As três do VOC
// tinham 17/09 gravado desde a carga de 13/09, isto é, ANTES de o faturamento acontecer.
//
// A ÚNICA FONTE DA ETAPA É A CARGA (`scripts/hercules/importar-fluxo-de-venda.mjs`) e o que o time
// move na tela. Se a tela mostra etapa velha, o que está velho é a carga — e é a carga que se
// resolve, não a leitura.
//
// Este teste existe para a promoção não voltar numa próxima pressa.

const ARQUIVOS = ["situacao-da-unidade.ts", "fluxo-de-venda.ts", "historico-da-unidade.ts"];

/** O arquivo sem os comentários: as notas CITAM o campo de propósito, para explicar a armadilha. */
const codigoDe = (nome: string): string =>
  readFileSync(join(__dirname, nome), "utf8")
    .split("\n")
    .filter((linha) => !/^\s*(\/\/|\*|\/\*)/.test(linha))
    .join("\n");

// ATRIBUIÇÃO, não comparação: `etapa:` de objeto ou `etapa =`, nunca `p.etapa === "faturado"` —
// comparar a etapa com um valor é exatamente o uso legítimo, e ele tem que continuar passando.
const LINHA_DE_ETAPA = /\betapa\s*(:|=[^=])/;

describe("a etapa da venda", () => {
  it("não sai de data_faturamento na régua única da situação", () => {
    // A régua que decide a situação do lote não precisa do campo, e enquanto precisou ela pintou
    // de "faturado" 36 vendas que seguiam em assinatura.
    expect(codigoDe("situacao-da-unidade.ts")).not.toContain("data_faturamento");
  });

  it("não existe mais régua de promoção pelo faturamento", () => {
    for (const nome of ARQUIVOS) {
      expect(codigoDe(nome), nome).not.toContain("etapaPeloFato");
      expect(codigoDe(nome), nome).not.toContain("etapa-pelo-fato");
    }
  });

  it("nenhuma linha atribui etapa a partir de data_faturamento", () => {
    // O padrão exato do erro: `etapa: <algo com data_faturamento>`.
    for (const nome of ARQUIVOS) {
      const linhas = codigoDe(nome)
        .split("\n")
        .filter((linha) => LINHA_DE_ETAPA.test(linha) && linha.includes("data_faturamento"));
      expect(linhas, nome).toEqual([]);
    }
  });

  it("o USO LEGÍTIMO continua de pé: a data do faturamento de quem JÁ faturou", () => {
    // Aqui a etapa é a premissa, não a conclusão — é ela que decide, e a data só rotula.
    expect(codigoDe("fluxo-de-venda.ts")).toContain(
      'if (p.etapa === "faturado") return p.data_faturamento ?? p.etapa_desde;',
    );
  });
});
