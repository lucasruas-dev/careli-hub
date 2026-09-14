import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ehRotaExterna,
  ehSalaPublicaDoChronos,
  ehSuperficieDoHub,
  raizDaRota,
  RAIZES_EXTERNAS,
  RAIZES_INTERNAS,
  RAIZES_SEM_LADO,
} from "./superficie";

describe("a raiz da rota", () => {
  it("pega a primeira parte do caminho", () => {
    expect(raizDaRota("/comercial/gurgel")).toBe("comercial");
    expect(raizDaRota("/e/vale-do-ouro-3f9c2a7b")).toBe("e");
    expect(raizDaRota("/apolo")).toBe("apolo");
  });

  it("devolve vazio na home e no que não existe", () => {
    expect(raizDaRota("/")).toBe("");
    expect(raizDaRota("")).toBe("");
    expect(raizDaRota(null)).toBe("");
  });
});

describe("o portal do coordenador", () => {
  // ⚠️ O DEFEITO DE 14/09/2026, VIRADO EM TESTE. Lucas: *"ao digitar a url da gurgel tem que cair
  // direto na tela de login do painel do coordenador e não no panteon"*. O portal comercial ganhou
  // endereço próprio em 02/09 e a lista do auth-provider só conhecia `/incorporador`.
  it("é porta de fora, e não superfície do hub", () => {
    expect(ehRotaExterna("/comercial/gurgel")).toBe(true);
    expect(ehSuperficieDoHub("/comercial/gurgel")).toBe(false);
  });

  it("vale para o slug que for", () => {
    expect(ehRotaExterna("/comercial/qualquer-um")).toBe(true);
    expect(ehRotaExterna("/comercial")).toBe(true);
  });
});

describe("as portas de fora", () => {
  it.each(["/incorporador/gurgel", "/e/villa-paris-rreaymrc", "/publico/cad", "/evento"])(
    "%s não recebe nada do hub",
    (caminho) => {
      expect(ehRotaExterna(caminho)).toBe(true);
      expect(ehSuperficieDoHub(caminho)).toBe(false);
    },
  );
});

describe("a sala pública do Chronos", () => {
  it("é externa: quem entra na reunião quase nunca é da casa", () => {
    expect(ehSalaPublicaDoChronos("/chronos/sala-abc")).toBe(true);
    expect(ehSuperficieDoHub("/chronos/sala-abc")).toBe(false);
    expect(ehSuperficieDoHub("/chronos/recording-view/123")).toBe(false);
  });

  it("mas a agenda do time continua sendo do hub", () => {
    expect(ehSalaPublicaDoChronos("/chronos")).toBe(false);
    expect(ehSuperficieDoHub("/chronos")).toBe(true);
  });
});

describe("o hub", () => {
  it.each(["/", "/apolo", "/iris", "/temis", "/m", "/zeus"])(
    "%s é superfície do hub",
    (caminho) => {
      expect(ehSuperficieDoHub(caminho)).toBe(true);
    },
  );
});

describe("a falha é fechada", () => {
  // ⚠️ ESTE É O TESTE QUE IMPORTA. Uma raiz que ninguém classificou NÃO pode ser tratada como hub:
  // se for, ela nasce com o banner de chamada e o canal de realtime — que é exatamente o
  // vazamento que o Lucas viu no portal da Gurgel.
  it("raiz desconhecida não é superfície do hub", () => {
    expect(ehSuperficieDoHub("/rota-que-ninguem-criou-ainda")).toBe(false);
    expect(ehSuperficieDoHub("/parceiro/acme")).toBe(false);
  });

  it("e também não é declarada externa por conta própria", () => {
    // Nem uma coisa nem outra: quem não foi classificado não ganha o hub NEM passa por porta de
    // fora conhecida. O silêncio não vira permissão de nenhum lado.
    expect(ehRotaExterna("/rota-que-ninguem-criou-ainda")).toBe(false);
  });

  it("login não é superfície do hub — é a porta dele", () => {
    expect(ehSuperficieDoHub("/login")).toBe(false);
  });
});

describe("as listas não se contradizem", () => {
  it("nenhuma raiz está dos dois lados", () => {
    const externas = new Set<string>(RAIZES_EXTERNAS);
    const repetidas = RAIZES_INTERNAS.filter((r) => externas.has(r));
    expect(repetidas).toEqual([]);
  });

  it("nenhuma raiz sem lado aparece nas outras duas", () => {
    const classificadas = new Set<string>([...RAIZES_EXTERNAS, ...RAIZES_INTERNAS]);
    expect(RAIZES_SEM_LADO.filter((r) => classificadas.has(r))).toEqual([]);
  });
});

// ⚠️ A TRAVA CONTRA A TERCEIRA VEZ. As duas listas acima são escritas à mão, e lista escrita à mão
// envelhece calada: foi assim que `/comercial` passou doze dias mandando o coordenador para o
// login do Panteon. Este teste LÊ O DISCO — se alguém criar um diretório de rota e não disser de
// que lado ele fica, a suíte fica vermelha antes do deploy, com o nome do diretório na mensagem.
describe("toda rota do app está classificada", () => {
  it("nenhum diretório de topo ficou sem lado", () => {
    const raizDoApp = join(__dirname, "..", "..", "app");
    const noDisco = readdirSync(raizDoApp, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      // `(grupo)` é route group do App Router: não vira caminho. `_algo` e `[slug]` também não
      // são raiz fixa.
      .map((e) => e.name)
      .filter((n) => !n.startsWith("(") && !n.startsWith("_") && !n.startsWith("["));

    const classificadas = new Set<string>([
      ...RAIZES_EXTERNAS,
      ...RAIZES_INTERNAS,
      ...RAIZES_SEM_LADO,
    ]);

    const semLado = noDisco.filter((n) => !classificadas.has(n));

    expect(
      semLado,
      `Rota(s) de topo sem lado em lib/rotas/superficie.ts: ${semLado.join(", ")}. ` +
        "Diga se é do HUB (RAIZES_INTERNAS) ou porta de fora (RAIZES_EXTERNAS). " +
        "Sem isso, ela nasce sem login do Panteon e sem os avisos do hub.",
    ).toEqual([]);
  });

  it("e nenhuma raiz da lista sumiu do disco", () => {
    const raizDoApp = join(__dirname, "..", "..", "app");
    const noDisco = new Set(
      readdirSync(raizDoApp, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name),
    );

    const fantasmas = [...RAIZES_EXTERNAS, ...RAIZES_INTERNAS, ...RAIZES_SEM_LADO].filter(
      (r) => !noDisco.has(r),
    );

    expect(fantasmas, `Raiz na lista que não existe mais em app/: ${fantasmas.join(", ")}`).toEqual(
      [],
    );
  });
});
