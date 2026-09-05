import { describe, expect, it } from "vitest";

import { agregarFluxo, type PropostaDaCarga } from "@/lib/hercules/fluxo-de-venda";

import { COLUNAS_DA_PROPOSTA } from "./route";

// A LEITURA DA TELA VENDA — o contrato entre o `select` e a agregação.
//
// ⚠️ ESTE ARQUIVO EXISTE POR CAUSA DE UM DEFEITO REAL: `protocolo_numero` não estava no `select`,
// e o PostgREST devolve a linha sem a coluna, sem erro nenhum. `agregarFluxo` monta
// `codigo: p.protocolo_numero ? codigoDaVenda(...) : null` — então o COD que a reserva mostrava
// DESAPARECIA no exato momento em que a venda avançava para proposta, na lista e na busca por
// código. O único jeito de uma coluna esquecida quebrar em vez de escrever `null` na tela é
// exercitar a agregação com a linha RECORTADA pelas colunas pedidas, que é o que se faz aqui.

/** O que o PostgREST devolve: a linha do banco recortada pelas colunas do `select`. */
function comoOPostgrestDevolve(linhaCompleta: Record<string, unknown>): PropostaDaCarga {
  const recorte: Record<string, unknown> = {};
  for (const coluna of COLUNAS_DA_PROPOSTA) {
    if (coluna in linhaCompleta) recorte[coluna] = linhaCompleta[coluna];
  }
  return recorte as unknown as PropostaDaCarga;
}

/** A proposta NATIVA como ela está gravada: COD copiado da reserva e prazo contratado. */
const NO_BANCO: Record<string, unknown> = {
  cliente_documento: "52998224725",
  cliente_nome: "MARIA DA SILVA",
  codigo: null,
  // ⚠️ 120 CONTRATADAS CONTRA 180 DO MOLDE: é o par que a tela precisa ler certo.
  contrato_parcelas: 120,
  criado_em: "2026-09-04T15:00:00.000Z",
  criado_em_c2x: null,
  criado_por_nome: "Lucas Ruas",
  data_assinatura: null,
  data_ato: null,
  data_faturamento: null,
  empreendimento_codigo: "JDG",
  etapa: "proposta",
  etapa_c2x: null,
  etapa_desde: "2026-09-04T15:00:00.000Z",
  id: "prop-1",
  imobiliaria_nome: "GURGEL",
  motivo: null,
  observacao: "Cliente pediu vencimento no dia 20.",
  origem: "panteon",
  plano_correcao: null,
  plano_juros: null,
  plano_nome: "NORMAL",
  plano_parcelas: 180,
  plano_personalizado: null,
  protocolo_numero: 123,
  unidade_id: "uni-1",
  unidade_nome: "Q01 L01",
  valor: 178_100,
};

describe("COLUNAS_DA_PROPOSTA", () => {
  it("⚠️ o COD segue a venda: a proposta gerada mostra o MESMO código da reserva", () => {
    const r = agregarFluxo({ propostas: [comoOPostgrestDevolve(NO_BANCO)], unidades: [] });
    expect(r.lista[0]?.codigo).toBe("000123");
  });

  it("⚠️ o prazo da lista é o CONTRATADO, não o do molde", () => {
    // 180 é o tamanho do produto que a mesa vende; 120 é o que o coordenador digitou. Sem
    // `contrato_parcelas` no recorte, `fluxoDoPlano` cai no molde e a lista mente sobre a venda.
    const r = agregarFluxo({ propostas: [comoOPostgrestDevolve(NO_BANCO)], unidades: [] });
    expect(r.lista[0]?.plano).toContain("120x");
    expect(r.lista[0]?.plano).not.toContain("180x");
  });

  it("o que o coordenador anotou chega junto", () => {
    const r = agregarFluxo({ propostas: [comoOPostgrestDevolve(NO_BANCO)], unidades: [] });
    expect(r.lista[0]?.observacao).toBe("Cliente pediu vencimento no dia 20.");
  });

  it("a proposta importada do C2X continua sem código — o legado não tem", () => {
    const doC2x = comoOPostgrestDevolve({
      ...NO_BANCO,
      criado_em_c2x: "2024-07-16T10:00:00Z",
      origem: "c2x",
      protocolo_numero: null,
    });
    expect(agregarFluxo({ propostas: [doC2x], unidades: [] }).lista[0]?.codigo).toBeNull();
  });

  it("nenhuma coluna repetida, e o `select` é uma string separada por vírgula", () => {
    expect(new Set(COLUNAS_DA_PROPOSTA).size).toBe(COLUNAS_DA_PROPOSTA.length);
    expect(COLUNAS_DA_PROPOSTA.join(",")).not.toContain(" ");
  });
});
