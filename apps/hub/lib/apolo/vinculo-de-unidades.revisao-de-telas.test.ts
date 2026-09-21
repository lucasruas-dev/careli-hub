import { describe, expect, it } from "vitest";

import { clienteEmMemoria, gravacoesEm, novoEstado } from "@/lib/temis/fixtures/supabase-em-memoria";

import { executarVinculoDeUnidades } from "./vinculo-de-unidades-servidor";

// REVISÃO DA ONDA (21/09/2026) — a lente é A TELA E A AÇÃO EM MASSA do vínculo de unidades.
//
// Nasceu falhando de propósito — cada caso escrevia um jeito de a tela mentir sobre o que ia
// acontecer — e foi fechado na mesma data. O que se lê aqui agora é a régua.
//
// Cadastro medido em produção (bxgukywoxgivlrhjkwjx) em 21/09/2026:
//   • Vale do Ouro: pai VLO = 35 (298 linhas, TODAS espelho), VOC = 37, VOL = 36, VOR = 41;
//   • 17 chaves de terreno (quadra|lote) têm DUAS linhas VIVAS em divisões diferentes da mesma
//     família: 4 no Vale do Ouro (VOC × VOR) e 13 no Rio de Pedras (RDP × RPC);
//   • Lagoa Bonita: 907 linhas, 495 terrenos; Cidade Jardim: 532 linhas, 532 terrenos.

const VLO = "35";
const VOC = "37";
const VOL = "36";
const VOR = "41";

const CATEGORIA = "cccccccc-0000-4000-8000-000000000001";
const AUTOR = { id: "11111111-1111-4111-8111-111111111111", nome: "Lucas" };
const AGORA = new Date("2026-09-21T12:00:00.000Z");

type LinhaDoCadastroDuble = {
  c2xEnterpriseId: null | string;
  codigo: string;
  id: string;
  nome: string;
  paiId: null | string;
};

const CADASTRO = [
  { c2xEnterpriseId: VLO, codigo: "VLO", id: "emp-vlo", nome: "Vale do Ouro", paiId: null },
  { c2xEnterpriseId: VOC, codigo: "VOC", id: "emp-voc", nome: "Vale do Ouro · VOC", paiId: "emp-vlo" },
  { c2xEnterpriseId: VOL, codigo: "VOL", id: "emp-vol", nome: "Vale do Ouro · VOL", paiId: "emp-vlo" },
  { c2xEnterpriseId: VOR, codigo: "VOR", id: "emp-vor", nome: "Vale do Ouro · VOR", paiId: "emp-vlo" },
] as unknown as Parameters<typeof executarVinculoDeUnidades>[0]["duble"] extends undefined
  ? never
  : LinhaDoCadastroDuble[];

function unidade(extras: Record<string, unknown>): Record<string, unknown> {
  return {
    apartamento: null,
    categoria_id: null,
    espelho_de: null,
    situacao: "disponivel",
    torre: null,
    workspace_id: "careli",
    ...extras,
  };
}

function montar(unidades: Record<string, unknown>[]) {
  const estado = novoEstado();
  estado.tabelas.hercules_unidades = unidades;
  estado.tabelas.temis_categorias = [
    { ativa: true, enterprise_id: VLO, id: CATEGORIA, nome: "Condomínio", workspace_id: "careli" },
  ];
  estado.tabelas.hercules_propostas = [];
  estado.tabelas.hercules_reservas = [];
  return estado;
}

async function chamar(estado: ReturnType<typeof novoEstado>, corpo: Record<string, unknown>) {
  return executarVinculoDeUnidades({
    agora: AGORA,
    autor: AUTOR,
    corpo,
    duble: {
      admin: clienteEmMemoria(estado) as never,
      cadastro: CADASTRO as never,
    },
  });
}

const linha = (estado: ReturnType<typeof novoEstado>, id: string) =>
  (estado.tabelas.hercules_unidades ?? []).find((l) => l.id === id) as
    | Record<string, unknown>
    | undefined;

// ─────────────────────────────────────────────────────────────────────────────
// 1) O terreno de duas glebas vivas
// ─────────────────────────────────────────────────────────────────────────────
//
// Q12/L06 do Vale do Ouro existe em TRÊS linhas hoje: VLO1206 (espelho, do pai), VOC1206 (viva) e
// VOR1206 (viva, reservada). `chaveDoTerreno` é só quadra + lote, então as três dividem a mesma
// chave — e VOC e VOR NÃO são a mesma linha nem espelho uma da outra.

