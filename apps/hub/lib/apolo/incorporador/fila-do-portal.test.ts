import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { FilaDoBoard, ItemDaFila } from "@/lib/apolo/board-do-servidor";

import {
  filaDoBoardParaPortal,
  filaSemCreditoParaPortal,
  itemSemCreditoParaPortal,
  portalVeCreditoNaFila,
} from "./fila-do-portal";

// A FILA DO BOARD PELO PORTAL DE INCORPORADOR (revisão de 16/09/2026): o motivo da reprovação no
// Serasa e a etapa `revisao` não saem para o time do Cecílio; a pendência de cadastro, sim.

const HUB = join(__dirname, "..", "..", "..");

const item = (over: Partial<ItemDaFila>): ItemDaFila => ({
  analistaId: null,
  c2xErro: null,
  c2xFalha: null,
  corretor: null,
  corretores: 0,
  criadoEm: "2026-09-16T10:00:00Z",
  documento: "529.982.247-25",
  empreendimentos: ["Garden"],
  enterpriseId: "39",
  entidadeStatus: null,
  erroEnvio: false,
  etapa: "validacao",
  id: "e1",
  imobiliaria: null,
  motivo: null,
  nome: "Fulano de Tal",
  pagoEm: null,
  papel: "prospect",
  papelStatus: null,
  prevendaHabilitada: false,
  semCad: false,
  socios: 0,
  ...over,
});

describe("itemSemCreditoParaPortal", () => {
  it("CAD reprovada no Serasa: revisão vira análise e o motivo de crédito não sai", () => {
    const saida = itemSemCreditoParaPortal(
      item({
        etapa: "revisao",
        motivo: "Crédito reprovado. Restrições de R$ 12.480,00 acima do limite de R$ 1.000,00.",
      }),
    );
    expect(saida.etapa).toBe("credito");
    expect(saida.motivo).toBeNull();
    expect(JSON.stringify(saida)).not.toMatch(/Crédito reprovado|Restrições|12\.480/);
  });

  it("indeferido continua indeferido (o processo acabou), sem o motivo", () => {
    const saida = itemSemCreditoParaPortal(item({ etapa: "indeferido", motivo: "Score baixo" }));
    expect(saida.etapa).toBe("indeferido");
    expect(saida.motivo).toBeNull();
  });

  it("motivo em crédito, pré-venda e credenciado não sai", () => {
    for (const etapa of ["credito", "prevenda", "credenciado"]) {
      expect(itemSemCreditoParaPortal(item({ etapa, motivo: "Análise de crédito desligada" })).motivo).toBeNull();
    }
  });

  it("pendência de correção de cadastro sai: é o que alguém precisa corrigir", () => {
    const saida = itemSemCreditoParaPortal(
      item({ etapa: "correcao", motivo: "Falta o comprovante de endereço" }),
    );
    expect(saida).toEqual(item({ etapa: "correcao", motivo: "Falta o comprovante de endereço" }));
  });

  it("imobiliária em correção (sem etapa) mantém o motivo", () => {
    expect(
      itemSemCreditoParaPortal(item({ etapa: null, motivo: "CRECI vencido", papel: "imobiliaria" })).motivo,
    ).toBe("CRECI vencido");
  });

  it("motivo que fala de crédito numa etapa de cadastro também não sai (a rede)", () => {
    expect(
      itemSemCreditoParaPortal(item({ etapa: "correcao", motivo: "Serasa com restrição" })).motivo,
    ).toBeNull();
  });

  it("não altera o item recebido", () => {
    const original = item({ etapa: "revisao", motivo: "Crédito reprovado." });
    itemSemCreditoParaPortal(original);
    expect(original.etapa).toBe("revisao");
    expect(original.motivo).toBe("Crédito reprovado.");
  });
});

describe("filaSemCreditoParaPortal", () => {
  it("passa em todos os itens e mantém o resto da fila", () => {
    const fila: FilaDoBoard = {
      analistas: [],
      empreendimentos: ["Garden"],
      itens: [item({ etapa: "revisao", id: "a", motivo: "Crédito reprovado." }), item({ id: "b" })],
      usuarioAtual: { id: "conta", nome: "Maria" },
    };
    const saida = filaSemCreditoParaPortal(fila);
    expect(saida.itens.map((i) => [i.id, i.etapa, i.motivo])).toEqual([
      ["a", "credito", null],
      ["b", "validacao", null],
    ]);
    expect(saida.usuarioAtual).toEqual(fila.usuarioAtual);
  });
});

