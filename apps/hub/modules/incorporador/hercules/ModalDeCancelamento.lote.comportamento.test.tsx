// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CANCELAR PROPOSTA: A TELA DIZ SE O LOTE VOLTOU, E POR QUE NÃO.
//
// ⚠️ A REVISÃO DE 24/09/2026 ACHOU A RESPOSTA SEM LEITOR. O PATCH de /venda/proposta devolve
// `loteVoltou` e `porque` (a trava pode segurar o lote: outro dono, irmã com dono, bloqueio), e a
// modal ignorava os dois e dizia sempre "A unidade voltou para a disponibilidade". Lucas, 24/09/2026:
// *"lembrando que quando tem cancelamento a unidade tem que ficar disponivel, tem que ter esse
// reflexo"*: quando o reflexo não acontece, quem cancelou precisa saber.
//
// A montagem é a de `TelaVenda.comportamento.test.tsx` (React no global, `act` na mão).

(globalThis as unknown as { React: typeof React }).React = React;
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { ModalDeCancelamento } from "./ModalDeCancelamento";

let raiz: null | Root = null;
let palco: HTMLDivElement;

beforeEach(() => {
  palco = document.createElement("div");
  document.body.appendChild(palco);
});

afterEach(() => {
  act(() => raiz?.unmount());
  raiz = null;
  palco.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function responder(data: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data }), { headers: { "content-type": "application/json" } })),
  );
}

async function cancelarProposta(): Promise<string> {
  const onCancelada = vi.fn();
  await act(async () => {
    raiz = createRoot(palco);
    raiz.render(
      <ModalDeCancelamento
        alvo="proposta"
        onCancelada={onCancelada}
        onFechar={() => undefined}
        propostaId="venda-31"
        unidade={{ id: "voc-0306", nome: "Q03 L06", produto: "VOC" }}
      />,
    );
  });
  const botoes = () => [...document.querySelectorAll("button")];
  await act(async () => {
    botoes().find((b) => b.textContent === "Cliente desistiu")?.click();
  });
  await act(async () => {
    botoes().find((b) => b.textContent === "Cancelar proposta")?.click();
  });
  expect(onCancelada).toHaveBeenCalledTimes(1);
  return String(onCancelada.mock.calls[0]?.[0] ?? "");
}

describe("ModalDeCancelamento (proposta): o desfecho do lote", () => {
  it("o lote voltou: a frase diz que voltou", async () => {
    responder({ avisos: [], codigo: "000031", id: "venda-31", loteVoltou: true, porque: null });
    const frase = await cancelarProposta();
    expect(frase).toContain("Proposta de Q03 L06 cancelada");
    expect(frase).toContain("A unidade voltou para a disponibilidade");
  });

  it("a trava segurou o lote: a frase NÃO diz que voltou, e diz por quê", async () => {
    responder({
      avisos: [],
      codigo: "000031",
      id: "venda-31",
      loteVoltou: false,
      porque: "a unidade NÃO voltou para a disponibilidade: o lote tem outro dono (reserva ativa)",
    });
    const frase = await cancelarProposta();
    expect(frase).toContain("Proposta de Q03 L06 cancelada");
    expect(frase).not.toContain("A unidade voltou para a disponibilidade");
    expect(frase).toContain("o lote tem outro dono (reserva ativa)");
    expect(frase).not.toMatch(/[—–]/);
  });

  // ⚠️ A NOVA TENTATIVA QUE NÃO AVISA DE NOVO (revisão de 24/09/2026). Quando a primeira tentativa
  // já mandou os WhatsApps, a rota responde `avisos: []` com `avisosJaSairam`. Lendo só a lista
  // vazia, a tela escrevia "O aviso não chegou a ser enviado" — e o coordenador avisava o cliente
  // uma segunda vez, sobre um cancelamento que ele já tinha recebido.
  it("os avisos já tinham saído na primeira tentativa: a frase NÃO diz que ninguém foi avisado", async () => {
    responder({ avisos: [], avisosJaSairam: true, codigo: "000031", id: "venda-31", loteVoltou: true, porque: null });
    const frase = await cancelarProposta();
    expect(frase).toContain("A unidade voltou para a disponibilidade");
    expect(frase).not.toContain("O aviso não chegou a ser enviado");
    expect(frase).toContain("já tinham sido avisados na primeira tentativa");
    expect(frase).not.toMatch(/[—–]/);
  });

  it("servidor antigo, sem loteVoltou: a frase de sempre", async () => {
    responder({ avisos: [], codigo: "000031", id: "venda-31" });
    const frase = await cancelarProposta();
    expect(frase).toContain("A unidade voltou para a disponibilidade");
  });
});

