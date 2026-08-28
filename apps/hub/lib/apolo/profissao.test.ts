import { describe, expect, it } from "vitest";

import { C2X_PROFISSOES } from "./c2x-professions";
import {
  LIMITE_PROFISSAO_LIVRE,
  MARCA_A_PADRONIZAR,
  casarProfissaoNaLista,
  ehProfissaoNaoDeclarada,
  normalizarProfissaoLivre,
  profissaoDeclarada,
  profissaoExibida,
  profissaoParaC2x,
  profissaoPendenteDePadronizacao,
  rotuloDaProfissao,
  temProfissao,
} from "./profissao";

// A ficha nasce no wizard com QUATRO combinações possíveis de profissão, e cada uma tem que se
// comportar de um jeito específico em três lugares: no que a tela MOSTRA, no que a validação
// COBRA e no que sobe para o C2X. É esse quadro que os testes abaixo fecham.
//
//   só lista  → mostra a profissão; nada a padronizar; C2X recebe o rótulo.
//   só livre  → mostra o texto marcado; pendente; C2X recebe NULL (aplica o default dele, o 25).
//   ambas     → mostra a padronizada; o texto vira observação; C2X recebe o rótulo.
//   nenhuma   → mostra vazio; C2X recebe NULL, exatamente como hoje.

// Ids reais do catálogo (evita test que passa por um catálogo vazio).
const ADVOGADO = C2X_PROFISSOES.find((o) => o.label === "ADVOGADO(A)");
const ADMINISTRADOR = C2X_PROFISSOES.find((o) => o.label === "ADMINISTRADOR(A)");

describe("catálogo do C2X", () => {
  it("as 234 profissões continuam lá, e os ids usados nos testes existem", () => {
    expect(C2X_PROFISSOES.length).toBe(234);
    expect(ADVOGADO).toBeDefined();
    expect(ADMINISTRADOR).toBeDefined();
  });

  it("rotuloDaProfissao aceita id como texto e como número", () => {
    expect(rotuloDaProfissao(String(ADVOGADO!.id))).toBe("ADVOGADO(A)");
    expect(rotuloDaProfissao(ADVOGADO!.id)).toBe("ADVOGADO(A)");
    expect(rotuloDaProfissao("")).toBe("");
    expect(rotuloDaProfissao(null)).toBe("");
    // Id que não existe no catálogo não inventa rótulo.
    expect(rotuloDaProfissao("999999")).toBe("");
  });
});

describe("normalizarProfissaoLivre", () => {
  it("apara e colapsa espaço", () => {
    expect(normalizarProfissaoLivre("  Confeiteira   de   bolo ")).toBe("Confeiteira de bolo");
  });

  it("corta no teto: um nome de profissão, não um parágrafo colado por engano", () => {
    const enorme = "a".repeat(500);
    expect(normalizarProfissaoLivre(enorme).length).toBe(LIMITE_PROFISSAO_LIVRE);
  });

  it("o que não é texto vira vazio", () => {
    expect(normalizarProfissaoLivre(null)).toBe("");
    expect(normalizarProfissaoLivre(undefined)).toBe("");
    expect(normalizarProfissaoLivre("   ")).toBe("");
  });
});

describe("casarProfissaoNaLista — não deixa nascer pendência à toa", () => {
  it("texto que É uma profissão do catálogo devolve o id (acento e caixa não importam)", () => {
    expect(casarProfissaoNaLista("advogado(a)")).toBe(String(ADVOGADO!.id));
    expect(casarProfissaoNaLista("  ADMINISTRADOR(A)  ")).toBe(String(ADMINISTRADOR!.id));
  });

  it("texto que não existe no catálogo não casa com nada", () => {
    expect(casarProfissaoNaLista("Piloto de drone agrícola")).toBe("");
    expect(casarProfissaoNaLista("")).toBe("");
  });
});

