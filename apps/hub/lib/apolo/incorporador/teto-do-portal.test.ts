import { beforeEach, describe, expect, it, vi } from "vitest";

// O TETO DAS TORNEIRAS PAGAS NO PORTAL: por conta E pelo portal inteiro (revisão do conjunto,
// 16/09/2026). Antes era só por conta, e dez contas somavam dez tetos.

const m = vi.hoisted(() => ({ consumir: vi.fn() }));
vi.mock("@/lib/publico/cad/rate-limit", () => ({ consumir: m.consumir }));

import {
  cabeNoTetoDoPortal,
  chaveDoPortal,
  chaveDoUsuarioDoPortal,
  PESSOAS_CHEIAS_POR_PORTAL,
} from "./teto-do-portal";

const ATOR = { incorporadorId: "inc-cecilio", usuarioId: "u-1" };
const CLIENTE = {} as Parameters<typeof cabeNoTetoDoPortal>[0];

beforeEach(() => {
  m.consumir.mockReset();
});

describe("cabeNoTetoDoPortal", () => {
  it("conta a conta e depois o portal, com o teto do portal maior", async () => {
    m.consumir.mockResolvedValue({ esperaMs: 0, permitido: true, teto: 400 });
    expect(await cabeNoTetoDoPortal(CLIENTE, ATOR, "leitura-de-documento")).toBe(true);
    expect(m.consumir).toHaveBeenNthCalledWith(1, CLIENTE, "ocr", chaveDoUsuarioDoPortal(ATOR));
    expect(m.consumir).toHaveBeenNthCalledWith(2, CLIENTE, "ocr", chaveDoPortal(ATOR), {
      teto: 400 * PESSOAS_CHEIAS_POR_PORTAL,
    });
  });

  it("conta no teto: recusa sem gastar o contador do portal", async () => {
    m.consumir.mockResolvedValue({ esperaMs: 0, permitido: false, teto: 60 });
    expect(await cabeNoTetoDoPortal(CLIENTE, ATOR, "consulta-paga")).toBe(false);
    expect(m.consumir).toHaveBeenCalledTimes(1);
  });

  it("portal no teto: recusa mesmo com a conta folgada", async () => {
    m.consumir
      .mockResolvedValueOnce({ esperaMs: 0, permitido: true, teto: 60 })
      .mockResolvedValueOnce({ esperaMs: 0, permitido: false, teto: 180 });
    expect(await cabeNoTetoDoPortal(CLIENTE, ATOR, "consulta-paga")).toBe(false);
  });

  it("a chave do portal nunca coincide com a de uma conta", () => {
    expect(chaveDoPortal(ATOR)).not.toBe(chaveDoUsuarioDoPortal(ATOR));
  });
});