const TERRENO_DE_DUAS_GLEBAS = [
  unidade({ codigo: "VLO1206", enterprise_id: VLO, espelho_de: "voc-1206", id: "vlo-1206", lote: "06", quadra: "12", situacao: "bloqueada" }),
  unidade({ codigo: "VOC1206", enterprise_id: VOC, id: "voc-1206", lote: "06", quadra: "12", situacao: "bloqueada" }),
  unidade({ codigo: "VOR1206", enterprise_id: VOR, id: "vor-1206", lote: "06", quadra: "12", situacao: "reservada" }),
];

describe("a tela em massa e o terreno que existe em duas glebas vivas", () => {
  it("a lista mostra os DOIS lotes vivos, e não só um deles", async () => {
    const estado = montar(TERRENO_DE_DUAS_GLEBAS.map((u) => ({ ...u })));
    const r = await chamar(estado, { acao: "universo", codigo: "VOC", enterpriseId: VOC });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const { unidades } = r.data as { unidades: { codigo: string; id: string }[] };
    // O operador precisa enxergar os DOIS lotes vivos: são duas linhas de venda, em duas glebas,
    // com dois donos no portal. Até 21/09/2026 saa uma só, e qual das duas dependia do `.order()`
    // do banco, que empata em quadra e lote — ou seja, não era nem determinístico.
    expect(unidades.map((u) => u.codigo).sort()).toEqual(["VOC1206", "VOR1206"]);
  });

  it("carimbar um lote NÃO alcança o lote da outra gleba — só o registro antigo do pai", async () => {
    const estado = montar(TERRENO_DE_DUAS_GLEBAS.map((u) => ({ ...u })));
    const universo = await chamar(estado, { acao: "universo", codigo: "VOC", enterpriseId: VOC });
    expect(universo.ok).toBe(true);
    if (!universo.ok) return;
    const visivel = (universo.data as { unidades: { id: string }[] }).unidades[0]!.id;

    const r = await chamar(estado, {
      acao: "aplicar",
      categoriaId: CATEGORIA,
      codigo: "VOC",
      enterpriseId: VOC,
      origem: "massa",
      unidadeIds: [visivel],
    });
    expect(r.ok).toBe(true);

    // O espelho do pai ir junto é o desenho (0161) e está certo.
    expect(linha(estado, "vlo-1206")?.categoria_id).toBe(CATEGORIA);
    // A outra GLEBA VIVA não: ela tem enterprise_id próprio, dono próprio no portal e minuta
    // própria. Carimbá-la a partir de um clique noutra gleba é decidir a minuta de um lote que o
    // operador não viu.
    expect(linha(estado, "vor-1206")?.categoria_id).toBeNull();
  });

  it("a prévia conta como registro antigo só o espelho do pai", async () => {
    const estado = montar(TERRENO_DE_DUAS_GLEBAS.map((u) => ({ ...u })));
    const r = await chamar(estado, {
      acao: "previa",
      categoriaId: CATEGORIA,
      codigo: "VOC",
      enterpriseId: VOC,
      origem: "massa",
      unidadeIds: ["voc-1206"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const previsao = r.data as {
      categorias: { previa: { porParentesco: number } }[];
    };
    // A tela imprime `porParentesco` como "N registros antigos do mesmo terreno vão junto"
    // (vincular-lotes.tsx, PainelDaPrevia). Só o espelho do pai é registro antigo: 1, e não 2 —
    // chamar de "registro antigo" um lote VIVO de outra gleba, com outro dono no portal e outra
    // minuta, é a frase mais cara que esta tela poderia imprimir.
    expect(previsao.categorias[0]?.previa.porParentesco).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2) O volume: a planilha do loteamento inteiro
// ─────────────────────────────────────────────────────────────────────────────

describe("o volume da ação em massa", () => {
  it("a planilha de um loteamento de 532 lotes passa inteira", async () => {
    // Cidade Jardim tem 532 unidades e 532 terrenos (medido em 21/09/2026). A aba "Subir planilha"
    // manda o CSV numa chamada só (`vinculo-de-unidades.ts`: `if (pedido.csv) return chamar(...)`),
    // e a porta recusa acima de 500.
    const unidades = Array.from({ length: 532 }, (_, i) =>
      unidade({
        codigo: `VOC${String(i + 1).padStart(4, "0")}`,
        enterprise_id: VOC,
        id: `voc-${i + 1}`,
        lote: String(i + 1),
        quadra: "A",
      }),
    );
    const estado = montar(unidades);
    const csv = ["Quadra;Lote;Categoria", ...unidades.map((_, i) => `A;${i + 1};Condomínio`)].join("\n");

    const r = await chamar(estado, {
      acao: "previa",
      codigo: "VOC",
      csv,
      enterpriseId: VOC,
      origem: "planilha",
    });

    // A aba da planilha não tem filtro de quadra nem de faixa, e a recusa mandava o operador usar
    // um recorte que só existe na OUTRA aba. A planilha tem teto próprio (`TETO_DA_PLANILHA`), e a
    // tela passou a dividir o CSV em blocos como já divide os ids.
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const previsao = r.data as { planilha: null | { resumo: { comCategoria: number } } };
    expect(previsao.planilha?.resumo.comCategoria).toBe(532);
  });

  it("mudar a divisão de 40 lotes vai em LOTE, e não numa gravação por unidade", async () => {
    // O duble recusa id que não é uuid em `.eq("id", …)`, como o Postgres (22P02).
    const idUuid = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
    const unidades = Array.from({ length: 40 }, (_, i) =>
      unidade({
        codigo: `VOC01${String(i + 1).padStart(2, "0")}`,
        enterprise_id: VOC,
        id: idUuid(i + 1),
        lote: String(i + 1),
        quadra: "01",
      }),
    );
    const estado = montar(unidades);

    const r = await chamar(estado, {
      acao: "aplicar",
      codigo: "VOC",
      confirmarDivisao: true,
      divisaoDestino: VOL,
      enterpriseId: VOC,
      origem: "massa",
      unidadeIds: unidades.map((u) => String(u.id)),
    });
    expect(r.ok).toBe(true);

    const gravacoesDeDivisao = gravacoesEm(estado, "hercules_unidades").filter(
      (c) => c.tipo === "update" && "enterprise_id" in ((c.valores ?? {}) as Record<string, unknown>),
    );
    // A tela deixa marcar centenas de lotes de uma vez (botão "Marcar os N visíveis") e o teto por
    // chamada é 500. Uma ida ao banco por lote punha 500 idas e voltas dentro de um
    // `maxDuration = 60`, e timeout da Vercel chega na tela como erro de JSON. A gravação da
    // categoria já ia em lote; a da divisão passou a ir também.
    expect(gravacoesDeDivisao.length).toBeLessThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3) O que está CERTO e precisa continuar assim
// ─────────────────────────────────────────────────────────────────────────────

describe("o número que a tela mostra depois de gravar", () => {
  it("o painel verde conta os lotes que MUDARAM, e não os que foram marcados", async () => {
    // O operador remarca uma quadra inteira que já está na categoria e clica em aplicar. A prévia
    // acerta (mostra `terrenos - jaEstao`); o painel do resultado usa `terrenos` cru.
    const jaNaCategoria = Array.from({ length: 30 }, (_, i) =>
      unidade({
        categoria_id: CATEGORIA,
        codigo: `VOC02${String(i + 1).padStart(2, "0")}`,
        enterprise_id: VOC,
        id: `bbbbbbbb-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        lote: String(i + 1),
        quadra: "02",
      }),
    );
    const estado = montar(jaNaCategoria);

    const r = await chamar(estado, {
      acao: "aplicar",
      categoriaId: CATEGORIA,
      codigo: "VOC",
      enterpriseId: VOC,
      origem: "massa",
      unidadeIds: jaNaCategoria.map((u) => String(u.id)),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const data = r.data as { gravadas: number; terrenos: number };
    // Nada foi regravado, e isso está certo (não suja `atualizado_em` nem o carimbo).
    expect(data.gravadas).toBe(0);
    // E `terrenos` é o que vai para "N lotes atualizados" em `PainelDoResultado`
    // (vincular-lotes.tsx): ele conta o que MUDOU, e não o que foi marcado.
    expect(data.terrenos).toBe(0);
  });
});

describe("a trava da categoria de outro empreendimento (porta nova)", () => {
  it("categoria de outra família é recusada com frase, sem gravar nada", async () => {
    const estado = montar(TERRENO_DE_DUAS_GLEBAS.map((u) => ({ ...u })));
    estado.tabelas.temis_categorias!.push({
      ativa: true,
      enterprise_id: "31",
      id: "cccccccc-0000-4000-8000-000000000099",
      nome: "Condomínio da Lagoa",
      workspace_id: "careli",
    });

    const r = await chamar(estado, {
      acao: "aplicar",
      categoriaId: "cccccccc-0000-4000-8000-000000000099",
      codigo: "VOC",
      enterpriseId: VOC,
      origem: "massa",
      unidadeIds: ["voc-1206"],
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(404);
    expect(r.error).toContain("Categoria não encontrada neste empreendimento");
    expect(linha(estado, "voc-1206")?.categoria_id).toBeNull();
  });
});
