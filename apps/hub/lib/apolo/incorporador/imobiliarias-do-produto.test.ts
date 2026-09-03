import { describe, expect, it } from "vitest";

import type { ApoloVendaUnit } from "@/lib/apolo/vendas";

import type { LinhaEsteira } from "./crm";
import {
  contarVendasPorImobiliaria,
  idsDoApoloDoRecorte,
  montarImobiliariasDoProduto,
  SEM_CORRETOR,
  situacaoDaCad,
} from "./imobiliarias-do-produto";

// A ABA IMOBILIÁRIAS DO HÉRCULES É NÚMERO NA TELA DO COORDENADOR. O que está travado aqui: a
// tradução etapa → situação, a árvore imobiliária → corretor → cliente, as contagens (que têm que
// fechar com o board) e o recorte de ids do Apolo, que não pode ampliar o escopo.

// ── Fábricas ────────────────────────────────────────────────────────────────
const cad = (p: Partial<LinhaEsteira> & { entity_id: string }): LinhaEsteira => ({
  chegou_em: "2026-08-01T12:00:00.000Z",
  corretor: "Maria Corretora",
  empreendimento: "VALE DO OURO",
  enterprise_id: "37",
  etapa: "validacao",
  imobiliaria: "RR Soluções",
  imobiliaria_entity_id: "imob-rr",
  ...p,
});

const credenciada = (p: { id: string; nome?: string; verificada?: boolean }) => ({
  documento: "12345678000199",
  id: p.id,
  nome: p.nome ?? p.id.toUpperCase(),
  verificada: p.verificada ?? true,
});

const venda = (p: Partial<ApoloVendaUnit> & { id: string }): ApoloVendaUnit => ({
  arId: 1,
  block: "02",
  blocked: false,
  client: null,
  code: "VOCQ02L18",
  imobiliaria: { code: null, entityId: "imob-rr", name: "RR Soluções" },
  lot: "18",
  stage: "faturado",
  stageSince: null,
  vgv: 100_000,
  ...p,
});

const nomes = new Map<string, string>([
  ["cli-1", "Ana Lima"],
  ["cli-2", "Bruno Souza"],
  ["cli-3", "Carla Dias"],
]);

describe("situacaoDaCad", () => {
  it("credenciado → credenciada; correcao → com_erro; indeferido → nao_seguiu; resto → em_andamento", () => {
    expect(situacaoDaCad("credenciado")).toBe("credenciada");
    expect(situacaoDaCad("correcao")).toBe("com_erro");
    expect(situacaoDaCad("indeferido")).toBe("nao_seguiu");
    for (const etapa of ["validacao", "credito", "revisao", "prevenda", null, undefined, ""]) {
      expect(situacaoDaCad(etapa)).toBe("em_andamento");
    }
  });

  it("não distingue caixa nem espaços — a etapa chega do banco como texto livre", () => {
    expect(situacaoDaCad("  Credenciado ")).toBe("credenciada");
  });
});

