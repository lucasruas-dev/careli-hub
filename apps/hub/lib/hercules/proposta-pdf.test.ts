import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { montarPropostaPdf, type PropostaParaPdf } from "./proposta-pdf";

// ⚠️ CAMINHOS POR `import.meta.url`, NUNCA `process.cwd()`: a suíte roda tanto de `apps/hub`
// quanto da raiz do monorepo, e um teste que depende do diretório de trabalho passa num lugar e
// quebra no outro (já aconteceu com `masterplan-estado.test.ts`).
const arquivo = (caminho: string) => new URL(caminho, import.meta.url);

const bytes = (caminho: string): Uint8Array =>
  new Uint8Array(readFileSync(arquivo(caminho)));

/** As dez anuais do exemplo: uma por ano, no mesmo dia de vencimento das mensais. */
const ANUAIS = Array.from({ length: 10 }, (_, i) => ({
  ordem: `${i + 1} de 10`,
  valor: "R$ 2.000,00",
  vencimento: `10 de dezembro de ${2027 + i}`,
}));

const EXEMPLO: PropostaParaPdf = {
  anuais: ANUAIS,
  anuaisTotal: "R$ 20.000,00",
  atendimento: {
    coordenador: "Lucas Ruas",
    corretor: "Nívea Ferreira",
    imobiliaria: "Raiane Imobiliária",
    telefone: "(62) 98877-1234",
  },
  codigo: "000003",
  compradores: [
    { documento: "529.982.247-25", nome: "Maria Aparecida da Silva", participacao: "60%" },
    { documento: "145.114.775-08", nome: "João Carlos da Silva", participacao: "40%" },
  ],
  condicoes: [
    { rotulo: "Parcelas mensais", valor: "120" },
    { rotulo: "Parcelas anuais", valor: "10 de R$ 2.000,00" },
    { rotulo: "Primeira parcela", valor: "10/12/2026" },
    { rotulo: "Última parcela", valor: "10/11/2036" },
    { rotulo: "Vencimento", valor: "todo dia 10" },
    { rotulo: "Juros", valor: "8% ao ano" },
    { rotulo: "Correção", valor: "IPCA anual" },
    { rotulo: "Sistema", valor: "SACOC" },
  ],
  destaques: [
    { detalhe: "R$ 400,00 por m²", rotulo: "Valor da unidade", valor: "R$ 100.000,00" },
    { detalhe: "10% · 2× de R$ 5.000,00", rotulo: "Entrada", valor: "R$ 10.000,00" },
    { detalhe: "120 mensais + 10 anuais", rotulo: "Financiado", valor: "R$ 90.000,00" },
    { detalhe: "1ª em 10/12/2026", rotulo: "Parcela mensal", valor: "R$ 583,33" },
  ],
  emitidaEm: "04/09/2026",
  empreendimento: "Garden",
  entrada: [
    { ordem: "1 de 2", valor: "R$ 5.000,00", vencimento: "10 de outubro de 2026" },
    { ordem: "2 de 2", valor: "R$ 5.000,00", vencimento: "10 de novembro de 2026" },
  ],
  entradaTotal: "R$ 10.000,00",
  logoC2x: bytes("../../public/c2x-logo.png"),
  logoEmpreendimento: bytes("../../public/garden/logo-garden.png"),
  observacoes: [
    {
      texto:
        "A parcela é reajustada uma vez por ano, no aniversário do contrato. Entre um aniversário e outro o valor não muda. Os valores da tabela acima consideram apenas os juros de 8% ao ano previstos em contrato; a correção pelo IPCA do período é somada na mesma data e não está projetada, por depender de índice futuro.",
      titulo: "Sobre o reajuste.",
    },
    {
      texto:
        "Os valores acima valem até 11/09/2026 e estão sujeitos à confirmação de disponibilidade da unidade e à aprovação de crédito.",
      titulo: "Sobre esta proposta.",
    },
  ],
  reajustes: [
    { ate: "10/11/2027", de: "10/12/2026", parcelas: "1 a 12", periodo: "1º ano", temIpca: false, valor: "R$ 583,33" },
    { ate: "10/11/2028", de: "10/12/2027", parcelas: "13 a 24", periodo: "2º ano", temIpca: true, valor: "R$ 612,66" },
    { ate: "10/11/2029", de: "10/12/2028", parcelas: "25 a 36", periodo: "3º ano", temIpca: true, valor: "R$ 668,20" },
  ],
  subtitulo: "Garden · 250,00 m² · Goiânia, GO",
  unidade: "Quadra 03 · Lote 07",
};

describe("montarPropostaPdf", () => {
  it("monta o PDF e grava o exemplo para conferência visual", async () => {
    const pdf = await montarPropostaPdf(EXEMPLO);

    // %PDF na assinatura: se o pdf-lib tivesse falhado, viria vazio ou lixo.
    expect(pdf.length).toBeGreaterThan(4000);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe("%PDF-");

    writeFileSync(arquivo("../../../../.tmpr/proposta-exemplo.pdf"), pdf);
  });

  it("⚠️ caractere fora do WinAnsi não derruba a proposta", async () => {
    const pdf = await montarPropostaPdf({
      ...EXEMPLO,
      compradores: [{ documento: "529.982.247-25", nome: "Mariana Ćurić — 東京", participacao: "100%" }],
      logoC2x: null,
      logoEmpreendimento: null,
    });
    expect(pdf.length).toBeGreaterThan(3000);
  });

  it("com um comprador só, a coluna de participação não é impressa", async () => {
    const pdf = await montarPropostaPdf({
      ...EXEMPLO,
      compradores: [{ documento: "529.982.247-25", nome: "Maria Aparecida da Silva", participacao: "100%" }],
    });
    expect(pdf.length).toBeGreaterThan(4000);
  });

  it("⚠️ sem parcelas anuais, a seção some — não sai um 'não há'", async () => {
    const semAnuais = await montarPropostaPdf({ ...EXEMPLO, anuais: [], anuaisTotal: "" });
    const comAnuais = await montarPropostaPdf(EXEMPLO);
    expect(semAnuais.length).toBeLessThan(comAnuais.length);
  });
});
