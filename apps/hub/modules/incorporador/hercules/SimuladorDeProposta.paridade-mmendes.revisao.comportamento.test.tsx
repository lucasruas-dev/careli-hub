// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PlanoComercial } from "@/lib/apolo/planos-comerciais";
import { montarCronograma, type Cronograma } from "@/lib/hercules/cronograma";
import { valoresDaSimulacaoPublica } from "@/lib/hercules/espelho/simulacao-publica";
import type { PlanoDaVenda } from "@/lib/hercules/fluxo-de-venda";
import { comoPlano, type LinhaDoPlano } from "@/lib/hercules/planos-do-panteon";
import { montarFolhaDaProposta } from "@/lib/hercules/proposta-para-pdf";

import { type CondicoesDaProposta, SimuladorDeProposta } from "./SimuladorDeProposta";

// REVISÃO INDEPENDENTE (lente: PARIDADE COM A MMENDES E COERÊNCIA DE NÚMEROS), 18/09/2026.
//
// Mede, com o SIMULADOR DE VERDADE montado em jsdom (Mesa de Venda e espelho), os 87 lotes disponíveis
// do Garden (SELECT em hercules_unidades, enterprise 39, situacao = 'disponivel', 18/09/2026) nos 3
// planos de temis_planos (SELECT de 18/09/2026, com o desconto que a 0178.dados-garden grava), contra o
// `renderOficial`/`ofBalanco` extraídos do próprio `masterplans-internos/garden.html`.
//
// Por lote e plano: o texto do cartão (cru e com as normalizações declaradas), o clique (o que sobe
// para a proposta), o cronograma e a folha do PDF (fechando ao centavo), as datas das anuais e o
// corpo que o espelho mandaria para a rota pública do PDF.
//
// Relatório com os números em RELATORIO, só quando a variável `RELATORIO_PARIDADE_MMENDES` aponta
// para um arquivo (fora do repositório). Sem ela, o teste não escreve nada em disco.

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ⚠️ NADA DE CAMINHO FIXO DA MÁQUINA DE QUEM REVISOU (18/09/2026): a primeira versão gravava numa
// pasta de rascunho de uma sessão, a cada rodada da suíte, em qualquer máquina.
const RELATORIO = process.env.RELATORIO_PARIDADE_MMENDES ?? null;

const HTML = fs.readFileSync(
  path.join(__dirname, "..", "..", "..", "masterplans-internos", "garden.html"),
  "utf8",
);
function trecho(de: string, ate: string): string {
  const i = HTML.indexOf(de);
  const f = HTML.indexOf(ate, i);
  if (i < 0 || f < 0) throw new Error(`marcador ausente: ${de} / ${ate}`);
  return HTML.slice(i, f);
}

type NumerosMM = {
  alvo: number;
  anQtd: number;
  anVal: number;
  ent: number;
  fecha: boolean;
  nominal: number;
  parcela: number;
  prazo: number;
};
type MMendes = {
  mesa: (preco: number) => string;
  moedaPa: (v: number) => string;
  numeros: (preco: number, k: number) => NumerosMM;
};
const MM = new Function(
  [
    trecho("const fM  =", "function curto("),
    trecho("function esc(s)", "\n"),
    trecho("const PLANOS=[", "/* ============================== abrir"),
    trecho("const OF_TOL=1.00;", "/* `mil` liga o separador"),
    trecho("function ofCampo(", "/* ligacoes do cartao"),
    trecho("function ofCompDoCartao(", "/* ------------------ pre-visualizacao"),
    "const alvoDaMesa={innerHTML:''};",
    "const $=id=>id==='ofMesa'?alvoDaMesa:null;",
    "function ofLigar(){} function ofRodape(){}",
    "function mesa(preco){ SIM.preco=preco; SIM.precoTabela=preco; EDIT=[]; ofAberto=null; renderOficial(); return alvoDaMesa.innerHTML; }",
    "function numeros(preco,k){ SIM.preco=preco; SIM.precoTabela=preco; EDIT=[]; return ofCompDoCartao(k); }",
    "return {mesa, moedaPa, numeros};",
  ].join("\n"),
)() as MMendes;

