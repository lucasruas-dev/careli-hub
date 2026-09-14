import { describe, expect, it } from "vitest";

import {
  conferirBloqueio,
  ehBloqueioNativo,
  LIMITE_DO_DETALHE,
  motivoDoBloqueio,
  MOTIVOS_DE_BLOQUEIO,
  podeBloquear,
} from "./bloqueio-de-unidade";

describe("podeBloquear", () => {
  it("só a unidade disponível", () => {
    expect(podeBloquear("disponivel")).toBe(true);
  });

  // ⚠️ A LISTA DO LUCAS, UMA A UMA. *"não pode ter nenhuma proposta, reserva, contrato (...) quando
  // tem reserva, proposta assinatura, fatura"*.
  it.each(["reservado", "proposta", "contrato", "assinatura", "faturado"])(
    "não bloqueia quando a unidade está em %s",
    (etapa) => {
      expect(podeBloquear(etapa)).toBe(false);
    },
  );

  it("não bloqueia o que já está bloqueado", () => {
    // Sobrescreveria o motivo do primeiro bloqueio, e a coluna é uma só.
    expect(podeBloquear("bloqueada")).toBe(false);
  });

  it.each(["vendida", "reservada"])("nem os estados de cadastro sem proposta (%s)", (etapa) => {
    expect(podeBloquear(etapa)).toBe(false);
  });

  it("etapa ausente não abre o portão", () => {
    expect(podeBloquear(null)).toBe(false);
    expect(podeBloquear(undefined)).toBe(false);
    expect(podeBloquear("")).toBe(false);
  });

  // ⚠️ ETAPA NOVA CAI NO LADO SEGURO. A regra é pela positiva, então um "em análise" que apareça
  // amanhã não precisa ser lembrado numa lista de proibidos.
  it("etapa desconhecida não pode ser bloqueada", () => {
    expect(podeBloquear("em-analise")).toBe(false);
    expect(podeBloquear("permutado")).toBe(false);
  });

  it("aceita caixa e espaço, porque o payload nem sempre vem limpo", () => {
    expect(podeBloquear(" Disponivel ")).toBe(true);
    expect(podeBloquear("DISPONIVEL")).toBe(true);
  });
});

describe("conferirBloqueio", () => {
  const bom = { detalhe: "", motivo: "Permuta", unidadeId: "u-1" };
  const frases = (erros: { mensagem: string }[]) => erros.map((e) => e.mensagem);

  it("pedido completo não tem erro", () => {
    expect(conferirBloqueio(bom)).toEqual([]);
  });

  it("cobra a unidade", () => {
    expect(frases(conferirBloqueio({ ...bom, unidadeId: "  " }))).toContain("Escolha a unidade.");
  });

  it("cobra o motivo", () => {
    expect(frases(conferirBloqueio({ ...bom, motivo: "" }))).toContain(
      "Escolha o motivo do bloqueio.",
    );
  });

  it("recusa motivo fora da lista", () => {
    expect(frases(conferirBloqueio({ ...bom, motivo: "Porque sim" }))).toContain(
      "Motivo de bloqueio desconhecido.",
    );
  });

  it("'Outro' exige o detalhe escrito", () => {
    expect(frases(conferirBloqueio({ ...bom, detalhe: "   ", motivo: "Outro" }))).toContain(
      "Escreva o motivo do bloqueio.",
    );
    expect(conferirBloqueio({ detalhe: "área de lazer", motivo: "Outro", unidadeId: "u-1" })).toEqual(
      [],
    );
  });

  it("detalhe longo demais é recusado", () => {
    const erros = conferirBloqueio({ ...bom, detalhe: "x".repeat(LIMITE_DO_DETALHE + 1) });
    expect(frases(erros)).toContain(`O motivo tem no máximo ${LIMITE_DO_DETALHE} caracteres.`);
    // O erro tem de apontar o CAMPO, senão a modal o pinta no lugar errado.
    expect(erros[0]?.campo).toBe("detalhe");
  });

  it("no limite exato, passa", () => {
    expect(conferirBloqueio({ ...bom, detalhe: "x".repeat(LIMITE_DO_DETALHE) })).toEqual([]);
  });

  // ⚠️ TODOS OS ERROS DE UMA VEZ: consertar um e descobrir o outro é o que esta escolha evita.
  it("devolve os dois problemas juntos", () => {
    const erros = conferirBloqueio({ detalhe: "", motivo: "", unidadeId: "" });
    expect(erros).toHaveLength(2);
  });
});

describe("motivoDoBloqueio", () => {
  it("sem detalhe, é só a categoria", () => {
    expect(motivoDoBloqueio({ detalhe: "", motivo: "Permuta", unidadeId: "u" })).toBe("Permuta");
  });

  // ⚠️ A CATEGORIA NUNCA SOME: é ela que responde, meses depois, se o bloqueio ainda vale.
  it("com detalhe, guarda os dois", () => {
    expect(
      motivoDoBloqueio({
        detalhe: "aguardando retificação no cartório",
        motivo: "Matrícula com problema",
        unidadeId: "u",
      }),
    ).toBe("Matrícula com problema · aguardando retificação no cartório");
  });

  it("apara o espaço das pontas", () => {
    expect(motivoDoBloqueio({ detalhe: "  permuta com o vizinho  ", motivo: "Outro", unidadeId: "u" })).toBe(
      "Outro · permuta com o vizinho",
    );
  });
});

describe("os motivos", () => {
  // Os três primeiros são os que a migration 0112 nomeou um ano antes de existir tela.
  it("trazem os casos que o banco já documentava", () => {
    expect(MOTIVOS_DE_BLOQUEIO).toContain("Permuta");
    expect(MOTIVOS_DE_BLOQUEIO).toContain("Lote da diretoria");
    expect(MOTIVOS_DE_BLOQUEIO).toContain("Matrícula com problema");
  });

  it("terminam em 'Outro', que é o que exige texto", () => {
    expect(MOTIVOS_DE_BLOQUEIO[MOTIVOS_DE_BLOQUEIO.length - 1]).toBe("Outro");
  });

  // ⚠️ NÃO SÃO OS MOTIVOS DE CANCELAMENTO. Bloqueio não tem cliente: falar de desistência aqui
  // seria descrever outra coisa.
  it("não falam de cliente", () => {
    for (const m of MOTIVOS_DE_BLOQUEIO) {
      expect(m.toLowerCase()).not.toContain("cliente");
      expect(m.toLowerCase()).not.toContain("crédito");
    }
  });
});

describe("ehBloqueioNativo", () => {
  // ⚠️ A AUSÊNCIA DE CARIMBO É O SINAL: as 1.554 bloqueadas de hoje vieram do retrato do C2X de
  // 01/09 e não têm dono. A carga precisa saber distinguir antes de sobrescrever.
  it("sem carimbo, veio do C2X", () => {
    expect(ehBloqueioNativo({ bloqueado_em: null })).toBe(false);
    expect(ehBloqueioNativo({})).toBe(false);
    expect(ehBloqueioNativo({ bloqueado_em: "" })).toBe(false);
  });

  it("com carimbo, foi decidido aqui", () => {
    expect(ehBloqueioNativo({ bloqueado_em: "2026-09-14T13:00:00Z" })).toBe(true);
  });
});
