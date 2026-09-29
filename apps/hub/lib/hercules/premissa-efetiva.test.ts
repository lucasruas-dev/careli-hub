import { describe, expect, it } from "vitest";

import type { FaixaDePrazo } from "./premissa-do-prazo";
import { planoEfetivo } from "./premissa-efetiva";

// ⚠️ AFIRMAÇÃO EM CAIXA ALTA: A PREMISSA NÃO ERA UM LUGAR, ERA UM `useMemo` DENTRO DE UM COMPONENTE.
//
// Nívea (24/09/2026), sobre a proposta 000038 (Vale do Ouro, Quadra 12 · Lote 22, TAISA FERNANDA
// BATISTA): *"Na proposta não está saindo o novo cenário de juros e correção."*
//
// O que estava MEDIDO nessa proposta (`select condicoes->'totais', condicoes->'reajustes' from
// hercules_propostas where protocolo_numero = 38`): `totais.mensais = R$ 138.130,32`, com quatro
// degraus de reajuste (2.595,00 / 2.719,84 / 2.964,61 / 3.231,41). Sem juros, que foi o que a
// corretora escolheu na tela, seriam 48 × R$ 2.595,00 = R$ 124.560,00. R$ 13.570,32 de diferença.
//
// A composição "cadastro → faixa de prazo → o que o corretor escreveu" existia só dentro de
// `SimuladorDeProposta.tsx` (o `useMemo` de `cru`), e por isso nem a modal, nem o corpo do pedido,
// nem a rota conseguiam alcançá-la. Este arquivo é essa composição virando peça.

const PLANO_LONGO = {
  entradaPercentual: 10,
  // O NORMAL do VOC, medido em 24/09/2026: 156 parcelas, IPCA anual, 0,7207% ao mês.
  indiceCorrecao: "IPCA_ANUAL",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "mensal",
  jurosTaxa: 0.7207,
  nome: "NORMAL",
  parcelas: 156,
  sistemaAmortizacao: "sacoc",
};

/** A faixa 1 a 24 do VOC, medida em `temis_faixas_de_prazo`: sem juros e sem correção. */
const FAIXA_CURTA: FaixaDePrazo = {
  defineEntrada: false,
  defineIndice: true,
  defineJuros: true,
  entradaPercentual: null,
  indiceCorrecao: "SEM_CORRECAO",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "mensal",
  jurosTaxa: 0,
  parcelaMaxima: 24,
  parcelaMinima: 1,
};

/** Uma faixa longa que NÃO opina sobre juros nem índice — o caso de "herda o cadastro". */
const FAIXA_MUDA: FaixaDePrazo = {
  defineEntrada: false,
  defineIndice: false,
  defineJuros: false,
  entradaPercentual: null,
  indiceCorrecao: null,
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "mensal",
  jurosTaxa: null,
  parcelaMaxima: 180,
  parcelaMinima: 25,
};

