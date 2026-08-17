import { describe, expect, it } from "vitest";

import {
  avisoDoEstado,
  descreverDisparo,
  ehPrimeiroAviso,
  explicarErroDoDisparo,
  mascararEmail,
  mascararTelefone,
  rotuloDoDestinatario,
  rotuloDoEvento,
  type LinhaDeDisparo,
} from "./credenciamento-disparos";

// Os erros abaixo são cópia do que está gravado em `apolo_disparos` (lido em 17/08/2026).

const linha = (patch: Partial<LinhaDeDisparo> = {}): LinhaDeDisparo => ({
  created_at: "2026-08-17T17:42:58.463Z",
  delivered_at: null,
  destinatario: "imobiliaria",
  erro: null,
  id: "d1",
  origem: "relacionamento:whatsapp",
  read_at: null,
  status: "enviado",
  telefone: "5531987265775",
  tipo: "credenciamento_aprovado",
  wa_message_id: null,
  ...patch,
});

describe("descrição do disparo", () => {
  it("sem wa_message_id NÃO promete confirmação de entrega (é o caso do canal do Relacionamento)", () => {
    const d = descreverDisparo(linha());
    expect(d.confirmaEntrega).toBe(false);
    expect(d.resultado).toBe("enviado");
    expect(d.evento).toBe("Aviso de habilitação");
    expect(d.para).toBe("Imobiliária");
    expect(d.contato).toBe("(31) *****-5775");
  });

  it("com wa_message_id e devolutiva da Meta, mostra entregue e lido", () => {
    const d = descreverDisparo(
      linha({
        delivered_at: "2026-08-17T17:43:10.000Z",
        read_at: "2026-08-17T17:45:00.000Z",
        status: "lido",
        wa_message_id: "wamid.X",
      }),
    );
    expect(d.confirmaEntrega).toBe(true);
    expect(d.resultado).toBe("lido");
  });

  it("erro do Evolution vira 'o número não tem WhatsApp', com o texto cru guardado", () => {
    const cru =
      'Evolution recusou o envio: {"status":400,"error":"Bad Request","response":{"message":[{"jid":"553187265775@s.whatsapp.net","exists":false,"number":"5531987265775"}]}}';
    const d = descreverDisparo(linha({ erro: cru, status: "falhou" }));

    expect(d.resultado).toBe("falhou");
    expect(d.motivo).toBe("O número não tem WhatsApp");
    expect(d.motivoTecnico).toBe(cru);
  });

  it("'sem telefone' explica que a ficha é que está incompleta", () => {
    const d = descreverDisparo(linha({ erro: "sem telefone", status: "falhou", telefone: "" }));
    expect(d.motivo).toBe("A ficha não tem telefone para receber a mensagem");
    expect(d.contato).toBeNull();
  });

  it("status 'enviado' com erro gravado ainda é FALHA (o registro sem telefone chega assim)", () => {
    expect(descreverDisparo(linha({ erro: "sem telefone", status: "enviado" })).resultado).toBe(
      "falhou",
    );
  });

  it("marca o reenvio manual", () => {
    expect(descreverDisparo(linha({ origem: "reenvio:whatsapp" })).reenvio).toBe(true);
    expect(descreverDisparo(linha()).reenvio).toBe(false);
  });
});

describe("quem recebeu", () => {
  it("traduz os papéis dos avisos de credenciamento", () => {
    expect(rotuloDoDestinatario("imobiliaria")).toBe("Imobiliária");
    expect(rotuloDoDestinatario("coordenador:HUBER NEGOCIOS IMOBILIARIOS LTDA")).toBe(
      "Coordenador · HUBER NEGOCIOS IMOBILIARIOS LTDA",
    );
    expect(rotuloDoDestinatario(null)).toBe("Sem destinatário registrado");
  });

  it("contato cru (fluxo da pré-venda) sai MASCARADO", () => {
    expect(rotuloDoDestinatario("fulano@empresa.com.br")).toBe("ful***@empresa.com.br");
    expect(rotuloDoDestinatario("5531999998888")).toBe("(31) *****-8888");
  });

  it("máscaras aguentam o que não é contato", () => {
    expect(mascararTelefone("123")).toBeNull();
    expect(mascararEmail("sem arroba")).toBeNull();
  });
});

describe("rótulo do evento", () => {
  it("usa o nome em português quando conhece o tipo", () => {
    expect(rotuloDoEvento("credenciamento_correcao")).toBe("Pedido de correção");
  });

  it("tipo desconhecido não vira 'undefined' na tela", () => {
    expect(rotuloDoEvento("tipo_novo_qualquer")).toBe("tipo novo qualquer");
    expect(rotuloDoEvento(null)).toBe("Mensagem");
  });
});

describe("qual aviso reenviar", () => {
  it("habilitada -> aviso de habilitação (418 fichas estão nesta combinação)", () => {
    expect(avisoDoEstado({ entidadeStatus: "review", papelStatus: "active" })).toBe("aprovado");
  });

  it("em correção -> pedido de correção (o estado mora na ENTIDADE)", () => {
    expect(avisoDoEstado({ entidadeStatus: "attention", papelStatus: "review" })).toBe("correcao");
  });

  it("recusada -> aviso de recusa, mesmo com a entidade em attention", () => {
    expect(avisoDoEstado({ entidadeStatus: "attention", papelStatus: "blocked" })).toBe(
      "indeferido",
    );
  });

  it("ainda em validação NÃO tem aviso para reenviar", () => {
    expect(avisoDoEstado({ entidadeStatus: "review", papelStatus: "review" })).toBeNull();
    expect(avisoDoEstado({})).toBeNull();
  });
});

describe("primeira vez", () => {
  it("quem nunca recebeu o aviso de aprovação recebe as boas-vindas", () => {
    expect(ehPrimeiroAviso([])).toBe(true);
    expect(
      ehPrimeiroAviso([{ status: "falhou", tipo: "credenciamento_aprovado" }]),
    ).toBe(true);
  });

  it("quem já recebeu ganha o texto de 'mais um empreendimento'", () => {
    expect(ehPrimeiroAviso([{ status: "enviado", tipo: "credenciamento_aprovado" }])).toBe(false);
  });

  it("disparo de outro tipo não conta", () => {
    expect(ehPrimeiroAviso([{ status: "enviado", tipo: "credenciamento_correcao" }])).toBe(true);
  });
});

describe("tradução de erro", () => {
  it("sem erro, sem motivo", () => {
    expect(explicarErroDoDisparo(null)).toBeNull();
    expect(explicarErroDoDisparo("   ")).toBeNull();
  });

  it("erro desconhecido não é escondido: aparece encurtado", () => {
    const gigante = "x".repeat(200);
    expect(explicarErroDoDisparo(gigante)).toHaveLength(91);
  });
});
