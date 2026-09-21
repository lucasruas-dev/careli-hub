import { describe, expect, it } from "vitest";

import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";

import {
  ehCarimboDoVinculoIndisponivel,
  executarVinculoDeUnidades,
  resolverFamilia,
} from "./vinculo-de-unidades-servidor";

// O VÍNCULO DA UNIDADE, com o banco simulado em memória.
//
// ⚠️ O QUE ESTE ARQUIVO TRAVA:
//   • os TRÊS caminhos (planilha, ficha, massa) caem na mesma porta e produzem a mesma gravação;
//   • o gêmeo do pai é carimbado junto, sempre (0161);
//   • quem já está na categoria não é regravado (não suja `atualizado_em` nem o carimbo);
//   • a categoria precisa ser da FAMÍLIA — a do pai vale para a gleba, a de outro produto não;
//   • mudar a divisão exige confirmação explícita e recusa unidade com venda viva, com frase;
//   • o carimbo da 0181 pode não existir: a gravação repete sem ele e o vínculo entra igual;
//   • prévia não escreve nada.

const PAI = "31";
const LBR = "27";
const LBP = "32";
const VLO = "35";

const CONDOMINIO = "cccccccc-0000-4000-8000-000000000001";
const LOTEAMENTO = "cccccccc-0000-4000-8000-000000000002";
const DE_OUTRO = "cccccccc-0000-4000-8000-000000000003";

const AUTOR = { id: "11111111-1111-4111-8111-111111111111", nome: "Lucas" };
const AGORA = new Date("2026-09-21T12:00:00.000Z");

const CADASTRO: LinhaDoCadastro[] = [
  { c2xEnterpriseId: PAI, cidade: null, codigo: "LAB", id: "emp-pai", nome: "Lagoa Bonita", ordem: 1, paiId: null, uf: null, vendendo: true },
  { c2xEnterpriseId: LBR, cidade: null, codigo: "LBR", id: "emp-lbr", nome: "Lagoa Bonita Residencial", ordem: 2, paiId: "emp-pai", uf: null, vendendo: true },
  { c2xEnterpriseId: LBP, cidade: null, codigo: "LBP", id: "emp-lbp", nome: "Lagoa Bonita Parque", ordem: 3, paiId: "emp-pai", uf: null, vendendo: true },
  { c2xEnterpriseId: VLO, cidade: null, codigo: "VLO", id: "emp-vlo", nome: "Vale do Ouro", ordem: 4, paiId: null, uf: null, vendendo: true },
] as unknown as LinhaDoCadastro[];

type Linha = Record<string, unknown>;

type Banco = {
  categorias: Linha[];
  propostas: Linha[];
  reservas: Linha[];
  /** `true` = a migration 0181 ainda não foi aplicada. */
  semCarimbo: boolean;
  unidades: Linha[];
  updates: { mudanca: Linha; tabela: string }[];
};

/**
 * O menor Supabase que serve: `from().select()/update()` com `eq`, `in`, `not`, `order`, `range`.
 *
 * ⚠️ ELE RECUSA AS COLUNAS DO CARIMBO quando `semCarimbo` está ligado, com o MESMO código do
 * PostgREST (PGRST204 nomeando a coluna). É assim que o teste prova que o vínculo entra com a 0181
 * pendente, em vez de confiar que entra.
 */
