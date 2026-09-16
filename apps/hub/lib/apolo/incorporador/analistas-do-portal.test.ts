import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { FilaDoBoard, ItemDaFila } from "@/lib/apolo/board-do-servidor";

import { analistasParaPortal, ID_EQUIPE_CARELI } from "./analistas-do-portal";
import { EQUIPE_CARELI } from "./historico-do-portal";

// A FILA DO BOARD PELO PORTAL NÃO ENTREGA A EQUIPE DA CARELI (16/09/2026).

const HUB = join(__dirname, "..", "..", "..");

const item = (over: Partial<ItemDaFila>): ItemDaFila => ({
  analistaId: null,
  c2xErro: null,
  c2xFalha: null,
  corretor: null,
  corretores: 0,
  criadoEm: "2026-09-16T12:00:00Z",
  documento: "123.456.789-00",
  empreendimentos: ["VALE DO OURO"],
  enterpriseId: "37",
  entidadeStatus: null,
  erroEnvio: false,
  etapa: "validacao",
  id: "e1",
  imobiliaria: null,
  motivo: null,
  nome: "Fulano",
  pagoEm: null,
  papel: "prospect",
  papelStatus: null,
  prevendaHabilitada: false,
  semCad: false,
  socios: 0,
  ...over,
});

const fila = (over: Partial<FilaDoBoard>): FilaDoBoard => ({
  analistas: [
    { id: "hub-1", nome: "Ana da Careli" },
    { id: "hub-2", nome: "bruno@careli.adm.br" },
  ],
  empreendimentos: ["VALE DO OURO"],
  itens: [],
  usuarioAtual: { id: "conta-portal", nome: "Maria do Cecílio" },
  ...over,
});

describe("analistasParaPortal", () => {
  it("nenhum nome nem e-mail do hub sai, nem quando a fila chega com eles", () => {
    const saida = analistasParaPortal(
      fila({ itens: [item({ analistaId: "hub-1", id: "a" }), item({ analistaId: "hub-2", id: "b" })] }),
    );
    const texto = JSON.stringify(saida);
    expect(texto).not.toMatch(/Ana da Careli|bruno@careli|hub-1|hub-2/);
  });

  it("a lista tem a conta do portal e UMA entrada 'Equipe Careli' quando algum card é da Careli", () => {
    const saida = analistasParaPortal(
      fila({ itens: [item({ analistaId: "hub-1", id: "a" }), item({ analistaId: "hub-2", id: "b" })] }),
    );
    expect(saida.analistas).toEqual([
      { id: "conta-portal", nome: "Maria do Cecílio" },
      { id: ID_EQUIPE_CARELI, nome: EQUIPE_CARELI },
    ]);
    expect(saida.itens.map((card) => card.analistaId)).toEqual([ID_EQUIPE_CARELI, ID_EQUIPE_CARELI]);
  });

  it("sem card da Careli, só a conta do portal (o que a tela precisa para atribuir ao abrir)", () => {
    const saida = analistasParaPortal(fila({ itens: [item({ id: "a" })] }));
    expect(saida.analistas).toEqual([{ id: "conta-portal", nome: "Maria do Cecílio" }]);
    expect(saida.itens[0]?.analistaId).toBeNull();
  });

  it("card atribuído à própria conta do portal continua dela", () => {
    const saida = analistasParaPortal(fila({ itens: [item({ analistaId: "conta-portal", id: "a" })] }));
    expect(saida.itens[0]?.analistaId).toBe("conta-portal");
    expect(saida.analistas).toEqual([{ id: "conta-portal", nome: "Maria do Cecílio" }]);
  });

  it("o resto da fila passa igual", () => {
    const entrada = fila({ itens: [item({ analistaId: "hub-1", id: "a" })] });
    const saida = analistasParaPortal(entrada);
    expect(saida.empreendimentos).toEqual(entrada.empreendimentos);
    expect(saida.usuarioAtual).toEqual(entrada.usuarioAtual);
    expect({ ...saida.itens[0], analistaId: "hub-1" }).toEqual(entrada.itens[0]);
  });
});

describe("as amarras no servidor", () => {
  const ler = (caminho: string) => readFileSync(join(HUB, caminho), "utf8");

  // (16/09/2026, D4) Decisão do Lucas: a Gurgel (comercial) volta a ver os nomes dos analistas da
  // Careli como antes da onda 1; o portal que opera sozinho (Cecílio) vê "Equipe Careli". O
  // comportamento da rota nas duas portas é testado em app/api/incorporador/board/route.test.ts.
  it("a rota do portal passa por analistasParaPortal fora do comercial, e só o comercial pede os nomes", () => {
    const rota = ler("app/api/incorporador/board/route.ts");
    expect(rota).toMatch(/const comercial = ehPortalComercial\(auth\.sessao\.tipo\);/);
    expect(rota).toMatch(/comAnalistasDoHub: comercial/);
    expect(rota).toMatch(/\{ data: comercial \? filaDoPortal : analistasParaPortal\(filaDoPortal\) \}/);
  });

  it("o recorte de montarFilaDoBoard só sai com a lista de hub_users quando pedem (fechado por padrão)", () => {
    const servidor = ler("lib/apolo/board-do-servidor.ts");
    const recorte = servidor.slice(
      servidor.indexOf("if (opts.recorte) {"),
      servidor.indexOf("data: { analistas, empreendimentos: empreendimentosDoCatalogo"),
    );
    expect(recorte).toMatch(/analistas: comAnalistasDoHub === true \? analistas : \[\],/);
  });
});
