import { describe, expect, it } from "vitest";

import { pedidoDoTrabalho } from "./pedido-do-trabalho";

// AS OBSERVAÇÕES SÃO AS DE VERDADE, copiadas do banco em 10/09/2026 — não um formato inventado
// para o teste passar. Se a rota do Hércules mudar a frase, é aqui que a mudança aparece.

const DO_HERCULES =
  "Pedido de cancelamento pela tela Venda do Hércules · COD 000006 · motivo: teste · " +
  "apurado pelo sistema: nenhuma assinatura registrada, nenhum pagamento registrado · " +
  "as assinaturas não fecharam e nada foi pago: o contrato não chegou a se formar";

function valor(itens: { rotulo: string; valor: string }[], rotulo: string): string | undefined {
  return itens.find((i) => i.rotulo === rotulo)?.valor;
}

describe("pedidoDoTrabalho — o pedido aberto pelo Hércules", () => {
  it("separa motivo, contrato, apuração e classificação", () => {
    const p = pedidoDoTrabalho({ observacao: DO_HERCULES, tipo: "cancelamento" });

    expect(p?.titulo).toBe("O pedido de cancelamento");
    expect(valor(p?.itens ?? [], "Motivo")).toBe("Teste");
    expect(valor(p?.itens ?? [], "Contrato")).toBe("COD 000006");
    expect(valor(p?.itens ?? [], "Apuração")).toBe(
      "Nenhuma assinatura registrada, nenhum pagamento registrado",
    );
    // A frase que decide entre cancelamento e distrato — e se há dinheiro a devolver.
    expect(valor(p?.itens ?? [], "Classificação")).toBe(
      "as assinaturas não fecharam e nada foi pago: o contrato não chegou a se formar",
    );
    expect(p?.livre).toBeNull();
  });

  it("distingue o ajuste manual da apuração automática", () => {
    // ⚠️ A DIFERENÇA PESA NA ANÁLISE. "O sistema apurou" e "alguém corrigiu à mão" levam o jurídico
    // a conferir coisas diferentes antes de redigir — a rota grava separado de propósito.
    const p = pedidoDoTrabalho({
      observacao:
        "Pedido de cancelamento pela tela Venda do Hércules · COD 000007 · motivo: Arrependimento · " +
        "AJUSTE MANUAL de Lucas Ruas: assinatura completa: sim, houve pagamento: não " +
        "(o sistema apurou: nenhuma assinatura registrada, nenhum pagamento registrado) · " +
        "o contrato foi assinado por todos e nada foi pago: exige distrato, sem devolução",
      tipo: "distrato",
    });

    expect(valor(p?.itens ?? [], "Ajuste manual")).toContain("Lucas Ruas");
    expect(valor(p?.itens ?? [], "Apuração")).toBeUndefined();
    expect(valor(p?.itens ?? [], "Classificação")).toContain("exige distrato");
  });

  it("diz de onde o pedido veio", () => {
    const p = pedidoDoTrabalho({ observacao: DO_HERCULES, tipo: "cancelamento" });
    expect(valor(p?.itens ?? [], "Origem")).toBe("Venda do Hércules");
  });
});

describe("pedidoDoTrabalho — o pedido escrito por gente", () => {
  it("mantém a frase do coordenador inteira", () => {
    // ⚠️ ESTE É O ÚNICO DADO QUE ESSES CARDS TÊM. Um parser que só entende o formato da máquina
    // apagaria da tela o motivo — que é justamente o que o operador abriu o card para ler.
    const p = pedidoDoTrabalho({
      observacao: "cedente pediu transferência para o filho",
      tipo: "cessao",
    });

    expect(p?.titulo).toBe("O pedido de cessão");
    expect(p?.livre).toBe("cedente pediu transferência para o filho");
    expect(p?.itens).toEqual([]);
    expect(p?.semRegistro).toBe(false);
  });

  it("mantém a frase do distrato aberto pelo coordenador", () => {
    const p = pedidoDoTrabalho({ observacao: "inadimplência de 6 parcelas", tipo: "distrato" });
    expect(p?.livre).toBe("inadimplência de 6 parcelas");
  });
});

describe("pedidoDoTrabalho — o que fica de fora", () => {
  it("marca como pendência quando ninguém registrou o motivo", () => {
    // "Registrar o motivo do distrato" é a primeira atividade do tipo: sem motivo, há trabalho a
    // fazer — e um bloco vazio faria a tela parecer completa.
    const p = pedidoDoTrabalho({ observacao: "", tipo: "distrato" });

    expect(p?.semRegistro).toBe(true);
    expect(p?.itens).toEqual([]);
    expect(p?.livre).toBeNull();
  });

  it("não abre bloco de pedido numa venda", () => {
    // No contrato o "pedido" é a própria proposta, que ocupa a tela logo abaixo. Uma linha dizendo
    // "Proposta entregue pela tela Venda do Hércules" em cima da proposta não acrescenta nada.
    expect(
      pedidoDoTrabalho({
        observacao: "Proposta entregue pela tela Venda do Hércules · COD 000010",
        tipo: "contrato",
      }),
    ).toBeNull();
  });
});