function bancoDuble(inicial: Partial<Banco> = {}) {
  const banco: Banco = {
    categorias: [],
    propostas: [],
    reservas: [],
    semCarimbo: false,
    unidades: [],
    updates: [],
    ...inicial,
  };

  const CARIMBO = ["vinculo_em", "vinculo_por", "vinculo_por_nome", "vinculo_origem"];

  function consulta(tabela: string) {
    const filtros: [string, string, unknown][] = [];
    let operacao: "select" | "update" = "select";
    let payload: Linha = {};
    let colunas = "";
    let faixa: null | [number, number] = null;

    const linhasDaTabela = (): Linha[] =>
      tabela === "hercules_unidades"
        ? banco.unidades
        : tabela === "temis_categorias"
          ? banco.categorias
          : tabela === "hercules_propostas"
            ? banco.propostas
            : tabela === "hercules_reservas"
              ? banco.reservas
              : [];

    const casa = (linha: Linha): boolean =>
      filtros.every(([tipo, coluna, valor]) => {
        if (tipo === "eq") return String(linha[coluna]) === String(valor);
        if (tipo === "in") return (valor as unknown[]).map(String).includes(String(linha[coluna]));
        if (tipo === "not-in") return !(valor as string[]).includes(String(linha[coluna]));
        return true;
      });

    const erroDoCarimbo = (nomes: string[]) => {
      const ausente = banco.semCarimbo ? CARIMBO.find((c) => nomes.includes(c)) : undefined;
      return ausente
        ? {
            code: "PGRST204",
            message: `Could not find the '${ausente}' column of 'hercules_unidades' in the schema cache`,
          }
        : null;
    };

    const executar = () => {
      if (operacao === "update") {
        const erro = erroDoCarimbo(Object.keys(payload));
        if (erro) return { data: null, error: erro };
        const atingidas = linhasDaTabela().filter(casa);
        for (const linha of atingidas) Object.assign(linha, payload);
        banco.updates.push({ mudanca: { ...payload }, tabela });
        return { data: atingidas.map((l) => ({ id: l.id })), error: null };
      }

      const erro = erroDoCarimbo(colunas.split(",").map((c) => c.trim()));
      if (erro) return { data: null, error: erro };

      let linhas = linhasDaTabela().filter(casa);
      if (faixa) linhas = linhas.slice(faixa[0], faixa[1] + 1);
      return { data: linhas.map((l) => ({ ...l })), error: null };
    };

    const construtor = {
      eq(coluna: string, valor: unknown) {
        filtros.push(["eq", coluna, valor]);
        return construtor;
      },
      in(coluna: string, valores: unknown[]) {
        filtros.push(["in", coluna, valores]);
        return construtor;
      },
      not(coluna: string, _operador: string, lista: string) {
        filtros.push(["not-in", coluna, lista.replace(/[()"]/g, "").split(",")]);
        return construtor;
      },
      order() {
        return construtor;
      },
      range(de: number, ate: number) {
        faixa = [de, ate];
        return construtor;
      },
      select(cols = "") {
        colunas = cols;
        return construtor;
      },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve(executar()).then(resolve);
      },
      update(valores: Linha) {
        operacao = "update";
        payload = valores;
        return construtor;
      },
    };

    return construtor;
  }

  return { admin: { from: (tabela: string) => consulta(tabela) } as never, banco };
}

/** O par pai + gleba do mesmo chão, como o Lagoa Bonita tem hoje. */
function terreno(chave: string, quadra: string, lote: string, extras: Linha = {}): Linha[] {
  return [
    {
      apartamento: null,
      categoria_id: null,
      codigo: `LAB${quadra}0${lote}`,
      enterprise_id: PAI,
      espelho_de: `${chave}-gleba`,
      id: `${chave}-pai`,
      lote: `0${lote}`,
      quadra,
      situacao: "disponivel",
      torre: null,
      workspace_id: "careli",
      ...extras,
    },
    {
      apartamento: null,
      categoria_id: null,
      codigo: `LBR${quadra}0${lote}`,
      enterprise_id: LBR,
      espelho_de: null,
      id: `${chave}-gleba`,
      lote,
      quadra,
      situacao: "disponivel",
      torre: null,
      workspace_id: "careli",
      ...extras,
    },
  ];
}

const CATEGORIAS: Linha[] = [
  { ativa: true, enterprise_id: PAI, id: CONDOMINIO, nome: "Condomínio", workspace_id: "careli" },
  { ativa: true, enterprise_id: PAI, id: LOTEAMENTO, nome: "Loteamento", workspace_id: "careli" },
  { ativa: true, enterprise_id: VLO, id: DE_OUTRO, nome: "Caução", workspace_id: "careli" },
];

function montar(extras: Partial<Banco> = {}) {
  return bancoDuble({
    categorias: CATEGORIAS,
    unidades: [...terreno("c01", "C", "1"), ...terreno("c02", "C", "2"), ...terreno("d01", "D", "1")],
    ...extras,
  });
}

async function chamar(corpo: Record<string, unknown>, duble: ReturnType<typeof montar>) {
  return executarVinculoDeUnidades({
    agora: AGORA,
    autor: AUTOR,
    corpo: { codigo: "LBR", enterpriseId: LBR, ...corpo },
    duble: { admin: duble.admin, cadastro: CADASTRO },
  });
}

describe("resolverFamilia", () => {
  it("sobe ao pai a partir da gleba, e desce a todas as irmãs", () => {
    const r = resolverFamilia(CADASTRO, { enterpriseId: LBR });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.ids.sort()).toEqual([LBR, PAI, LBP].sort());
  });

  // ⚠️ A FICHA CONSOLIDADA NÃO TEM ID DE EMPREENDIMENTO: o Apolo monta "group:Lagoa Bonita", que é
  // rótulo e não chave. Foi assim que as categorias do LAB sumiram da tela.
  it("a ficha consolidada volta pelo código", () => {
    const r = resolverFamilia(CADASTRO, { codigo: "LBP", enterpriseId: "group:Lagoa Bonita" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.nome).toBe("Lagoa Bonita");
  });

  it("empreendimento que não existe é 404", () => {
    const r = resolverFamilia(CADASTRO, { enterpriseId: "999" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });
});

describe("universo", () => {
  it("devolve um terreno por linha, com as categorias e as divisões da família", async () => {
    const duble = montar();
    const r = await chamar({ acao: "universo" }, duble);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const data = r.data as {
      categorias: unknown[];
      divisoes: unknown[];
      unidades: { id: string }[];
    };
    // 3 terrenos, e não 6 linhas: a do pai é espelho da da gleba.
    expect(data.unidades.map((u) => u.id).sort()).toEqual(["c01-gleba", "c02-gleba", "d01-gleba"]);
    expect(data.categorias).toHaveLength(2);
    expect(data.divisoes).toHaveLength(3);
  });

  it("o filtro recorta por quadra e por faixa de lotes", async () => {
    const duble = montar();
    const r = await chamar({ acao: "universo", filtro: { faixa: "1", quadras: ["C"] } }, duble);
    if (!r.ok) throw new Error("esperava sucesso");
    expect((r.data as { unidades: { id: string }[] }).unidades.map((u) => u.id)).toEqual(["c01-gleba"]);
  });
});

describe("prévia", () => {
  it("não escreve nada e conta o gêmeo", async () => {
    const duble = montar();
    const r = await chamar(
      { acao: "previa", categoriaId: CONDOMINIO, unidadeIds: ["c01-gleba"] },
      duble,
    );
    if (!r.ok) throw new Error("esperava sucesso");
    const data = r.data as { categorias: { previa: { ids: string[]; porParentesco: number } }[] };
    expect(data.categorias[0]?.previa.ids.sort()).toEqual(["c01-gleba", "c01-pai"]);
    expect(data.categorias[0]?.previa.porParentesco).toBe(1);
    expect(duble.banco.updates).toEqual([]);
  });
});

describe("aplicar — o caminho em massa", () => {
  it("carimba o terreno inteiro e grava quem, quando e por onde", async () => {
    const duble = montar();
    const r = await chamar(
      { acao: "aplicar", categoriaId: CONDOMINIO, origem: "massa", unidadeIds: ["c01-gleba"] },
      duble,
    );
    if (!r.ok) throw new Error("esperava sucesso");
    expect((r.data as { gravadas: number }).gravadas).toBe(2);

    const pai = duble.banco.unidades.find((u) => u.id === "c01-pai");
    const gleba = duble.banco.unidades.find((u) => u.id === "c01-gleba");
    expect(pai?.categoria_id).toBe(CONDOMINIO);
    expect(gleba?.categoria_id).toBe(CONDOMINIO);
    expect(gleba?.vinculo_por_nome).toBe("Lucas");
    expect(gleba?.vinculo_por).toBe(AUTOR.id);
    expect(gleba?.vinculo_origem).toBe("massa");
    expect(gleba?.vinculo_em).toBe(AGORA.toISOString());
  });

  // ⚠️ REGRAVAR O MESMO VALOR SUJARIA `atualizado_em` E O CARIMBO DE 907 LINHAS À TOA.
  it("quem já está na categoria não é regravado", async () => {
    const duble = montar({
      categorias: CATEGORIAS,
      unidades: [...terreno("c01", "C", "1", { categoria_id: CONDOMINIO })],
    });
    const r = await chamar(
      { acao: "aplicar", categoriaId: CONDOMINIO, unidadeIds: ["c01-gleba"] },
      duble,
    );
    if (!r.ok) throw new Error("esperava sucesso");
    expect((r.data as { gravadas: number }).gravadas).toBe(0);
    expect(duble.banco.updates).toEqual([]);
  });

  it("tirar a categoria manda null", async () => {
    const duble = montar({
      categorias: CATEGORIAS,
      unidades: [...terreno("c01", "C", "1", { categoria_id: CONDOMINIO })],
    });
    const r = await chamar({ acao: "aplicar", categoriaId: null, unidadeIds: ["c01-gleba"] }, duble);
    if (!r.ok) throw new Error("esperava sucesso");
    expect(duble.banco.unidades.every((u) => u.categoria_id === null)).toBe(true);
  });

  // ⚠️ A CATEGORIA DE OUTRO EMPREENDIMENTO SAIRIA EM CONTRATO, e nada na tela denunciaria.
  it("recusa categoria fora da família, com a frase", async () => {
    const duble = montar();
    const r = await chamar({ acao: "aplicar", categoriaId: DE_OUTRO, unidadeIds: ["c01-gleba"] }, duble);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(404);
      expect(r.error).toContain("Categoria não encontrada");
    }
    expect(duble.banco.updates).toEqual([]);
  });

  it("sem unidade escolhida é 422", async () => {
    const duble = montar();
    const r = await chamar({ acao: "aplicar", categoriaId: CONDOMINIO, unidadeIds: [] }, duble);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(422);
  });
});

describe("aplicar — o caminho unitário (a ficha)", () => {
  it("um id só é o caminho em massa com um item, e o gêmeo vai junto", async () => {
    const duble = montar();
    const r = await chamar(
      { acao: "aplicar", categoriaId: LOTEAMENTO, origem: "ficha", unidadeIds: ["d01-gleba"] },
      duble,
    );
    if (!r.ok) throw new Error("esperava sucesso");
    expect((r.data as { gravadas: number; terrenos: number }).terrenos).toBe(1);
    expect(duble.banco.unidades.find((u) => u.id === "d01-pai")?.categoria_id).toBe(LOTEAMENTO);
    expect(duble.banco.unidades.find((u) => u.id === "d01-gleba")?.vinculo_origem).toBe("ficha");
  });
});

describe("aplicar — o caminho da planilha", () => {
  it("casa por quadra e lote e diz o que não casou", async () => {
    const duble = montar();
    const r = await chamar(
      {
        acao: "aplicar",
        csv: "Quadra;Lote;Categoria\nC;01;CONDOMINIO\nZ;99;Condomínio\nD;01;Caução\n",
        origem: "planilha",
      },
      duble,
    );
    if (!r.ok) throw new Error("esperava sucesso");
    const data = r.data as {
      gravadas: number;
      planilha: { naoCasaram: { motivo: string }[]; resumo: { total: number } };
    };
    expect(data.gravadas).toBe(2);
    expect(data.planilha.resumo.total).toBe(3);
    expect(data.planilha.naoCasaram.map((n) => n.motivo).join(" ")).toContain("Nenhum lote");
    expect(data.planilha.naoCasaram.map((n) => n.motivo).join(" ")).toContain('"Caução" não existe');
    expect(duble.banco.unidades.find((u) => u.id === "c01-pai")?.categoria_id).toBe(CONDOMINIO);
    expect(duble.banco.unidades.find((u) => u.id === "d01-gleba")?.categoria_id).toBeNull();
  });

  it("planilha vazia é 400", async () => {
    const duble = montar();
    const r = await chamar({ acao: "aplicar", csv: "Quadra;Lote\n" }, duble);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});

describe("a divisão", () => {
  it("sem confirmação explícita, não move nada", async () => {
    const duble = montar();
    const r = await chamar(
      { acao: "aplicar", divisaoDestino: LBP, unidadeIds: ["c01-gleba"] },
      duble,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.error).toContain("confirmação");
    }
    expect(duble.banco.updates).toEqual([]);
  });

  it("com confirmação, move e devolve os avisos", async () => {
    const duble = montar();
    const r = await chamar(
      { acao: "aplicar", confirmarDivisao: true, divisaoDestino: LBP, unidadeIds: ["c01-gleba"] },
      duble,
    );
    if (!r.ok) throw new Error("esperava sucesso");
    const data = r.data as { avisos: string[]; movidas: number };
    expect(data.movidas).toBe(1);
    expect(duble.banco.unidades.find((u) => u.id === "c01-gleba")?.enterprise_id).toBe(LBP);
    expect(data.avisos.join(" ")).toContain("masterplan");
  });

  // ⚠️ RECUSA COM FRASE, e não aviso: trocar a divisão no meio da negociação troca a minuta, a
  // comissão e quem enxerga o lote no portal.
  it("recusa a unidade com proposta viva, e nada é gravado", async () => {
    const duble = montar({
      categorias: CATEGORIAS,
      propostas: [{ etapa: "proposta", unidade_id: "c01-gleba", workspace_id: "careli" }],
      unidades: [...terreno("c01", "C", "1")],
    });
    const r = await chamar(
      { acao: "aplicar", confirmarDivisao: true, divisaoDestino: LBP, unidadeIds: ["c01-gleba"] },
      duble,
    );
    if (!r.ok) throw new Error("esperava sucesso com recusa por unidade");
    const data = r.data as { movidas: number; recusas: { motivo: string }[] };
    expect(data.movidas).toBe(0);
    expect(data.recusas[0]?.motivo).toContain("venda em andamento");
    expect(duble.banco.unidades.find((u) => u.id === "c01-gleba")?.enterprise_id).toBe(LBR);
  });

  it("recusa a unidade com reserva viva", async () => {
    const duble = montar({
      categorias: CATEGORIAS,
      reservas: [{ situacao: "ativa", unidade_id: "c01-gleba", workspace_id: "careli" }],
      unidades: [...terreno("c01", "C", "1")],
    });
    const r = await chamar(
      { acao: "aplicar", confirmarDivisao: true, divisaoDestino: LBP, unidadeIds: ["c01-gleba"] },
      duble,
    );
    if (!r.ok) throw new Error("esperava sucesso com recusa por unidade");
    expect((r.data as { recusas: { motivo: string }[] }).recusas[0]?.motivo).toContain(
      "venda em andamento",
    );
  });

  it("a categoria e a divisão podem ir na mesma planilha", async () => {
    const duble = montar();
    const r = await chamar(
      {
        acao: "aplicar",
        confirmarDivisao: true,
        csv: "Quadra;Lote;Categoria;Divisão\nC;01;Condomínio;LBP\n",
        origem: "planilha",
      },
      duble,
    );
    if (!r.ok) throw new Error("esperava sucesso");
    expect(duble.banco.unidades.find((u) => u.id === "c01-gleba")?.enterprise_id).toBe(LBP);
    expect(duble.banco.unidades.find((u) => u.id === "c01-gleba")?.categoria_id).toBe(CONDOMINIO);
  });
});

describe("a migration 0181 pendente", () => {
  it("é reconhecida pelo código e pelo nome da coluna", () => {
    expect(
      ehCarimboDoVinculoIndisponivel({ code: "PGRST204", message: "Could not find the 'vinculo_em' column" }),
    ).toBe(true);
    expect(
      ehCarimboDoVinculoIndisponivel({ code: "23514", message: "hercules_unidades_vinculo_origem_valida" }),
    ).toBe(true);
    // ⚠️ E NUNCA SEM O NOME: engolir erro de outra coluna esconderia o defeito.
    expect(
      ehCarimboDoVinculoIndisponivel({ code: "42703", message: "column categoria_id does not exist" }),
    ).toBe(false);
  });

  // ⚠️ O VÍNCULO É O QUE NÃO PODE FALTAR. Sem a 0181 o carimbo some e o carimbo é o detalhe.
  it("o vínculo entra mesmo sem as colunas do carimbo", async () => {
    const duble = montar({
      categorias: CATEGORIAS,
      semCarimbo: true,
      unidades: [...terreno("c01", "C", "1")],
    });
    const r = await chamar(
      { acao: "aplicar", categoriaId: CONDOMINIO, unidadeIds: ["c01-gleba"] },
      duble,
    );
    if (!r.ok) throw new Error("esperava sucesso");
    const data = r.data as { gravadas: number; semCarimbo: boolean };
    expect(data.gravadas).toBe(2);
    expect(data.semCarimbo).toBe(true);
    expect(duble.banco.unidades.find((u) => u.id === "c01-gleba")?.categoria_id).toBe(CONDOMINIO);
    expect(duble.banco.unidades.find((u) => u.id === "c01-gleba")?.vinculo_em).toBeUndefined();
  });
});

// ── O QUE A PORTA ANTIGA MEDIA, E QUE AGORA É MEDIDO AQUI ───────────────────
//
// O PATCH de `/api/temis/categorias/unidades` foi aposentado em 21/09/2026 (410, apontando para
// esta porta). Os dois casos que o teste dele travava — o apartamento e o lote sem quadra e sem
// lote — continuam valendo, e passam a ser conferidos contra quem responde por eles hoje.
describe("as linhas sem chave de terreno", () => {
  it("escolher um apartamento carimba só ele, e não o prédio inteiro", async () => {
    // ⚠️ TODO APARTAMENTO TEM QUADRA E LOTE NULOS, e é por isso que ele era perigoso: pela chave de
    // quadra + lote os dois dividiam a mesma chave vazia "|". A identidade do terreno é a linha
    // (`espelho_de ?? id`), então cada apartamento responde por si.
    const apartamento = (id: string, numero: string): Linha => ({
      apartamento: numero,
      categoria_id: null,
      codigo: `LBR-T1-${numero}`,
      enterprise_id: LBR,
      espelho_de: null,
      id,
      lote: null,
      quadra: null,
      situacao: "disponivel",
      torre: "1",
      workspace_id: "careli",
    });
    const duble = montar({
      categorias: CATEGORIAS,
      unidades: [apartamento("apto-101", "101"), apartamento("apto-102", "102")],
    });

    const r = await chamar(
      { acao: "aplicar", categoriaId: CONDOMINIO, unidadeIds: ["apto-101"] },
      duble,
    );
    if (!r.ok) throw new Error("esperava sucesso");
    expect((r.data as { gravadas: number }).gravadas).toBe(1);
    expect(duble.banco.unidades.find((u) => u.id === "apto-101")?.categoria_id).toBe(CONDOMINIO);
    expect(duble.banco.unidades.find((u) => u.id === "apto-102")?.categoria_id).toBeNull();
  });

  it("o lote sem quadra e sem lote carimba só ele, e não arrasta os outros iguais", async () => {
    // A porta antiga RECUSAVA a seleção inteira com 409 ("há unidade sem quadra e sem lote"), porque
    // todos esses lotes dividiam a chave "|" e um arrastaria os outros. Com a identidade por linha a
    // trava deixou de ser necessária: o cadastro continua torto, mas o carimbo não escorrega.
    const semChave = (id: string): Linha => ({
      apartamento: null,
      categoria_id: null,
      codigo: id.toUpperCase(),
      enterprise_id: LBR,
      espelho_de: null,
      id,
      lote: null,
      quadra: null,
      situacao: "disponivel",
      torre: null,
      workspace_id: "careli",
    });
    const duble = montar({
      categorias: CATEGORIAS,
      unidades: [semChave("sem-chave-1"), semChave("sem-chave-2")],
    });

    const r = await chamar(
      { acao: "aplicar", categoriaId: CONDOMINIO, unidadeIds: ["sem-chave-1"] },
      duble,
    );
    if (!r.ok) throw new Error("esperava sucesso");
    expect((r.data as { gravadas: number }).gravadas).toBe(1);
    expect(duble.banco.unidades.find((u) => u.id === "sem-chave-2")?.categoria_id).toBeNull();
  });
});
