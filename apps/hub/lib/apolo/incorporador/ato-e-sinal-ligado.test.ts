import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// A RÉGUA TEM QUE ESTAR LIGADA NA ROTA — typecheck não prova conexão.
//
// ⚠️ A CHAVE DO BALDE DE ATO E SINAL É O PEDIDO, NÃO A UNIDADE (21/09/2026). A rota da carteira
// monta uma linha por PEDIDO (`group by ... ar.id`, em lib/apolo/carteira.ts) e, enquanto o mapa
// foi montado por `enterprise_unities.id`, cada linha recebeu o balde inteiro da unidade: o
// vencido do comprador do pedido vivo aparecia cobrado no nome de quem teve o pedido cancelado
// (medido: 21 unidades, 22 linhas repetidas, R$ 298.066,63 em duplicidade). Ver ato-e-sinal.ts.
//
// Este teste existe para a chave não voltar a ser a unidade numa próxima mexida.

const ROTA = readFileSync(
  join(__dirname, "..", "..", "..", "app", "api", "incorporador", "carteira", "route.ts"),
  "utf8",
);

const CODIGO = ROTA.split("\n")
  .filter((linha) => !/^\s*(\/\/|\*|\/\*)/.test(linha))
  .join("\n");

describe("a rota da carteira", () => {
  it("usa a régua nova de ato e sinal", () => {
    expect(CODIGO).toContain("agruparAtoESinalPorPedido");
  });

  it("casa o balde pelo PEDIDO da linha, não pela unidade", () => {
    expect(CODIGO).toContain("atoESinalPorPedido.get(unit.pedidoId)");
  });

  it("não tem mais mapa de ato e sinal por unidade", () => {
    expect(CODIGO).not.toContain("atoESinalPorUnitId");
    expect(CODIGO).not.toMatch(/porUnitId\s*=\s*new Map<string, ParcelaDeAtoESinal/);
  });

  it("a leitura traz o id do pedido do C2X", () => {
    // Sem `ar.id` no select, a régua não tem chave para agrupar.
    expect(CODIGO).toMatch(/ar\.id\s+as ar_id/);
  });
});
