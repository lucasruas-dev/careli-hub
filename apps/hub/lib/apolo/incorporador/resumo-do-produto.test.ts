import { describe, expect, it } from "vitest";

import type { LinhaEsteira } from "./crm";
import {
  comIdsDoGrupo,
  contarCadsPorEtapa,
  contarCorretores,
  contarPorEstagio,
  type ImobiliariaVinculada,
  maiorImobiliaria,
  montarResumoDoProduto,
} from "./resumo-do-produto";

// A FAIXA DO PROCESSO É O NÚMERO QUE O COORDENADOR OLHA PRIMEIRO. Número errado aqui vira reunião;
// por isso cada regra (etapas, contagens, maior imobiliária, ids do grupo) tem o seu caso.

// ── Fábricas ────────────────────────────────────────────────────────────────
const cad = (p: Partial<LinhaEsteira> & { etapa: string }): LinhaEsteira => ({
  chegou_em: null,
  corretor: null,
  empreendimento: null,
  enterprise_id: "37",
  entity_id: `pessoa-${Math.random().toString(36).slice(2, 8)}`,
  imobiliaria: null,
  imobiliaria_entity_id: null,
  ...p,
});

const imob = (p: Partial<ImobiliariaVinculada> & { id: string }): ImobiliariaVinculada => ({
  nome: p.id,
  verificada: true,
  ...p,
});

const barra = (lista: ReturnType<typeof contarCadsPorEtapa>, rotulo: string) => {
  const achada = lista.find((item) => item.rotulo === rotulo);
  if (!achada) throw new Error(`sem barra "${rotulo}"`);
  return achada;
};

// ── CADs por etapa ──────────────────────────────────────────────────────────
describe("contarCadsPorEtapa", () => {
  it("sai na ordem do caminho, com as etapas vazias em zero", () => {
    const barras = contarCadsPorEtapa([cad({ etapa: "credenciado" })]);

    expect(barras.map((b) => b.rotulo)).toEqual([
      "Em cadastro",
      "Em validação",
      "Em análise",
      "Aguardando correção",
      "Aguardando pré-venda",
      "Credenciado",
      "Não seguiu",
    ]);
    expect(barra(barras, "Credenciado").quantidade).toBe(1);
    expect(barra(barras, "Em validação").quantidade).toBe(0);
  });

  it("junta credito e revisao numa barra só (\"Em análise\"), com a etapa representante", () => {
    const barras = contarCadsPorEtapa([
      cad({ etapa: "credito" }),
      cad({ etapa: "revisao" }),
      cad({ etapa: "REVISAO " }),
    ]);

    const analise = barra(barras, "Em análise");
    expect(analise.quantidade).toBe(3);
    expect(analise.etapa).toBe("credito");
    expect(barras.filter((b) => b.rotulo === "Em análise")).toHaveLength(1);
  });

  it("etapa fora do caminho vira \"Em andamento\", e só aparece quando tem alguém", () => {
    expect(contarCadsPorEtapa([]).some((b) => b.rotulo === "Em andamento")).toBe(false);

    const barras = contarCadsPorEtapa([cad({ etapa: "triagem" }), cad({ etapa: "" })]);
    expect(barra(barras, "Em andamento").quantidade).toBe(2);
  });
});

// ── Corretores ──────────────────────────────────────────────────────────────
describe("contarCorretores", () => {
  it("conta nomes distintos ignorando caixa e espaços; vazio não conta", () => {
    const n = contarCorretores([
      cad({ corretor: "João Silva", etapa: "validacao" }),
      cad({ corretor: "  joão   SILVA ", etapa: "credito" }),
      cad({ corretor: "Maria", etapa: "credito" }),
      cad({ corretor: "   ", etapa: "credito" }),
      cad({ corretor: null, etapa: "credito" }),
    ]);

    expect(n).toBe(2);
  });
});

// ── Maior imobiliária ───────────────────────────────────────────────────────
describe("maiorImobiliaria", () => {
  it("conta pelo entity_id (não pelo texto) e usa o nome do vínculo", () => {
    const esteira = [
      cad({ etapa: "credito", imobiliaria: "RR Soluções", imobiliaria_entity_id: "rr" }),
      cad({ etapa: "credito", imobiliaria: "RR SOLUCOES LTDA", imobiliaria_entity_id: "rr" }),
      cad({ etapa: "credito", imobiliaria: "Alfa", imobiliaria_entity_id: "alfa" }),
    ];

    expect(maiorImobiliaria(esteira, [imob({ id: "rr", nome: "RR Soluções Imobiliárias" })])).toEqual(
      { cads: 2, nome: "RR Soluções Imobiliárias" },
    );
  });

  it("sem vínculo, o nome é o texto mais frequente da esteira", () => {
    const esteira = [
      cad({ etapa: "credito", imobiliaria: "Alfa Imóveis", imobiliaria_entity_id: "alfa" }),
      cad({ etapa: "credito", imobiliaria: "ALFA", imobiliaria_entity_id: "alfa" }),
      cad({ etapa: "credito", imobiliaria: "Alfa Imóveis", imobiliaria_entity_id: "alfa" }),
    ];

    expect(maiorImobiliaria(esteira, [])).toEqual({ cads: 3, nome: "Alfa Imóveis" });
  });

  it("empate desempata pelo nome, para o card não trocar a cada carregamento", () => {
    const esteira = [
      cad({ etapa: "credito", imobiliaria_entity_id: "b" }),
      cad({ etapa: "credito", imobiliaria_entity_id: "a" }),
    ];
    const vinculos = [imob({ id: "b", nome: "Zeta" }), imob({ id: "a", nome: "Alfa" })];

    expect(maiorImobiliaria(esteira, vinculos)?.nome).toBe("Alfa");
  });

  it("CAD sem imobiliária não conta; sem nenhuma, devolve nulo", () => {
    expect(maiorImobiliaria([cad({ etapa: "credito", imobiliaria: "Solta" })], [])).toBeNull();
  });
});

