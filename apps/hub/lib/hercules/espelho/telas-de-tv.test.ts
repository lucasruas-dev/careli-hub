import { describe, expect, it } from "vitest";

import type { EstadoDoEspelho, LoteDoEspelho } from "./estado-do-espelho";
import { codigoDaTelaDeTv, estadoParaTv, telaDeTv, TELAS_DE_TV } from "./telas-de-tv";

// A TELA DE TV — o que a lista curta autoriza, e o que sai pelo fio.
//
// Os dois assuntos deste arquivo são os dois riscos da tela: um link sem selo que vire catálogo
// da casa, e um payload público que carregue mais do que duas cores.

/** Um lote como `estadoDoEspelho` o devolve: com preço, área e rótulo dentro. */
function loteCheio(over: Partial<LoteDoEspelho> = {}): LoteDoEspelho {
  return {
    andar: null,
    apartamento: null,
    area: 360.5,
    codigo: "GDN0101",
    grupo: "01",
    lote: "01",
    numero: "01",
    preco: 189_900,
    quadra: "01",
    rotulo: "Quadra 01 · Lote 01",
    situacao: "disponivel",
    tipologia: null,
    tipoProduto: "loteamento",
    torre: null,
    vagas: null,
    ...over,
  };
}

describe("a lista curta das telas de TV", () => {
  it("resolve o slug do Garden no código do empreendimento", () => {
    expect(codigoDaTelaDeTv("garden")).toBe("GDN");
    expect(telaDeTv("garden")?.codigo).toBe("GDN");
  });

  // ⚠️ ESTE É O TESTE QUE SUBSTITUI O SELO. O espelho público protege `/e/<apelido>` com 8
  // caracteres de assinatura justamente para ninguém varrer nomes e montar o catálogo da casa. A
  // TV não tem selo (ver o cabeçalho de telas-de-tv.ts), então o que impede a varredura é a lista
  // ser escrita à mão: qualquer slug fora dela responde 404, INCLUSIVE o de um empreendimento que
  // existe de verdade no cadastro.
  it.each(["vale-do-ouro", "veredas-do-ouro", "lagoa-bonita", "villa-paris", "gdn", ""])(
    "não resolve %s — a rota não consulta o cadastro",
    (slug) => {
      expect(codigoDaTelaDeTv(slug)).toBeNull();
      expect(telaDeTv(slug)).toBeNull();
    },
  );

  it("não resolve slug nulo nem indefinido", () => {
    expect(codigoDaTelaDeTv(null)).toBeNull();
    expect(codigoDaTelaDeTv(undefined)).toBeNull();
  });

  // ⚠️ O TECLADO DA TV COMEÇA MAIÚSCULO. Quem digita "Garden" no controle remoto não está errado,
  // e uma tela em branco por causa disso manda alguém ligar para o suporte no meio do stand.
  it.each(["Garden", "GARDEN", " garden ", "/garden"])("aceita %s", (digitado) => {
    expect(codigoDaTelaDeTv(digitado)).toBe("GDN");
  });

  it("cada tela traz as marcas que a moldura desenha", () => {
    for (const tela of TELAS_DE_TV) {
      expect(tela.slug).toMatch(/^[a-z0-9-]+$/);
      expect(tela.codigo).toMatch(/^[A-Z0-9]+$/);
      expect(tela.marcas.empreendimento.src).toMatch(/^\//);
      expect(tela.marcas.empreendimento.alt.length).toBeGreaterThan(0);
    }
  });

  it("nenhum slug repetido: duas telas no mesmo endereço seria sorteio", () => {
    const slugs = TELAS_DE_TV.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("o que a TV recebe pelo fio", () => {
  const estado: EstadoDoEspelho = {
    atualizadoEm: "2026-09-22T12:00:00.000Z",
    contagem: { disponivel: 1, indisponivel: 1 },
    lotes: [
      loteCheio(),
      loteCheio({
        codigo: "GDN0102",
        lote: "02",
        preco: 210_000,
        rotulo: "Quadra 01 · Lote 02",
        situacao: "indisponivel",
      }),
    ],
  };

  it("leva o código e a cor de cada lote", () => {
    expect(estadoParaTv(estado).lotes).toEqual([
      { codigo: "GDN0101", situacao: "disponivel" },
      { codigo: "GDN0102", situacao: "indisponivel" },
    ]);
  });

  // ⚠️ O TESTE QUE SEGURA A TELA. Lucas (22/09/2026): *"não teria os dados de disponivel, nem a
  // parte de unidades"*. O link da TV é público e sem selo — 20 caracteres que qualquer um digita
  // —, então o que trafega nele é o que qualquer um lê. `estadoParaTv` monta um objeto NOVO com
  // dois campos nomeados; trocar isso por um espalhamento (`{ ...lote }`) publicaria preço de
  // tabela, área e rótulo de 404 lotes sem ninguém perceber, que é exatamente a lição do Garden
  // (uma página interna sem senha mostrando nome e preço juntos).
  it("não leva preço, área, rótulo, quadra nem contagem", () => {
    const pelaRede = JSON.stringify(estadoParaTv(estado));

    expect(pelaRede).not.toContain("preco");
    expect(pelaRede).not.toContain("189900");
    expect(pelaRede).not.toContain("210000");
    expect(pelaRede).not.toContain("area");
    expect(pelaRede).not.toContain("360.5");
    expect(pelaRede).not.toContain("rotulo");
    expect(pelaRede).not.toContain("Quadra 01");
    expect(pelaRede).not.toContain("quadra");
    expect(pelaRede).not.toContain("contagem");
    expect(pelaRede).not.toContain("tipologia");
  });

  it("cada lote tem exatamente dois campos", () => {
    for (const lote of estadoParaTv(estado).lotes) {
      expect(Object.keys(lote).sort()).toEqual(["codigo", "situacao"]);
    }
  });

  it("carrega a hora da leitura — é como se percebe um mapa congelado na parede", () => {
    expect(estadoParaTv(estado).atualizadoEm).toBe("2026-09-22T12:00:00.000Z");
  });

  it("cadastro vazio devolve lista vazia, e não quebra", () => {
    expect(
      estadoParaTv({ atualizadoEm: "x", contagem: { disponivel: 0, indisponivel: 0 }, lotes: [] })
        .lotes,
    ).toEqual([]);
  });
});
