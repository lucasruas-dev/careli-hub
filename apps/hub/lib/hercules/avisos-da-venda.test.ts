import { beforeEach, describe, expect, it, vi } from "vitest";

// OS AVISOS DA VENDA DO PORTAL QUE OPERA SOZINHO.
//
// Decisão do Lucas (16/09/2026): reserva, proposta e cancelamento feitos pelo portal que confecciona
// (hoje o `cecilio-rocha`) não avisam NINGUÉM por WhatsApp por enquanto, e o histórico registra que
// o aviso não saiu por decisão. As vendas da Gurgel (comercial) continuam avisando como antes.
//
// O gateway é trocado por um espião: o que se prova aqui é que o caminho do "não enviado" NUNCA
// chama o envio, e que ele deixa uma linha por destinatário em `apolo_disparos`.

const estado = vi.hoisted(() => ({
  enviados: 0,
  inserido: [] as Array<{ linhas: unknown; tabela: string }>,
}));

vi.mock("@/lib/apolo/disparo-credenciamento", () => ({
  coordenadoresDosEmpreendimentos: async () => [],
  enviarPeloRelacionamento: async () => {
    estado.enviados += 1;
    return { ok: true, para: "5562999990000" };
  },
}));

vi.mock("@/lib/apolo/empreendimentos", () => ({
  loadApoloEnterpriseCadastro: async () => [],
}));

vi.mock("./quem-pode-vender", () => ({
  coordenadoresDoPanteon: async () => [],
}));

import {
  AVISO_NAO_ENVIADO_POR_DECISAO,
  avisarSobreAVenda,
  type DestinatariosDaVenda,
  registrarAvisoNaoEnviado,
  vendaAvisaPeloWhatsapp,
} from "./avisos-da-venda";
import { comoFoiOAviso, MOTIVO_DO_AVISO_DESLIGADO } from "./reserva";

const DESTINATARIOS: DestinatariosDaVenda = {
  coordenadores: [{ nome: "Nivea", telefone: "62999990000" }],
  corretor: { nome: "João Souza", telefone: "62988887777" },
  imobiliaria: { nome: "Cecílio Rocha", telefone: "6232220000" },
};

function clienteFalso() {
  return {
    from: (tabela: string) => ({
      insert: async (linhas: unknown) => {
        estado.inserido.push({ linhas, tabela });
        return { data: null, error: null };
      },
    }),
  } as unknown as Parameters<typeof registrarAvisoNaoEnviado>[0];
}

beforeEach(() => {
  estado.enviados = 0;
  estado.inserido = [];
});

describe("vendaAvisaPeloWhatsapp", () => {
  it("⚠️ o portal do Cecílio não avisa ninguém", () => {
    expect(vendaAvisaPeloWhatsapp({ slug: "cecilio-rocha", tipo: "incorporador" })).toBe(false);
    expect(vendaAvisaPeloWhatsapp({ slug: " Cecilio-Rocha ", tipo: "incorporador" })).toBe(false);
  });

  it("a Gurgel (comercial) continua avisando, e o comercial nunca é o portal que confecciona", () => {
    expect(vendaAvisaPeloWhatsapp({ slug: "gurgel", tipo: "comercial" })).toBe(true);
    // Mesmo com o slug do Cecílio, o tipo comercial manda: é a régua de `portalConfeccionaContrato`.
    expect(vendaAvisaPeloWhatsapp({ slug: "cecilio-rocha", tipo: "comercial" })).toBe(true);
  });

  it("o padrão (sem sessão reconhecida) avisa como sempre avisou", () => {
    expect(vendaAvisaPeloWhatsapp({ slug: null, tipo: null })).toBe(true);
    expect(vendaAvisaPeloWhatsapp({ slug: "vistaalegre", tipo: "incorporador" })).toBe(true);
  });
});

describe("registrarAvisoNaoEnviado", () => {
  it("⚠️ grava uma linha 'nao_enviado' por destinatário e NÃO chama o envio", async () => {
    const resultados = await registrarAvisoNaoEnviado(clienteFalso(), {
      corretorId: "cor-1",
      destinatarios: DESTINATARIOS,
      imobiliariaId: "imo-1",
      origem: "reserva:whatsapp",
      tipo: "hercules_reserva",
    });

    expect(estado.enviados).toBe(0);
    expect(estado.inserido).toHaveLength(1);
    expect(estado.inserido[0]?.tabela).toBe("apolo_disparos");

    const linhas = estado.inserido[0]?.linhas as Array<Record<string, unknown>>;
    expect(linhas.map((l) => l.destinatario)).toEqual(["corretor", "imobiliaria", "coordenador"]);
    for (const linha of linhas) {
      expect(linha).toMatchObject({
        erro: AVISO_NAO_ENVIADO_POR_DECISAO,
        origem: "reserva:whatsapp",
        status: "nao_enviado",
        telefone: null,
        tipo: "hercules_reserva",
      });
    }
    // O registro do coordenador pendura na ficha da imobiliária, como no envio de verdade.
    expect(linhas[2]?.entity_id).toBe("imo-1");

    expect(resultados).toEqual([
      { motivo: MOTIVO_DO_AVISO_DESLIGADO, ok: false, para: "corretor" },
      { motivo: MOTIVO_DO_AVISO_DESLIGADO, ok: false, para: "imobiliaria" },
      { motivo: MOTIVO_DO_AVISO_DESLIGADO, ok: false, para: "coordenador" },
    ]);
    expect(comoFoiOAviso(resultados)).toContain("avisos estão desligados");
  });

  it("sem corretor, não inventa a linha dele", async () => {
    await registrarAvisoNaoEnviado(clienteFalso(), {
      corretorId: null,
      destinatarios: { ...DESTINATARIOS, corretor: null },
      imobiliariaId: "imo-1",
      origem: "proposta:cancelamento",
      tipo: "hercules_proposta",
    });
    const linhas = estado.inserido[0]?.linhas as Array<Record<string, unknown>>;
    expect(linhas.map((l) => l.destinatario)).toEqual(["imobiliaria", "coordenador"]);
  });

  it("falha ao gravar o registro não lança: a venda já está gravada", async () => {
    const quebrado = {
      from: () => ({
        insert: async () => {
          throw new Error("banco fora");
        },
      }),
    } as unknown as Parameters<typeof registrarAvisoNaoEnviado>[0];
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const resultados = await registrarAvisoNaoEnviado(quebrado, {
      corretorId: null,
      destinatarios: { ...DESTINATARIOS, corretor: null },
      imobiliariaId: "imo-1",
      origem: "reserva:whatsapp",
      tipo: "hercules_reserva",
    });

    expect(resultados).toHaveLength(2);
    expect(estado.enviados).toBe(0);
    erro.mockRestore();
  });
});

describe("avisarSobreAVenda (a Gurgel)", () => {
  it("continua chamando o envio para os mesmos destinatários", async () => {
    const resultados = await avisarSobreAVenda(clienteFalso(), {
      corretorId: "cor-1",
      destinatarios: DESTINATARIOS,
      imobiliariaId: "imo-1",
      origem: "reserva:whatsapp",
      textos: [
        { papel: "corretor", texto: "a" },
        { papel: "imobiliaria", texto: "b" },
        { papel: "coordenador", texto: "c" },
      ],
      tipo: "hercules_reserva",
    });
    expect(estado.enviados).toBe(3);
    expect(resultados.map((r) => r.para)).toEqual(["corretor", "imobiliaria", "coordenador"]);
  });
});
