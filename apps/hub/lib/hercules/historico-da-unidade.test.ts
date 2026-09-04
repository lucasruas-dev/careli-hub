import { describe, expect, it } from "vitest";

import {
  type EventoImportado,
  historicoDaUnidade,
  type MovimentoDoHistorico,
  type PropostaDoHistorico,
  eventosDaReserva,
  type ReservaDoHistorico,
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

// ── A RESERVA DO PANTEON NA LINHA DO TEMPO ──────────────────────────────────
describe("eventosDaReserva", () => {
  const RESERVA: ReservaDoHistorico = {
    cancelada_em: null,
    cancelada_motivo: null,
    criado_em: "2026-09-04T12:00:00.000Z",
    criado_por_nome: "Lucas Ruas",
    id: "res-1",
    imobiliaria_nome: "Raiane Imobiliaria",
    observacao: "Cliente viaja quinta.",
    proponentes: [{ cpf: "529.982.247-25", nome: "Maria da Silva", telefone: "62991234567" }],
    situacao: "ativa",
    validade_em: "2026-09-07T02:59:59.000Z",
  };

  it("⚠️ a reserva nascida aqui APARECE — era o buraco todo", () => {
    // O histórico lia só as três tabelas vindas do C2X, e a ficha dizia "nunca teve proposta"
    // embaixo de uma reserva ativa (Lucas, 04/09/2026: *"o histórico não está ligado"*).
    const eventos = eventosDaReserva([RESERVA]);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.fato).toBe("Reserva criada");
    expect(eventos[0]?.cliente).toBe("Maria da Silva");
    expect(eventos[0]?.quem).toBe("Lucas Ruas");
    expect(eventos[0]?.observacao).toContain("Cliente viaja quinta.");
  });

  it("⚠️ cancelada e vencida são linhas SEPARADAS, com a data de cada uma", () => {
    // Uma linha só ("reserva") esconderia justamente o que a pessoa quer saber ao abrir o
    // histórico: por que ela não está mais de pé.
    const cancelada = eventosDaReserva([
      {
        ...RESERVA,
        cancelada_em: "2026-09-05T10:00:00.000Z",
        cancelada_motivo: "Cliente desistiu",
        situacao: "cancelada",
      },
    ]);
    expect(cancelada.map((e) => e.fato)).toEqual(["Reserva cancelada", "Reserva criada"]);
    expect(cancelada[0]?.observacao).toBe("Cliente desistiu");
  });

  it("⚠️ QUEM CRIOU é quem criou, e não a imobiliária", () => {
    // A primeira versão escrevia "Reserva criada pela RAIANE IMOBILIARIA", que atribui o ato a
    // quem não o praticou. Lucas, 04/09/2026: *"a reserva tem que vir criada por quem criou, que no
    // caso foi reservada pelo meu usuário"*. A imobiliária é quem VENDE; ela desce para o contexto.
    const [criada] = eventosDaReserva([RESERVA]);
    expect(criada?.fato).toBe("Reserva criada");
    expect(criada?.fato).not.toContain("Raiane");
    expect(criada?.quem).toBe("Lucas Ruas");
    expect(criada?.observacao).toContain("Imobiliária: Raiane Imobiliaria");
  });

  it("vencida entra pela data de validade", () => {
    const vencida = eventosDaReserva([{ ...RESERVA, situacao: "expirada" }]);
    expect(vencida.map((e) => e.fato)).toContain("Reserva vencida");
    expect(vencida.find((e) => e.fato === "Reserva vencida")?.quando).toBe(RESERVA.validade_em);
  });

  it("⚠️ o que virou proposta NÃO ganha linha de vencida", () => {
    // A reserva acabou porque a venda andou, não porque o prazo passou: dizer "venceu" seria
    // inventar um fato que não aconteceu.
    const virouProposta = eventosDaReserva([{ ...RESERVA, situacao: "proposta" }]);
    expect(virouProposta.map((e) => e.fato)).not.toContain("Reserva vencida");
  });

  it("sem imobiliária e sem proponente, a linha ainda existe", () => {
    const magra = eventosDaReserva([
      { ...RESERVA, imobiliaria_nome: null, observacao: null, proponentes: [] },
    ]);
    expect(magra[0]?.fato).toBe("Reserva criada");
    expect(magra[0]?.cliente).toBeNull();
    expect(magra[0]?.observacao).toBeNull();
  });
});