// ── Pipeline ────────────────────────────────────────────────────────────────
describe("contarPorEstagio", () => {
  it("uma unidade por estágio; disponível fica de fora da venda", () => {
    const contagem = contarPorEstagio([
      { stage: "disponivel" },
      { stage: "reservado" },
      { stage: "proposta" },
      { stage: "proposta" },
      { stage: "contrato" },
      { stage: "assinatura" },
      { stage: "faturado" },
      { stage: "faturado" },
      { stage: "faturado" },
    ]);

    expect(contagem).toEqual({
      assinatura: 1,
      contrato: 1,
      disponivel: 1,
      faturado: 3,
      proposta: 2,
      reservado: 1,
    });
  });
});

// ── A montagem inteira ──────────────────────────────────────────────────────
describe("montarResumoDoProduto", () => {
  const esteira = [
    cad({ corretor: "Ana", etapa: "cadastro", imobiliaria_entity_id: "rr" }),
    cad({ corretor: "Ana", etapa: "validacao", imobiliaria_entity_id: "rr" }),
    cad({ corretor: "Beto", etapa: "correcao", imobiliaria_entity_id: "alfa" }),
    cad({ corretor: "Beto", etapa: "prevenda", imobiliaria_entity_id: "alfa" }),
    cad({ corretor: "Caio", etapa: "credenciado", imobiliaria_entity_id: "rr" }),
    cad({ corretor: "Caio", etapa: "credenciado", imobiliaria_entity_id: "rr" }),
    cad({ etapa: "indeferido" }),
  ];
  const imobiliarias = [
    imob({ id: "rr", nome: "RR", verificada: true }),
    imob({ id: "alfa", nome: "Alfa", verificada: false }),
    imob({ id: "beta", nome: "Beta", verificada: false }),
  ];
  const unidades = [
    { stage: "disponivel" as const },
    { stage: "reservado" as const },
    { stage: "proposta" as const },
    { stage: "contrato" as const },
    { stage: "assinatura" as const },
    { stage: "faturado" as const },
    { stage: "faturado" as const },
  ];

  const resumo = montarResumoDoProduto({ esteira, imobiliarias, unidades });

  it("a faixa: em andamento exclui credenciado e indeferido; correção é subconjunto", () => {
    expect(resumo.processo).toEqual({
      cadsCorrecao: 1,
      cadsEmAndamento: 4,
      corretores: 3,
      credenciados: 2,
      emAssinatura: 1,
      emContrato: 1,
      imobiliariasAguardando: 2,
      imobiliariasHabilitadas: 1,
      propostas: 1,
      reservas: 1,
      vendidas: 2,
    });
  });

  it("quem vende: habilitadas, aguardando, corretores e a maior imobiliária", () => {
    expect(resumo.quemVende).toEqual({
      aguardando: 2,
      corretores: 3,
      habilitadas: 1,
      maior: { cads: 4, nome: "RR" },
    });
  });

  it("as barras batem com a faixa", () => {
    const soma = resumo.cadsPorEtapa.reduce((acc, b) => acc + b.quantidade, 0);
    expect(soma).toBe(esteira.length);
    expect(barra(resumo.cadsPorEtapa, "Credenciado").quantidade).toBe(resumo.processo.credenciados);
    expect(barra(resumo.cadsPorEtapa, "Aguardando correção").quantidade).toBe(
      resumo.processo.cadsCorrecao,
    );
  });

  it("produto sem nada: tudo zero e maior nula", () => {
    const vazio = montarResumoDoProduto({ esteira: [], imobiliarias: [], unidades: [] });

    expect(Object.values(vazio.processo).every((n) => n === 0)).toBe(true);
    expect(vazio.quemVende.maior).toBeNull();
    expect(vazio.cadsPorEtapa.every((b) => b.quantidade === 0)).toBe(true);
  });
});

// ── Os ids que as tabelas do Apolo entendem ─────────────────────────────────
describe("comIdsDoGrupo", () => {
  const catalogo = [
    { id: "group:Lagoa Bonita", stageIds: ["33", "34", "38"] },
    { id: "37", stageIds: ["37"] },
  ];

  it("pai que cobre o grupo inteiro ganha o id do grupo, se a sessão o tem", () => {
    const ids = comIdsDoGrupo(
      ["33", "34", "38"],
      catalogo,
      new Set(["group:Lagoa Bonita", "33", "34", "38"]),
    );

    expect(ids).toEqual(["33", "34", "38", "group:Lagoa Bonita"]);
  });

  it("gleba sozinha NÃO ganha o grupo — o conjunto não é dela", () => {
    const ids = comIdsDoGrupo(["33"], catalogo, new Set(["group:Lagoa Bonita", "33", "34", "38"]));
    expect(ids).toEqual(["33"]);
  });

  it("grupo fora da sessão não entra, mesmo coberto", () => {
    const ids = comIdsDoGrupo(["33", "34", "38"], catalogo, new Set(["33", "34", "38"]));
    expect(ids).toEqual(["33", "34", "38"]);
  });

  it("empreendimento simples não duplica o próprio id", () => {
    expect(comIdsDoGrupo(["37"], catalogo, new Set(["37"]))).toEqual(["37"]);
  });
});