const limpo = (t: null | string | undefined) => (t ?? "").replace(/\s+/g, " ").trim();
const reaisDoTexto = (t: string) => Number(t.replace(/[^\d,]/g, "").replace(",", "."));

// ── Os dados, como o banco os tem ────────────────────────────────────────────────────────────────
/** Os 87 lotes disponíveis do Garden: SELECT codigo, preco_tabela FROM hercules_unidades WHERE enterprise_id = 39 AND situacao = disponivel (18/09/2026). */
const LOTES_POR_PRECO: Record<number, string> = {
  410000: "GDN0101 GDN0102 GDN0103 GDN0104 GDN0105 GDN0110 GDN0111 GDN0112 GDN0113 GDN0201 GDN0202 GDN0203 GDN0204 GDN0209 GDN0210 GDN0211 GDN0212",
  416000: "GDN0402 GDN0411 GDN0412 GDN0416 GDN0427 GDN0428 GDN0429 GDN0430 GDN0431 GDN0432 GDN0503 GDN0504 GDN0505 GDN0611 GDN0626 GDN0627 GDN0628 GDN0701 GDN0702",
  420000: "GDN0304",
  421500: "GDN0401 GDN0707 GDN0708 GDN0803 GDN0827 GDN1002 GDN1003 GDN1004 GDN1005 GDN1006 GDN1012 GDN1801 GDN1802",
  430000: "GDN0314 GDN0315 GDN1108 GDN1109 GDN1225 GDN1324 GDN1325 GDN1407 GDN1408 GDN1616 GDN1617 GDN1618 GDN1706 GDN1707 GDN1803 GDN1804",
  435000: "GDN1110 GDN1111 GDN1223 GDN1224 GDN1311 GDN1312 GDN1313 GDN1409 GDN1410 GDN1411",
  440000: "GDN0305",
  460000: "GDN0306",
  470000: "GDN0307 GDN0308 GDN0313",
  480000: "GDN0309",
  490000: "GDN0310",
  510000: "GDN0311",
  530000: "GDN0312",
  570000: "GDN1805",
  580000: "GDN1806",
};
const LOTES = Object.entries(LOTES_POR_PRECO).flatMap(([p, cs]) => cs.split(" ").map((c) => ({ c, p: Number(p) })));