describe("o plano efetivo", () => {
  it("a ordem é cadastro, depois faixa, depois corretor", () => {
    const sem = planoEfetivo({ parcelas: 48, plano: PLANO_LONGO });
    expect(sem.plano?.jurosTaxa).toBe(0.7207);
    expect(sem.plano?.indiceCorrecao).toBe("IPCA_ANUAL");
    expect(sem.jurosDe).toBe("cadastro");
    expect(sem.indiceDe).toBe("cadastro");

    const comFaixa = planoEfetivo({
      faixasDePrazo: [FAIXA_CURTA, FAIXA_MUDA],
      parcelas: 24,
      plano: PLANO_LONGO,
    });
    expect(comFaixa.plano?.jurosTaxa).toBe(0);
    expect(comFaixa.plano?.indiceCorrecao).toBe("SEM_CORRECAO");
    expect(comFaixa.jurosDe).toBe("faixa");

    const comCorretor = planoEfetivo({
      faixasDePrazo: [FAIXA_CURTA, FAIXA_MUDA],
      indiceSobrescrito: "POUPANCA",
      jurosSobrescrito: "0,5",
      parcelas: 24,
      plano: PLANO_LONGO,
    });
    expect(comCorretor.plano?.jurosTaxa).toBe(0.5);
    expect(comCorretor.plano?.indiceCorrecao).toBe("POUPANCA");
    expect(comCorretor.jurosDe).toBe("corretor");
    expect(comCorretor.indiceDe).toBe("corretor");
    expect(comCorretor.alteradaPeloCorretor).toBe(true);
  });

  it("taxa vazia volta à premissa da faixa, e 0 escrito à mão é alteração de verdade", () => {
    // Apagar o campo é DESFAZER a alteração.
    const vazia = planoEfetivo({
      faixasDePrazo: [FAIXA_MUDA],
      jurosSobrescrito: "   ",
      parcelas: 48,
      plano: PLANO_LONGO,
    });
    expect(vazia.plano?.jurosTaxa).toBe(0.7207);
    expect(vazia.alteradaPeloCorretor).toBe(false);

    // Escrever 0 é dizer SEM JUROS, e aí a nota tem de abrir.
    const zero = planoEfetivo({
      faixasDePrazo: [FAIXA_MUDA],
      jurosSobrescrito: "0",
      parcelas: 48,
      plano: PLANO_LONGO,
    });
    expect(zero.plano?.jurosTaxa).toBe(0);
    expect(zero.alteradaPeloCorretor).toBe(true);
    expect(zero.taxaAoMes).toBe(0);
  });

  it("o indiceCorrecao do corretor entra no plano efetivo", () => {
    // ⚠️ ERA ESTE O CAMPO QUE MORRIA. `SimuladorDeProposta.tsx` copiava para a conta só
    // `entradaPercentual`, `sistemaAmortizacao` e `taxaAoMes`: o índice escolhido nunca entrava no
    // plano, nem na própria tela. É o "poupança anual" do print da Nívea, que o PDF desmentia.
    const r = planoEfetivo({
      indiceSobrescrito: "POUPANCA",
      parcelas: 48,
      plano: PLANO_LONGO,
    });
    expect(r.plano?.indiceCorrecao).toBe("POUPANCA");
    // A taxa não foi tocada: mexer no índice não mexe nos juros.
    expect(r.plano?.jurosTaxa).toBe(0.7207);
    expect(r.jurosDe).toBe("cadastro");
    expect(r.indiceDe).toBe("corretor");
  });

  it("a faixa 1 a 24 do VOC com define_juros e juros 0 zera o plano longo de 0,7207", () => {
    const r = planoEfetivo({
      faixasDePrazo: [FAIXA_CURTA, FAIXA_MUDA],
      parcelas: 24,
      plano: PLANO_LONGO,
    });
    expect(r.plano?.jurosTaxa).toBe(0);
    expect(r.taxaAoMes).toBe(0);
    expect(r.plano?.indiceCorrecao).toBe("SEM_CORRECAO");
    expect(r.alteradaPeloCorretor).toBe(false);
    // O molde continua à mão, para a Têmis distinguir o cadastro do negociado.
    expect(r.doCadastro?.jurosTaxa).toBe(0.7207);
  });

  it("o molde do cadastro volta intacto, e sem faixa nem corretor o objeto é o MESMO", () => {
    const r = planoEfetivo({ parcelas: 48, plano: PLANO_LONGO });
    expect(r.plano).toBe(PLANO_LONGO);
    expect(r.doCadastro).toBe(PLANO_LONGO);
  });

  it("sem plano nenhum não quebra", () => {
    const r = planoEfetivo({ parcelas: 48, plano: null });
    expect(r.plano).toBe(null);
    expect(r.taxaAoMes).toBe(0);
    expect(r.alteradaPeloCorretor).toBe(false);
  });

  it("a taxa mensal sai da convenção do plano, e não do número cru", () => {
    // 12% ao ano em equivalente é (1,12)^(1/12) − 1 ≈ 0,9489% ao mês.
    const anual = { ...PLANO_LONGO, jurosPeriodicidade: "anual", jurosTaxa: 12 };
    const r = planoEfetivo({ parcelas: 48, plano: anual });
    expect(r.taxaAoMes).toBeCloseTo(0.0094888, 7);
  });

  it("o sistema de amortização sai normalizado do cadastro", () => {
    const r = planoEfetivo({
      parcelas: 48,
      plano: { ...PLANO_LONGO, sistemaAmortizacao: "SACOC" },
    });
    expect(r.sistemaAmortizacao).toBe("sacoc");
  });
});
