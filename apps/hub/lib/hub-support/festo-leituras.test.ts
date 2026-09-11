import { describe, expect, it } from "vitest";

import {
  mudancasRecentes,
  palavrasQueDistinguem,
  parecidosNaFila,
} from "@/lib/hub-support/festo-leituras";

const HOJE = new Date("2026-09-11T15:00:00-03:00");

describe("palavrasQueDistinguem", () => {
  it("tira acento, pontuacao, palavra curta e palavra vazia", () => {
    expect(palavrasQueDistinguem("Não consigo salvar a proposta!")).toEqual([
      "salvar",
      "proposta",
    ]);
  });

  it("iguala o relato com acento ao relato sem acento", () => {
    expect(palavrasQueDistinguem("relatório de comissão")).toEqual(
      palavrasQueDistinguem("relatorio de comissao"),
    );
  });

  it("devolve vazio para relato que so tem palavra generica", () => {
    expect(palavrasQueDistinguem("a tela deu erro aqui")).toEqual([]);
  });
});

describe("mudancasRecentes", () => {
  const versoes = [
    {
      deployedAt: "2026-09-10T10:00:00-03:00",
      itens: ["**A proposta volta a salvar** quando o cliente tem dois compradores."],
      title: "Correcoes",
      version: "1.313.0",
    },
    {
      deployedAt: "2026-09-09T10:00:00-03:00",
      itens: ["O boleto passa a mostrar a unidade."],
      title: "Boletos",
      version: "1.312.0",
    },
    {
      deployedAt: "2026-05-01T10:00:00-03:00",
      itens: ["A proposta volta a salvar em telas antigas."],
      title: "Antigo",
      version: "1.100.0",
    },
  ];

  it("acha a mudanca recente que casa com o relato", () => {
    const achados = mudancasRecentes({
      hoje: HOJE,
      termos: "nao consigo salvar a proposta",
      versoes,
    });

    expect(achados).toEqual([
      {
        item: "A proposta volta a salvar quando o cliente tem dois compradores.",
        quando: "2026-09-10",
        versao: "1.313.0",
      },
    ]);
  });

  it("ignora o que saiu ha mais de 45 dias", () => {
    // A entrada de maio casa palavra por palavra, mas nao explica o que a pessoa ve hoje.
    const achados = mudancasRecentes({
      hoje: HOJE,
      termos: "salvar proposta",
      versoes: [versoes[2]!],
    });

    expect(achados).toEqual([]);
  });

  it("exige DUAS palavras em comum, para nao casar com meio changelog", () => {
    const achados = mudancasRecentes({
      hoje: HOJE,
      termos: "proposta",
      versoes,
    });

    expect(achados).toEqual([]);
  });

  it("devolve vazio quando o relato so tem palavra generica", () => {
    expect(
      mudancasRecentes({ hoje: HOJE, termos: "deu erro na tela", versoes }),
    ).toEqual([]);
  });
});

describe("parecidosNaFila", () => {
  const fila = [
    {
      abertoEm: "2026-09-10",
      modulo: "Hercules",
      protocolo: "HD-0102",
      situacao: "em_tratativa",
      titulo: "Proposta nao salva com dois compradores",
    },
    {
      abertoEm: "2026-09-08",
      modulo: "Hercules",
      protocolo: "HD-0099",
      situacao: "novo",
      titulo: "Erro ao salvar proposta",
    },
    {
      abertoEm: "2026-09-07",
      modulo: "Iris",
      protocolo: "HD-0098",
      situacao: "fechado",
      titulo: "Mensagem duplicada no atendimento",
    },
  ];

  it("conta os parecidos e devolve a situacao do mais recente", () => {
    const achado = parecidosNaFila({ chamados: fila, termos: "salvar proposta" });

    expect(achado.paraOAgente).toEqual({
      quantos: 2,
      situacaoDoMaisRecente: "em_tratativa",
    });
  });

  it("guarda os protocolos SO para a nota interna", () => {
    const achado = parecidosNaFila({ chamados: fila, termos: "salvar proposta" });

    // O que vai para o modelo nao pode ter protocolo de outra pessoa; o que vai para a nota
    // interna tem, porque so quem atende le.
    expect(achado.paraANotaInterna).toEqual([
      "HD-0102 (em_tratativa, 2026-09-10)",
      "HD-0099 (novo, 2026-09-08)",
    ]);
    expect(JSON.stringify(achado.paraOAgente)).not.toContain("HD-");
  });

  it("nao acha parecido quando o assunto e outro", () => {
    const achado = parecidosNaFila({
      chamados: fila,
      termos: "boleto do cliente vencido",
    });

    expect(achado.paraOAgente).toBeNull();
    expect(achado.paraANotaInterna).toEqual([]);
  });

  it("nao acha nada quando o relato so tem palavra generica", () => {
    expect(parecidosNaFila({ chamados: fila, termos: "deu erro" }).paraOAgente).toBeNull();
  });
});
