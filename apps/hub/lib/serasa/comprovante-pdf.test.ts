import { writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { montarComprovantePdf } from "@/lib/serasa/comprovante-pdf";

const AMOSTRA = process.env.COMPROVANTE_AMOSTRA_PATH;

// Garante que a cadeia PDF (pdf-lib) + QR (qrcode) + logo embutida roda no Node sem quebrar e
// devolve um PDF válido. Não valida layout (isso é visual), só a integridade da geração.
describe("montarComprovantePdf", () => {
  it("gera um PDF válido com QR e restrições", async () => {
    const bytes = await montarComprovantePdf({
      ambiente: "producao",
      autenticacao: "SR-ABCD1234",
      cliente: "Fulano de Tal",
      data: "21/07/2026 15:30",
      documento: "123.456.789-00",
      empreendimento: "Vale do Ouro",
      faixa: "HRLN",
      protocolo: "SR-ABCD1234",
      qrUrl: "https://c2x.app.br/publico/verificar?c=abc.def.ghi",
      restricoes: [
        { quantidade: 1, rotulo: "Restricoes financeiras (Refin)", valor: 964.89 },
        { quantidade: 4, rotulo: "Registros de cobranca", valor: 4534.88 },
      ],
      score: 916,
      scoreModelo: "HRLN",
      veredito: {
        aprovado: false,
        limite: 1000,
        motivo: "Restricoes de R$ 5.499,77 acima do limite de R$ 1.000,00.",
        total: 5499.77,
      },
    });

    expect(bytes.byteLength).toBeGreaterThan(1000);
    // Assinatura de arquivo PDF: "%PDF".
    expect(Buffer.from(bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");
    // Amostra visual opcional (só quando COMPROVANTE_AMOSTRA_PATH está setado).
    if (AMOSTRA) writeFileSync(AMOSTRA, Buffer.from(bytes));
  });

  it("gera mesmo sem QR e sem restrições (best-effort)", async () => {
    const bytes = await montarComprovantePdf({
      ambiente: "homologacao",
      autenticacao: "SR-00000000",
      cliente: "Empresa X",
      data: "21/07/2026 10:00",
      documento: "12.345.678/0001-99",
      protocolo: "SR-00000000",
      qrUrl: "",
      restricoes: [],
      score: null,
      veredito: { aprovado: true, limite: 1000, motivo: "Sem restricoes.", total: 0 },
    });
    expect(Buffer.from(bytes.slice(0, 4)).toString("latin1")).toBe("%PDF");
  });
});
