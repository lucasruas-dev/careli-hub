import { describe, expect, it } from "vitest";

import {
  acharBlocoPronto,
  BLOCOS_PRONTOS,
  nosDoBloco,
  textoDoBloco,
} from "./blocos-prontos";
import { acharVariavel, conferirBlocos, extensosOrfaos, variaveisDoTexto } from "./variaveis";

// O QUE ESTES TESTES PROTEGEM. Um bloco pronto é inserido com um clique e vai inteiro para dentro de
// um contrato que alguém assina — o jurídico revisa a REDAÇÃO, não a marcação. Se um `[nome]` daqui
// não existir no catálogo, ele sai impresso entre colchetes no papel; se um `[inicio_x]` não fechar,
// o motor imprime o trecho que devia sumir. Os dois defeitos já aconteceram em contrato real (as
// minutas do legado com `[Nome]` e o Villa Paris com o bloco de PJ num comprador PF), e nenhum dos
// dois dá erro em tempo de execução.

describe("blocos prontos", () => {
  it("tem os blocos na ordem em que o contrato é escrito", () => {
    expect(BLOCOS_PRONTOS.map((b) => b.id)).toEqual([
      "partes-vendedora",
      "partes-compradores",
      "objeto",
      "preco",
      "fluxo-tabela",
      "fluxo-escrito",
      "corretagem",
      "anexos",
      "fecho",
    ]);
  });

  it("não repete id", () => {
    const ids = BLOCOS_PRONTOS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("acha pelo id, e devolve undefined no que não existe", () => {
    expect(acharBlocoPronto("partes-vendedora")?.rotulo).toBe("Partes — vendedora");
    expect(acharBlocoPronto("clausula-inventada")).toBeUndefined();
  });

  // ⚠️ O TESTE PRINCIPAL. Toda variável de todo bloco existe no catálogo.
  it.each(BLOCOS_PRONTOS.map((b) => [b.id, b] as const))(
    "%s só usa variáveis que o Temis sabe preencher",
    (_id, bloco) => {
      const desconhecidas = variaveisDoTexto(textoDoBloco(bloco)).filter((n) => !acharVariavel(n));
      expect(desconhecidas).toEqual([]);
    },
  );

  it.each(BLOCOS_PRONTOS.map((b) => [b.id, b] as const))(
    "%s fecha todos os blocos que abre",
    (_id, bloco) => {
      expect(conferirBlocos(textoDoBloco(bloco))).toEqual([]);
    },
  );

  // Valor sem extenso ao lado passa no cartório; extenso sem o valor perde o número. A data do
  // fecho é a exceção, e está tratada em `extensosOrfaos` — o fecho escreve só o extenso.
  it.each(BLOCOS_PRONTOS.map((b) => [b.id, b] as const))(
    "%s não deixa extenso órfão",
    (_id, bloco) => {
      expect(extensosOrfaos(textoDoBloco(bloco))).toEqual([]);
    },
  );

  it("continua fechando os blocos quando todos são inseridos em sequência", () => {
    // É o uso real: quem monta uma minuta do zero clica nos sete, de cima para baixo.
    const tudo = BLOCOS_PRONTOS.map(textoDoBloco).join("\n");
    expect(conferirBlocos(tudo)).toEqual([]);
  });
});

describe("o laço por comprador", () => {
  it("qualifica o comprador uma vez só, sem os sufixos do legado", () => {
    const texto = textoDoBloco(acharBlocoPronto("partes-compradores") as never);
    expect(texto).toContain("[inicio_cada_comprador]");
    expect(texto).toContain("[fim_cada_comprador]");
    // ⚠️ Nenhum `_2`…`_5`: é a decisão de 07/09/2026 (contrato só no Panteon). Um sufixo que
    // reaparecesse aqui traria de volta o teto de cinco compradores.
    expect(texto).not.toMatch(/\[[a-z_]+_[2-5]\]/);
  });

  it("põe o cônjuge DENTRO do laço, para nascer de cada comprador", () => {
    const texto = textoDoBloco(acharBlocoPronto("partes-compradores") as never);
    const abre = texto.indexOf("[inicio_cada_comprador]");
    const conjuge = texto.indexOf("[inicio_dados_conjuge]");
    const fecha = texto.indexOf("[fim_cada_comprador]");
    expect(abre).toBeLessThan(conjuge);
    expect(conjuge).toBeLessThan(fecha);
  });

  it("repete a linha de assinatura por comprador e por cônjuge", () => {
    const texto = textoDoBloco(acharBlocoPronto("fecho") as never);
    const abre = texto.indexOf("[inicio_cada_comprador]");
    expect(abre).toBeGreaterThan(-1);
    expect(texto.indexOf("[nome_cliente]")).toBeGreaterThan(abre);
    expect(texto.indexOf("[nome_conjuge]")).toBeGreaterThan(abre);
  });
});

describe("a participação é DA UNIDADE", () => {
  // Lucas, 07/09/2026: *"em vez de ser detentor de 100% do imóvel, troca para unidade"*.
  it("não escreve 'imóvel' em bloco nenhum", () => {
    for (const bloco of BLOCOS_PRONTOS) {
      expect(textoDoBloco(bloco).toLowerCase()).not.toContain("imóvel");
      expect(textoDoBloco(bloco).toLowerCase()).not.toContain("imovel");
    }
  });

  it("liga o percentual do comprador à unidade", () => {
    expect(textoDoBloco(acharBlocoPronto("partes-compradores") as never)).toContain(
      "detentor de [percentual_cliente] da unidade",
    );
  });
});

describe("a vendedora", () => {
  // *"aqui é os dados do incorporador ou spe, vai estar no sistema também"* — e a vendedora pode
  // mudar dentro do mesmo empreendimento, por categoria.
  it("é qualificada por variável, não escrita à mão", () => {
    const texto = textoDoBloco(acharBlocoPronto("partes-vendedora") as never);
    for (const nome of [
      "vendedora_razao_social",
      "vendedora_natureza_juridica",
      "vendedora_cnpj",
      "vendedora_cidade",
      "vendedora_representante_nome",
      // ⚠️ O contrato real do Villa Paris qualifica o representante INTEIRO. Lucas (07/09/2026):
      // *"trazer no bloco das partes o e-mail dos sócios"*. Sem variável, esses dados ficam
      // digitados na minuta — e o contrato do ano que vem sai com o sócio que já saiu da empresa.
      "vendedora_representante_email",
      "vendedora_representante_rg",
      "vendedora_representante_endereco",
    ]) {
      expect(texto).toContain(`[${nome}]`);
    }
  });

  // ⚠️ DOIS BLOCOS, E NÃO UM: *"acho separar, podemos ter o sub bloco da vendedora e dos
  // compradores"*. Eles mudam por motivos diferentes — a vendedora muda quando o incorporador troca
  // de representante (uma vez a cada anos, valendo para todos os contratos); o comprador muda a
  // cada venda.
  it("mora num bloco separado do comprador", () => {
    const compradores = textoDoBloco(acharBlocoPronto("partes-compradores") as never);
    expect(compradores).not.toContain("[vendedora_razao_social]");
    expect(compradores).toContain("[nome_cliente]");
  });

  it("assina o contrato pelo nome, no fecho", () => {
    expect(textoDoBloco(acharBlocoPronto("fecho") as never)).toContain("[vendedora_razao_social]");
  });
});

describe("o fluxo de pagamento", () => {
  it("esconde as anuais quando o plano não tem", () => {
    const texto = textoDoBloco(acharBlocoPronto("fluxo-escrito") as never);
    const abre = texto.indexOf("[inicio_tem_anuais]");
    const fecha = texto.indexOf("[fim_tem_anuais]");
    expect(abre).toBeGreaterThan(-1);
    expect(texto.indexOf("[plano_anuais_quantidade]")).toBeGreaterThan(abre);
    expect(texto.indexOf("[plano_anuais_valor]")).toBeLessThan(fecha);
  });

  // ⚠️ OS DOIS FORMATOS NÃO SE MISTURAM. *"podemos ter os dois tipos, tabela e escrita, no lagoa é
  // escrito"* — mas um contrato que traz o quadro E os parágrafos diz o preço duas vezes, e no dia
  // de uma renegociação só um dos dois é corrigido.
  it("põe o quadro só no formato tabela", () => {
    expect(textoDoBloco(acharBlocoPronto("fluxo-tabela") as never)).toContain(
      "[tabela_geral_pagamentos]",
    );
    expect(textoDoBloco(acharBlocoPronto("fluxo-escrito") as never)).not.toContain(
      "[tabela_geral_pagamentos]",
    );
  });

  it("põe os parágrafos redigidos só no formato escrito", () => {
    const escrito = textoDoBloco(acharBlocoPronto("fluxo-escrito") as never);
    const tabela = textoDoBloco(acharBlocoPronto("fluxo-tabela") as never);
    for (const nome of ["paragrafo_sinal", "paragrafo_parcelamento", "paragrafo_vencimento"]) {
      expect(escrito).toContain(`[${nome}]`);
      expect(tabela).not.toContain(`[${nome}]`);
    }
  });

  it("traz a condição suspensiva do sinal, que é o que dá dente à cláusula", () => {
    expect(textoDoBloco(acharBlocoPronto("fluxo-escrito") as never)).toContain(
      "condição suspensiva",
    );
  });
});

describe("os anexos", () => {
  // *"ae podemos ter o bloco dos anexo"* — as peças do contrato que não são texto. E o anexo é uma
  // POSIÇÃO, não um tipo: *"podemos ter já definido os campos anexo, 1,2,3"*.
  it("põe cada anexo dentro do seu par, para a linha sumir quando não há arquivo", () => {
    const texto = textoDoBloco(acharBlocoPronto("anexos") as never);
    for (const n of [1, 2, 3]) {
      const abre = texto.indexOf(`[inicio_tem_anexo_${n}]`);
      const fecha = texto.indexOf(`[fim_tem_anexo_${n}]`);
      expect(abre, `anexo ${n}`).toBeGreaterThan(-1);
      // ⚠️ O RÓTULO vai DENTRO do par, não só a variável: "ANEXO II" seguido de nada é o contrato
      // prometendo uma peça que não está lá.
      expect(texto.indexOf(`[anexo_${n}]`)).toBeGreaterThan(abre);
      expect(texto.indexOf(`[anexo_${n}]`)).toBeLessThan(fecha);
    }
  });

  it("não fixa tipo de anexo nenhum — planta e convenção são do cadastro, não do código", () => {
    const texto = textoDoBloco(acharBlocoPronto("anexos") as never);
    for (const inventado of ["anexo_planta", "anexo_convencao", "anexo_memorial", "anexo_matricula"]) {
      expect(texto, inventado).not.toContain(inventado);
      expect(acharVariavel(inventado), inventado).toBeUndefined();
    }
  });

  it("fecha com o curinga, que traz o que o texto não posicionou", () => {
    expect(textoDoBloco(acharBlocoPronto("anexos") as never)).toContain("[anexos_do_contrato]");
  });

  it("vem antes do fecho — anexo assinado é anexo que já estava no documento", () => {
    const ids = BLOCOS_PRONTOS.map((b) => b.id);
    expect(ids.indexOf("anexos")).toBeLessThan(ids.indexOf("fecho"));
  });
});

describe("os parágrafos que vão para a folha", () => {
  it("dá um parágrafo por linha", () => {
    const bloco = acharBlocoPronto("objeto") as never as { linhas: unknown[] };
    expect(nosDoBloco(acharBlocoPronto("objeto") as never)).toHaveLength(bloco.linhas.length);
  });

  it("põe o título em negrito e justifica o corpo", () => {
    const [titulo, corpo] = nosDoBloco(acharBlocoPronto("objeto") as never);
    expect(titulo?.children?.[0]).toMatchObject({ bold: true });
    expect(corpo?.align).toBe("justify");
  });

  it("centraliza a linha de assinatura", () => {
    const nos = nosDoBloco(acharBlocoPronto("fecho") as never);
    const assinatura = nos.find((n) => n.children?.[0] && "text" in n.children[0] && (n.children[0] as { text: string }).text.startsWith("___"));
    expect(assinatura?.align).toBe("center");
  });

  // ⚠️ A VARIÁVEL SAI COMO TEXTO, de propósito: quem insere chama `promoverVariaveisNoValor`, o
  // mesmo caminho do que é colado e do que vem do .docx. Montar o nó aqui duplicaria a regra.
  it("deixa a variável como texto [nome], para a promoção fazer o nó", () => {
    const [, corpo] = nosDoBloco(acharBlocoPronto("objeto") as never);
    const primeiro = corpo?.children?.[0] as { text: string };
    expect(primeiro.text).toContain("[codigo_unidade]");
    expect(corpo?.children).toHaveLength(1);
  });

  it("todo parágrafo é do tipo p", () => {
    for (const bloco of BLOCOS_PRONTOS) {
      for (const no of nosDoBloco(bloco)) expect(no.type).toBe("p");
    }
  });
});
