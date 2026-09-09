import { beforeEach, describe, expect, it, vi } from "vitest";

// O PORTÃO DA EMISSÃO DE CONTRATO — as listas de papel de verdade, sem mock de autorização.
//
// ⚠️ ESTE TESTE EXISTE PORQUE O PONTO É ÚNICO. `lib/temis/autorizacao.ts` é o lugar onde a etapa 2
// vai trocar o recorte por papel do Hub por "tem `temis:manage` ou é admin"; se o mapeamento de hoje
// não estiver preso aqui, a troca acontece sem ninguém perceber que o recorte mudou de tamanho.
//
// Só o cliente do Supabase é simulado: `authorizeApolo` roda inteiro, com as listas de
// `lib/apolo/auth.ts`.

const estado = vi.hoisted(() => ({ papel: "admin", status: "active" }));

vi.mock("@/lib/apolo/server", () => {
  const cliente = {
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
    },
    from: () => {
      const proprios: Record<string, unknown> = {
        maybeSingle: async () => ({
          data: { id: "user-1", role: estado.papel, status: estado.status },
          error: null,
        }),
      };
      // Qualquer filtro (`select`, `eq`…) só encadeia.
      const builder: Record<string, unknown> = new Proxy(proprios, {
        get: (alvo, prop) => (prop in alvo ? alvo[prop as string] : () => builder),
      });
      return builder;
    },
  };

  return {
    createApoloAdminClient: () => cliente,
    createApoloUserClient: () => cliente,
  };
});

import {
  autorizarEmissaoDeContrato,
  autorizarLeituraDeContrato,
} from "@/lib/temis/autorizacao";

function comSessao() {
  return new Request("https://x/api/temis/contrato/gerar", {
    headers: { authorization: "Bearer tok" },
  });
}

beforeEach(() => {
  estado.papel = "admin";
  estado.status = "active";
});

describe("emitir contrato é da coordenação", () => {
  // ⚠️ A REGRA DO LUCAS (08/09/2026): *"para o perfil da gurgel, comercial, pode tirar. Na Têmis só
  // quem tiver relacionado ao setor de contratos e os admin"*. Enquanto `hub_permissions` não tem
  // `temis` cadastrado nem uma concessão sequer, o recorte mais próximo é admin + leader.
  it("admin e leader passam", async () => {
    for (const papel of ["admin", "leader"]) {
      estado.papel = papel;
      expect((await autorizarEmissaoDeContrato(comSessao())).ok).toBe(true);
    }
  });

  it("operator e viewer levam 403", async () => {
    for (const papel of ["operator", "viewer"]) {
      estado.papel = papel;
      const r = await autorizarEmissaoDeContrato(comSessao());
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.response.status).toBe(403);
    }
  });

  it("sem Bearer é 401, antes de qualquer ida ao banco", async () => {
    const r = await autorizarEmissaoDeContrato(new Request("https://x/api/temis/contrato/gerar"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(401);
  });

  // ⚠️ ADMIN DESLIGADO NÃO EMITE. Quem sai da empresa continua com a linha em `hub_users`; o que
  // muda é o `status`, e é ele que precisa fechar a porta — não o papel.
  it("admin com status desligado não passa", async () => {
    estado.status = "disabled";
    const r = await autorizarEmissaoDeContrato(comSessao());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.response.status).toBe(403);
  });
});

describe("abrir o que já foi emitido continua na leitura", () => {
  // ⚠️ A ASSIMETRIA É A DECISÃO, não um esquecimento: ver o documento já emitido é conferência, e é
  // o que sustenta "Abrir o contrato guardado" no rodapé do portal depois que o botão de emitir saiu.
  it("viewer abre contrato guardado, mas não emite", async () => {
    estado.papel = "viewer";
    expect((await autorizarLeituraDeContrato(comSessao())).ok).toBe(true);
    expect((await autorizarEmissaoDeContrato(comSessao())).ok).toBe(false);
  });
});
