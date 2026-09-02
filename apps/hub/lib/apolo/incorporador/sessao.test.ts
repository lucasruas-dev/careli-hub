import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  criarSessaoIncorporador,
  empreendimentosPermitidos,
  INCORPORADOR_COOKIE,
  INCORPORADOR_TTL_MS,
  lerSessaoIncorporador,
  sessaoDoRequest,
  type SessaoIncorporador,
} from "./sessao";

// O QUE ESTE TESTE PROTEGE: a única coisa que separa a carteira de um incorporador da do outro.
// A regra do Lucas (10/08) é que o usuário só alcança "os dados dos empreendimentos que aquele
// incorporador tem com a gente", e quem materializa esse "só" é a lista assinada dentro do token
// mais o filtro de `empreendimentosPermitidos`. Um furo aqui não aparece na tela: o cliente vê
// número a mais e ninguém percebe.

const AGORA = 1_760_000_000_000;

const BASE: Omit<SessaoIncorporador, "exp"> = {
  enterpriseIds: ["39", "37"],
  enterpriseIdsComCarteira: ["37"],
  incorporadorId: "inc-1",
  incorporadorNome: "Cecílio Rocha",
  slug: "cecilio-rocha",
  tipo: "incorporador",
  usuarioId: "user-1",
  usuarioNome: "Nívea",
};

beforeEach(() => {
  process.env.SESSAO_INCORPORADOR_SECRET = "segredo-de-teste";
});

afterEach(() => {
  delete process.env.SESSAO_INCORPORADOR_SECRET;
});

describe("sessão do incorporador", () => {
  it("vai e volta preservando o escopo", () => {
    const token = criarSessaoIncorporador(BASE, AGORA);
    const sessao = lerSessaoIncorporador(token, AGORA);

    expect(sessao?.incorporadorId).toBe("inc-1");
    expect(sessao?.enterpriseIds).toEqual(["39", "37"]);
    expect(sessao?.enterpriseIdsComCarteira).toEqual(["37"]);
    expect(sessao?.exp).toBe(AGORA + INCORPORADOR_TTL_MS);
  });

  it("recusa token com a lista de empreendimentos adulterada", () => {
    // O ataque óbvio: o cliente decodifica o payload, acrescenta o empreendimento do vizinho e
    // reenvia. Sem o segredo, a assinatura não acompanha.
    const token = criarSessaoIncorporador(BASE, AGORA);
    const [corpo, assinatura] = token.split(".");
    const adulterado = JSON.parse(Buffer.from(corpo!, "base64url").toString("utf8"));
    adulterado.enterpriseIds = ["39", "37", "36"];
    const novoCorpo = Buffer.from(JSON.stringify(adulterado)).toString("base64url");

    expect(lerSessaoIncorporador(`${novoCorpo}.${assinatura}`, AGORA)).toBeNull();
  });

  it("recusa token assinado com outro segredo", () => {
    const token = criarSessaoIncorporador(BASE, AGORA);
    process.env.SESSAO_INCORPORADOR_SECRET = "outro-segredo";

    expect(lerSessaoIncorporador(token, AGORA)).toBeNull();
  });

  it("recusa token expirado", () => {
    const token = criarSessaoIncorporador(BASE, AGORA);

    expect(lerSessaoIncorporador(token, AGORA + INCORPORADOR_TTL_MS + 1)).toBeNull();
  });

  it("recusa lixo, vazio e token sem assinatura", () => {
    expect(lerSessaoIncorporador(null, AGORA)).toBeNull();
    expect(lerSessaoIncorporador("", AGORA)).toBeNull();
    expect(lerSessaoIncorporador("sem-ponto", AGORA)).toBeNull();
    expect(lerSessaoIncorporador(".assinatura", AGORA)).toBeNull();
  });

  it("recusa sessão sem nenhum empreendimento", () => {
    // Servir telas vazias deixaria a dúvida entre "não tem dado" e "não tem permissão".
    const token = criarSessaoIncorporador({ ...BASE, enterpriseIds: [] }, AGORA);

    expect(lerSessaoIncorporador(token, AGORA)).toBeNull();
  });

  it("não quebra quando o segredo some do ambiente", () => {
    const token = criarSessaoIncorporador(BASE, AGORA);
    delete process.env.SESSAO_INCORPORADOR_SECRET;

    // Sem sessão, não exceção: a página trata como visitante deslogado.
    expect(lerSessaoIncorporador(token, AGORA)).toBeNull();
  });

  it("lê o cookie no meio de outros cookies", () => {
    const token = criarSessaoIncorporador(BASE, AGORA);
    const request = new Request("https://c2x.app.br/incorporador/vendas", {
      headers: { cookie: `outro=1; ${INCORPORADOR_COOKIE}=${token}; mais=2` },
    });

    expect(sessaoDoRequest(request, AGORA)?.incorporadorId).toBe("inc-1");
  });

  it("sem cookie, sem sessão", () => {
    const request = new Request("https://c2x.app.br/incorporador/vendas");

    expect(sessaoDoRequest(request, AGORA)).toBeNull();
  });
});

describe("empreendimentosPermitidos", () => {
  const sessao = { ...BASE, exp: AGORA + INCORPORADOR_TTL_MS } as SessaoIncorporador;

  it("sem pedido, devolve tudo que a sessão autoriza", () => {
    expect(empreendimentosPermitidos(sessao)).toEqual(["39", "37"]);
    expect(empreendimentosPermitidos(sessao, null)).toEqual(["39", "37"]);
    expect(empreendimentosPermitidos(sessao, "")).toEqual(["39", "37"]);
  });

  it("com pedido válido, devolve só o pedido", () => {
    expect(empreendimentosPermitidos(sessao, "39")).toEqual(["39"]);
    expect(empreendimentosPermitidos(sessao, ["37", "39"])).toEqual(["37", "39"]);
  });

  it("empreendimento de fora da sessão SOME, não vaza", () => {
    // 36 é o VOL, a carteira do outro sócio. Pedir não dá erro nem retorna: desaparece.
    expect(empreendimentosPermitidos(sessao, "36")).toEqual([]);
    expect(empreendimentosPermitidos(sessao, "39,36")).toEqual(["39"]);
    expect(empreendimentosPermitidos(sessao, ["36", "35", "1"])).toEqual([]);
  });

  it("pedido sujo não derruba nem escapa", () => {
    expect(empreendimentosPermitidos(sessao, " 39 , ,37 ")).toEqual(["39", "37"]);
    expect(empreendimentosPermitidos(sessao, "39; drop table")).toEqual([]);
    expect(empreendimentosPermitidos(sessao, "*")).toEqual([]);
  });
});
