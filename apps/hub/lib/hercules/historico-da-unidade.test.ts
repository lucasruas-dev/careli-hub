import { describe, expect, it } from "vitest";

import {
  type EventoImportado,
  historicoDaUnidade,
  type MovimentoDoHistorico,
  type PropostaDoHistorico,
} from "./historico-da-unidade";

const proposta = (p: Partial<PropostaDoHistorico> & { id: string }): PropostaDoHistorico => ({
  cliente_nome: "FULANO DE TAL",
  codigo: "PDV1",
  criado_em_c2x: "2024-07-16T10:00:00Z",
  etapa: "cancelado",
  imobiliaria_nome: "GURGEL",
  valor: 100_000,
  ...p,
});

const movimento = (m: Partial<MovimentoDoHistorico> & { proposta_id: string }): MovimentoDoHistorico => ({
  autor_nome: "NIVEA CARELI PEREIRA DE AVELAR",
  de_c2x: 1,
  motivo: null,
  observacao: null,
  para_c2x: 9,
  quando: "2024-07-17T12:00:00Z",
  ...m,
});

describe("historicoDaUnidade", () => {
  it("junta a abertura da proposta com os movimentos dela", () => {
    const eventos = historicoDaUnidade(
      [proposta({ id: "p1" })],
      [movimento({ proposta_id: "p1" })],
    );

    expect(eventos).toHaveLength(2);
    // Mais recente primeiro: é assim que se lê histórico procurando "o que houve agora".
    expect(eventos[0]?.fato).toBe("Reservado → Proposta realizada");
    expect(eventos[1]?.fato).toBe("Proposta aberta · GURGEL");
  });

  it("⚠️ usa os nomes REAIS dos onze estágios, não os cinco do funil", () => {
    // A dobra existe para o coordenador planejar (Análise de crédito e Proposta realizada viram os
    // dois "Proposta"); num histórico ela apagaria o que de fato aconteceu.
    const eventos = historicoDaUnidade(
      [proposta({ id: "p1" })],
      [movimento({ de_c2x: 2, para_c2x: 8, proposta_id: "p1" })],
    );
    expect(eventos[0]?.fato).toBe("Análise de crédito → Reprovado na análise");
  });

  it("⚠️ movimento SEM origem nem destino não some: vira 'Registro atualizado'", () => {
    // São 3.831 das 12.295 linhas — gravações do C2X sem troca de estágio. Escondê-las apagaria
    // que alguém mexeu naquela proposta naquele dia, que é metade do que uma auditoria procura.
    const eventos = historicoDaUnidade(
      [proposta({ id: "p1" })],
      [movimento({ de_c2x: null, para_c2x: null, proposta_id: "p1" })],
    );
    expect(eventos[0]?.fato).toBe("Registro atualizado");
    expect(eventos[0]?.quem).toBe("NIVEA CARELI PEREIRA DE AVELAR");
  });

  it("sem origem, diz só onde entrou — não inventa de onde veio", () => {
    const eventos = historicoDaUnidade(
      [proposta({ id: "p1" })],
      [movimento({ de_c2x: null, para_c2x: 4, proposta_id: "p1" })],
    );
    expect(eventos[0]?.fato).toBe("Faturado");
  });

  it("⚠️ o eixo é o LOTE: cada evento diz de quem era a proposta", () => {
    // O lote 01 04 do Portal dos Vales teve proposta de sete clientes em quatro dias. Uma linha do
    // tempo por proposta esconde isso; aqui o cliente vira coluna do evento.
    const eventos = historicoDaUnidade(
      [
        proposta({ cliente_nome: "ADAO RENALDO LEMOS", id: "p1" }),
        proposta({
          cliente_nome: "TAYNA LANES FERREIRA",
          criado_em_c2x: "2024-07-20T09:00:00Z",
          id: "p2",
        }),
      ],
      [
        movimento({ proposta_id: "p1", quando: "2024-07-16T18:00:00Z" }),
        movimento({ proposta_id: "p2", quando: "2024-07-21T09:00:00Z" }),
      ],
    );

    expect(eventos[0]?.cliente).toBe("TAYNA LANES FERREIRA");
    expect(eventos.at(-1)?.cliente).toBe("ADAO RENALDO LEMOS");
    expect(eventos).toHaveLength(4);
  });

  it("a abertura não atribui autor a ninguém", () => {
    // O C2X não guarda quem ABRIU a proposta, só quem a moveu. Pôr o autor do primeiro movimento
    // seria atribuir a alguém um ato que pode não ter sido dele.
    const eventos = historicoDaUnidade([proposta({ id: "p1" })], []);
    expect(eventos[0]?.quem).toBeNull();
  });

  it("motivo vence observação quando os dois existem", () => {
    const eventos = historicoDaUnidade(
      [proposta({ id: "p1" })],
      [movimento({ motivo: "DATA DIVERGENTE", observacao: "conferir", proposta_id: "p1" })],
    );
    expect(eventos[0]?.observacao).toBe("DATA DIVERGENTE");
  });
});

