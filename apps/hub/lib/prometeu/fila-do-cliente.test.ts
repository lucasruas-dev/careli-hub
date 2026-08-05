import { describe, expect, it } from "vitest";

import { derivarAcompanhamento } from "./fila-do-cliente";
import type { PrometeuCredenciado, PrometeuMesa } from "./types";

// A REGRA DA PAGINA DO CLIENTE. O que esta travado aqui e' a ORDEM DE PRECEDENCIA: um mesmo
// credenciado satisfaz varias condicoes ao mesmo tempo (quem foi chamado para a mesa continua com
// `etapa = "secretaria"`; quem esta em no-show continua na etapa em que parou), entao o que
// decide o que a pessoa le no celular e' qual teste roda antes.

function credenciado(input: Partial<PrometeuCredenciado> & { id: string }): PrometeuCredenciado {
  return {
    chegouEm: null,
    corretor: null,
    credenciadoNaJanela: null,
    documento: null,
    entityId: null,
    entrouEm: "2026-08-01T12:00:00Z",
    etapa: "recepcao",
    etapaDesde: "2026-08-01T12:00:00Z",
    etiquetaImpressaEm: null,
    eventoId: "evento-1",
    imobiliaria: null,
    imobiliariaEntityId: null,
    nome: input.id,
    noShow: false,
    noShowZona: null,
    ordemFila: null,
    ordemMotivo: null,
    origem: "teste",
    paPath: null,
    pagoEm: null,
    posicao: null,
    recepcaoFase: null,
    recepcaoLigado: null,
    unidades: [],
    ...input,
  };
}

function mesa(input: Partial<PrometeuMesa> & { id: string }): PrometeuMesa {
  return {
    atendenteNome: null,
    atendenteUserId: null,
    credenciadoId: null,
    estado: "livre",
    numero: "03",
    updatedAt: null,
    zona: "secretaria",
    ...input,
  };
}

function derivar(input: {
  credenciado: PrometeuCredenciado;
  emTransito?: { credenciadoId: string }[];
  filaRecepcao?: PrometeuCredenciado[];
  filaSecretaria?: PrometeuCredenciado[];
  mesas?: PrometeuMesa[];
  ritmoPorPessoaMin?: number;
}) {
  return derivarAcompanhamento({
    agora: "2026-08-01T12:30:00Z",
    credenciado: input.credenciado,
    emTransito: input.emTransito ?? [],
    filaRecepcao: input.filaRecepcao ?? [],
    filaSecretaria: input.filaSecretaria ?? [],
    lancamento: "Vale do Ouro",
    mesas: input.mesas ?? [],
    ritmoPorPessoaMin: input.ritmoPorPessoaMin,
  });
}