// (16/09/2026, crédito no portal) QUEM VÊ O CRÉDITO NA FILA. Os três casos da decisão do Lucas: a
// Gurgel (comercial) continua vendo como sempre; o Cecílio (opera sozinho) passa a ver, porque faz o
// crédito dos clientes dele; o incorporador padrão continua sem saber do Serasa.
describe("filaDoBoardParaPortal: a régua por tipo de portal", () => {
  const reprovada = () =>
    item({
      etapa: "revisao",
      id: "rep",
      motivo: "Crédito reprovado. Restrições de R$ 12.480,00 acima do limite de R$ 1.000,00.",
    });
  const fila = (): FilaDoBoard => ({
    analistas: [],
    empreendimentos: ["Garden"],
    itens: [reprovada(), item({ etapa: "indeferido", id: "ind", motivo: "Score de crédito insuficiente" })],
    usuarioAtual: { id: "conta", nome: "Maria" },
  });

  it("comercial (Gurgel): a fila sai como veio, com revisão e motivo (onda 1, nada muda)", () => {
    const entrada = fila();
    const saida = filaDoBoardParaPortal(entrada, { slug: "gurgel", tipo: "comercial" });
    expect(saida).toBe(entrada);
    expect(saida.itens[0]).toMatchObject({ etapa: "revisao", motivo: expect.stringMatching(/Crédito reprovado/) });
  });

  it("portal que opera sozinho (cecilio-rocha): etapa e motivo reais do crédito ficam visíveis", () => {
    const saida = filaDoBoardParaPortal(fila(), { slug: "cecilio-rocha", tipo: "incorporador" });
    expect(saida.itens.map((i) => [i.id, i.etapa, i.motivo])).toEqual([
      ["rep", "revisao", "Crédito reprovado. Restrições de R$ 12.480,00 acima do limite de R$ 1.000,00."],
      ["ind", "indeferido", "Score de crédito insuficiente"],
    ]);
  });

  it("incorporador padrão (cer, vistaalegre): continua saneada", () => {
    for (const slug of ["cer", "vistaalegre"]) {
      const saida = filaDoBoardParaPortal(fila(), { slug, tipo: "incorporador" });
      expect(saida.itens.map((i) => [i.id, i.etapa, i.motivo])).toEqual([
        ["rep", "credito", null],
        ["ind", "indeferido", null],
      ]);
      expect(JSON.stringify(saida)).not.toMatch(/Crédito reprovado|Score|12\.480/);
    }
  });

  it("o slug do Cecílio com tipo comercial é comercial; sem slug nem tipo, fecha", () => {
    expect(portalVeCreditoNaFila({ slug: "cecilio-rocha", tipo: "comercial" })).toBe(true);
    expect(portalVeCreditoNaFila({})).toBe(false);
    expect(portalVeCreditoNaFila({ slug: " Cecilio-Rocha ", tipo: null })).toBe(true);
    expect(portalVeCreditoNaFila({ slug: "cecilio", tipo: "incorporador" })).toBe(false);
  });
});

describe("as amarras no servidor", () => {
  const ler = (caminho: string) => readFileSync(join(HUB, caminho), "utf8");

  it("a rota do board decide a fila pela sessão, num lugar só (filaDoBoardParaPortal)", () => {
    const rota = ler("app/api/incorporador/board/route.ts");
    expect(rota).toMatch(/filaDoBoardParaPortal\(fila\.data,\s*auth\.sessao\)/);
    // E a fila crua não sai por outro caminho: o que vai para `analistasParaPortal` é a da regra.
    expect(rota).toMatch(/analistasParaPortal\(filaDoPortal\)/);
    expect(rota).not.toMatch(/filaSemCreditoParaPortal\(/);
  });

  it("o recorte da fila só rotula o card com os produtos do recorte", () => {
    const servidor = ler("lib/apolo/board-do-servidor.ts");
    const recorte = servidor.slice(servidor.indexOf("if (opts.recorte) {"));
    expect(recorte).toMatch(/itens: itens\.filter\(noRecorte\)\.map\(soDoRecorte\)/);
  });
});