const LINHAS: LinhaDoPlano[] = [
  { anuais_quantidade: 5, anuais_valor: "25000.00", categoria_id: null, desconto_percentual: "0", enterprise_id: "39", entrada_percentual: "10.000", id: "2250f8d9-76a7-4859-ac14-c38f84cfd4cb", indice_correcao: "IPCA_ANUAL", juros_convencao: "equivalente", juros_periodicidade: "anual", juros_taxa: "6.000000", nome: "NORMAL", ordem: 1, parcelas: 60, ressalva: null, sistema_amortizacao: "sacoc", slot: null },
  { anuais_quantidade: 4, anuais_valor: "25000.00", categoria_id: null, desconto_percentual: "8", enterprise_id: "39", entrada_percentual: "8.000", id: "c25514fe-6d18-47c0-8521-aac7681d4f3c", indice_correcao: "IPCA_ANUAL", juros_convencao: "equivalente", juros_periodicidade: "anual", juros_taxa: "6.000000", nome: "INVESTIDOR PARCELADO", ordem: 2, parcelas: 84, ressalva: "válido para as próximas 16 unidades", sistema_amortizacao: "sacoc", slot: null },
  { anuais_quantidade: 3, anuais_valor: "30000.00", categoria_id: null, desconto_percentual: "12", enterprise_id: "39", entrada_percentual: "40.000", id: "c3a15c48-4fb0-40b5-bee3-e3d51c913ce3", indice_correcao: "IPCA_ANUAL", juros_convencao: "equivalente", juros_periodicidade: "anual", juros_taxa: "0.000000", nome: "INVESTIDOR", ordem: 3, parcelas: 36, ressalva: null, sistema_amortizacao: "sacoc", slot: null },
];
/** O plano da Mesa: a mesma normalização da rota `/venda` e do portão da proposta. */
const DO_PANTEON = LINHAS.map((l) => comoPlano(l));
const PLANOS_DA_MESA = DO_PANTEON as unknown as Array<PlanoDaVenda & { ressalva?: null | string }>;
/** O plano público (PlanoPublico → PlanoDaVenda do `PainelDoLote`): sem a ressalva, como hoje. */
const PLANOS_DO_ESPELHO = DO_PANTEON.map((p) => ({
  anuaisQuantidade: p.anuaisQuantidade ?? 0,
  anuaisValor: p.anuaisValor ?? 0,
  descontoPercentual: p.descontoPercentual,
  entradaPercentual: p.entradaPercentual,
  indiceCorrecao: p.indiceCorrecao,
  jurosConvencao: "efetiva",
  jurosPeriodicidade: p.jurosPeriodicidade,
  jurosTaxa: p.jurosTaxa,
  nome: p.nome,
  parcelas: p.parcelas,
  sistemaAmortizacao: p.sistemaAmortizacao,
  slot: null,
})) as unknown as PlanoDaVenda[];
const PISO = 8;

// ── Montagem ─────────────────────────────────────────────────────────────────────────────────────
let alvo: HTMLDivElement;
let raiz: Root;
let ultima: CondicoesDaProposta | null = null;
const aoMudar = (c: CondicoesDaProposta | null) => {
  ultima = c;
};

beforeEach(() => {
  alvo = document.createElement("div");
  document.body.appendChild(alvo);
  raiz = createRoot(alvo);
  ultima = null;
});
afterEach(() => {
  act(() => raiz.unmount());
  alvo.remove();
});

function montar(
  vocabulario: "proposta" | "simulacao",
  planos: Array<PlanoDaVenda & { ressalva?: null | string }>,
  preco: number,
  unidade: string,
) {
  act(() => {
    raiz.render(
      <SimuladorDeProposta
        aoMudarCondicoes={aoMudar}
        entradaMinimaPercentual={PISO}
        planos={planos}
        unidade={unidade}
        valorDaUnidade={preco}
        vocabulario={vocabulario}
      />,
    );
  });
}
function botaoDoCartao(nome: string): HTMLButtonElement {
  const b = [...alvo.querySelectorAll("button")].find(
    (x) => x.querySelector('[data-cartao="nome"]')?.textContent?.trim() === nome,
  );
  if (!b) throw new Error(`cartão ${nome} ausente`);
  return b;
}
function clicar(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}
function parcelaGrande(): string {
  const b = [...alvo.querySelectorAll("b")].find((x) => x.style.fontSize === "34px");
  return limpo(b?.textContent);
}

