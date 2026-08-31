import { describe, expect, it } from "vitest";

import { lerAba, resumirAba } from "./ler-planilha";

// Monta a grade no formato que o leitor recebe: cada célula com `valor` e `texto`.
function grade(linhas: unknown[][]) {
  return linhas.map((l) =>
    l.map((v) => ({ texto: v instanceof Date ? null : v === null ? null : String(v), valor: v })),
  );
}
// ⚠️ `Date.UTC` e não `new Date(ano, m-1, 1)`: é assim que o ExcelJS entrega a data do
// cabeçalho, e é justamente essa diferença que deslocava todos os meses em uma casa.
const mes = (ano: number, m: number) => new Date(Date.UTC(ano, m - 1, 1));

// ⚠️ AS DUAS FORMAS REAIS DE CABEÇALHO, do arquivo de 31/08/2026. Foi por causa desta diferença
// que o leitor PROCURA o cabeçalho em vez de assumir a linha 1 ou a posição das colunas.
const ABA_PREDIO = grade([
  ["BOLETOS ED. RUBI - AEROPORTO", null, null, null, null, null, null, 0.78, 0.61],
  ["Nome cliente", "Contato", "Aptos", "Venc.", "Nº Parc.", "Parc. Atual", mes(2026, 8), mes(2026, 9)],
  ["PEDRO HENRIQUE CAIXETA", "37 9911-4655", "401", 15, 24, 20, 1109.73, 1116.5],
]);

const ABA_LOTEAMENTO = grade([
  ["", "BOLETOS VALE SOL", null, null, null, null, null, 0.78, 0.61],
  ["Nº", "Nome cliente", "FORMA ENVIO", "Aptos", "Venc.", "Nº Parc.", "Parc. Atual", mes(2026, 8), mes(2026, 9)],
  [2, "ALEXANDRE MENDES", "+55 37 9821-9958", "205 BL 04", 20, 72, 9, 672.78, 676.89],
]);

describe("acha o cabeçalho onde quer que ele esteja", () => {
  it("aba de prédio: cabeçalho na linha 2, sem coluna Nº", () => {
    const r = lerAba("BOLETOS ED RUBI", ABA_PREDIO, "2026-09");
    expect("motivo" in r).toBe(false);
    if ("motivo" in r) return;
    expect(r.clientes).toHaveLength(1);
    expect(r.clientes[0]).toMatchObject({
      contato: "37 9911-4655",
      nome: "PEDRO HENRIQUE CAIXETA",
      unidade: "401",
      valor: 1116.5,
      vencimento: 15,
    });
  });

  it("aba de loteamento: uma coluna Nº na frente desloca tudo", () => {
    const r = lerAba("BOLETOS VALE SOL", ABA_LOTEAMENTO, "2026-09");
    if ("motivo" in r) throw new Error(r.motivo);
    // Se o leitor fosse por posição, o nome viria "2" e o valor viria errado.
    expect(r.clientes[0]?.nome).toBe("ALEXANDRE MENDES");
    expect(r.clientes[0]?.valor).toBe(676.89);
    expect(r.clientes[0]?.contato).toBe("+55 37 9821-9958");
  });

  it("aba sem cabeçalho reconhecível NÃO some em silêncio", () => {
    const r = lerAba("QUALQUER", grade([["um título solto"], ["a", "b"]]), "2026-09");
    expect("motivo" in r).toBe(true);
  });
});

describe("a competência pedida é a que vale", () => {
  it("lê agosto quando se pede agosto", () => {
    const r = lerAba("BOLETOS ED RUBI", ABA_PREDIO, "2026-08");
    if ("motivo" in r) throw new Error(r.motivo);
    expect(r.clientes[0]?.valor).toBe(1109.73);
  });

  it("mês que a aba não tem deixa o valor vazio, sem inventar", () => {
    const r = lerAba("BOLETOS ED RUBI", ABA_PREDIO, "2026-12");
    if ("motivo" in r) throw new Error(r.motivo);
    expect(r.clientes[0]?.valor).toBeNull();
  });
});

