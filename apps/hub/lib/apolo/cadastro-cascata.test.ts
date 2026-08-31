import { describe, expect, it } from "vitest";

import {
  derivarNacionalidade,
  partesDaNaturalidade,
  sinaisDeFichaCosturada,
  unirCadastroEFicha,
  unirConjuge,
  unirEndereco,
} from "./cadastro-cascata";

// Os casos abaixo são os REAIS do lançamento Vale do Ouro (medidos nos 343 credenciados em
// 31/jul), não exemplos inventados — é o que a cascata precisa acertar para o C2X receber a
// mesma ficha que está na CAD assinada.

describe("união cadastro + ficha", () => {
  it("a ficha ganha do cadastro quando os dois têm valor", () => {
    const r = unirCadastroEFicha({ profissaoId: "93" }, { profissaoId: "35" });
    expect(r.valores.profissaoId).toBe("35");
    expect(r.divergenciasComuns).toContain("profissaoId");
    expect(r.divergenciasDeIdentidade).toEqual([]);
  });

  it("o cadastro entra onde a ficha é omissa", () => {
    const r = unirCadastroEFicha({ nomeMae: "MARIA SOUZA" }, { profissaoId: "35" });
    expect(r.valores.nomeMae).toBe("MARIA SOUZA");
    expect(r.valores.profissaoId).toBe("35");
  });

  it("traz o que SÓ existe na ficha — o buraco que deixava o C2X sem sexo e sem regime", () => {
    const r = unirCadastroEFicha(
      { dataNascimento: "1995-08-04" },
      { regimeBensId: "1", rg: "MG-12.345.678", sexoId: "2" },
    );
    expect(r.valores.sexoId).toBe("2");
    expect(r.valores.regimeBensId).toBe("1");
    expect(r.valores.rg).toBe("MG-12.345.678");
    expect(r.vindosDaFicha).toEqual(expect.arrayContaining(["regimeBensId", "rg", "sexoId"]));
  });

  it("caixa e acento NÃO são divergência", () => {
    // O cadastro veio do OCR em caixa alta e sem acento; a ficha foi digitada pelo operador.
    const r = unirCadastroEFicha(
      { nomeMae: "DJANRA DE FATIMA BATISTA" },
      { nomeMae: "Djanra de Fátima Batista" },
    );
    expect(r.divergenciasDeIdentidade).toEqual([]);
    expect(r.valores.nomeMae).toBe("Djanra de Fátima Batista");
  });

  it("OCR que PARTIU a palavra ainda cai em conferência (JONES VERTELO, caso real)", () => {
    // Dado real: o OCR leu "DJAN RA" com espaço no meio do primeiro nome. Normalizar caixa e
    // acento não resolve isso, e a gente NÃO tenta adivinhar juntando palavras — no contexto de
    // contrato, errar mandando para conferência custa um olhar; errar mandando dado trocado para
    // o C2X custa um contrato. Este teste fixa a escolha: falso positivo é aceito de propósito.
    const r = unirCadastroEFicha(
      { nomeMae: "DJAN RA DE FATIMA BATISTA" },
      { nomeMae: "Djanra de Fatima Batista" },
    );
    expect(r.divergenciasDeIdentidade).toContain("nomeMae");
    // Mesmo indo para conferência, o valor bom (o da ficha) é o que fica montado.
    expect(r.valores.nomeMae).toBe("Djanra de Fatima Batista");
  });

  it("espaço a mais também não é divergência", () => {
    const r = unirCadastroEFicha(
      { nomeMae: "MARIA  DEJANIRA   DE MOURA" },
      { nomeMae: "Maria Dejanira de Moura" },
    );
    expect(r.divergenciasDeIdentidade).toEqual([]);
  });

  it("mãe DIFERENTE é divergência de identidade (ALEXANDRE DUTRA CRUZ, caso real)", () => {
    // Cadastro trouxe a mãe de outra pessoa; a ficha tem a mãe cujo sobrenome bate com o titular.
    const r = unirCadastroEFicha(
      { dataNascimento: "1992-02-06", nomeMae: "DE ABREU NETTO NACIF" },
      { dataNascimento: "1993-03-20", nomeMae: "Maria Angelica Dutra Cruz" },
    );
    expect(r.divergenciasDeIdentidade).toEqual(
      expect.arrayContaining(["dataNascimento", "nomeMae"]),
    );
  });

  it("profissão divergente NÃO bloqueia — muda com o tempo, o operador é a fonte nova", () => {
    const r = unirCadastroEFicha(
      { estadoCivilId: "1", profissaoId: "93", rendaId: "2" },
      { estadoCivilId: "2", profissaoId: "35", rendaId: "3" },
    );
    expect(r.divergenciasDeIdentidade).toEqual([]);
    expect(r.divergenciasComuns).toEqual(
      expect.arrayContaining(["estadoCivilId", "profissaoId", "rendaId"]),
    );
    expect(r.valores.estadoCivilId).toBe("2");
  });

  it("campo vazio na ficha não apaga o do cadastro", () => {
    const r = unirCadastroEFicha({ nomeMae: "MARIA SOUZA" }, { nomeMae: "   " });
    expect(r.valores.nomeMae).toBe("MARIA SOUZA");
    expect(r.divergenciasDeIdentidade).toEqual([]);
  });

  it("aguenta fonte nula dos dois lados", () => {
    expect(unirCadastroEFicha(null, null).valores).toEqual({});
    expect(unirCadastroEFicha(undefined, { sexoId: "1" }).valores.sexoId).toBe("1");
  });
});