describe("derivarAcompanhamento", () => {
  it("na fila da recepcao: posicao e quantos estao na frente saem do indice da lista do servidor", () => {
    const eu = credenciado({ id: "eu" });
    const fila = [credenciado({ id: "a" }), credenciado({ id: "b" }), eu];

    const r = derivar({ credenciado: eu, filaRecepcao: fila });

    expect(r.estado).toBe("na_fila");
    expect(r.posicao).toBe(3);
    expect(r.pessoasNaFrente).toBe(2);
    expect(r.filaZona).toBe("recepcao");
    expect(r.lancamento).toBe("Vale do Ouro");
  });

  it("primeiro da fila tem zero pessoas na frente (e nao null)", () => {
    const eu = credenciado({ id: "eu" });

    const r = derivar({ credenciado: eu, filaRecepcao: [eu, credenciado({ id: "b" })] });

    expect(r.posicao).toBe(1);
    expect(r.pessoasNaFrente).toBe(0);
  });

  it("na fila da secretaria conta pela fila da secretaria, nao pela da recepcao", () => {
    const eu = credenciado({ etapa: "secretaria", id: "eu" });

    const r = derivar({
      credenciado: eu,
      filaRecepcao: [credenciado({ id: "x" }), credenciado({ id: "y" }), eu],
      filaSecretaria: [credenciado({ etapa: "secretaria", id: "z" }), eu],
    });

    expect(r.filaZona).toBe("secretaria");
    expect(r.posicao).toBe(2);
  });

  // Se ele sumiu da lista por um motivo que nao chegou ate aqui, NAO inventamos posicao: chutar
  // "1" mandaria a pessoa levantar da cadeira por engano.
  it("na etapa de fila mas fora da lista: espera sem numero", () => {
    const eu = credenciado({ id: "eu" });

    const r = derivar({ credenciado: eu, filaRecepcao: [credenciado({ id: "outro" })] });

    expect(r.estado).toBe("na_fila");
    expect(r.posicao).toBeNull();
    expect(r.pessoasNaFrente).toBeNull();
  });

  it("chamado para a mesa: destino traz zona e numero da mesa", () => {
    const eu = credenciado({ etapa: "secretaria", id: "eu" });

    const r = derivar({
      credenciado: eu,
      emTransito: [{ credenciadoId: "eu" }],
      filaSecretaria: [eu],
      mesas: [mesa({ credenciadoId: "eu", estado: "ocupada", id: "m1", numero: "07" })],
    });

    expect(r.estado).toBe("chamado");
    expect(r.destinoZona).toBe("secretaria");
    expect(r.destinoMesa).toBe("07");
    // Chamado NAO mostra posicao: a pessoa tem que levantar, nao contar quantos faltam.
    expect(r.posicao).toBeNull();
  });

  it("chamado da recepcao (sem mesa) manda para o salao", () => {
    const eu = credenciado({ id: "eu" });

    const r = derivar({ credenciado: eu, emTransito: [{ credenciadoId: "eu" }] });

    expect(r.estado).toBe("chamado");
    expect(r.destinoZona).toBe("salao");
    expect(r.destinoMesa).toBeNull();
  });

  it("chamado vence no-show: chamar de novo traz a pessoa de volta ao fluxo", () => {
    const eu = credenciado({ id: "eu", noShow: true });

    const r = derivar({ credenciado: eu, emTransito: [{ credenciadoId: "eu" }] });

    expect(r.estado).toBe("chamado");
  });

  it("mesa em atendimento vence a chamada em aberto", () => {
    const eu = credenciado({ etapa: "secretaria", id: "eu" });

    const r = derivar({
      credenciado: eu,
      emTransito: [{ credenciadoId: "eu" }],
      mesas: [mesa({ credenciadoId: "eu", estado: "atendimento", id: "m1", numero: "12" })],
    });

    expect(r.estado).toBe("em_atendimento");
    expect(r.destinoMesa).toBe("12");
  });

  it("no-show sem chamada em aberto vira 'nao localizado'", () => {
    const eu = credenciado({ id: "eu", noShow: true });

    expect(derivar({ credenciado: eu }).estado).toBe("nao_localizado");
  });

  it("sem check-in ainda: aguardando entrada, mesmo estando na etapa de recepcao", () => {
    const eu = credenciado({ entrouEm: null, id: "eu" });

    const r = derivar({ credenciado: eu, filaRecepcao: [eu] });

    expect(r.estado).toBe("aguardando_entrada");
    expect(r.posicao).toBeNull();
  });

  it("negociacao e' atendimento no salao (nao e' fila de espera)", () => {
    const eu = credenciado({ etapa: "negociacao", id: "eu" });

    const r = derivar({ credenciado: eu });

    expect(r.estado).toBe("em_atendimento");
    expect(r.destinoZona).toBe("salao");
    expect(r.posicao).toBeNull();
  });

  it("etapas intermediarias (reserva/proposta/pagamento) contam como atendimento", () => {
    for (const etapa of ["reserva", "proposta", "pagamento"] as const) {
      expect(derivar({ credenciado: credenciado({ etapa, id: "eu" }) }).estado).toBe(
        "em_atendimento",
      );
    }
  });

  it("concluido e cancelado sao desfechos e vencem mesa e chamada", () => {
    const concluido = credenciado({ etapa: "concluido", id: "eu" });
    const cancelado = credenciado({ etapa: "cancelado", id: "eu" });
    const presos = {
      emTransito: [{ credenciadoId: "eu" }],
      mesas: [mesa({ credenciadoId: "eu", estado: "atendimento", id: "m1" })],
    };

    expect(derivar({ credenciado: concluido, ...presos }).estado).toBe("concluido");
    expect(derivar({ credenciado: cancelado, ...presos }).estado).toBe("encerrado");
  });

  // A pagina e' publica: o que nao esta no retorno nao chega ao browser do cliente.
  it("nao devolve nenhum dado sensivel do credenciado", () => {
    const eu = credenciado({
      corretor: "Corretor Fulano",
      documento: "12345678900",
      id: "eu",
      imobiliaria: "Imob X",
      pagoEm: "2026-07-20T10:00:00Z",
      telefone: "31999999999",
    });

    const r = derivar({ credenciado: eu, filaRecepcao: [eu] });

    expect(Object.keys(r).sort()).toEqual([
      "atualizadoEm",
      "destinoMesa",
      "destinoZona",
      "estado",
      "etaMinutos",
      "filaZona",
      "lancamento",
      "nome",
      "pessoasNaFrente",
      "posicao",
    ]);
  });

  // PERSPECTIVA DE ATENDIMENTO (Lucas 30/jul): faixa de tempo, não número exato.
  it("na fila: perspectiva sai como faixa de pessoasNaFrente x ritmo (+-30%)", () => {
    const eu = credenciado({ id: "eu" });
    const fila = [credenciado({ id: "a" }), credenciado({ id: "b" }), eu]; // 2 na frente

    const r = derivar({ credenciado: eu, filaRecepcao: fila, ritmoPorPessoaMin: 10 });

    // 2 na frente x 10 min: de = round(20*0.7)=14, ate = round(20*1.3)=26.
    expect(r.etaMinutos).toEqual({ ate: 26, de: 14 });
  });

  it("primeiro da fila (ninguém na frente) não tem perspectiva: é o próximo", () => {
    const eu = credenciado({ id: "eu" });

    const r = derivar({
      credenciado: eu,
      filaRecepcao: [eu, credenciado({ id: "b" })],
      ritmoPorPessoaMin: 10,
    });

    expect(r.pessoasNaFrente).toBe(0);
    expect(r.etaMinutos).toBeNull();
  });

  it("sem ritmo do servidor, não inventa perspectiva", () => {
    const eu = credenciado({ id: "eu" });
    const fila = [credenciado({ id: "a" }), credenciado({ id: "b" }), eu];

    expect(derivar({ credenciado: eu, filaRecepcao: fila }).etaMinutos).toBeNull();
  });
});