// ── O ALVO DA RESERVA HERDADA DO C2X (Lucas, 25/09/2026) ────────────────────────
//
// ⚠️ A MODAL FALA DE RESERVA E BATE NA PORTA DA PROPOSTA, e as duas coisas são de propósito. O
// coordenador lê "Cancelar reserva" na grade; a linha, porém, mora em `hercules_propostas` (a carga do
// C2X trouxe a proposta e nunca criou a reserva: ZERO linhas em `hercules_reservas` para as 13,
// medido em 25/09/2026 no projeto bxgukywoxgivlrhjkwjx). Mandar este clique para
// `/api/incorporador/venda/reserva` seria trocar botão apagado por 409.
//
// ⚠️ E A LISTA DE MOTIVOS É A QUE A ROTA ACEITA. `conferirCancelamentoDaProposta` recusa motivo fora
// de `MOTIVOS_DE_CANCELAMENTO_DA_PROPOSTA`, e a lista da reserva tem três que não estão nela
// ("Cliente não retornou", "Reserva feita por engano", "Prazo esgotado"): oferecer os da reserva aqui
// daria 422 na cara de quem clicou.

describe("ModalDeCancelamento (reserva do legado): fala de reserva, escreve na proposta", () => {
  async function cancelarReservaDoLegado(): Promise<{ frase: string; pedido: RequestInit; rota: string }> {
    const onCancelada = vi.fn();
    const chamadas: Array<[string, RequestInit]> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (rota: string, pedido: RequestInit) => {
        chamadas.push([rota, pedido]);
        return new Response(
          JSON.stringify({ data: { avisos: [], codigo: null, id: "venda-c2x", loteVoltou: true, porque: null } }),
          { headers: { "content-type": "application/json" } },
        );
      }),
    );
    await act(async () => {
      raiz = createRoot(palco);
      raiz.render(
        <ModalDeCancelamento
          alvo="reserva_do_legado"
          onCancelada={onCancelada}
          onFechar={() => undefined}
          propostaId="venda-c2x"
          unidade={{ id: "vdo-0305", nome: "Q03 L05", produto: "VDO" }}
        />,
      );
    });
    const botoes = () => [...document.querySelectorAll("button")];
    await act(async () => {
      botoes().find((b) => b.textContent === "Cliente desistiu")?.click();
    });
    await act(async () => {
      botoes().find((b) => b.textContent === "Cancelar reserva")?.click();
    });
    expect(onCancelada).toHaveBeenCalledTimes(1);
    return {
      frase: String(onCancelada.mock.calls[0]?.[0] ?? ""),
      pedido: chamadas[0]?.[1] ?? {},
      rota: String(chamadas[0]?.[0] ?? ""),
    };
  }

  it("⚠️ o verbo é da reserva e o PATCH vai para a rota da proposta, com o id da linha", async () => {
    const { frase, pedido, rota } = await cancelarReservaDoLegado();

    expect(rota).toBe("/api/incorporador/venda/proposta");
    expect(pedido.method).toBe("PATCH");
    expect(JSON.parse(String(pedido.body))).toMatchObject({ propostaId: "venda-c2x", unidadeId: "vdo-0305" });
    expect(frase).toContain("Reserva de Q03 L05 cancelada");
    expect(frase).toContain("A unidade voltou para a disponibilidade");
  });

  it("⚠️ a trava segurou o lote: a frase não diz que voltou, e fala de RESERVA", async () => {
    const onCancelada = vi.fn();
    responder({
      avisos: [],
      id: "venda-c2x",
      loteVoltou: false,
      porque: "a unidade NÃO voltou para a disponibilidade: o lote tem outro dono (contrato)",
    });
    await act(async () => {
      raiz = createRoot(palco);
      raiz.render(
        <ModalDeCancelamento
          alvo="reserva_do_legado"
          onCancelada={onCancelada}
          onFechar={() => undefined}
          propostaId="venda-c2x"
          unidade={{ id: "vdo-0305", nome: "Q03 L05", produto: "VDO" }}
        />,
      );
    });
    const botoes = () => [...document.querySelectorAll("button")];
    await act(async () => {
      botoes().find((b) => b.textContent === "Cliente desistiu")?.click();
    });
    await act(async () => {
      botoes().find((b) => b.textContent === "Cancelar reserva")?.click();
    });

    const frase = String(onCancelada.mock.calls[0]?.[0] ?? "");
    expect(frase).toContain("Reserva de Q03 L05 cancelada");
    expect(frase).not.toContain("A unidade voltou para a disponibilidade");
    expect(frase).toContain("outro dono");
  });

  it("⚠️ os motivos oferecidos são os que a rota da proposta aceita", async () => {
    await act(async () => {
      raiz = createRoot(palco);
      raiz.render(
        <ModalDeCancelamento
          alvo="reserva_do_legado"
          onCancelada={() => undefined}
          onFechar={() => undefined}
          propostaId="venda-c2x"
          unidade={{ id: "vdo-0305", nome: "Q03 L05", produto: "VDO" }}
        />,
      );
    });
    const rotulos = [...document.querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(rotulos).toContain("Condições não aceitas");
    // Os três da lista da reserva que a rota da proposta NÃO aceita ficam fora.
    expect(rotulos).not.toContain("Cliente não retornou");
    expect(rotulos).not.toContain("Reserva feita por engano");
    expect(rotulos).not.toContain("Prazo esgotado");
  });
});