describe("montarImobiliariasDoProduto", () => {
  it("imobiliária sem CAD aparece com corretores vazios e contagens zeradas", () => {
    const saida = montarImobiliariasDoProduto({
      credenciadas: [credenciada({ id: "imob-sem-cad", nome: "Sem Cad Imóveis" })],
      esteira: [],
      nomes,
      vendasPorImobiliaria: new Map(),
    });

    expect(saida.habilitadas).toBe(1);
    expect(saida.aguardando).toBe(0);
    expect(saida.cadsForaDaLista).toBe(0);
    expect(saida.imobiliarias).toHaveLength(1);

    const linha = saida.imobiliarias[0]!;
    expect(linha.nome).toBe("Sem Cad Imóveis");
    expect(linha.situacao).toBe("habilitada");
    expect(linha.corretores).toEqual([]);
    expect(linha.contagens).toEqual({
      comErro: 0,
      credenciadas: 0,
      emAndamento: 0,
      enviadas: 0,
      naoSeguiu: 0,
      vendas: 0,
    });
  });

  it("vínculo pending = Aguardando habilitação; verified = Habilitada; e o mesmo id com os dois vale habilitada", () => {
    const saida = montarImobiliariasDoProduto({
      credenciadas: [
        credenciada({ id: "imob-a", verificada: false }),
        credenciada({ id: "imob-b", verificada: true }),
        // A mesma imobiliária chega duas vezes quando o recorte tem grupo + divisões.
        credenciada({ id: "imob-a", verificada: true }),
      ],
      esteira: [],
      nomes,
      vendasPorImobiliaria: new Map(),
    });

    expect(saida.imobiliarias).toHaveLength(2);
    expect(saida.habilitadas).toBe(2);
    expect(saida.aguardando).toBe(0);
    expect(saida.imobiliarias.map((i) => i.situacao)).toEqual(["habilitada", "habilitada"]);
  });

  it("corretor vazio ou nulo agrupa em 'Sem corretor', sempre por último", () => {
    const saida = montarImobiliariasDoProduto({
      credenciadas: [credenciada({ id: "imob-rr" })],
      esteira: [
        cad({ corretor: "", entity_id: "cli-1" }),
        cad({ corretor: null, entity_id: "cli-2" }),
        cad({ corretor: "   ", entity_id: "cli-3" }),
        cad({ corretor: "Zé", entity_id: "cli-4" }),
      ],
      nomes,
      vendasPorImobiliaria: new Map(),
    });

    const corretores = saida.imobiliarias[0]!.corretores;
    // "Sem corretor" tem 3 clientes e "Zé" tem 1, mas "Sem corretor" vai para o fim mesmo assim.
    expect(corretores.map((c) => c.nome)).toEqual(["Zé", SEM_CORRETOR]);
    expect(corretores[1]!.clientes).toHaveLength(3);
    // Quem não tem entidade no Apolo sai como "Sem nome", nunca trava a lista.
    expect(corretores[0]!.clientes[0]!.nome).toBe("Sem nome");
  });

  it("agrupa o corretor sem distinguir caixa e espaços, mostrando o primeiro nome que chegou", () => {
    const saida = montarImobiliariasDoProduto({
      credenciadas: [credenciada({ id: "imob-rr" })],
      esteira: [
        cad({ corretor: "Maria  Corretora", entity_id: "cli-1" }),
        cad({ corretor: "MARIA CORRETORA", entity_id: "cli-2" }),
      ],
      nomes,
      vendasPorImobiliaria: new Map(),
    });

    const corretores = saida.imobiliarias[0]!.corretores;
    expect(corretores).toHaveLength(1);
    expect(corretores[0]!.nome).toBe("Maria Corretora");
    expect(corretores[0]!.clientes).toHaveLength(2);
  });

  it("contagens: enviadas = credenciadas + emAndamento + comErro + naoSeguiu; vendas vem do mapa", () => {
    const saida = montarImobiliariasDoProduto({
      credenciadas: [credenciada({ id: "imob-rr" })],
      esteira: [
        cad({ entity_id: "cli-1", etapa: "credenciado" }),
        cad({ entity_id: "cli-2", etapa: "credenciado" }),
        cad({ entity_id: "cli-3", etapa: "correcao" }),
        cad({ entity_id: "cli-4", etapa: "indeferido" }),
        cad({ entity_id: "cli-5", etapa: "validacao" }),
        cad({ entity_id: "cli-6", etapa: "credito" }),
        cad({ entity_id: "cli-7", etapa: "prevenda" }),
      ],
      nomes,
      vendasPorImobiliaria: new Map([["imob-rr", 4]]),
    });

    const { contagens } = saida.imobiliarias[0]!;
    expect(contagens).toEqual({
      comErro: 1,
      credenciadas: 2,
      emAndamento: 3,
      enviadas: 7,
      naoSeguiu: 1,
      vendas: 4,
    });
    expect(
      contagens.credenciadas + contagens.emAndamento + contagens.comErro + contagens.naoSeguiu,
    ).toBe(contagens.enviadas);
  });

  it("cada cliente sai com etapa, rótulo do cliente e situação — e sem veredito de crédito", () => {
    const saida = montarImobiliariasDoProduto({
      credenciadas: [credenciada({ id: "imob-rr" })],
      esteira: [cad({ entity_id: "cli-1", etapa: "indeferido" })],
      nomes,
      vendasPorImobiliaria: new Map(),
    });

    const cliente = saida.imobiliarias[0]!.corretores[0]!.clientes[0]!;
    expect(cliente).toEqual({
      chegouEm: "2026-08-01T12:00:00.000Z",
      entityId: "cli-1",
      etapa: "indeferido",
      nome: "Ana Lima",
      rotulo: "Não seguiu",
      situacao: "nao_seguiu",
    });
  });

  it("CAD de imobiliária sem vínculo vigente (ou sem imobiliária) não vira linha: só conta em cadsForaDaLista", () => {
    const saida = montarImobiliariasDoProduto({
      credenciadas: [credenciada({ id: "imob-rr" })],
      esteira: [
        cad({ entity_id: "cli-1" }),
        cad({ entity_id: "cli-2", imobiliaria_entity_id: "imob-arquivada" }),
        cad({ entity_id: "cli-3", imobiliaria: null, imobiliaria_entity_id: null }),
      ],
      nomes,
      vendasPorImobiliaria: new Map(),
    });

    expect(saida.imobiliarias).toHaveLength(1);
    expect(saida.imobiliarias[0]!.contagens.enviadas).toBe(1);
    expect(saida.cadsForaDaLista).toBe(2);
  });

  it("ordena: habilitadas primeiro, depois quem mais mandou CAD, depois o nome", () => {
    const saida = montarImobiliariasDoProduto({
      credenciadas: [
        credenciada({ id: "imob-z", nome: "Zeta", verificada: true }),
        credenciada({ id: "imob-a", nome: "Alfa", verificada: true }),
        credenciada({ id: "imob-p", nome: "Pendente", verificada: false }),
      ],
      esteira: [
        cad({ entity_id: "cli-1", imobiliaria_entity_id: "imob-z" }),
        cad({ entity_id: "cli-2", imobiliaria_entity_id: "imob-z" }),
        cad({ entity_id: "cli-3", imobiliaria_entity_id: "imob-a" }),
        // A pendente tem MAIS CAD que todo mundo e ainda assim fica depois das habilitadas.
        cad({ entity_id: "cli-4", imobiliaria_entity_id: "imob-p" }),
        cad({ entity_id: "cli-5", imobiliaria_entity_id: "imob-p" }),
        cad({ entity_id: "cli-6", imobiliaria_entity_id: "imob-p" }),
      ],
      nomes,
      vendasPorImobiliaria: new Map(),
    });

    expect(saida.imobiliarias.map((i) => i.nome)).toEqual(["Zeta", "Alfa", "Pendente"]);
    expect(saida.habilitadas).toBe(2);
    expect(saida.aguardando).toBe(1);
  });

  it("clientes do corretor: o cadastro mais recente primeiro", () => {
    const saida = montarImobiliariasDoProduto({
      credenciadas: [credenciada({ id: "imob-rr" })],
      esteira: [
        cad({ chegou_em: "2026-07-01T00:00:00.000Z", entity_id: "cli-1" }),
        cad({ chegou_em: "2026-08-15T00:00:00.000Z", entity_id: "cli-2" }),
        cad({ chegou_em: null, entity_id: "cli-3" }),
      ],
      nomes,
      vendasPorImobiliaria: new Map(),
    });

    const clientes = saida.imobiliarias[0]!.corretores[0]!.clientes;
    expect(clientes.map((c) => c.nome)).toEqual(["Bruno Souza", "Ana Lima", "Carla Dias"]);
  });
});

