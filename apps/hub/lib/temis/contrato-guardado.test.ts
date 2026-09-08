import { describe, expect, it } from "vitest";

import {
  type ContratoJaGuardado,
  contratoVigente,
  identidadeDoContrato,
  nomeDoContrato,
  podeGerarContrato,
  proximaVersao,
  textoDaSubstituicao,
  versaoDoNome,
} from "./contrato-guardado";

// AS TRÊS DECISÕES DO CONTRATO GUARDADO, cada uma com o caso que a justifica.

const guardado = (nome: string, criadoEm: string, id = nome): ContratoJaGuardado => ({
  criadoEm,
  id,
  nome,
});

// ── 1. VARIÁVEL SEM VALOR BLOQUEIA ──────────────────────────────────────────

describe("a geração recusa contrato com lacuna", () => {
  it("libera quando não falta nada", () => {
    expect(podeGerarContrato([])).toEqual({ ok: true });
  });

  // ⚠️ ESTE É O TESTE QUE PROTEGE O CARTÓRIO. `preencherContrato` imprime `[cpf_cliente]` no corpo
  // quando o dado falta — na prévia isso é conferência, num arquivo guardado é um contrato com
  // colchete impresso circulando com selo de "gerado pelo sistema".
  it("recusa quando alguma variável ficou sem valor", () => {
    const r = podeGerarContrato(["cpf_cliente"]);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("deveria ter recusado");
    expect(r.erro).toContain("1 variável ficou sem valor");
    // ⚠️ O NOME VAI NA MENSAGEM: sem ele, a pessoa procura colchete em 27 páginas.
    expect(r.erro).toContain("cpf_cliente");
  });

  it("lista todas as que faltaram, e concorda no plural", () => {
    const r = podeGerarContrato(["cpf_cliente", "regime_casamento_cliente"]);
    if (r.ok) throw new Error("deveria ter recusado");
    expect(r.erro).toContain("2 variáveis ficaram sem valor");
    expect(r.erro).toContain("regime_casamento_cliente");
  });
});

// ── 2. GERAR DE NOVO CRIA VERSÃO ────────────────────────────────────────────

describe("a versão sai do nome do arquivo", () => {
  it("lê o sufixo que nós mesmos escrevemos", () => {
    expect(versaoDoNome("Contrato TST - Q01 L05 - Joao - 2026-09-09 v1.pdf")).toBe(1);
    expect(versaoDoNome("Contrato TST - Q01 L05 - Joao - 2026-09-09 v12.pdf")).toBe(12);
  });

  // ⚠️ NOME DE ARQUIVO QUE ALGUÉM SUBIU NÃO VIRA VERSÃO. `tipo = contrato` só nasce da geração, mas
  // uma linha antiga (ou migrada) pode não ter o sufixo — e adivinhar ali produziria número errado.
  it("devolve null quando o nome não carrega versão", () => {
    expect(versaoDoNome("contrato assinado.pdf")).toBeNull();
    expect(versaoDoNome("v3 contrato.pdf")).toBeNull();
    expect(versaoDoNome("")).toBeNull();
  });
});

describe("a próxima versão", () => {
  it("começa em 1 quando nada foi gerado", () => {
    expect(proximaVersao([])).toBe(1);
  });

  it("é a maior mais um", () => {
    expect(
      proximaVersao([guardado("c v1.pdf", "2026-09-09T10:00:00Z"), guardado("c v2.pdf", "2026-09-09T11:00:00Z")]),
    ).toBe(3);
  });

  // ⚠️ MÁXIMO, E NÃO CONTAGEM. Uma linha escondida faria a contagem repetir um número que já
  // circulou em PDF na mão de alguém — duas folhas diferentes com "v2" no rodapé é pior que um vão.
  it("não repete um número quando falta uma linha no meio", () => {
    expect(proximaVersao([guardado("c v3.pdf", "2026-09-09T12:00:00Z")])).toBe(4);
  });

  it("cai na contagem quando nenhum nome tem versão legível", () => {
    expect(
      proximaVersao([guardado("antigo.pdf", "2026-09-01T10:00:00Z"), guardado("outro.pdf", "2026-09-02T10:00:00Z")]),
    ).toBe(3);
  });
});

describe("qual contrato vale hoje", () => {
  it("é a geração mais recente", () => {
    const vigente = contratoVigente([
      guardado("c v1.pdf", "2026-09-09T10:00:00Z"),
      guardado("c v2.pdf", "2026-09-09T15:00:00Z"),
      guardado("c v3.pdf", "2026-09-09T12:00:00Z"),
    ]);
    expect(vigente?.nome).toBe("c v2.pdf");
  });

  // ⚠️ DOIS CLIQUES NO MESMO SEGUNDO. Sem desempate, o "vigente" oscilaria entre as duas linhas a
  // cada leitura, e o board mostraria uma versão diferente a cada carga.
  it("desempata pela versão quando a data é a mesma", () => {
    const vigente = contratoVigente([
      guardado("c v1.pdf", "2026-09-09T10:00:00Z", "a"),
      guardado("c v2.pdf", "2026-09-09T10:00:00Z", "b"),
    ]);
    expect(vigente?.id).toBe("b");
  });

  it("devolve null quando não há nenhum", () => {
    expect(contratoVigente([])).toBeNull();
  });
});

