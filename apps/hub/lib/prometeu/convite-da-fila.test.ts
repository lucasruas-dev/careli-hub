import { describe, expect, it } from "vitest";

import {
  primeiroNome,
  telefoneParaWhatsapp,
  textoDoConviteDaFila,
  urlDoConviteNoWhatsapp,
} from "./convite-da-fila";

// O QUE ESTE TESTE PROTEGE: o botão de WhatsApp da fila manda a POSIÇÃO de uma pessoa. Errar o
// número não é um envio perdido, é a posição (e o primeiro nome) de um cliente indo para um
// desconhecido. Por isso a regra prefere não ter número a ter um número improvisado.

describe("telefone para o wa.me", () => {
  it("prefixa 55 no numero nacional de 10 e 11 digitos", () => {
    expect(telefoneParaWhatsapp("(31) 99999-8888")).toBe("5531999998888");
    expect(telefoneParaWhatsapp("3133334444")).toBe("553133334444");
  });

  // A ARMADILHA DO DDD 55 (Santa Maria/RS): "55 9xxxx-xxxx" tem 11 dígitos e começa com 55 sem
  // ter código de país. Decidir pelo prefixo antes do tamanho mandaria esse cliente para um
  // número que não existe.
  it("trata DDD 55 como nacional, e nao como codigo de pais", () => {
    expect(telefoneParaWhatsapp("55991234567")).toBe("5555991234567");
  });

  it("mantem o numero que ja veio com o codigo do pais", () => {
    expect(telefoneParaWhatsapp("+55 31 99999-8888")).toBe("5531999998888");
    expect(telefoneParaWhatsapp("553133334444")).toBe("553133334444");
  });

  it("descarta a discagem internacional colada no cadastro", () => {
    expect(telefoneParaWhatsapp("005531999998888")).toBe("5531999998888");
  });

  // FALHA FECHADA: tamanho que não bate com nada conhecido não vira número "quase certo".
  it("devolve nulo para vazio, lixo e tamanho improvavel", () => {
    expect(telefoneParaWhatsapp(null)).toBeNull();
    expect(telefoneParaWhatsapp("")).toBeNull();
    expect(telefoneParaWhatsapp("sem numero")).toBeNull();
    expect(telefoneParaWhatsapp("99999")).toBeNull();
    expect(telefoneParaWhatsapp("4915112345678")).toBeNull();
  });
});

describe("texto do convite", () => {
  it("chama a pessoa pelo primeiro nome e leva o link", () => {
    const texto = textoDoConviteDaFila({ link: "https://c2x.app.br/x", nome: "Maria Silva" });

    expect(texto).toContain("Olá, Maria!");
    expect(texto).toContain("https://c2x.app.br/x");
  });

  it("cita o lancamento quando ele existe", () => {
    expect(
      textoDoConviteDaFila({
        lancamento: "Vale do Ouro",
        link: "https://c2x.app.br/x",
        nome: "Maria",
      }),
    ).toContain("fila do Vale do Ouro por aqui");
  });

  it("sem nome cumprimenta sem deixar buraco no texto", () => {
    const texto = textoDoConviteDaFila({ link: "https://c2x.app.br/x", nome: "  " });

    expect(texto.startsWith("Olá! Acompanhe")).toBe(true);
  });

  // Regra do Lucas para texto que vai ao cliente.
  it("nao usa travessao", () => {
    expect(
      textoDoConviteDaFila({
        lancamento: "Vale do Ouro",
        link: "https://c2x.app.br/x",
        nome: "Maria",
      }),
    ).not.toContain("—");
  });

  it("primeiroNome tolera nulo", () => {
    expect(primeiroNome(null)).toBe("");
    expect(primeiroNome("Ana Paula de Souza")).toBe("Ana");
  });
});

describe("url do wa.me", () => {
  it("aponta para o numero do cliente com o texto pronto", () => {
    const url = new URL(
      urlDoConviteNoWhatsapp({
        link: "https://c2x.app.br/publico/fila?t=abc",
        nome: "Maria Silva",
        telefone: "(31) 99999-8888",
      }),
    );

    expect(url.host).toBe("wa.me");
    expect(url.pathname).toBe("/5531999998888");
    expect(url.searchParams.get("text")).toContain("https://c2x.app.br/publico/fila?t=abc");
  });

  // Sem número o envio não pode simplesmente sumir: o operador ainda consegue escolher o contato.
  it("sem numero confiavel abre o seletor de contatos com o mesmo texto", () => {
    const url = new URL(
      urlDoConviteNoWhatsapp({ link: "https://c2x.app.br/x", nome: "Maria", telefone: null }),
    );

    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("text")).toContain("Maria");
  });

  // O token do link tem "=" e pode ter "+"/"/" no base64url do HMAC: escapar errado quebra a
  // assinatura e a página do cliente responde "Link inválido".
  it("preserva o token do link ao escapar o texto", () => {
    const link = "https://c2x.app.br/publico/fila?t=aa.bb-cc_dd.ee%3D%3D";
    const url = new URL(
      urlDoConviteNoWhatsapp({ link, nome: "Maria", telefone: "31999998888" }),
    );

    expect(url.searchParams.get("text")).toContain(link);
  });
});
