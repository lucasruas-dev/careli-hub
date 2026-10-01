import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "@/proxy";

// O PORTÃO DO HUB PARA O LINK DO CORRETOR AUTÔNOMO (01/10/2026).
//
// O link precisa abrir sem login, e por isso `/api/publico/autonomo` entrou na lista de prefixos
// públicos do proxy.ts. O que este teste guarda é a FRONTEIRA: só esse prefixo abre, e a fila e as
// decisões do time (que moram em /api/apolo/corretores-autonomos) continuam exigindo sessão. Um prefixo
// mal escrito ("/api/publico/auto", sem barra no fim) abriria rotas que ninguém pensou em abrir.
//
// Importa o proxy de verdade, e não uma cópia da regra: a lista é a de produção.

function passa(caminho: string, headers: Record<string, string> = {}): boolean {
  const resposta = proxy(new NextRequest(`https://c2x.app.br${caminho}`, { headers, method: "POST" }));
  return resposta.status !== 401;
}

describe("o que o link do autônomo libera sem login", () => {
  it("as duas rotas do link", () => {
    expect(passa("/api/publico/autonomo/iniciar")).toBe(true);
    expect(passa("/api/publico/autonomo/cadastro")).toBe(true);
  });
});

describe("o que continua exigindo sessão", () => {
  it("a fila, as decisões e a habilitação do time", () => {
    expect(passa("/api/apolo/corretores-autonomos/fila")).toBe(false);
    expect(passa("/api/apolo/corretores-autonomos/abc/decisao")).toBe(false);
    expect(passa("/api/apolo/corretores-autonomos/abc/habilitar")).toBe(false);
    expect(passa("/api/apolo/corretores-autonomos")).toBe(false);
  });

  it("caminho que só COMEÇA parecido não vale como prefixo", () => {
    expect(passa("/api/publico/autonomos")).toBe(false);
    expect(passa("/api/publico/autonomo-admin/fila")).toBe(false);
    expect(passa("/api/publico/auto")).toBe(false);
  });

  it("com Bearer, a rota interna segue para a validação de dentro (o proxy só é a rede)", () => {
    expect(passa("/api/apolo/corretores-autonomos/fila", { authorization: "Bearer x" })).toBe(true);
  });
});
