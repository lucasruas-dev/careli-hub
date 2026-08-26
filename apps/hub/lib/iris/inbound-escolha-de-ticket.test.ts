import { describe, expect, it } from "vitest";

import { escolherTicketDoInbound } from "./meta-inbound-processor";

// QUAL ATENDIMENTO RECEBE A MENSAGEM QUE CHEGOU.
//
// Regra do Lucas (26/08/2026): *"se o cliente tem um ticket aberto, tudo será registrado nesse
// ticket; se o ticket está fechado e ele conversar com a gente, abre-se um novo; ou seja, um novo
// só pode nascer se não tiver nenhum aberto"*.
//
// ⚠️ ESTE ARQUIVO EXISTE PORQUE O INBOUND NÃO TINHA TESTE NENHUM, e ele é o coração da operação em
// produção. A regra abaixo estava espalhada em duas expressões booleanas dentro de uma função de
// 200 linhas que fala com o Supabase — impossível de exercitar sem subir meio mundo.

const ticket = (id: string) => ({ id });

describe("escolherTicketDoInbound", () => {
  it("o ATENDIMENTO ABERTO ganha do reply-context", () => {
    // ⚠️ O bug dos cards duplicados morava aqui: o cliente respondia um template antigo, o
    // reply-context achava o atendimento encerrado daquele template e o reabria por cima do vivo.
    const escolha = escolherTicketDoInbound({
      abertoDoContato: ticket("aberto"),
      replyContextTicket: ticket("template-antigo"),
    });

    expect(escolha.ticket?.id).toBe("aberto");
    expect(escolha.forceReopen).toBe(false);
  });

  it("nunca reabre nada quando existe um aberto", () => {
    const escolha = escolherTicketDoInbound({
      abertoDoContato: ticket("aberto"),
      replyContextTicket: null,
    });

    expect(escolha.forceReopen).toBe(false);
  });

  it("sem nada aberto, o reply-context diz em qual conversa a resposta entra", () => {
    // O reply-context não perdeu a função: ele evita abrir uma conversa nova quando a pessoa
    // responde um envio antigo e não há atendimento vivo.
    const escolha = escolherTicketDoInbound({
      abertoDoContato: null,
      replyContextTicket: ticket("template-antigo"),
    });

    expect(escolha.ticket?.id).toBe("template-antigo");
    expect(escolha.forceReopen).toBe(true);
  });

  it("sem aberto e sem reply-context, nasce um novo", () => {
    const escolha = escolherTicketDoInbound({
      abertoDoContato: null,
      replyContextTicket: null,
    });

    expect(escolha.ticket).toBeNull();
    expect(escolha.forceReopen).toBe(false);
  });

  it("o mesmo atendimento nos dois lados não vira reabertura", () => {
    // Acontece quando a pessoa responde uma mensagem do atendimento que já está aberto: é o
    // caminho comum, e reabrir um ticket que nunca fechou só sujaria o histórico.
    const mesmo = ticket("igual");
    const escolha = escolherTicketDoInbound({
      abertoDoContato: mesmo,
      replyContextTicket: mesmo,
    });

    expect(escolha.ticket?.id).toBe("igual");
    expect(escolha.forceReopen).toBe(false);
  });
});
