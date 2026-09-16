import { afterEach, describe, expect, it, vi } from "vitest";

import type { AtorDoHub, AtorDoPortal } from "./ator";
import {
  COLUNAS_DA_0173,
  ehColunaDeAutoriaAusente,
  gravarComAutoria,
  nomeComOrigem,
  registrarAtoDoPortal,
} from "./autoria-dos-modelos";

// A AUTORIA DOS MODELOS — o nome com a porta, e a 0173 como enriquecimento (nunca como trava).
//
// O que está travado aqui:
//   · o hub grava o nome como sempre, sem sufixo;
//   · o portal grava "(portal do incorporador)" junto, e sem nome grava só a origem (não inventa
//     pessoa);
//   · "coluna ausente" só vale pelo NOME da coluna da 0173 na mensagem;
//   · sem a 0173, a gravação é refeita sem as colunas; com outro erro, NÃO é refeita.

const HUB: AtorDoHub = { nome: "Jurídico Careli", papel: "escrita", tipo: "hub", userId: "user-1" };
const PORTAL: AtorDoPortal = {
  enterpriseIds: ["37"],
  incorporadorId: "0f6d2c1e-3b4a-4c5d-8e9f-a1b2c3d4e5f6",
  nome: "Maria do Jurídico",
  slug: "cecilio-rocha",
  tipo: "portal",
  usuarioId: "usuario-portal-1",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("nomeComOrigem", () => {
  it("hub: o nome que o chamador resolveu, sem sufixo", () => {
    expect(nomeComOrigem(HUB, "juridico@careli.adm.br")).toBe("juridico@careli.adm.br");
    expect(nomeComOrigem(HUB, null)).toBe(null);
  });

  it("hub sem nome resolvido: o nome do ator, e nulo quando não há (nunca 'Sistema')", () => {
    expect(nomeComOrigem(HUB)).toBe("Jurídico Careli");
    expect(nomeComOrigem({ ...HUB, nome: "  " })).toBe(null);
  });

  it("portal: o nome da sessão com a porta junto, ignorando qualquer nome do hub", () => {
    expect(nomeComOrigem(PORTAL)).toBe("Maria do Jurídico (portal do incorporador)");
    expect(nomeComOrigem(PORTAL, "alguém do hub")).toBe("Maria do Jurídico (portal do incorporador)");
  });

  it("portal sem nome: só a origem", () => {
    expect(nomeComOrigem({ ...PORTAL, nome: "" })).toBe("Portal do incorporador");
  });
});

describe("ehColunaDeAutoriaAusente", () => {
  const colunas = COLUNAS_DA_0173.temis_minutas;

  it("PGRST204 e 42703 citando a coluna da 0173", () => {
    expect(
      ehColunaDeAutoriaAusente(
        { code: "PGRST204", message: "Could not find the 'publicada_por_nome' column" },
        colunas,
      ),
    ).toBe(true);
    expect(
      ehColunaDeAutoriaAusente({ code: "42703", message: 'column "arquivada_por_nome" does not exist' }, colunas),
    ).toBe(true);
  });

  it("o mesmo código citando OUTRA coluna não é a 0173", () => {
    expect(
      ehColunaDeAutoriaAusente({ code: "PGRST204", message: "Could not find the 'conteudo_htm' column" }, colunas),
    ).toBe(false);
  });

  it("outro código, erro vazio ou torto: não", () => {
    expect(ehColunaDeAutoriaAusente({ code: "23505", message: "publicada_por_nome" }, colunas)).toBe(false);
    expect(ehColunaDeAutoriaAusente(null, colunas)).toBe(false);
    expect(ehColunaDeAutoriaAusente("PGRST204", colunas)).toBe(false);
  });
});

describe("gravarComAutoria", () => {
  it("sem erro: uma gravação só, com as colunas", async () => {
    const gravar = vi.fn(async (comAutoria: boolean) => ({ comAutoria, error: null }));
    const r = await gravarComAutoria(COLUNAS_DA_0173.temis_minutas, gravar);
    expect(gravar).toHaveBeenCalledTimes(1);
    expect(r.comAutoria).toBe(true);
  });

  it("0173 pendente: grava de novo SEM as colunas e devolve a segunda resposta", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const gravar = vi.fn(async (comAutoria: boolean) =>
      comAutoria
        ? { comAutoria, error: { code: "PGRST204", message: "Could not find the 'desativado_por_nome' column" } }
        : { comAutoria, error: null },
    );
    const r = await gravarComAutoria(COLUNAS_DA_0173.temis_anexos, gravar);
    expect(gravar.mock.calls.map((c) => c[0])).toEqual([true, false]);
    expect(r).toEqual({ comAutoria: false, error: null });
  });

  it("outro erro (a trava da posição, por exemplo) volta como veio, sem segunda tentativa", async () => {
    const gravar = vi.fn(async () => ({ error: { code: "23505", message: "duplicate key" } }));
    const r = await gravarComAutoria(COLUNAS_DA_0173.temis_assinantes, gravar);
    expect(gravar).toHaveBeenCalledTimes(1);
    expect(r.error).toEqual({ code: "23505", message: "duplicate key" });
  });
});

describe("registrarAtoDoPortal", () => {
  it("o hub não deixa nada novo no log", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    registrarAtoDoPortal(HUB, "minuta publicada", { minutaId: "m" });
    expect(log).not.toHaveBeenCalled();
  });

  it("o portal deixa o ato com incorporador, usuário e origem", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    registrarAtoDoPortal(PORTAL, "minuta publicada", { minutaId: "m" });
    expect(log).toHaveBeenCalledWith("[temis][portal] minuta publicada", {
      incorporadorId: PORTAL.incorporadorId,
      minutaId: "m",
      origem: "portal",
      slug: "cecilio-rocha",
      usuarioId: "usuario-portal-1",
    });
  });
});
