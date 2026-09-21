import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canalForaDaMeta,
  decidirAbertura,
  ORIGEM_DO_TICKET_DIRETO,
  origemDoTicket,
} from "./abertura-fora-da-meta";

// ABRIR ATENDIMENTO PELA CENTRAL DE RELACIONAMENTO (Evolution, fora da Meta).
//
// Lucas (18/09/2026): *"A janela tem que existir somente para o canal de atendimento, 4143, o canal
// do relacionamento o número está rodando fora da meta"*. O modal já dizia "não precisa de
// template", e a rota respondia 409 "Janela de 24h fechada" no mesmo clique.

describe("canalForaDaMeta", () => {
  it("o canal da Evolution é fora da Meta", () => {
    expect(canalForaDaMeta({ provider: "evolution" })).toBe(true);
    expect(canalForaDaMeta({ provider: " Evolution " })).toBe(true);
  });

  it("o canal da Meta, e a falta de canal, contam como Meta", () => {
    expect(canalForaDaMeta({ provider: "meta" })).toBe(false);
    expect(canalForaDaMeta({ provider: null })).toBe(false);
    expect(canalForaDaMeta(null)).toBe(false);
    expect(canalForaDaMeta(undefined)).toBe(false);
  });
});

describe("decidirAbertura", () => {
  it("fora da Meta não trava por janela nem manda template, com a janela fechada", () => {
    expect(
      decidirAbertura({ foraDaMeta: true, janelaAberta: false, pediuTemplate: false }),
    ).toEqual({ bloquearPorJanela: false, enviarTemplate: false, enviarTextoLivre: false });
  });

  it("fora da Meta ignora o template mesmo quando a tela manda um", () => {
    expect(
      decidirAbertura({ foraDaMeta: true, janelaAberta: false, pediuTemplate: true }),
    ).toEqual({ bloquearPorJanela: false, enviarTemplate: false, enviarTextoLivre: false });
  });

  it("na Meta, janela fechada sem template continua travando", () => {
    expect(
      decidirAbertura({ foraDaMeta: false, janelaAberta: false, pediuTemplate: false }),
    ).toEqual({ bloquearPorJanela: true, enviarTemplate: false, enviarTextoLivre: false });
  });

  it("na Meta, janela fechada com template manda o template", () => {
    expect(
      decidirAbertura({ foraDaMeta: false, janelaAberta: false, pediuTemplate: true }),
    ).toEqual({ bloquearPorJanela: false, enviarTemplate: true, enviarTextoLivre: false });
  });

  // ⚠️ JANELA ABERTA NÃO É "NÃO MANDA NADA". Era assim que o código lia, e o ticket nascia mudo:
  // 37 tickets sem uma linha na base, 31 clientes que ninguém procurou, 28 deles encerrados como
  // "sem interação" (medido em 21/09/2026). Chamados TI-000139 e TI-000140.
  it("na Meta, janela aberta manda o CORPO como texto, sem template e sem tarifa", () => {
    expect(
      decidirAbertura({ foraDaMeta: false, janelaAberta: true, pediuTemplate: true }),
    ).toEqual({ bloquearPorJanela: false, enviarTemplate: false, enviarTextoLivre: true });
  });

  it("na Meta, janela aberta SEM corpo escolhido continua só abrindo a conversa", () => {
    // Aqui o operador vai digitar: não há o que mandar por ele.
    expect(
      decidirAbertura({ foraDaMeta: false, janelaAberta: true, pediuTemplate: false }),
    ).toEqual({ bloquearPorJanela: false, enviarTemplate: false, enviarTextoLivre: false });
  });
});

describe("origemDoTicket", () => {
  it("fora da Meta o ticket nasce como conversa direta, com o telefone de destino", () => {
    expect(
      origemDoTicket({
        foraDaMeta: true,
        sourceEntityId: "entidade-do-apolo",
        sourceEntityType: "apolo-crm360",
        telefone: "5531998788087",
      }),
    ).toEqual({ sourceEntityId: "5531998788087", sourceEntityType: "whatsapp-direct" });
  });

  it("na Meta a origem continua a que a tela mandou", () => {
    expect(
      origemDoTicket({
        foraDaMeta: false,
        sourceEntityId: "entidade-do-apolo",
        sourceEntityType: "apolo-crm360",
        telefone: "5531998788087",
      }),
    ).toEqual({ sourceEntityId: "entidade-do-apolo", sourceEntityType: "apolo-crm360" });
  });
});

// ⚠️ A MARCA "whatsapp-direct" É UM CONTRATO ENTRE QUATRO ARQUIVOS, e nenhum tipo o amarra. A tela
// só trata o ticket como conversa da Evolution (sem janela, envio pela Evolution) quando lê essa
// marca; o envio direto recusa ticket sem ela; e a resposta do cliente só cai no mesmo ticket se o
// processador da Evolution achar a mesma marca. Uma grafia diferente em qualquer ponta abriria o
// ticket e deixaria a conversa presa, sem erro.
describe("contrato da marca de conversa direta", () => {
  const ler = (caminho: string) => readFileSync(join(__dirname, "..", "..", caminho), "utf8");

  it("a tela, o envio e o processador da Evolution usam a mesma marca", () => {
    expect(ORIGEM_DO_TICKET_DIRETO).toBe("whatsapp-direct");
    expect(ler("modules/caredesk/data/iris-data-client.ts")).toContain(
      `source_entity_type === "${ORIGEM_DO_TICKET_DIRETO}"`,
    );
    expect(ler("app/api/iris/group-messages/route.ts")).toContain(
      `source_entity_type !== "${ORIGEM_DO_TICKET_DIRETO}"`,
    );
    expect(ler("lib/iris/evolution-inbound-processor.ts")).toContain(
      `.eq("source_entity_type", "${ORIGEM_DO_TICKET_DIRETO}")`,
    );
  });

  it("a rota de abrir atendimento decide a janela pela regra, e não trava sem olhar o canal", () => {
    const rota = ler("app/api/iris/tickets/route.ts");
    expect(rota).toContain("decidirAbertura(");
    expect(rota).toContain("origemDoTicket(");
    expect(rota).not.toContain("if (!requestedTemplateSend && !customerServiceWindow.open)");
  });
});
