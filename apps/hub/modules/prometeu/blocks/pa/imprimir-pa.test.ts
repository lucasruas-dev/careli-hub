import { describe, expect, it } from "vitest";

import type { PlanoComercial } from "@/lib/apolo/planos-comerciais";

import { type DadosDaPa, folhaHTML, type UnidadeDaPa } from "./imprimir-pa";

// ⚠️ O QUE ESTE ARQUIVO PROTEGE. Até 29/08/2026 os planos da folha eram três constantes no
// código, com os números do Villa Paris, impressas em qualquer lançamento. Agora vêm do
// empreendimento — e o risco mudou de lugar: a tabela e o texto jurídico logo abaixo dela
// podem passar a discordar entre si, o que ninguém percebe olhando o papel de relance.
//
// Estes testes fixam as duas coisas que o papel promete: o número na linha do plano e o número
// escrito por extenso na cláusula.

function plano(parcial: Partial<PlanoComercial>): PlanoComercial {
  return {
    entradaPercentual: 10,
    indiceCorrecao: "IPCA_ANUAL",
    jurosConvencao: "equivalente",
    jurosPeriodicidade: "anual",
    jurosTaxa: null,
    nome: "NORMAL",
    parcelas: 120,
    sistemaAmortizacao: "sacoc",
    slot: "normal",
    ...parcial,
  };
}

const UNIDADE: UnidadeDaPa = {
  area: "376,56",
  codigo: "RVPA23",
  lote: "23",
  precoTabela: 220_000,
  quadra: "A",
  reservadaEm: "29/08/2026 10:00",
};

function dados(planos: PlanoComercial[]): DadosDaPa {
  return {
    codigoCupom: "ABC-123",
    corretor: "Fulano",
    dataExtensa: "29 de agosto de 2026",
    imobiliaria: "Imobiliária Teste",
    incorporadora: "Careli",
    lancamento: "Villa Paris",
    logoSrc: "https://exemplo/logo.png",
    planos,
    proponentes: [{ documento: "12345678909", nome: "Maria", percentual: 100 }],
    qrDataUrl: "data:image/png;base64,AAA",
    unidades: [UNIDADE],
  };
}

describe("a folha imprime os planos DO EMPREENDIMENTO", () => {
  const villaParis = [
    plano({
      entradaPercentual: 10,
      jurosPeriodicidade: "mensal",
      jurosTaxa: 0.6434,
      nome: "NORMAL",
      parcelas: 180,
    }),
  ];

  it("o número de parcelas é o do cadastro, não o 120 que estava fixo", () => {
    const html = folhaHTML(dados(villaParis), UNIDADE);
    expect(html).toContain("180× DE");
    expect(html).not.toContain("120× DE");
  });

  it("SACOC imprime a amortização pura — R$ 1.100,00, que é o que o boleto traz", () => {
    const html = folhaHTML(dados(villaParis), UNIDADE);
    expect(html).toContain("1.100,00");
    // O valor que a folha antiga imprimia, em Price: não pode reaparecer.
    expect(html).not.toContain("2.402,29");
  });

  it("a cláusula jurídica repete o MESMO número da tabela", () => {
    const html = folhaHTML(dados(villaParis), UNIDADE);
    expect(html).toContain("180 parcelas de amortização constante");
    expect(html).not.toContain("120 parcelas pela Tabela Price");
  });

  it("SACOC com juros avisa que o reajuste é no aniversário", () => {
    const html = folhaHTML(dados(villaParis), UNIDADE);
    expect(html).toContain("reajuste no aniversário");
  });
});

