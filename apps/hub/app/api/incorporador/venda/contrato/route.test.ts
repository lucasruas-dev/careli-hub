import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// O ENVIO PARA CONTRATO — o que pode e o que não pode parar o coordenador.
//
// ⚠️ DECISÃO DO LUCAS (16/09/2026): *"pode deixar eles enviarem mesmo não tendo um contrato pois a
// responsabilidade do contrato é da equipe administrativa e não do coordenador"*.
//
// A rota recusava o envio quando o empreendimento não tinha minuta de contrato PUBLICADA. A trava
// tinha motivo (as duas primeiras vendas foram para o jurídico sem documento possível), mas na
// prática travava quase tudo: medido na mesma data, 14 dos 16 empreendimentos que estão vendendo
// não tinham minuta de contrato publicada — LBR, VOC, VOL, VLO, REP, LAB entre eles.
//
// Cadastrar a minuta é trabalho da equipe administrativa, e ela já enxerga a falta: o board da
// Têmis destaca "planos ativos sem minuta" (app/api/temis/board/route.ts). O card nasce mesmo
// sem minuta — `abrirTrabalho` não exige uma.
//
// Este teste lê a rota porque a trava era uma consulta e um `return` no meio dela, e não uma
// função isolada. Ele existe para que a recusa não volte por engano sem que alguém saiba da
// decisão acima.

const ROTA = readFileSync(join(__dirname, "route.ts"), "utf8");

describe("envio para contrato", () => {
  it("não recusa o coordenador por falta de minuta publicada", () => {
    expect(ROTA).not.toContain("Este empreendimento ainda não pode gerar contrato");
    expect(ROTA).not.toMatch(/servicoDisponivel\(\s*["']contrato["']/);
  });

  // As travas que continuam valendo são as que o coordenador resolve na hora, na própria tela.
  it("continua exigindo unidade e proposta aberta", () => {
    expect(ROTA).toContain("Escolha a unidade.");
    expect(ROTA).toContain("Não há proposta aberta nesta unidade.");
  });
});