describe("a versão anterior fica marcada", () => {
  it("diz por quem foi substituída e quando", () => {
    // 09/09/2026 às 00h30 UTC ainda é 08/09 em Brasília — e é a data de Brasília que a casa lê.
    expect(textoDaSubstituicao(2, new Date("2026-09-09T00:30:00Z"))).toBe(
      "Substituído pela versão 2, gerada em 08/09/2026.",
    );
  });
});

// ── 3. O NOME QUE UMA PESSOA ENTENDE DEPOIS ─────────────────────────────────

describe("o nome do arquivo", () => {
  const emitido = new Date("2026-09-09T18:00:00Z");

  it("traz empreendimento, unidade, comprador, data e versão", () => {
    expect(
      nomeDoContrato(
        { comprador: "Henrique Sales do Vale", empreendimento: "TST", unidade: "Q01 L05" },
        1,
        emitido,
      ),
    ).toBe("Contrato - TST - Q01 L05 - Henrique Sales do Vale - 2026-09-09 v1.pdf");
  });

  // ⚠️ A DATA É DE BRASÍLIA. Um contrato gerado às 21h30 daqui é o dia seguinte em UTC, e o arquivo
  // nasceria datado de amanhã.
  it("data no fuso da operação, não em UTC", () => {
    expect(
      nomeDoContrato({ comprador: "A", empreendimento: "B", unidade: "C" }, 1, new Date("2026-09-10T00:30:00Z")),
    ).toContain("2026-09-09");
  });

  // ⚠️ BARRA VIRA PASTA E `·` JÁ APARECEU TRUNCADO EM CLIENTE DE E-MAIL. O nome vai para o
  // Content-Disposition do download e daí para o disco de quem baixou.
  it("tira o que quebra nome de arquivo", () => {
    const nome = nomeDoContrato(
      { comprador: "Maria / José · Silva", empreendimento: "V:LO", unidade: "Q1*L2" },
      2,
      emitido,
    );
    expect(nome).not.toMatch(/[\\/:*?"<>|·]/);
    // ⚠️ O ACENTO FICA. Ele é legal em nome de arquivo nos três sistemas e é o nome da pessoa; quem
    // precisa de ASCII é o CAMINHO no bucket, e lá `nomeSeguroDeArquivo` já faz a limpeza.
    expect(nome).toContain("Maria José Silva");
    expect(nome.endsWith(" v2.pdf")).toBe(true);
  });

  it("aguenta pedaço faltando sem deixar hífen solto", () => {
    expect(nomeDoContrato({ comprador: "Joao", empreendimento: "", unidade: "" }, 1, emitido)).toBe(
      "Contrato - Joao - 2026-09-09 v1.pdf",
    );
  });
});

describe("a identidade sai do mesmo dado que foi impresso", () => {
  // ⚠️ DO PREENCHIMENTO, e não de uma segunda consulta: um arquivo chamado "Quadra 02" com o
  // contrato falando de "Quadra 01" é o documento errado com cara de certo.
  it("monta a unidade por quadra e lote quando não há código", () => {
    expect(
      identidadeDoContrato(
        { empreendimento_codigo: "TST", numero_lote: "05", numero_quadra: "01" },
        "Henrique Sales do Vale",
      ),
    ).toEqual({ comprador: "Henrique Sales do Vale", empreendimento: "TST", unidade: "Q01 L05" });
  });

  // ⚠️ O TITULAR NÃO ESTÁ EM `gerais`, E ISSO JÁ GEROU ARQUIVO SEM NOME. `nome_cliente` é escrito
  // por comprador (dentro do laço), em `compradores[i].valores` — a primeira versão desta função
  // lia `gerais.nome_cliente` e produzia, calada, "Contrato - TST - Q01 L05 - 2026-09-09 v1.pdf".
  it("ignora um nome_cliente que apareça em gerais: quem manda é o titular", () => {
    expect(
      identidadeDoContrato({ empreendimento_codigo: "TST", nome_cliente: "NÃO USAR" }, "Maria")
        .comprador,
    ).toBe("Maria");
  });

  it("prefere o código da unidade quando ele existe", () => {
    expect(
      identidadeDoContrato(
        {
          codigo_unidade: "LOS0302",
          empreendimento_codigo: "LOS",
          numero_lote: "02",
          numero_quadra: "03",
        },
        "X",
      ).unidade,
    ).toBe("LOS0302");
  });

  it("cai no nome do empreendimento quando não há código", () => {
    expect(
      identidadeDoContrato({ empreendimento_nome: "Jardim das Gerais" }, "X").empreendimento,
    ).toBe("Jardim das Gerais");
  });
});