describe("o que a ficha MOSTRA", () => {
  it("só lista: a profissão padronizada, sem marca nenhuma", () => {
    const exibido = profissaoExibida(String(ADVOGADO!.id), "");
    // `titleCase` só maiusculiza após espaço, "/", "'" e "-": "ADVOGADO(A)" vira "Advogado(a)".
    // É a mesma exibição que o wizard já produzia antes desta mudança.
    expect(exibido).toBe("Advogado(a)");
    expect(exibido).not.toContain(MARCA_A_PADRONIZAR);
  });

  it("só livre: o texto do corretor, MARCADO como pendente", () => {
    expect(profissaoExibida("", "piloto de drone agrícola")).toBe(
      `Piloto De Drone Agrícola ${MARCA_A_PADRONIZAR}`,
    );
  });

  it("ambas: a padronizada ganha, e a marca some", () => {
    const exibido = profissaoExibida(String(ADVOGADO!.id), "advogada trabalhista");
    // `titleCase` só maiusculiza após espaço, "/", "'" e "-": "ADVOGADO(A)" vira "Advogado(a)".
    // É a mesma exibição que o wizard já produzia antes desta mudança.
    expect(exibido).toBe("Advogado(a)");
    expect(exibido).not.toContain(MARCA_A_PADRONIZAR);
  });

  it("nenhuma: vazio (a tela mostra o traço dela)", () => {
    expect(profissaoExibida("", "")).toBe("");
    expect(profissaoExibida(null, null)).toBe("");
  });
});

describe("o texto declarado não se perde", () => {
  it("ambas: vira observação com o texto original", () => {
    expect(profissaoDeclarada(String(ADVOGADO!.id), "advogada trabalhista")).toBe(
      "Advogada Trabalhista",
    );
  });

  it("ambas, mas o texto é a MESMA profissão escrita de outro jeito: nada a observar", () => {
    expect(profissaoDeclarada(String(ADVOGADO!.id), "advogado(a)")).toBe("");
  });

  it("só livre: não é observação, é o valor principal (marcado) — ver profissaoExibida", () => {
    expect(profissaoDeclarada("", "piloto de drone agrícola")).toBe("");
  });

  it("só lista / nenhuma: nada", () => {
    expect(profissaoDeclarada(String(ADVOGADO!.id), "")).toBe("");
    expect(profissaoDeclarada("", "")).toBe("");
  });
});

describe("o que a VALIDAÇÃO cobra", () => {
  it("pendente é só quando há texto livre e ninguém padronizou", () => {
    expect(profissaoPendenteDePadronizacao("", "piloto de drone agrícola")).toBe(true);
    expect(profissaoPendenteDePadronizacao(String(ADVOGADO!.id), "piloto de drone")).toBe(false);
    expect(profissaoPendenteDePadronizacao(String(ADVOGADO!.id), "")).toBe(false);
    // Ficha antiga, sem profissão nenhuma: não é pendência DESTA regra (não há o que padronizar).
    expect(profissaoPendenteDePadronizacao("", "")).toBe(false);
  });
});

