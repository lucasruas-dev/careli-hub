import { describe, expect, it } from "vitest";

import { carteirasDoPortal, portalEmiteBoletos, portalPodeEmitir } from "./portais";

// ⚠️ ESTE ARQUIVO GUARDA A PORTA. A rota de boletos do portal CRIA COBRANÇA em nome de outra
// empresa, num CNPJ que não é o nosso, e o Asaas não desfaz em lote. Se qualquer caso aqui virar
// verde por engano, alguém emite dívida na carteira do vizinho.

describe("quem enxerga carteira de boleto", () => {
  it("os dois portais do Cecílio veem as nove carteiras", () => {
    // ⚠️ ELAS ENTRARAM EM DUAS ETAPAS, e nenhuma por semelhança: primeiro os quatro edifícios da CER
    // (*"vamos fazer o CER primeiro"*), e as outras cinco quando o Lucas autorizou (*"pode subir os
    // demais empreendimentos que vamos fazer"*, 01/09/2026).
    //
    // A carteira "teste" fica de fora desta lista de propósito: ela existe para o boleto de
    // conferência e sai daqui quando servir. Ver o teste seguinte.
    for (const slug of ["cer", "cecilio-rocha"]) {
      const carteiras = carteirasDoPortal(slug)
        .filter((c) => !c.startsWith("teste"))
        .sort();
      expect(carteiras, slug).toEqual([
        "ed-cristal",
        "ed-esmeralda",
        "ed-jade",
        "ed-rubi",
        "garden",
        "giant-towers",
        "guaimbe",
        "on-sky",
        "vale-do-sol",
      ]);
    }
  });

  it("há uma carteira de teste por conta do Asaas, e todas são temporárias", () => {
    // ⚠️ UMA POR CONTA porque a conta vem do EMPREENDIMENTO: testar a chave do Garden exige emitir
    // por um empreendimento cuja conta seja `garden`. Pedido do Lucas (01/09/2026): *"quero testar
    // todas as contas antes de enviar"*.
    const daCer = carteirasDoPortal("cer").filter((c) => c.startsWith("teste"));
    expect(daCer.sort()).toEqual([
      "teste",
      "teste-garden",
      "teste-giant-towers",
      "teste-guaimbe",
      "teste-on-sky",
      "teste-vale-do-sol",
    ]);
  });

  it("a carteira de teste está só nos portais do Cecílio, e é temporária", () => {
    // ⚠️ ESTE TESTE É O LEMBRETE. "teste" emite na conta CER de verdade — pedido do Lucas
    // (01/09/2026): *"coloca para mim um boleto Lucas Ruas - Teste - 10 reais"*. Quando o teste
    // tiver servido, a linha sai de CARTEIRAS_DO_PORTAL e de EMPREENDIMENTOS_DE_BOLETO, e este
    // teste vem junto. Enquanto ele existir, ninguém a apaga por engano nem a estende a outro portal.
    expect(carteirasDoPortal("cer")).toContain("teste");
    expect(carteirasDoPortal("cecilio-rocha")).toContain("teste");
    for (const slug of ["vistaalegre", "lagoabonita", "mmendes"]) {
      expect(carteirasDoPortal(slug), slug).not.toContain("teste");
    }
  });

  it("nenhum outro portal vê carteira nenhuma", () => {
    for (const slug of ["vistaalegre", "lagoabonita", "mmendes", "gurgel", ""]) {
      expect(carteirasDoPortal(slug), slug).toEqual([]);
      expect(portalEmiteBoletos(slug), slug).toBe(false);
    }
  });

  it("slug ausente ou nulo não vira portal com acesso", () => {
    expect(portalEmiteBoletos(null)).toBe(false);
    expect(portalEmiteBoletos(undefined)).toBe(false);
    expect(carteirasDoPortal(null)).toEqual([]);
  });

  it("maiúscula e espaço não fazem o portal certo perder a aba", () => {
    // ⚠️ A URL chega com a caixa que o usuário digitou: `/incorporador/CER` é o mesmo portal que
    // `/incorporador/cer`. Já houve este erro na rota da logo — ver o comentário em
    // `app/api/incorporador/[slug]/logo/route.ts`. Aqui perder a caixa não abriria acesso a
    // ninguém: apagaria a aba de quem tem direito a ela.
    expect(portalEmiteBoletos(" CER ")).toBe(true);
    expect(portalEmiteBoletos("Cecilio-Rocha")).toBe(true);
    expect(portalEmiteBoletos("CECILIO-ROCHA")).toBe(true);
  });

  it("nome parecido com o de um portal permitido NÃO entra", () => {
    // O que a normalização não pode fazer é o contrário: aproximar slugs diferentes.
    for (const slug of ["cer2", "cer-teste", "cecilio", "cecilio-rocha-2", "acer"]) {
      expect(portalEmiteBoletos(slug), slug).toBe(false);
    }
  });
});

describe("a trava de emitir num empreendimento", () => {
  it("o CER emite nos quatro edifícios dele", () => {
    for (const e of ["ed-jade", "ed-rubi", "ed-cristal", "ed-esmeralda"]) {
      expect(portalPodeEmitir("cer", e), e).toBe(true);
    }
  });

  it("o CER emite nas nove carteiras liberadas", () => {
    for (const e of ["garden", "vale-do-sol", "on-sky", "guaimbe", "giant-towers"]) {
      expect(portalPodeEmitir("cer", e), e).toBe(true);
    }
  });

  it("o CER NÃO emite em carteira que não está na lista", () => {
    // ⚠️ ESTE É O CASO QUE A TRAVA EXISTE PARA PEGAR: a sessão é legítima, a aba está na tela, e o
    // slug vem no corpo do POST — a parte que qualquer um edita. Um empreendimento futuro só passa
    // depois de entrar em CARTEIRAS_DO_PORTAL, por decisão, nunca por consequência.
    for (const e of ["vale-do-ouro", "villa-paris", "lagoa-bonita", "ed-safira"]) {
      expect(portalPodeEmitir("cer", e), e).toBe(false);
    }
  });

  it("portal sem aba não emite em lugar nenhum", () => {
    for (const e of ["ed-jade", "garden", "on-sky"]) {
      expect(portalPodeEmitir("vistaalegre", e), e).toBe(false);
      expect(portalPodeEmitir("mmendes", e), e).toBe(false);
    }
  });

  it("empreendimento vazio ou desconhecido não passa", () => {
    expect(portalPodeEmitir("cer", "")).toBe(false);
    expect(portalPodeEmitir("cer", "ed-safira")).toBe(false);
    // Prefixo do nome de um permitido não vale: a comparação é do slug inteiro.
    expect(portalPodeEmitir("cer", "ed-")).toBe(false);
    expect(portalPodeEmitir("cer", "ed-jade-2")).toBe(false);
  });
});
