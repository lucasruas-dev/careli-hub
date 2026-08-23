import { describe, expect, it } from "vitest";

import {
  CHAVES_DE_TEMPLATE_PREENCHIVEIS,
  montarValoresDeTemplate,
  templateSaiCompletoPeloServidor,
} from "./template-chaves";

// O CASO REAL (23/08/2026): "Reabrir conversa" com "Credito indeferido (corretor)" falhava
// sempre — e uma das causas era a chave `cliente`, que o servidor não conhecia. Este módulo
// virou a fonte única: o Set deriva das keys do mapa, então o filtro da tela e o preenchimento
// da rota não têm como descolar.
describe("montarValoresDeTemplate", () => {
  it("preenche cliente e nome_cliente com o nome do contato", () => {
    const valores = montarValoresDeTemplate({
      assunto: "Solicitacao de documento",
      nomeCompleto: "  Flavia Daves  ",
      operador: "Marina",
      protocolo: "AT-001026",
    });

    expect(valores.cliente).toBe("Flavia Daves");
    expect(valores.nome_cliente).toBe("Flavia Daves");
    expect(valores.primeiro_nome).toBe("Flavia");
    expect(valores.operador).toBe("Marina");
    expect(valores.protocolo).toBe("AT-001026");
    expect(valores.assunto).toBe("Solicitacao de documento");
  });

  it("nunca devolve valor vazio — a Meta rejeita o envio inteiro por um parâmetro em branco", () => {
    const valores = montarValoresDeTemplate({
      assunto: "",
      nomeCompleto: "",
      operador: null,
      protocolo: null,
    });

    for (const [chave, valor] of Object.entries(valores)) {
      expect(valor, `chave ${chave} veio vazia`).not.toBe("");
    }
    expect(valores.assunto).toBe("seu atendimento");
    expect(valores.operador).toBe("equipe Careli");
  });
});

describe("templateSaiCompletoPeloServidor", () => {
  it("aceita template sem variáveis e com todas as chaves conhecidas", () => {
    expect(templateSaiCompletoPeloServidor(undefined)).toBe(true);
    expect(templateSaiCompletoPeloServidor([])).toBe(true);
    expect(
      templateSaiCompletoPeloServidor(["primeiro_nome", "operador", "protocolo", "assunto"]),
    ).toBe(true);
    expect(templateSaiCompletoPeloServidor(["cliente"])).toBe(true);
  });

  it("recusa chave sem fonte no ticket — ela viraria '-' no texto do cliente", () => {
    // Chaves reais de produção em 23/08: variavel_2..5 (campanhas), unidade, empreendimento,
    // parcelas, saldo_aberto (cobrança). São de DISPARO, onde o chamador manda os valores.
    expect(templateSaiCompletoPeloServidor(["primeiro_nome", "variavel_2"])).toBe(false);
    expect(templateSaiCompletoPeloServidor(["parcelas"])).toBe(false);
    expect(templateSaiCompletoPeloServidor([42])).toBe(false);
  });
});

describe("CHAVES_DE_TEMPLATE_PREENCHIVEIS", () => {
  it("deriva das keys do mapa — chave nova entra nos dois lados junta", () => {
    const chaves = Object.keys(
      montarValoresDeTemplate({ assunto: "", nomeCompleto: "", operador: null, protocolo: null }),
    );

    expect([...CHAVES_DE_TEMPLATE_PREENCHIVEIS].sort()).toEqual(chaves.sort());
  });
});
