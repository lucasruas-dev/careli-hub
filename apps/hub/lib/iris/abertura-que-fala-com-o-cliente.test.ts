import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// ABRIR ATENDIMENTO TEM DE FALAR COM O CLIENTE — ou não abrir.
//
// TI-000139 e TI-000140 (Isac, 26 e 27/08/2026): *"Enviamos template para os clientes Vitorino e
// Brayan... ambos tickets ficaram como pendente, dentro do ticket nao aparece mensagem"* e *"alguns
// cliente aparecem como pendente na tela do hades, mas não aparece nenhum histórico de mensagem
// quando abre a conversa. Não da pra saber se a minha mensagem chegou nele."*
//
// ⚠️ NÃO ERA A TELA: A MENSAGEM NUNCA SAIU. Com a janela de 24h ABERTA, o modal pedia "abre sem
// mandar nada", a rota respondia 200 e ninguém enviava nem gravava coisa alguma. Medido em
// 21/09/2026, no Supabase de produção: 37 tickets sem uma única linha, 31 clientes distintos, de
// 28/06 a 18/09, TODOS com `metadata.metaTemplateStatus = "window_open_reused"`; nenhum deles tem
// registro de envio pela Meta; e 28 foram encerrados como "sem interação" — o time registrou que o
// cliente não respondeu uma conversa que nunca existiu. Na mesma fila, os 2.273 tickets que
// passaram pelos outros caminhos têm histórico: a tela sempre mostrou o que existia.
//
// ⚠️ ESTE TESTE LÊ O CÓDIGO-FONTE, e isso é proposital: a rota tem 2.700 linhas e depende da Meta,
// do Supabase e de seis leituras encadeadas. O que ele guarda são as três costuras que, separadas,
// produzem de novo um ticket mudo.

const RAIZ = join(__dirname, "..", "..");
const ROTA = readFileSync(join(RAIZ, "app", "api", "iris", "tickets", "route.ts"), "utf8");
const MODAL_HADES = readFileSync(
  join(RAIZ, "modules", "guardian", "attendance", "components", "HadesAttendanceModal.tsx"),
  "utf8",
);
const MODAL_IRIS = readFileSync(
  join(RAIZ, "modules", "caredesk", "blocks", "start-attendance", "iris-start-attendance-modal.tsx"),
  "utf8",
);

describe("a rota de abertura", () => {
  it("manda o corpo como TEXTO quando a janela está aberta", () => {
    expect(ROTA).toContain("sendMetaWhatsAppTextMessage");
    expect(ROTA).toContain("shouldSendText && templatePreview");
  });

  // ⚠️ A COSTURA QUE PRODUZIU OS 37 TICKETS MUDOS: o insert da mensagem estava preso a
  // `shouldSendTemplate`, então o caminho da janela aberta gravava nada.
  it("grava a mensagem no histórico nos DOIS caminhos, não só no do template", () => {
    expect(ROTA).toContain("if (vaiFalarComOCliente && templatePreview) {");
    expect(ROTA).not.toContain("if (shouldSendTemplate && templatePreview) {");
  });

  it("o corpo da mensagem é montado nos dois caminhos", () => {
    // Sem isto, `templatePreview` volta a nascer nulo fora do template e não há o que enviar.
    expect(ROTA).toContain("vaiFalarComOCliente && templateBody");
  });

  // ⚠️ QUEM JÁ FALOU COM O CLIENTE ESTÁ ESPERANDO ELE. Nascer "Pendente" depois de mandar a
  // cobrança é o que levava o operador a encerrar como "sem interação".
  it("o ticket que já falou com o cliente nasce aguardando o cliente", () => {
    expect(ROTA).toContain(
      'const initialStatus = vaiFalarComOCliente ? "waiting_customer" : "waiting_operator";',
    );
  });

  it("a resposta diz se saiu mensagem, e não só se saiu template", () => {
    expect(ROTA).toContain("mensagemEnviada: Boolean(sent?.messageId)");
  });
});

describe("os modais de abertura", () => {
  // ⚠️ O PEDIDO É "FALE COM O CLIENTE", E A FORMA É DO SERVIDOR. Enquanto a tela pedia "abre sem
  // mandar nada" e só mandava template depois de levar 409, a janela aberta caía no vão entre os
  // dois passos.
  it("o modal do Hades faz UM pedido, já pedindo para falar com o cliente", () => {
    expect(MODAL_HADES).toContain("const envio = await attempt(true);");
    expect(MODAL_HADES).not.toContain("await attempt(false)");
  });

  it("o modal da Iris também", () => {
    expect(MODAL_IRIS).toContain("await attempt(true)");
    expect(MODAL_IRIS).not.toContain("await attempt(false)");
  });

  // A prévia da mensagem deixou de mentir: ela é o que o cliente recebe, com a janela aberta ou
  // fechada.
  it("a prévia do Hades não promete mais que só vale com a janela fechada", () => {
    expect(MODAL_HADES).not.toContain("enviada só com a janela de 24h fechada");
  });
});