describe("endereço", () => {
  const FICHA = {
    bairro: "Centro",
    cep: "35660-000",
    cidade: "Pará de Minas",
    complemento: "Apto 201",
    logradouro: "Rua Sete de Setembro",
    numero: "100",
    uf: "MG",
  };

  it("monta o endereço que estava preso na ficha (314 dos 343 casos)", () => {
    expect(unirEndereco(FICHA, null)).toEqual(FICHA);
  });

  it("resolve CAMPO A CAMPO: o que o operador corrigiu ganha do endereço cadastrado", () => {
    // A CAD assinada mostra "Rua B, 250"; se o C2X escolhesse a fonte inteira, gravaria "Rua A, 10".
    const r = unirEndereco(
      { logradouro: "Rua B", numero: "250" },
      { bairro: "Centro", cep: "35660-000", cidade: "Pará de Minas", logradouro: "Rua A", numero: "10", uf: "MG" },
    );
    expect(r?.logradouro).toBe("Rua B");
    expect(r?.numero).toBe("250");
    // e o que só a tabela tinha continua vindo
    expect(r?.cep).toBe("35660-000");
    expect(r?.bairro).toBe("Centro");
  });

  it("usa o endereço cadastrado quando a ficha não tem nada", () => {
    const r = unirEndereco(null, { cep: "35660-000", logradouro: "Rua A", numero: "10" });
    expect(r?.logradouro).toBe("Rua A");
  });

  it("sem rua e sem CEP não há endereço", () => {
    expect(unirEndereco({ cidade: "Pará de Minas", uf: "MG" }, null)).toBeNull();
    expect(unirEndereco(null, null)).toBeNull();
  });
});

describe("cônjuge", () => {
  it("o nome corrigido na ficha ganha do label do relacionamento", () => {
    // Sem isto o cliente assina uma CAD com um nome e o C2X grava outro no contrato.
    const r = unirConjuge(
      { conjugeCpf: "111.222.333-44", conjugeNome: "Maria Angelica Dutra Cruz" },
      { cpf: "999.888.777-66", nome: "MARIA A. D. CRUZ" },
    );
    expect(r?.nome).toBe("Maria Angelica Dutra Cruz");
    expect(r?.cpf).toBe("111.222.333-44");
  });

  it("cônjuge que só existe na ficha É cônjuge (senão o casado sobe sem assinante)", () => {
    const r = unirConjuge({ conjugeNome: "Joana Silva" }, null);
    expect(r?.nome).toBe("Joana Silva");
  });

  // ⚠️ O CÔNJUGE ASSINA A ESCRITURA e é qualificado nela igual ao titular ("brasileira,
  // professora, portadora do CPF..."). Estes dois campos ficaram fora da cascata até 31/08/2026:
  // o wizard os coletava, a tela do CRM os mostrava, e o caminho até o C2X os perdia. Resultado
  // medido no Villa Paris: 11 cônjuges no legado sem profissão e sem nacionalidade, 5 deles em
  // contratos JÁ GERADOS.
  it("leva nacionalidade e profissão — sem elas o contrato não qualifica quem assina", () => {
    const r = unirConjuge(
      {
        conjugeNacionalidade: "Brasileira",
        conjugeNome: "Maria Angelica",
        conjugeProfissaoId: "88",
      },
      null,
    );
    expect(r?.nacionalidade).toBe("Brasileira");
    expect(r?.profissaoId).toBe("88");
  });

  it("os dois campos também vêm do relacionamento, quando a ficha não os tem", () => {
    // A ficha da esteira só existe depois que um operador digitou; no cadastro novo o dado mora
    // no relacionamento que o wizard gravou.
    const r = unirConjuge(
      { conjugeNome: "Maria Angelica" },
      { nacionalidade: "Brasileira", profissaoId: "88" },
    );
    expect(r?.nacionalidade).toBe("Brasileira");
    expect(r?.profissaoId).toBe("88");
  });

  it("a ficha do operador ganha do relacionamento também nestes dois", () => {
    // Mesma precedência do nome: quem corrigiu por último manda.
    const r = unirConjuge(
      { conjugeNacionalidade: "Portuguesa", conjugeNome: "Maria", conjugeProfissaoId: "12" },
      { nacionalidade: "Brasileira", profissaoId: "88" },
    );
    expect(r?.nacionalidade).toBe("Portuguesa");
    expect(r?.profissaoId).toBe("12");
  });

  it("cai no relacionamento quando a ficha não tem cônjuge", () => {
    const r = unirConjuge({}, { email: "j@x.com", nome: "Joana Silva" });
    expect(r?.nome).toBe("Joana Silva");
    expect(r?.email).toBe("j@x.com");
  });

  it("sem nome não há cônjuge", () => {
    expect(unirConjuge({ conjugeCpf: "111.222.333-44" }, null)).toBeNull();
    expect(unirConjuge(null, null)).toBeNull();
  });
});