describe("contarVendasPorImobiliaria", () => {
  it("conta unidade com venda ativa por imobiliária; disponível e sem imobiliária ficam de fora", () => {
    const contagem = contarVendasPorImobiliaria([
      venda({ id: "1", stage: "faturado" }),
      venda({ id: "2", stage: "proposta" }),
      venda({ id: "3", imobiliaria: { code: null, entityId: "imob-b", name: "B" } }),
      venda({ id: "4", imobiliaria: null }),
      venda({ id: "5", stage: "disponivel" }),
    ]);

    expect(contagem.get("imob-rr")).toBe(2);
    expect(contagem.get("imob-b")).toBe(1);
    expect(contagem.size).toBe(2);
  });
});

describe("idsDoApoloDoRecorte", () => {
  const catalogo = [
    { id: "group:Lagoa Bonita", stageIds: ["33", "27", "32"] },
    { id: "37", stageIds: ["37"] },
  ];

  it("pedido pelo GRUPO, sessão dona do conjunto: grupo + todas as divisões", () => {
    const permitidos = new Set(["group:Lagoa Bonita", "33", "27", "32"]);
    const ids = idsDoApoloDoRecorte(catalogo, ["group:Lagoa Bonita"], permitidos);

    expect(new Set(ids)).toEqual(new Set(["group:Lagoa Bonita", "33", "27", "32"]));
  });

  it("pedido pelo GRUPO, sessão só com uma gleba: SÓ a gleba (nem o grupo, nem as outras)", () => {
    const permitidos = new Set(["33"]);
    const ids = idsDoApoloDoRecorte(catalogo, ["group:Lagoa Bonita"], permitidos);

    expect(ids).toEqual(["33"]);
  });

  it("pedido por DIVISÕES (filhos do pai), sessão dona do conjunto: as divisões pedidas + o grupo, sem as outras", () => {
    const permitidos = new Set(["group:Lagoa Bonita", "33", "27", "32"]);
    const ids = idsDoApoloDoRecorte(catalogo, ["33", "27"], permitidos);

    expect(new Set(ids)).toEqual(new Set(["33", "27", "group:Lagoa Bonita"]));
  });

  it("pedido por DIVISÃO fora do escopo devolve vazio — nunca amplia", () => {
    const permitidos = new Set(["33"]);
    expect(idsDoApoloDoRecorte(catalogo, ["27"], permitidos)).toEqual([]);
    expect(idsDoApoloDoRecorte(catalogo, ["999"], permitidos)).toEqual([]);
    expect(idsDoApoloDoRecorte(catalogo, [], permitidos)).toEqual([]);
  });

  it("empreendimento simples: o próprio id, quando autorizado", () => {
    expect(idsDoApoloDoRecorte(catalogo, ["37"], new Set(["37"]))).toEqual(["37"]);
    expect(idsDoApoloDoRecorte(catalogo, ["37"], new Set(["36"]))).toEqual([]);
  });

  it("id que sumiu do catálogo mas a sessão autoriza continua valendo", () => {
    expect(idsDoApoloDoRecorte(catalogo, ["40"], new Set(["40"]))).toEqual(["40"]);
  });
});
