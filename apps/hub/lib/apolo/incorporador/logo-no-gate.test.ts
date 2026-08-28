import { describe, expect, it } from "vitest";

// O GATE DE AUTENTICAÇÃO DA ROTA DA LOGO.
//
// A porta de login do incorporador mostra a marca do cliente ANTES de existir cookie. O
// `guardApi` do proxy.ts exige Bearer em todo /api/*, então sem um alívio o <img> da logo leva
// 401 e a porta abre com o quadrado quebrado — foi o que a revisão pegou antes do deploy.
//
// ⚠️ O alívio é por FORMATO EXATO, nunca por prefixo: "/api/incorporador" na lista de prefixos
// públicos abriria carteira, contrato e vendas do dono do loteamento para o mundo. Este teste
// guarda a fronteira: o que abre é só `/api/incorporador/<slug>/logo`.
//
// A expressão é a MESMA de `apps/hub/proxy.ts` — copiada de propósito, porque o middleware roda
// noutro runtime e não dá para importar de lá sem arrastar o arquivo inteiro para o teste.
const LIBERA_LOGO = /^\/api\/incorporador\/[a-z0-9-]{1,60}\/logo$/;

const passa = (caminho: string) => LIBERA_LOGO.test(caminho);

describe("o que a rota pública da logo libera", () => {
  it("libera a logo de um portal", () => {
    expect(passa("/api/incorporador/mmendes/logo")).toBe(true);
    expect(passa("/api/incorporador/cecilio-rocha/logo")).toBe(true);
  });

  it("a variante vai na query, não no caminho — e não muda a decisão", () => {
    // O middleware casa contra o pathname puro; ?variante=escura não entra aqui.
    expect(passa("/api/incorporador/mmendes/logo")).toBe(true);
  });
});

describe("o que continua exigindo sessão", () => {
  it("carteira, contrato, vendas e produtos do incorporador", () => {
    expect(passa("/api/incorporador/mmendes/carteira")).toBe(false);
    expect(passa("/api/incorporador/produtos")).toBe(false);
    expect(passa("/api/incorporador/crm/ficha")).toBe(false);
    expect(passa("/api/incorporador/parcelas")).toBe(false);
  });

  it("não vale como prefixo — nada depois de /logo passa", () => {
    expect(passa("/api/incorporador/mmendes/logo/../carteira")).toBe(false);
    expect(passa("/api/incorporador/mmendes/logo/qualquer-coisa")).toBe(false);
  });

  it("não vale para caminho fora do padrão de slug", () => {
    // Barra, ponto, %, maiúscula e vazio ficam de fora: o slug real é [a-z0-9-].
    expect(passa("/api/incorporador/a/b/logo")).toBe(false);
    expect(passa("/api/incorporador/../logo")).toBe(false);
    expect(passa("/api/incorporador/cec%/logo")).toBe(false);
    expect(passa("/api/incorporador/MMendes/logo")).toBe(false);
    expect(passa("/api/incorporador//logo")).toBe(false);
  });

  it("não abre rota de OUTRO módulo que termine em /logo", () => {
    expect(passa("/api/apolo/incorporadores/logo")).toBe(false);
    expect(passa("/api/apolo/entidades/9/logo")).toBe(false);
  });

  it("slug absurdamente longo não passa", () => {
    expect(passa(`/api/incorporador/${"a".repeat(61)}/logo`)).toBe(false);
  });
});