describe("historicoDaUnidade · pagamento e assinatura", () => {
  const evento = (e: Partial<EventoImportado> & { tipo: string }): EventoImportado => ({
    descricao: null,
    documento: null,
    proposta_id: "p1",
    quando: "2024-08-01T10:00:00Z",
    quem: null,
    valor: null,
    ...e,
  });

  it("entram na MESMA linha do tempo, em ordem com as etapas", () => {
    // Pedido do Lucas: "há trazer os pagamentos, as assinaturas". A linha do tempo por etapa conta
    // metade do que aconteceu com o lote.
    const eventos = historicoDaUnidade(
      [proposta({ id: "p1" })],
      [movimento({ proposta_id: "p1", quando: "2024-07-17T12:00:00Z" })],
      [
        evento({ descricao: "Ato", quando: "2024-07-25T09:00:00Z", tipo: "pagamento", valor: "5000.00" }),
        evento({
          descricao: "Assinatura · Comprador",
          quando: "2024-08-02T15:00:00Z",
          quem: "CRISTIANE MARIANO DA SILVA",
          tipo: "assinatura",
        }),
      ],
    );

    expect(eventos.map((e) => e.tipo)).toEqual(["assinatura", "pagamento", "etapa", "etapa"]);
    expect(eventos[1]?.valor).toBe(5000);
    expect(eventos[0]?.quem).toBe("CRISTIANE MARIANO DA SILVA");
  });

  it("⚠️ o CPF do signatário sai MASCARADO", () => {
    // O portal é externo: o coordenador precisa saber QUEM assinou, não o documento inteiro.
    const eventos = historicoDaUnidade(
      [proposta({ id: "p1" })],
      [],
      [evento({ documento: "077.655.646-09", tipo: "assinatura" })],
    );
    expect(eventos[0]?.observacao).toBe("***.655.646-**");
    expect(eventos[0]?.observacao).not.toContain("077");
  });

  it("⚠️ a linha diz a AÇÃO, não o nome da coisa", () => {
    // "Ato · R$ 1.000" não diz se foi pago (Lucas: "eu não sei se foi pago, se foi assinado, tem
    // que vir a ação"). Num registro de auditoria, supor é o que não pode acontecer.
    const eventos = historicoDaUnidade(
      [proposta({ id: "p1" })],
      [],
      [
        evento({ descricao: "Ato", tipo: "pagamento" }),
        evento({ descricao: "Sinal 2 de 5", quando: "2024-08-02T10:00:00Z", tipo: "pagamento" }),
        evento({
          descricao: "Assinatura · Assinar como parte",
          quando: "2024-08-03T10:00:00Z",
          tipo: "assinatura",
        }),
        evento({
          descricao: "Assinatura · Assinar como testemunha",
          quando: "2024-08-04T10:00:00Z",
          tipo: "assinatura",
        }),
      ],
    );

    expect(eventos.map((e) => e.fato)).toEqual([
      "Assinado como testemunha",
      "Assinado como parte",
      "Sinal 2 de 5 pago",
      "Ato pago",
      // A abertura da proposta fecha a lista: ela é o evento mais antigo do lote.
      "Proposta aberta · GURGEL",
    ]);
  });

  it("⚠️ CNPJ tem a própria máscara", () => {
    // A primeira versão cortava em "doc. 1-87", que não identifica nada e parecia defeito.
    const eventos = historicoDaUnidade(
      [proposta({ id: "p1" })],
      [],
      [evento({ documento: "11.115.899/0001-04", tipo: "assinatura" })],
    );
    expect(eventos[0]?.observacao).toBe("**.115.899/0001-**");
  });

  it("o valor vem como texto do Postgres e vira número", () => {
    const eventos = historicoDaUnidade(
      [proposta({ id: "p1" })],
      [],
      [evento({ tipo: "pagamento", valor: "1234.56" })],
    );
    expect(eventos[0]?.valor).toBe(1234.56);
  });
});
