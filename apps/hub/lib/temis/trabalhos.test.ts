import { describe, expect, it } from "vitest";

import {
  ATIVIDADES,
  atividadesDoEstagio,
  diasUteis,
  estagiosDoTipo,
  podeAvancar,
  progresso,
  proximoEstagio,
  situacaoDoPrazo,
  type TipoDeTrabalho,
} from "./trabalhos";

const TIPOS: TipoDeTrabalho[] = [
  "cancelamento",
  "cancelamento_correcao",
  "cessao",
  "contrato",
  "distrato",
];

describe("o caminho de cada tipo", () => {
  // ⚠️ A DESISTÊNCIA NÃO ASSINA, e isso veio de correção do Lucas: eu tinha suposto o contrário.
  it("o cancelamento simples pula a assinatura; os outros quatro passam", () => {
    expect(estagiosDoTipo("cancelamento")).toEqual(["entrada", "confeccao", "finalizado"]);
    for (const tipo of ["contrato", "distrato", "cancelamento_correcao", "cessao"] as const) {
      expect(estagiosDoTipo(tipo)).toContain("assinatura");
    }
  });

  it("o próximo estágio respeita o que o tipo pula", () => {
    expect(proximoEstagio("cancelamento", "confeccao")).toBe("finalizado");
    expect(proximoEstagio("contrato", "confeccao")).toBe("assinatura");
  });

  it("o último estágio não tem próximo", () => {
    for (const tipo of TIPOS) expect(proximoEstagio(tipo, "finalizado")).toBeNull();
  });

  // ⚠️ ATIVIDADE NUM ESTÁGIO QUE O TIPO NÃO PERCORRE NUNCA SERIA FEITA, e o card ficaria preso:
  // `podeAvancar` exigiria uma marcação que a tela não tem como oferecer.
  it("nenhuma atividade cai num estágio fora do caminho do tipo", () => {
    for (const tipo of TIPOS) {
      const caminho = new Set(estagiosDoTipo(tipo));
      for (const atividade of ATIVIDADES[tipo]) {
        expect(caminho.has(atividade.estagio), `${tipo}: "${atividade.texto}"`).toBe(true);
      }
    }
  });

  // ⚠️ ESTÁGIO SEM ATIVIDADE NÃO ANDA SOZINHO, então um card que chegasse nele ficaria parado para
  // sempre. Vale para todos menos o último, que é onde o trabalho termina.
  it("todo estágio percorrido tem pelo menos uma atividade", () => {
    for (const tipo of TIPOS) {
      const caminho = estagiosDoTipo(tipo);
      for (const estagio of caminho.slice(0, -1)) {
        expect(atividadesDoEstagio(tipo, estagio).length, `${tipo} / ${estagio}`).toBeGreaterThan(0);
      }
    }
  });
});

describe("andar sozinho", () => {
  const base = { estagio: "confeccao" as const, tipo: "contrato" as const };

  it("não anda com atividade faltando", () => {
    expect(podeAvancar({ ...base, atividadesFeitas: [] })).toBe(false);
    expect(
      podeAvancar({
        ...base,
        atividadesFeitas: ["Gerar o contrato pela minuta do empreendimento"],
      }),
    ).toBe(false);
  });

  it("anda quando todas as do estágio estão feitas", () => {
    const todas = atividadesDoEstagio("contrato", "confeccao").map((a) => a.texto);
    expect(podeAvancar({ ...base, atividadesFeitas: todas })).toBe(true);
  });

  // ⚠️ MARCAR ATIVIDADE DE OUTRO ESTÁGIO NÃO FAZ O CARD ANDAR: quem termina a confecção adiantando
  // o despacho não deveria pular a própria confecção.
  it("atividade de outro estágio não conta", () => {
    expect(podeAvancar({ ...base, atividadesFeitas: ["Despachar para assinatura"] })).toBe(false);
  });

  it("estágio sem atividade não anda sozinho", () => {
    expect(
      podeAvancar({ atividadesFeitas: [], estagio: "finalizado", tipo: "contrato" }),
    ).toBe(false);
  });
});