describe("o rótulo no papel é sempre INVESTIDOR / CURTO / NORMAL", () => {
  // Lucas, 29/08: "sempre vamos colocar um nome como normal, curto, investidor". O C2X guarda
  // "PLANO-NORMAL", "PLANO COMERCIAL 84", "10% ENTRADA + 144 PARCELAS" — nomes internos de quem
  // cadastrou, um por empreendimento. No papel o corretor lê sempre o mesmo vocabulário.
  it("o nome cadastrado no C2X não chega ao papel", () => {
    const html = folhaHTML(
      dados([
        plano({ nome: "PLANO COMERCIAL 84", slot: "curto" }),
        plano({ nome: "10% ENTRADA + 144 PARCELAS", slot: "normal" }),
      ]),
      UNIDADE,
    );
    expect(html).not.toContain("COMERCIAL 84");
    expect(html).not.toContain("144 PARCELAS");
    expect(html).toContain("CURTO");
    expect(html).toContain("NORMAL");
  });

  it("e a palavra PLANO não sai duplicada na cláusula", () => {
    const html = folhaHTML(
      dados([plano({ nome: "PLANO-NORMAL", slot: "normal" })]),
      UNIDADE,
    );
    expect(html).not.toMatch(/PLANO\s+PLANO/);
    expect(html).toContain("<b>PLANO NORMAL:</b>");
  });

  it("plano SEM slot cai no nome cadastrado, em vez de virar linha anônima", () => {
    const html = folhaHTML(
      dados([plano({ nome: "PROMOCIONAL FEIRAO", slot: null })]),
      UNIDADE,
    );
    expect(html).toContain("PROMOCIONAL FEIRAO");
  });
});

describe("PRICE continua sendo Price onde o empreendimento é Price", () => {
  it("a parcela embute os juros e a cláusula diz Tabela Price", () => {
    const html = folhaHTML(
      dados([
        plano({
          jurosTaxa: 8,
          parcelas: 120,
          sistemaAmortizacao: "price",
        }),
      ]),
      UNIDADE,
    );
    expect(html).toContain("2.373,18");
    expect(html).toContain("Tabela Price");
    expect(html).toContain("já embutidos na parcela");
  });
});

describe("a quantidade de planos vem do empreendimento", () => {
  it("dois planos saem duas linhas, e as alíneas param na letra certa", () => {
    const html = folhaHTML(
      dados([
        plano({ nome: "CURTO", parcelas: 24, slot: "curto" }),
        plano({ nome: "NORMAL", parcelas: 156, slot: "normal" }),
      ]),
      UNIDADE,
    );
    expect(html.match(/class="plano"/g)?.length).toBe(2);
    // A) sinal · B) CURTO · C) NORMAL · D) PERSONALIZADO — e nada de E).
    expect(html).toContain("<b>D)</b> <b>PLANO PERSONALIZADO:</b>");
    expect(html).not.toContain("<b>E)</b>");
  });

  it("quatro planos também fecham a conta das letras", () => {
    const html = folhaHTML(
      dados([
        plano({ slot: "investidor" }),
        plano({ slot: "curto" }),
        plano({ slot: "normal" }),
        plano({ slot: "avista" }),
      ]),
      UNIDADE,
    );
    expect(html).toContain("<b>F)</b> <b>PLANO PERSONALIZADO:</b>");
  });

  it("a ordem é investidor, curto, normal — mesmo chegando embaralhado", () => {
    const html = folhaHTML(
      dados([
        plano({ nome: "z", slot: "normal" }),
        plano({ nome: "a", slot: "investidor" }),
        plano({ nome: "m", slot: "curto" }),
      ]),
      UNIDADE,
    );
    expect(html.indexOf("INVESTIDOR")).toBeLessThan(html.indexOf("CURTO"));
    expect(html.indexOf("CURTO")).toBeLessThan(html.indexOf("NORMAL"));
  });
});

describe("sem preço de tabela a folha ainda sai", () => {
  it("a linha do plano fica em branco para preencher à mão, e o plano não some", () => {
    const semPreco = { ...UNIDADE, precoTabela: null };
    const html = folhaHTML(
      { ...dados([plano({ nome: "NORMAL" })]), unidades: [semPreco] },
      semPreco,
    );
    expect(html).toContain("NORMAL");
    expect(html).toContain("class=\"plano\"");
  });
});

describe("o sinal impresso é o do cadastro", () => {
  it("entrada de 15% sai como 15%, e a cláusula fala do saldo de 85%", () => {
    const html = folhaHTML(
      dados([plano({ entradaPercentual: 15, parcelas: 192 })]),
      UNIDADE,
    );
    expect(html).toContain("SINAL 15%");
    expect(html).toContain("O saldo de 85% é");
    // 15% de 220.000
    expect(html).toContain("33.000,00");
  });
});