describe("as colunas sem cabeçalho depois do último mês são OBSERVAÇÃO", () => {
  // Foi uma dessas que eu não li na conferência do Garden.
  it("captura o recado que decide a emissão", () => {
    const g = grade([
      ["Nome cliente", "Contato", "Aptos", "Venc.", "Nº Parc.", "Parc. Atual", mes(2026, 9), null],
      ["ANDRE ALMEIDA COSTA", "37 9996-0252", "810", 10, 57, 16, 10730.02, "PAGO ATÉ MAIO/27 RETOMA JUNHO/27"],
    ]);
    const r = lerAba("BOLETOS GIANT", g, "2026-09");
    if ("motivo" in r) throw new Error(r.motivo);
    expect(r.clientes[0]?.observacao).toBe("PAGO ATÉ MAIO/27 RETOMA JUNHO/27");
    // E o resumo tira ele da emissão, apesar do valor calculado.
    expect(resumirAba(r).emitem).toBe(0);
    expect(resumirAba(r).fora[0]?.explicacao).toContain("pag");
  });

  it("texto NA célula do mês vira marcação, não valor", () => {
    const g = grade([
      ["Nome cliente", "Contato", "Aptos", "Venc.", "Nº Parc.", "Parc. Atual", mes(2026, 9)],
      ["EVERTON VINICIUS", "", "202", 5, 36, 14, "Não fazer"],
    ]);
    const r = lerAba("BOLETOS ED CRISTAL", g, "2026-09");
    if ("motivo" in r) throw new Error(r.motivo);
    expect(r.clientes[0]?.marcaNoMes).toBe("Não fazer");
    expect(r.clientes[0]?.valor).toBeNull();
    expect(resumirAba(r).emitem).toBe(0);
  });

  it("o rodapé da aba não vira cliente", () => {
    const g = grade([
      ["Nome cliente", "Contato", "Aptos", "Venc.", "Nº Parc.", "Parc. Atual", mes(2026, 9)],
      ["GUSTAVO AUGUSTO", "37 8409-0108", "102", 15, 18, 14, 1682.16],
      ["Obs: Paralisamos a parcela do cliente pois a obra está atrasada."],
    ]);
    const r = lerAba("BOLETOS ED ESMERALDA", g, "2026-09");
    if ("motivo" in r) throw new Error(r.motivo);
    expect(r.clientes).toHaveLength(1);
  });
});

describe("loteamento monta a unidade de quadra e lote", () => {
  it("Q5 L7 quando não há coluna de apartamento", () => {
    const g = grade([
      ["Nº", "LOTE", "QUADRA", "NOME DO CLIENTE", "Venc.", "Nº Parc.", "Parc. Atual", mes(2026, 9)],
      [1, "7", "5", "LIBERIO EUSTAQUIO", 10, 48, 1, 1966.67],
    ]);
    const r = lerAba("VALE DO OURO", g, "2026-09");
    if ("motivo" in r) throw new Error(r.motivo);
    expect(r.clientes[0]?.unidade).toBe("Q5 L7");
  });
});

describe("a aba conhece o empreendimento dela", () => {
  it("casa mesmo com espaço sobrando no nome da aba", () => {
    const r = lerAba("BOLETOS GIANT ", ABA_PREDIO, "2026-09");
    if ("motivo" in r) throw new Error(r.motivo);
    expect(r.empreendimento?.nome).toBe("Giant Towers");
  });

  it("aba desconhecida devolve empreendimento nulo, e a tela avisa", () => {
    const r = lerAba("BOLETOS INVENTADO", ABA_PREDIO, "2026-09");
    if ("motivo" in r) throw new Error(r.motivo);
    expect(r.empreendimento).toBeNull();
  });
});

describe("o mês vem em UTC — o deslocamento que trocava a competência", () => {
  // ⚠️ CASO REAL do arquivo de 31/08/2026. O ExcelJS entrega setembro como
  // `2026-09-01T00:00:00Z`; lido no fuso do Brasil (UTC−3) isso é 31/08 às 21h, ou seja AGOSTO.
  // Com a leitura local, pedir setembro não achava coluna e a tela mostrava 0 boleto — e o risco
  // maior era o silencioso: receber os valores do mês anterior sem nenhum aviso.
  it("2026-09-01T00:00:00Z é setembro, não agosto", () => {
    const g = grade([
      ["Nome cliente", "Venc.", mes(2026, 8), mes(2026, 9)],
      ["ADMINISTRADORA DE IMOVEIS QUARESMA", 10, 4239.77, 4265.63],
    ]);
    const r = lerAba("BOLETOS VALE SOL", g, "2026-09");
    if ("motivo" in r) throw new Error(r.motivo);
    expect(r.meses).toEqual(["2026-08", "2026-09"]);
    expect(r.clientes[0]?.valor).toBe(4265.63);
    expect(resumirAba(r).emitem).toBe(1);
  });
});