describe("dias úteis", () => {
  // ⚠️ PRAZO EM DIA CORRIDO PINTARIA DE VERMELHO NA SEGUNDA tudo que entrou na sexta.
  it("sexta para segunda é UM dia útil", () => {
    expect(diasUteis(new Date("2026-09-04T10:00:00Z"), new Date("2026-09-07T10:00:00Z"))).toBe(1);
  });

  it("o fim de semana inteiro não conta", () => {
    expect(diasUteis(new Date("2026-09-05T10:00:00Z"), new Date("2026-09-06T10:00:00Z"))).toBe(0);
  });

  it("uma semana cheia dá cinco", () => {
    expect(diasUteis(new Date("2026-09-07T10:00:00Z"), new Date("2026-09-14T10:00:00Z"))).toBe(5);
  });

  it("no mesmo dia é zero, e data invertida também", () => {
    expect(diasUteis(new Date("2026-09-08T09:00:00Z"), new Date("2026-09-08T18:00:00Z"))).toBe(0);
    expect(diasUteis(new Date("2026-09-10T10:00:00Z"), new Date("2026-09-08T10:00:00Z"))).toBe(0);
  });
});

describe("o prazo", () => {
  const trabalho = {
    atividadesFeitas: [] as string[],
    estagio: "confeccao" as const,
    estagioDesde: "2026-09-07T10:00:00Z",
    tipo: "contrato" as const,
  };

  it("dentro do prazo não acusa nada", () => {
    const s = situacaoDoPrazo(trabalho, new Date("2026-09-07T18:00:00Z"));
    expect(s.atrasado).toBe(false);
    expect(s.decorridos).toBe(0);
  });

  it("acusa quando passa do prazo da atividade mais apertada", () => {
    const s = situacaoDoPrazo(trabalho, new Date("2026-09-09T10:00:00Z"));
    expect(s.decorridos).toBe(2);
    expect(s.atrasado).toBe(true);
  });

  it("avisa no dia em que vence", () => {
    const s = situacaoDoPrazo(trabalho, new Date("2026-09-08T10:00:00Z"));
    expect(s.vencendo).toBe(true);
    expect(s.atrasado).toBe(false);
  });

  // ⚠️ ESPERAR O CLIENTE ASSINAR NÃO É ATRASO DA EQUIPE. Pintar isso de vermelho faz o vermelho
  // perder sentido, e em duas semanas ninguém olha mais o board.
  it("espera de cliente não conta como atraso nosso", () => {
    const s = situacaoDoPrazo(
      {
        atividadesFeitas: ["Despachar para assinatura"],
        estagio: "assinatura",
        estagioDesde: "2026-09-01T10:00:00Z",
        tipo: "contrato",
      },
      new Date("2026-09-30T10:00:00Z"),
    );
    expect(s.atrasado).toBe(false);
    expect(s.decorridos).toBeGreaterThan(7);
  });

  it("com o despacho pendente, o atraso é nosso", () => {
    const s = situacaoDoPrazo(
      {
        atividadesFeitas: [],
        estagio: "assinatura",
        estagioDesde: "2026-09-01T10:00:00Z",
        tipo: "contrato",
      },
      new Date("2026-09-08T10:00:00Z"),
    );
    expect(s.atrasado).toBe(true);
  });

  it("nada faltando, nada a cobrar", () => {
    const todas = atividadesDoEstagio("contrato", "confeccao").map((a) => a.texto);
    const s = situacaoDoPrazo({ ...trabalho, atividadesFeitas: todas }, new Date("2026-10-01T10:00:00Z"));
    expect(s.prazo).toBeNull();
    expect(s.atrasado).toBe(false);
  });
});

describe("progresso", () => {
  it("conta só as do estágio atual", () => {
    const p = progresso({
      atividadesFeitas: ["Gerar o contrato pela minuta do empreendimento", "Despachar para assinatura"],
      estagio: "confeccao",
      tipo: "contrato",
    });
    expect(p).toEqual({ feitas: 1, total: 2 });
  });
});
