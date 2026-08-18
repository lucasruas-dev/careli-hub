import { describe, expect, it } from "vitest";

import { comTemaClaro } from "@/lib/apolo/masterplan-tema-claro";

import {
  deveClarearMasterplan,
  escolhaInicialDoPortal,
  lerTemaEscolhido,
  resolverTemaEfetivo,
  SCRIPT_TEMA_ANTES_DA_PINTURA,
  scriptDeTemaAntesDaPintura,
} from "./tema-portal";

describe("o que a pessoa escolheu", () => {
  it("aceita os dois temas explícitos", () => {
    expect(lerTemaEscolhido("claro")).toBe("claro");
    expect(lerTemaEscolhido("escuro")).toBe("escuro");
  });

  it("qualquer outra coisa é 'sistema'", () => {
    // Storage de versão antiga, valor digitado na URL, extensão que suja o localStorage: nada
    // disso pode travar o portal num tema que ninguém pediu.
    expect(lerTemaEscolhido(null)).toBe("sistema");
    expect(lerTemaEscolhido(undefined)).toBe("sistema");
    expect(lerTemaEscolhido("")).toBe("sistema");
    expect(lerTemaEscolhido("   ")).toBe("sistema");
    expect(lerTemaEscolhido("dark")).toBe("sistema");
    expect(lerTemaEscolhido("sistema")).toBe("sistema");
  });

  it("não se importa com caixa nem com espaço em volta", () => {
    expect(lerTemaEscolhido(" Escuro ")).toBe("escuro");
    expect(lerTemaEscolhido("CLARO")).toBe("claro");
  });
});

describe("o tema que vale agora", () => {
  it("a escolha explícita vence o aparelho NOS DOIS SENTIDOS", () => {
    // O caso que o alternador existe para resolver: quem tem o sistema no escuro e quer o portal
    // claro (e vice-versa). Um dos dois sentidos funcionando é o mesmo que nenhum.
    expect(resolverTemaEfetivo("claro", true)).toBe("claro");
    expect(resolverTemaEfetivo("escuro", false)).toBe("escuro");
  });

  it("'sistema' segue o aparelho", () => {
    expect(resolverTemaEfetivo("sistema", true)).toBe("escuro");
    expect(resolverTemaEfetivo("sistema", false)).toBe("claro");
  });
});

describe("o masterplan servido pela rota", () => {
  it("só o escuro explícito dispensa o clareamento", () => {
    expect(deveClarearMasterplan("escuro")).toBe(false);
    expect(deveClarearMasterplan("claro")).toBe(true);
  });

  it("sem parâmetro continua clareando — o comportamento de hoje", () => {
    // Portal PERSONALIZADO (Cecílio), link salvo, aba antiga em cache: todos chegam sem `tema` e
    // têm que receber o mapa claro, exatamente como antes desta mudança.
    expect(deveClarearMasterplan(null)).toBe(true);
    expect(deveClarearMasterplan(undefined)).toBe(true);
    expect(deveClarearMasterplan("")).toBe(true);
    expect(deveClarearMasterplan("qualquer-coisa")).toBe(true);
  });

  it("não aplicar o tema claro entrega o arquivo escuro nativo", () => {
    // A prova de que "escuro" é não-fazer-nada: o A-INTERNO já nasce `data-uix-theme="dark"`, e é
    // o `comTemaClaro` que o vira. Sem ele, o mapa chega escuro no portal escuro.
    const arquivo = '<html data-uix-theme="dark"><head><style>:root{--canvas:#0a0a0a}</style></head><body></body></html>';

    expect(arquivo.includes('data-uix-theme="dark"')).toBe(true);
    expect(comTemaClaro(arquivo)).toContain('data-uix-theme="light"');
    expect(comTemaClaro(arquivo)).toContain("--canvas:#f7f8fa");
  });
});

describe("o padrão de quem nunca escolheu (Lucas, 18/08/2026)", () => {
  it("storage vazio abre no ESCURO, não no tema do aparelho", () => {
    expect(escolhaInicialDoPortal(null)).toBe("escuro");
    expect(escolhaInicialDoPortal(undefined)).toBe("escuro");
    expect(escolhaInicialDoPortal("")).toBe("escuro");
    expect(escolhaInicialDoPortal("lixo-de-outra-versao")).toBe("escuro");
  });

  it("mas 'seguir o aparelho' continua sendo uma escolha de verdade", () => {
    // A armadilha que esta separação evita: com storage vazio caindo em "sistema", clicar no
    // botão do aparelho ficava indistinguível de nunca ter clicado.
    expect(escolhaInicialDoPortal("sistema")).toBe("sistema");
    expect(resolverTemaEfetivo("sistema", false)).toBe("claro");
    expect(resolverTemaEfetivo("sistema", true)).toBe("escuro");
  });

  it("a escolha explícita continua mandando", () => {
    expect(escolhaInicialDoPortal("claro")).toBe("claro");
    expect(escolhaInicialDoPortal("escuro")).toBe("escuro");
  });

  it("⚠️ o MAPA não muda de comportamento: sem tema no pedido, ele segue clareado", () => {
    // `lerTemaEscolhido` (usada pela rota do masterplan) NÃO herda o padrão novo — se herdasse,
    // link antigo e portal personalizado passariam a receber o mapa escuro sem pedir.
    expect(deveClarearMasterplan(null)).toBe(true);
    expect(deveClarearMasterplan(undefined)).toBe(true);
    expect(deveClarearMasterplan("escuro")).toBe(false);
  });

  it("o script pré-pintura aplica o padrão quando não há nada salvo", () => {
    expect(SCRIPT_TEMA_ANTES_DA_PINTURA).toContain('"escuro"');
    expect(SCRIPT_TEMA_ANTES_DA_PINTURA).toContain("removeAttribute");
  });
});

describe("o Cecílio também escolhe (Lucas, 18/08/2026)", () => {
  it("no portal PERSONALIZADO quem nunca escolheu continua seguindo o aparelho", () => {
    // Ele ganhou o alternador, não um tema novo por baixo: o portal dele já está no ar e aprovado.
    expect(escolhaInicialDoPortal(null, true)).toBe("sistema");
    expect(escolhaInicialDoPortal("", true)).toBe("sistema");
  });

  it("mas a escolha dele vale igual à de todo mundo", () => {
    expect(escolhaInicialDoPortal("escuro", true)).toBe("escuro");
    expect(escolhaInicialDoPortal("claro", true)).toBe("claro");
  });

  it("o script do personalizado não crava tema: deixa a media query mandar", () => {
    const doPersonalizado = scriptDeTemaAntesDaPintura("sistema");
    expect(doPersonalizado).toContain("removeAttribute");
    expect(doPersonalizado).not.toContain('padrao="escuro"');

    // E o do padrão continua cravando o escuro para quem nunca escolheu.
    expect(scriptDeTemaAntesDaPintura()).toContain('"escuro"');
  });
});