// ── A MODAL NÃO PROMETE AVISO QUE NÃO SAI (revisão de 25/09/2026) ────────────────
//
// ⚠️ MEDIDO EM 25/09/2026 (projeto bxgukywoxgivlrhjkwjx, só SELECT): das 13 herdadas vivas,
// `imobiliaria_entity_id` é NULO em 13/13 e `corretor_entity_id` é NULO em 13/13. O portão do aviso na
// rota é `if (imobiliariaId && ...)`: sem imobiliária não há destinatário, não sai WhatsApp e nem o
// registro de "não enviado" é gravado. A resposta volta com `avisos: []`.
//
// ⚠️ E `comoFoiOAviso([])` ESCREVE "O AVISO NÃO CHEGOU A SER ENVIADO", que relata como FALHA um aviso
// que nunca podia existir. É a MESMA armadilha que o alvo `bloqueio` já tinha corrigido, e o comentário
// dele está no registro `ALVOS`: *prometer aviso que não sai é pior do que não prometer nada*.

describe("ModalDeCancelamento (reserva do legado): o aviso que não existe", () => {
  it("⚠️ antes do clique, NÃO promete aviso aos três", async () => {
    await act(async () => {
      raiz = createRoot(palco);
      raiz.render(
        <ModalDeCancelamento
          alvo="reserva_do_legado"
          onCancelada={() => undefined}
          onFechar={() => undefined}
          propostaId="venda-c2x"
          unidade={{ id: "vdo-0305", nome: "Q03 L05", produto: "VDO" }}
        />,
      );
    });

    const texto = document.body.textContent ?? "";
    expect(texto).not.toContain("Corretor, imobiliária e coordenador recebem o aviso");
    expect(texto).not.toContain("vai na mensagem do WhatsApp");
    expect(texto).toContain("Ninguém é avisado");
  });

  it("⚠️ depois do clique, o recado NÃO diz que o aviso falhou", async () => {
    const onCancelada = vi.fn();
    responder({ avisos: [], id: "venda-c2x", loteVoltou: true, porque: null });
    await act(async () => {
      raiz = createRoot(palco);
      raiz.render(
        <ModalDeCancelamento
          alvo="reserva_do_legado"
          onCancelada={onCancelada}
          onFechar={() => undefined}
          propostaId="venda-c2x"
          unidade={{ id: "vdo-0305", nome: "Q03 L05", produto: "VDO" }}
        />,
      );
    });
    const botoes = () => [...document.querySelectorAll("button")];
    await act(async () => {
      botoes().find((b) => b.textContent === "Cliente desistiu")?.click();
    });
    await act(async () => {
      botoes().find((b) => b.textContent === "Cancelar reserva")?.click();
    });

    const frase = String(onCancelada.mock.calls[0]?.[0] ?? "");
    expect(frase).toContain("Reserva de Q03 L05 cancelada");
    expect(frase).not.toContain("O aviso não chegou a ser enviado");
    expect(frase).toContain("Não havia a quem avisar");
  });

  // ⚠️ E SE UM DIA A HERDADA TIVER IMOBILIÁRIA, a frase da casa volta a contar o que aconteceu: a
  // exceção é da lista VAZIA, não do alvo.
  it("com aviso de verdade na resposta, a frase da casa volta", async () => {
    const onCancelada = vi.fn();
    responder({
      avisos: [{ ok: true, para: "imobiliaria" }],
      id: "venda-c2x",
      loteVoltou: true,
      porque: null,
    });
    await act(async () => {
      raiz = createRoot(palco);
      raiz.render(
        <ModalDeCancelamento
          alvo="reserva_do_legado"
          onCancelada={onCancelada}
          onFechar={() => undefined}
          propostaId="venda-c2x"
          unidade={{ id: "vdo-0305", nome: "Q03 L05", produto: "VDO" }}
        />,
      );
    });
    const botoes = () => [...document.querySelectorAll("button")];
    await act(async () => {
      botoes().find((b) => b.textContent === "Cliente desistiu")?.click();
    });
    await act(async () => {
      botoes().find((b) => b.textContent === "Cancelar reserva")?.click();
    });

    const frase = String(onCancelada.mock.calls[0]?.[0] ?? "");
    expect(frase).toContain("Aviso enviado para imobiliária");
    expect(frase).not.toContain("Não havia a quem avisar");
  });
});
