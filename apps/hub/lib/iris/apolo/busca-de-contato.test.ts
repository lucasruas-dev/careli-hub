import { describe, expect, it } from "vitest";

import {
  contatosDoVinculo,
  escolherTelefone,
  filtrarVinculosPorTermo,
  mesclarContatos,
  normalizarTermo,
  ordenarPorRelevancia,
  pontuarRelevancia,
  telefoneParaWhatsApp,
  type ContatoDaEntidade,
} from "./busca-de-contato";

describe("normalizarTermo", () => {
  it("tira acento, caixa e espaco dobrado", () => {
    expect(normalizarTermo("  RR   Soluções  ")).toBe("rr solucoes");
    expect(normalizarTermo("J&F Negócios")).toBe("j&f negocios");
  });

  it("devolve vazio para entrada vazia", () => {
    expect(normalizarTermo("")).toBe("");
    expect(normalizarTermo("   ")).toBe("");
  });
});

describe("pontuarRelevancia", () => {
  const imobiliaria = {
    displayName: "RR SOLUCOES IMOBILIARIAS LTDA",
    id: "imob",
  };
  const clienteDela = {
    displayName: "MARIA DAS GRACAS SOUZA",
    id: "cli",
  };

  // ⚠️ MENOR PONTUACAO = MAIS RELEVANTE. O nome proprio tem que ganhar de quem so cita o
  // termo na carteira, senao a imobiliaria continua atras dos 169 clientes dela.
  it("nome exato ganha de prefixo, que ganha de contem", () => {
    expect(pontuarRelevancia({ displayName: "RR SOLUCOES", id: "a" }, "rr solucoes")).toBe(0);
    expect(pontuarRelevancia(imobiliaria, "rr solucoes")).toBe(1);
    expect(
      pontuarRelevancia({ displayName: "GRUPO RR SOLUCOES LTDA", id: "b" }, "rr solucoes"),
    ).toBe(2);
  });

  // ⚠️ O CASO QUE PRODUZIU A QUEIXA: o cliente nao tem o termo no proprio nome; ele so casou
  // porque o nome da imobiliaria foi copiado para o normalized_text dele.
  it("quem nao tem o termo no nome proprio fica por ultimo", () => {
    expect(pontuarRelevancia(clienteDela, "rr solucoes")).toBe(3);
  });

  it("olha tambem razao social e nome fantasia", () => {
    expect(
      pontuarRelevancia(
        { displayName: "Sem nome", id: "c", legalName: "RR SOLUCOES IMOBILIARIAS LTDA" },
        "rr solucoes",
      ),
    ).toBe(1);
    expect(
      pontuarRelevancia({ displayName: "Sem nome", id: "d", tradeName: "RR Solucoes" }, "rr solucoes"),
    ).toBe(0);
  });
});