type Linhas = {
  correcao: string;
  nome: string;
  origemDoValor: string;
  parcela: string;
  prazo: string;
  ressalva: string;
  resumo: string;
  valorDoLote: string;
};
function linhasNossas(b: HTMLButtonElement): Linhas {
  const l = (k: string) => limpo(b.querySelector(`[data-cartao="${k}"]`)?.textContent);
  return {
    correcao: l("correcao"),
    nome: l("nome"),
    origemDoValor: l("origem-do-valor"),
    parcela: l("parcela"),
    prazo: l("prazo"),
    ressalva: l("ressalva"),
    resumo: l("resumo"),
    valorDoLote: l("valor-do-lote"),
  };
}
function mesaDaMMendes(preco: number) {
  const doc = new DOMParser().parseFromString(`<div>${MM.mesa(preco)}</div>`, "text/html");
  const cartoes = [...doc.querySelectorAll(".of-pl")].map((pl) => {
    const b = pl.querySelector(".of-nome b")!;
    const ressalva = limpo(b.querySelector(".of-res")?.textContent);
    const pv = pl.querySelector(".of-pa .of-v")!;
    const prazo = limpo(pv.querySelector("small")?.textContent);
    const linhas: Linhas = {
      correcao: limpo(pl.querySelector(".of-pa .of-de")?.textContent),
      nome: limpo(b.textContent).replace(ressalva, "").trim(),
      origemDoValor: limpo(pl.querySelector(".of-lote .of-de")?.textContent),
      parcela: limpo(pv.textContent).replace(prazo, "").trim(),
      prazo,
      ressalva,
      resumo: limpo(pl.querySelector(".of-nome small")?.textContent),
      valorDoLote: limpo(pl.querySelector(".of-lote .of-v")?.textContent),
    };
    return { inteiro: limpo(pl.querySelector(".of-cab")?.textContent), linhas };
  });
  return { aVista: limpo(doc.querySelector(".of-avista")?.textContent), cartoes };
}

const centavos = (v: number) => Math.round(v * 100);