describe("ficha costurada de duas pessoas", () => {
  it("CPF do cônjuge igual ao do titular", () => {
    expect(sinaisDeFichaCosturada({ conjugeCpf: "123.456.789-09" }, "12345678909")).toEqual([
      "o CPF do cônjuge é o mesmo do titular",
    ]);
  });

  it("titular e cônjuge com a mesma mãe e o mesmo nascimento", () => {
    const s = sinaisDeFichaCosturada(
      {
        conjugeMae: "Maria Souza",
        conjugeNascimento: "1990-01-01",
        dataNascimento: "1990-01-01",
        nomeMae: "MARIA SOUZA",
      },
      "12345678909",
    );
    expect(s).toEqual([
      "titular e cônjuge com a mesma mãe",
      "titular e cônjuge com a mesma data de nascimento",
    ]);
  });

  it("casal normal não acusa nada", () => {
    expect(
      sinaisDeFichaCosturada(
        {
          conjugeCpf: "987.654.321-00",
          conjugeMae: "Joana Lima",
          conjugeNascimento: "1988-03-02",
          dataNascimento: "1990-01-01",
          nomeMae: "Maria Souza",
        },
        "12345678909",
      ),
    ).toEqual([]);
  });

  it("ficha sem cônjuge não acusa nada (é o caso de 432 das 458)", () => {
    expect(sinaisDeFichaCosturada({ nomeMae: "Maria Souza" }, "12345678909")).toEqual([]);
    expect(sinaisDeFichaCosturada(null, null)).toEqual([]);
  });
});

describe("nacionalidade derivada da naturalidade", () => {
  it("separa cidade e UF do formato dominante 'CIDADE / UF'", () => {
    expect(partesDaNaturalidade("PARA DE MINAS / MG")).toEqual({
      cidade: "PARA DE MINAS",
      uf: "MG",
    });
    expect(partesDaNaturalidade("PARA DE MINAS")).toEqual({ cidade: "PARA DE MINAS", uf: null });
  });

  it("não confunde sufixo qualquer com UF", () => {
    // "AB" não é UF — o texto inteiro continua sendo a cidade.
    expect(partesDaNaturalidade("CIDADE X / AB")).toEqual({ cidade: "CIDADE X / AB", uf: null });
  });

  it("UF brasileira basta para dizer Brasileira", () => {
    expect(derivarNacionalidade("BELO HORIZONTE / MG", "")).toBe("Brasileira");
  });

  it("sem UF, quem decide é a tabela de cidades do C2X (CONTAGEM, caso real)", () => {
    const conhece = (c: string) => c.toUpperCase() === "CONTAGEM";
    expect(derivarNacionalidade("CONTAGEM", "", conhece)).toBe("Brasileira");
    expect(derivarNacionalidade("LISBOA", "", conhece)).toBeNull();
  });

  it("sem ninguém para consultar, deixa vazio em vez de inventar", () => {
    expect(derivarNacionalidade("PARA DE MINAS", "")).toBeNull();
  });

  it("NUNCA sobrescreve a nacionalidade já preenchida", () => {
    expect(derivarNacionalidade("LISBOA / MG", "Portuguesa")).toBeNull();
  });

  it("sem naturalidade não deriva nada", () => {
    expect(derivarNacionalidade("", "")).toBeNull();
  });
});