describe("ordenarPorRelevancia", () => {
  // ⚠️ ESTE E O BUG INTEIRO EM UM TESTE. Medido em producao: "rr solucoes" traz 170 linhas e a
  // propria RR Solucoes e a ULTIMA. Com corte em 12 pela ordem fisica, ela nunca aparecia.
  it("traz a imobiliaria para a frente dos proprios clientes", () => {
    const clientes = Array.from({ length: 169 }, (_, indice) => ({
      displayName: `CLIENTE ${indice} DA CARTEIRA`,
      id: `cli-${indice}`,
    }));
    const imobiliaria = { displayName: "RR SOLUCOES IMOBILIARIAS LTDA", id: "imob" };

    const ordenado = ordenarPorRelevancia([...clientes, imobiliaria], "rr solucoes");

    expect(ordenado[0]?.id).toBe("imob");
    expect(ordenado.slice(0, 12).map((item) => item.id)).toContain("imob");
  });

  it("mantem a ordem original entre empatados", () => {
    const entrada = [
      { displayName: "SILVA A", id: "1" },
      { displayName: "SILVA B", id: "2" },
      { displayName: "SILVA C", id: "3" },
    ];

    expect(ordenarPorRelevancia(entrada, "silva").map((item) => item.id)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("sem termo, devolve como veio", () => {
    const entrada = [{ displayName: "A", id: "1" }, { displayName: "B", id: "2" }];
    expect(ordenarPorRelevancia(entrada, "").map((item) => item.id)).toEqual(["1", "2"]);
  });
});

describe("telefoneParaWhatsApp", () => {
  it("aceita celular com DDD e poe o 55", () => {
    expect(telefoneParaWhatsApp("(31) 99866-2052")).toBe("5531998662052");
    expect(telefoneParaWhatsApp("3198662052")).toBe("553198662052");
  });

  it("mantem quem ja veio com DDI", () => {
    expect(telefoneParaWhatsApp("5531998662052")).toBe("5531998662052");
  });

  it("recusa o que nao e telefone", () => {
    expect(telefoneParaWhatsApp("")).toBeNull();
    expect(telefoneParaWhatsApp("123")).toBeNull();
    expect(telefoneParaWhatsApp("cliente@empresa.com.br")).toBeNull();
  });
});

describe("escolherTelefone", () => {
  // ⚠️ O DESCARTE SILENCIOSO: a versao antiga pegava o whatsapp e, se ele fosse invalido,
  // devolvia null SEM olhar o telefone seguinte — e a entidade inteira sumia da busca.
  it("cai para o proximo quando o whatsapp esta quebrado", () => {
    expect(
      escolherTelefone([
        { type: "whatsapp", value: "999" },
        { type: "phone", value: "(31) 3521-4400" },
      ]),
    ).toBe("553135214400");
  });

  it("prefere whatsapp quando os dois servem", () => {
    expect(
      escolherTelefone([
        { type: "phone", value: "(31) 3521-4400" },
        { type: "whatsapp", value: "(31) 99866-2052" },
      ]),
    ).toBe("5531998662052");
  });

  it("devolve nulo quando nenhum serve", () => {
    expect(escolherTelefone([{ type: "whatsapp", value: "abc" }])).toBeNull();
    expect(escolherTelefone([])).toBeNull();
  });
});

describe("contatosDoVinculo", () => {
  // ⚠️ A FONTE QUE A IRIS NUNCA LEU. Formato real medido em producao.
  it("extrai nome e telefone do vinculo kind=contato", () => {
    const mapa = contatosDoVinculo([
      {
        entity_id: "ent-1",
        label: "Cristiane Scher",
        metadata: {
          kind: "contato",
          phone: "(31) 999455486",
          role: "socio",
          email: "crischer@varpimoveis.com.br",
        },
      },
    ]);

    expect(mapa.get("ent-1")).toEqual([
      {
        label: "Cristiane Scher (socio)",
        origem: "relacionamento",
        primary: false,
        type: "whatsapp",
        value: "5531999455486",
      },
    ]);
  });

  it("ignora vinculo sem telefone aproveitavel", () => {
    const mapa = contatosDoVinculo([
      { entity_id: "ent-1", label: "Sem telefone", metadata: { kind: "contato" } },
      { entity_id: "ent-1", label: "Curto", metadata: { kind: "contato", phone: "123" } },
    ]);

    expect(mapa.get("ent-1")).toBeUndefined();
  });

  it("agrupa varios contatos da mesma entidade", () => {
    const mapa = contatosDoVinculo([
      { entity_id: "e", label: "Um", metadata: { kind: "contato", phone: "31999455486" } },
      { entity_id: "e", label: "Dois", metadata: { kind: "contato", phone: "31988223571" } },
    ]);

    expect(mapa.get("e")).toHaveLength(2);
  });

  it("usa rotulo generico quando o vinculo nao tem nome", () => {
    const mapa = contatosDoVinculo([
      { entity_id: "e", label: null, metadata: { kind: "contato", phone: "31999455486" } },
    ]);

    expect(mapa.get("e")?.[0]?.label).toBe("Contato");
  });
});

describe("filtrarVinculosPorTermo", () => {
  const vinculos = [
    {
      entity_id: "e1",
      label: "Cristiane Scher",
      metadata: { kind: "contato", phone: "+55 (31) 98980-4891" },
    },
    {
      entity_id: "e2",
      label: "Marcos Antonio",
      metadata: { kind: "contato", phone: "(31) 999455486" },
    },
  ];

  it("acha pelo nome do contato, sem caixa nem acento", () => {
    expect(filtrarVinculosPorTermo(vinculos, "cristiane", "")).toHaveLength(1);
    expect(filtrarVinculosPorTermo(vinculos, "CRISTIANE", "")[0]?.entity_id).toBe("e1");
    expect(filtrarVinculosPorTermo(vinculos, "marcos antonio", "")[0]?.entity_id).toBe("e2");
  });

  // ⚠️ O TELEFONE VEM COM MÁSCARA: 194 dos 258 têm pontuação e 111 têm hífen. Comparar
  // dígitos crus contra "98980-4891" não casa — tem que normalizar os dois lados.
  it("acha pelo telefone mesmo com mascara e hifen", () => {
    expect(filtrarVinculosPorTermo(vinculos, "", "31989804891")[0]?.entity_id).toBe("e1");
    expect(filtrarVinculosPorTermo(vinculos, "", "989804891")[0]?.entity_id).toBe("e1");
    expect(filtrarVinculosPorTermo(vinculos, "", "5531999455486")[0]?.entity_id).toBe("e2");
  });

  it("nao devolve nada quando nao ha termo nem telefone util", () => {
    expect(filtrarVinculosPorTermo(vinculos, "", "")).toEqual([]);
    expect(filtrarVinculosPorTermo(vinculos, "a", "")).toEqual([]);
  });

  it("nao inventa casamento para quem nao bate", () => {
    expect(filtrarVinculosPorTermo(vinculos, "fulano", "")).toEqual([]);
    expect(filtrarVinculosPorTermo(vinculos, "", "31900000000")).toEqual([]);
  });
});

describe("mesclarContatos", () => {
  const doCadastro: ContatoDaEntidade[] = [
    { label: null, origem: "cadastro", primary: true, type: "whatsapp", value: "5531999455486" },
  ];

  // ⚠️ 62 dos 258 telefones de contato JA existem em apolo_contacts. Sem dedup, o operador
  // veria o mesmo numero duas vezes e nao saberia qual escolher.
  it("nao repete o numero que ja veio do cadastro", () => {
    const juntos = mesclarContatos(doCadastro, [
      { label: "Fulano", origem: "relacionamento", primary: false, type: "whatsapp", value: "5531999455486" },
    ]);

    expect(juntos).toHaveLength(1);
    expect(juntos[0]?.origem).toBe("cadastro");
  });

  it("acrescenta o contato novo depois dos do cadastro", () => {
    const juntos = mesclarContatos(doCadastro, [
      { label: "Fulano", origem: "relacionamento", primary: false, type: "whatsapp", value: "5531988223571" },
    ]);

    expect(juntos.map((item) => item.value)).toEqual(["5531999455486", "5531988223571"]);
  });

  it("aguenta lista vazia dos dois lados", () => {
    expect(mesclarContatos([], [])).toEqual([]);
  });
});