// 🔴 O CASO QUE FAZIA A TAREFA DESAPARECER (revisão de 27/08).
//
// 25 = "PROFISSÃO NÃO DECLARADA" é o DEFAULT da FK do C2X e já é o valor de 803 pessoas da base.
// Ele volta da leitura ao vivo por cima do que veio do cadastro: se "tem id" bastasse para dizer
// "alguém padronizou", a pendência sumiria sozinha exatamente no caso mais comum — e some de vez
// depois que a CAD sobe sem padronização, porque o envio só faz POST.
describe("o 25 do C2X é o VAZIO dele, não uma padronização", () => {
  const NAO_DECLARADA = C2X_PROFISSOES.find((o) => o.id === 25);

  it("o id 25 é mesmo PROFISSÃO NÃO DECLARADA no catálogo", () => {
    expect(NAO_DECLARADA?.label).toBe("PROFISSÃO NÃO DECLARADA");
    expect(ehProfissaoNaoDeclarada("25")).toBe(true);
    expect(ehProfissaoNaoDeclarada(25)).toBe(true);
    expect(ehProfissaoNaoDeclarada(String(ADVOGADO!.id))).toBe(false);
    expect(ehProfissaoNaoDeclarada("")).toBe(false);
  });

  it("com texto declarado, o 25 continua PENDENTE", () => {
    expect(profissaoPendenteDePadronizacao("25", "piloto de drone agrícola")).toBe(true);
    expect(profissaoPendenteDePadronizacao(25, "piloto de drone agrícola")).toBe(true);
  });

  it("a tela mostra o que o cliente declarou, não o rótulo do vazio do C2X", () => {
    const exibido = profissaoExibida("25", "piloto de drone agrícola");
    expect(exibido).toBe(`Piloto De Drone Agrícola ${MARCA_A_PADRONIZAR}`);
    expect(exibido).not.toContain("Não Declarada");
  });

  it("e o texto NÃO vira nota de rodapé: ele é o valor principal", () => {
    expect(profissaoDeclarada("25", "piloto de drone agrícola")).toBe("");
  });

  it("sem texto declarado, nada muda: o 25 é exibido como qualquer rótulo", () => {
    expect(profissaoExibida("25", "")).toBe("Profissão Não Declarada");
    expect(profissaoPendenteDePadronizacao("25", "")).toBe(false);
  });

  it("⚠️ o envio ao C2X NÃO muda: mandar o rótulo do 25 é o que o legado faria sozinho", () => {
    expect(profissaoParaC2x("25")).toBe("PROFISSÃO NÃO DECLARADA");
  });
});

describe("o que o WIZARD aceita para avançar", () => {
  it("lista ou texto digitado servem; nenhuma trava", () => {
    expect(temProfissao(String(ADVOGADO!.id), "")).toBe(true);
    expect(temProfissao("", "piloto de drone agrícola")).toBe(true);
    expect(temProfissao(String(ADVOGADO!.id), "piloto de drone")).toBe(true);
    expect(temProfissao("", "")).toBe(false);
    expect(temProfissao("", "   ")).toBe(false);
  });
});

describe("⚠️ o que vai para o C2X — texto livre JAMAIS", () => {
  it("só lista: o rótulo exato do catálogo (é o que o Rails resolve de volta para a FK)", () => {
    expect(profissaoParaC2x(String(ADVOGADO!.id))).toBe("ADVOGADO(A)");
  });

  it("só livre: NULL. O C2X aplica o default dele (25 = PROFISSÃO NÃO DECLARADA)", () => {
    expect(profissaoParaC2x("")).toBeNull();
  });

  it("ambas: vai o rótulo do id, nunca o texto digitado", () => {
    const enviado = profissaoParaC2x(String(ADVOGADO!.id));
    expect(enviado).toBe("ADVOGADO(A)");
    expect(enviado).not.toContain("trabalhista");
  });

  it("nenhuma: NULL — idêntico ao comportamento de hoje para profissão vazia", () => {
    expect(profissaoParaC2x("")).toBeNull();
    expect(profissaoParaC2x(null)).toBeNull();
    expect(profissaoParaC2x(undefined)).toBeNull();
  });

  it("nada que o C2X receba carrega a marca de pendência", () => {
    for (const id of ["", String(ADVOGADO!.id), "999999", null]) {
      expect(profissaoParaC2x(id) ?? "").not.toContain(MARCA_A_PADRONIZAR);
    }
  });

  it("id inexistente não vira rótulo inventado (melhor ausente do que errado)", () => {
    expect(profissaoParaC2x("999999")).toBeNull();
  });

  it("todo rótulo devolvido existe no catálogo — é a garantia da FK", () => {
    const rotulos = new Set(C2X_PROFISSOES.map((o) => o.label));
    for (const opcao of C2X_PROFISSOES) {
      expect(rotulos.has(profissaoParaC2x(String(opcao.id))!)).toBe(true);
    }
  });
});