// ── A medição ────────────────────────────────────────────────────────────────────────────────────
describe("REVISÃO paridade MMendes: 87 lotes disponíveis do Garden × 3 planos, simulador montado", () => {
  it("mede e grava o relatório (números abaixo; asserções só do que foi medido)", () => {
    const r = {
      aVista: { cru: 0, normalizado: 0, total: 0, exemplos: [] as string[] },
      cartaoInteiroCru: { iguais: 0, total: 0, exemplo: "" },
      cartao: {
        total: 0,
        porCampoCru: {} as Record<string, number>,
        normalizadoIguais: 0,
        diferencasNormalizadas: [] as string[],
      },
      clique: {
        total: 0,
        valorIgual: 0,
        entradaIgual: 0,
        anuaisIguais: 0,
        parcelaCentavoIgual: 0,
        parcelaGrandeIgualCartao: 0,
        diferencas: [] as string[],
      },
      folha: {
        total: 0,
        fechaAoCentavo: 0,
        primeiraMensalIgualParcela: 0,
        somaDasMensaisCiclo1: [] as string[],
        naoFecha: [] as string[],
        destaquesFecham: 0,
      },
      datas: { total: 0, anualKcomMensal12k: 0, ultimaAnualDepoisDaUltimaMensal: 0, pelaClausulaDepoisDaUltimaMensal: 0, pelaClausulaDataDiferente: 0, exemplos: [] as string[] },
      espelho: {
        total: 0,
        corpoIntacto: 0,
        corpoAlterado: [] as string[],
        ressalvaNoCartao: 0,
        ressalvaDiferenteDaMesa: 0,
        cartaoIgualAMesa: 0,
      },
    };
    const campos: Array<keyof Linhas> = [
      "nome", "ressalva", "resumo", "valorDoLote", "origemDoValor", "parcela", "prazo", "correcao",
    ];
    for (const c of campos) r.cartao.porCampoCru[c] = 0;

    for (const lote of LOTES) {
      const dela = mesaDaMMendes(lote.p);
      const daMesa: Record<string, Linhas> = {};

      // ── Mesa de Venda ──
      montar("proposta", PLANOS_DA_MESA, lote.p, lote.c);
      // A linha do à vista.
      const av = limpo(alvo.querySelector('[data-cartao="a-vista"]')?.textContent);
      r.aVista.total += 1;
      const avDela = dela.aVista;
      // Os blocos da MMendes vêm sem separador; os nossos também (textContent).
      if (av === avDela) r.aVista.cru += 1;
      if (av.replace("plano INVESTIDOR", "plano Investidor") === avDela) r.aVista.normalizado += 1;
      else if (r.aVista.exemplos.length < 2) r.aVista.exemplos.push(`${lote.c}: ${av} | ${avDela}`);

      DO_PANTEON.forEach((plano, k) => {
        const botao = botaoDoCartao(plano.nome);
        const nosso = linhasNossas(botao);
        daMesa[plano.nome] = nosso;
        const mm = dela.cartoes[k]!;
        r.cartao.total += 1;
        for (const c of campos) if (nosso[c] === mm.linhas[c]) r.cartao.porCampoCru[c]! += 1;

        // O cartão inteiro, texto cru (o botão todo) contra o `.of-cab` dela.
        r.cartaoInteiroCru.total += 1;
        const inteiro = limpo(botao.textContent);
        if (inteiro === mm.inteiro) r.cartaoInteiroCru.iguais += 1;
        else if (!r.cartaoInteiroCru.exemplo && plano.nome === "INVESTIDOR PARCELADO" && lote.p === 435_000)
          r.cartaoInteiroCru.exemplo = `NOSSO: ${inteiro}\nDELA:  ${mm.inteiro}`;

        // Normalizado: as 4 diferenças declaradas (caixa do nome, "(N%)", "IPCA anual", parcela pela
        // regra `moedaPa` dela em vez do `moeda` do renderOficial).
        const n = MM.numeros(lote.p, k);
        const norm = {
          ...nosso,
          correcao: nosso.correcao.replace("IPCA anual", "IPCA"),
          nome: nosso.nome.toLowerCase(),
          resumo: nosso.resumo.replace(/ \(\d+(,\d+)?%\)/, ""),
        };
        const esperado = { ...mm.linhas, nome: mm.linhas.nome.toLowerCase(), parcela: limpo(MM.moedaPa(n.parcela)) };
        if (JSON.stringify(norm) === JSON.stringify(esperado)) r.cartao.normalizadoIguais += 1;
        else
          r.cartao.diferencasNormalizadas.push(
            `${lote.c} ${lote.p} ${plano.nome}: ${campos.filter((c) => norm[c] !== esperado[c]).map((c) => `${c} "${norm[c]}" x "${esperado[c]}"`).join("; ")}`,
          );

        // ── O clique: o que sobe para a proposta ──
        clicar(botao);
        const c = ultima!;
        r.clique.total += 1;
        const ok = {
          valor: centavos(c.valorNegociado) === centavos(n.alvo),
          entrada: centavos(c.entradaValor) === centavos(n.ent),
          anuais: c.anuaisQuantidade === n.anQtd && c.anuaisValor === n.anVal && c.parcelasMensais === n.prazo,
          parcela: centavos(c.parcela) === centavos(n.parcela),
        };
        if (ok.valor) r.clique.valorIgual += 1;
        if (ok.entrada) r.clique.entradaIgual += 1;
        if (ok.anuais) r.clique.anuaisIguais += 1;
        if (ok.parcela) r.clique.parcelaCentavoIgual += 1;
        if (!(ok.valor && ok.entrada && ok.anuais && ok.parcela))
          r.clique.diferencas.push(
            `${lote.c} ${lote.p} ${plano.nome}: valor ${c.valorNegociado}/${n.alvo} entrada ${c.entradaValor}/${n.ent} parcela ${c.parcela.toFixed(4)}/${n.parcela.toFixed(4)} anuais ${c.anuaisQuantidade}x${c.anuaisValor}/${n.anQtd}x${n.anVal}`,
          );
        // A parcela do cartão grande é a do cartão do plano (mesmo número, mesmo centavo).
        if (reaisDoTexto(parcelaGrande()) === reaisDoTexto(nosso.parcela)) r.clique.parcelaGrandeIgualCartao += 1;

        // ── O cronograma e a folha, como a ModalDeProposta e a rota os montam ──
        const cron: Cronograma = montarCronograma({
          anuaisQuantidade: c.anuaisQuantidade,
          anuaisValor: c.anuaisValor,
          diaDeVencimento: c.diaDeVencimento,
          entradaDatas: c.entradaDatas,
          entradaParcelas: c.entradaParcelas,
          entradaValor: c.entradaValor,
          entradaVezes: c.entradaVezes,
          parcelasMensais: c.parcelasMensais,
          plano: plano as unknown as PlanoComercial,
          primeiraParcelaDaEntrada: c.primeiraParcelaEm,
          valorNegociado: c.valorNegociado,
        });
        r.folha.total += 1;
        const soma = centavos(cron.totais.entrada) + centavos(cron.totais.anuais) + centavos(cron.totais.financiado);
        if (soma === centavos(c.valorNegociado)) r.folha.fechaAoCentavo += 1;
        else r.folha.naoFecha.push(`${lote.c} ${plano.nome}: ${soma / 100} x ${c.valorNegociado}`);
        if (centavos(cron.mensais[0]!.valor) === centavos(c.parcela)) r.folha.primeiraMensalIgualParcela += 1;
        const ciclo1 = cron.mensais.slice(0, 12).reduce((s, m) => s + m.valor, 0);
        if (lote.p === 435_000 && lote.c === "GDN1110")
          r.folha.somaDasMensaisCiclo1.push(
            `${plano.nome}: financiado ${cron.totais.financiado} · 1ª mensal ${cron.mensais[0]!.valor} × ${cron.mensais.length} = ${(cron.mensais[0]!.valor * cron.mensais.length).toFixed(2)} (ciclo 1 soma ${ciclo1.toFixed(2)}) · total geral ${cron.totais.geral}`,
          );

        const folha = montarFolhaDaProposta({
          atendimento: { coordenador: null, corretor: null, imobiliaria: null, telefone: null },
          codigo: "000001",
          compradores: [],
          cronograma: cron,
          diaDeVencimento: c.diaDeVencimento,
          emitidaEmIso: new Date().toISOString(),
          empreendimento: "Garden",
          logoC2x: null,
          logoEmpreendimento: null,
          plano: plano as unknown as PlanoComercial,
          precoDeTabela: lote.p,
          unidade: { area: 420, cidade: null, nome: lote.c, uf: null },
          validadeEmIso: null,
          valorNegociado: c.valorNegociado,
        });
        const d = (rot: string) => reaisDoTexto(folha.destaques.find((x) => x.rotulo === rot)?.valor ?? "0");
        const anuaisNaFolha = cron.anuais.length * (cron.anuais[0]?.valor ?? 0);
        if (centavos(d("Entrada")) + centavos(d("Financiado")) + centavos(anuaisNaFolha) === centavos(d("Valor da unidade")))
          r.folha.destaquesFecham += 1;

        // ── As datas das anuais ──
        cron.anuais.forEach((a, i) => {
          r.datas.total += 1;
          const mensal = cron.mensais[12 * (i + 1) - 1];
          if (mensal && mensal.vencimento === a.vencimento) r.datas.anualKcomMensal12k += 1;
          else if (r.datas.exemplos.length < 3) r.datas.exemplos.push(`${lote.c} ${plano.nome} anual ${i + 1}: ${a.vencimento} x mensal ${12 * (i + 1)} ${mensal?.vencimento}`);
          if (a.vencimento > cron.mensais.at(-1)!.vencimento) r.datas.ultimaAnualDepoisDaUltimaMensal += 1;
          // A cláusula da Têmis (blocos-prontos.ts:229): "vencíveis a cada doze meses contados da primeira
          // parcela mensal" = a data da mensal 12k + 1. Além da última mensal quando 12k + 1 > prazo.
          const pelaClausula = cron.mensais[12 * (i + 1)];
          if (!pelaClausula) r.datas.pelaClausulaDepoisDaUltimaMensal += 1;
          if (pelaClausula?.vencimento !== a.vencimento) r.datas.pelaClausulaDataDiferente += 1;
        });
      });

      // ── Espelho público: o MESMO componente, com os planos como o `PainelDoLote` os entrega ──
      montar("simulacao", PLANOS_DO_ESPELHO, lote.p, lote.c);
      DO_PANTEON.forEach((plano) => {
        const botao = botaoDoCartao(plano.nome);
        const doEspelho = linhasNossas(botao);
        r.espelho.total += 1;
        if (doEspelho.ressalva) r.espelho.ressalvaNoCartao += 1;
        if (JSON.stringify({ ...doEspelho, ressalva: "" }) === JSON.stringify({ ...daMesa[plano.nome]!, ressalva: "" })) r.espelho.cartaoIgualAMesa += 1;
        if (doEspelho.ressalva !== daMesa[plano.nome]!.ressalva) r.espelho.ressalvaDiferenteDaMesa += 1;
        clicar(botao);
        const c = ultima!;
        // O corpo que o `baixarPdf` manda, pela régua da rota.
        const aceita = valoresDaSimulacaoPublica({
          anuaisPedidas: { quantidade: c.anuaisQuantidade, valor: c.anuaisValor },
          entradaMinimaPercentual: PISO,
          entradaPedida: c.entradaValor,
          parcelasPedidas: c.parcelasMensais,
          plano: {
            anuaisQuantidade: plano.anuaisQuantidade ?? 0,
            anuaisValor: plano.anuaisValor ?? 0,
            descontoPercentual: plano.descontoPercentual,
            nome: plano.nome,
            parcelas: plano.parcelas,
          },
          planos: DO_PANTEON,
          precoDeTabela: lote.p,
          valorPedido: c.valorNegociado,
        });
        if (
          aceita.ok &&
          aceita.valor === c.valorNegociado &&
          aceita.entrada === c.entradaValor &&
          aceita.parcelas === c.parcelasMensais &&
          aceita.anuais.quantidade === c.anuaisQuantidade &&
          aceita.anuais.valor === c.anuaisValor
        )
          r.espelho.corpoIntacto += 1;
        else r.espelho.corpoAlterado.push(`${lote.c} ${plano.nome}: ${JSON.stringify(aceita)} x ${JSON.stringify({ v: c.valorNegociado, e: c.entradaValor })}`);
      });
    }

    try {
      if (RELATORIO) fs.writeFileSync(RELATORIO, JSON.stringify(r, null, 2));
    } catch {
      // O relatório é conveniência da revisão; sem a pasta de rascunho, as asserções abaixo bastam.
    }
    expect(LOTES).toHaveLength(87);

    // Asserções: o que foi medido (o relatório tem o detalhe).
    expect(r.cartao.total).toBe(261);
    expect(r.clique.total).toBe(261);
    // Medido em 18/09/2026 (o relatório tem o detalhe de cada diferença):
    expect(r.cartaoInteiroCru.iguais).toBe(0); // texto cru: caixa do nome, "(8%)", "IPCA anual", centavos
    expect(r.cartao.normalizadoIguais).toBe(248); // os 13 restantes: 421.500 × INVESTIDOR PARCELADO
    expect(r.aVista.normalizado).toBe(87);
    expect(r.clique.valorIgual).toBe(261);
    expect(r.clique.parcelaCentavoIgual).toBe(248);
    expect(r.clique.parcelaGrandeIgualCartao).toBe(261);
    expect(r.folha.fechaAoCentavo).toBe(261);
    expect(r.folha.destaquesFecham).toBe(261);
    expect(r.datas.anualKcomMensal12k).toBe(r.datas.total);
    expect(r.datas.ultimaAnualDepoisDaUltimaMensal).toBe(0);
    expect(r.datas.pelaClausulaDataDiferente).toBe(r.datas.total);
    expect(r.datas.pelaClausulaDepoisDaUltimaMensal).toBe(174);
    expect(r.espelho.corpoIntacto).toBe(261);
    expect(r.espelho.cartaoIgualAMesa).toBe(261);
  }, 600_000);
});
