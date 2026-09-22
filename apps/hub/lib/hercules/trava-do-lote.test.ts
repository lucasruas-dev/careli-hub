import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ETAPAS_DO_FLUXO } from "./fluxo-de-venda";
import { estaLivre, lerSituacaoDasUnidades } from "./situacao-da-unidade";
import { type DonoDoLote, fraseDoConflito, outrosDonosDoLote, type QuemEstaGravando } from "./trava-do-lote";

// A TRAVA DO LOTE E O TERRENO, CONTRA UM BANCO EM MEMÓRIA.
//
// Lucas (18/09/2026): *"eu não posso vender dois lotes para pessoas diferentes, eu tomo processo
// por conta disso"*. A trava (`trava-do-lote.ts`) procura OUTRO dono vivo em qualquer linha do
// terreno; quem diz quais linhas são o terreno é a leitura da situação (`situacao-da-unidade.ts`).
// As duas rodam de verdade aqui: se o terreno sair errado, a trava procura dono no lugar errado e
// nenhum teste da trava sozinha perceberia.
//
// ⚠️ O BANCO EM MEMÓRIA É O MESMO DE `criar-reserva.test.ts` (a casa tem um dublê por arquivo de
// teste). Mudou a imitação lá, muda aqui.

// ── O BANCO EM MEMÓRIA ─────────────────────────────────────────────────────────

type Linha = Record<string, unknown>;
type ErroDoBanco = { code: string; message: string };
type Resposta = { data: unknown; error: ErroDoBanco | null };
type Operacao = "insert" | "select" | "update";
type Consulta = { filtros: readonly string[]; n: number; operacao: Operacao; tabela: string };

type Construtor = PromiseLike<Resposta> & {
  eq(coluna: string, valor: unknown): Construtor;
  in(coluna: string, valores: readonly unknown[]): Construtor;
  insert(linha: Linha | Linha[]): Construtor;
  is(coluna: string, valor: null): Construtor;
  maybeSingle(): Construtor;
  not(coluna: string, operador: string, valor: unknown): Construtor;
  or(expressao: string): Construtor;
  order(coluna: string): Construtor;
  range(de: number, ate: number): Construtor;
  select(colunas?: string): Construtor;
  update(patch: Linha): Construtor;
};

type Banco = {
  cliente: SupabaseClient;
  /** Toda consulta executada, na ordem em que chegou ao banco. */
  consultas: Consulta[];
  /** Roda `fazer` UMA vez, logo depois da primeira consulta bem-sucedida que casar com `quando`. */
  depois(quando: (c: Consulta) => boolean, fazer: (banco: Banco) => void): void;
  /** Toda consulta que casar com `quando` volta com erro, como uma conexão que caiu. */
  falhar(quando: (c: Consulta) => boolean): void;
  linhas(tabela: string): Linha[];
  /** Consultas que usaram coluna inexistente ou operador que este banco não imita. */
  problemas: string[];
  semear(tabela: string, linha: Linha): void;
};

const COLUNAS: Record<string, readonly string[]> = {
  hercules_propostas: [
    "aberta", "atualizado_em", "cancelada_em", "cancelamento_pedido_em", "codigo", "criado_em",
    "criado_em_c2x", "etapa",
    "etapa_desde", "id", "origem", "protocolo_numero", "reserva_id", "unidade_id", "workspace_id",
  ],
  hercules_reservas: [
    "atualizado_em", "cancelada_em", "cancelada_motivo", "cancelada_por", "cancelada_por_nome",
    "corretor_entity_id", "criado_em", "criado_por", "criado_por_nome", "empreendimento_id",
    "evento_id", "id", "imobiliaria_entity_id", "observacao", "origem", "prometeu_reserva_id",
    "proponentes", "protocolo_numero", "situacao", "terreno_chave", "unidade_id", "validade_em",
    "venda_id", "workspace_id",
  ],
  hercules_unidades: [
    "atualizado_em", "codigo", "criado_em", "enterprise_id", "espelho_de", "id", "lote",
    "origem_c2x_id", "preco_tabela", "quadra", "situacao", "workspace_id",
  ],
  prometeu_reservas: ["codigo", "evento_id", "id", "lote", "quadra", "situacao", "unidade_c2x_id"],
};

const VIVAS_DA_RESERVA = ["ativa", "proposta"];
const ORIGENS_COM_A_0167 = ["coordenador", "salao", "corretor", "interno", "incorporador"];

const texto = (valor: unknown): null | string =>
  valor === null || valor === undefined ? null : String(valor);

/** Separa por vírgula só no nível de fora (nem dentro de parênteses, nem dentro de aspas). */
function separarNoTopo(expressao: string): string[] {
  const partes: string[] = [];
  let atual = "";
  let nivel = 0;
  let aspas = false;
  for (const ch of expressao) {
    if (ch === '"') aspas = !aspas;
    else if (!aspas && ch === "(") nivel += 1;
    else if (!aspas && ch === ")") nivel -= 1;
    else if (!aspas && nivel === 0 && ch === ",") {
      partes.push(atual);
      atual = "";
      continue;
    }
    atual += ch;
  }
  if (atual.trim()) partes.push(atual);
  return partes;
}

/** Uma condição do `.or()` do PostgREST: `coluna.eq.valor` ou `coluna.in.(a,"b")`. */
function condicaoDoOr(expressao: string): null | { coluna: string; teste: (l: Linha) => boolean } {
  const m = /^([a-z_0-9]+)\.(eq|in)\.(.+)$/.exec(expressao.trim());
  if (!m) return null;
  const coluna = m[1] ?? "";
  const valor = m[3] ?? "";
  if (m[2] === "eq") return { coluna, teste: (l) => texto(l[coluna]) === valor };
  if (!valor.startsWith("(") || !valor.endsWith(")")) return null;
  const aceitos = new Set(
    separarNoTopo(valor.slice(1, -1)).map((v) => v.trim().replace(/^"(.*)"$/, "$1")),
  );
  return {
    coluna,
    teste: (l) => {
      const t = texto(l[coluna]);
      return t !== null && aceitos.has(t);
    },
  };
}

/** As regras de `hercules_reservas` que o banco de verdade faz valer (0125 + 0167). */
function violacao(
  tabela: string,
  linha: Linha,
  outras: readonly Linha[],
  origensAceitas: readonly string[],
): ErroDoBanco | null {
  if (tabela !== "hercules_reservas") return null;
  for (const coluna of ["empreendimento_id", "unidade_id", "origem"]) {
    if (texto(linha[coluna]) === null) {
      return { code: "23502", message: `null value in column "${coluna}" of relation "hercules_reservas"` };
    }
  }
  const check = (nome: string): ErroDoBanco => ({
    code: "23514",
    message: `new row for relation "hercules_reservas" violates check constraint "${nome}"`,
  });
  if (!origensAceitas.includes(String(linha.origem))) return check("hercules_reservas_origem");
  if (!["ativa", "proposta", "vendida", "cancelada", "expirada"].includes(String(linha.situacao))) {
    return check("hercules_reservas_situacao");
  }
  if (linha.origem === "salao" && texto(linha.evento_id) === null) {
    return check("hercules_reservas_salao_tem_evento");
  }
  const viva = (l: Linha) => VIVAS_DA_RESERVA.includes(String(l.situacao));
  if (viva(linha) && outras.some((o) => viva(o) && texto(o.unidade_id) === texto(linha.unidade_id))) {
    return {
      code: "23505",
      message: 'duplicate key value violates unique constraint "hercules_reservas_uma_viva_por_unidade"',
    };
  }
  return null;
}

function criarBanco(
  inicial: Record<string, Linha[]>,
  opcoes: { maxLinhas?: number; origensAceitas?: readonly string[] } = {},
): Banco {
  const maxLinhas = opcoes.maxLinhas ?? 1000;
  const origensAceitas = opcoes.origensAceitas ?? ORIGENS_COM_A_0167;
  const tabelas = new Map<string, Linha[]>();
  const consultas: Consulta[] = [];
  const problemas: string[] = [];
  const falhas: Array<(c: Consulta) => boolean> = [];
  const ganchos: Array<{ fazer: (b: Banco) => void; quando: (c: Consulta) => boolean }> = [];
  let contador = 0;
  const proximo = () => {
    contador += 1;
    return contador;
  };

  const daTabela = (tabela: string): Linha[] => {
    const existente = tabelas.get(tabela);
    if (existente) return existente;
    const nova: Linha[] = [];
    tabelas.set(tabela, nova);
    return nova;
  };

  const comPadroes = (tabela: string, linha: Linha): Linha => {
    const base: Linha = Object.fromEntries((COLUNAS[tabela] ?? []).map((c) => [c, null]));
    const agora = new Date().toISOString();
    if (tabela === "hercules_reservas") {
      Object.assign(base, {
        atualizado_em: agora,
        criado_em: agora,
        id: `res-${proximo()}`,
        proponentes: [],
        protocolo_numero: proximo(),
        situacao: "ativa",
        workspace_id: "careli",
      });
    } else {
      base.id = `${tabela}-${proximo()}`;
    }
    return { ...base, ...linha };
  };

  function from(tabela: string): Construtor {
    let operacao: Operacao = "select";
    let colunas: null | string[] = null;
    let devolver = false;
    let unico = false;
    let carga: Linha[] = [];
    let ordem: null | string = null;
    let faixa: null | readonly [number, number] = null;
    const filtros: Array<(l: Linha) => boolean> = [];
    const descricao: string[] = [];
    const erros: string[] = [];

    const conferir = (coluna: string, onde: string) => {
      const conhecidas = COLUNAS[tabela];
      if (!conhecidas) erros.push(`a tabela ${tabela} não existe`);
      else if (!conhecidas.includes(coluna)) erros.push(`${onde}: a coluna ${tabela}.${coluna} não existe`);
    };

    const projetar = (l: Linha): Linha =>
      colunas ? Object.fromEntries(colunas.map((c) => [c, l[c] ?? null])) : { ...l };

    const saida = (linhas: Linha[]): Resposta => {
      const projetadas = linhas.map(projetar);
      if (!unico) return { data: projetadas, error: null };
      if (projetadas.length > 1) {
        return { data: null, error: { code: "PGRST116", message: "multiple rows returned" } };
      }
      return { data: projetadas[0] ?? null, error: null };
    };

    const responder = (): Resposta => {
      const todas = daTabela(tabela);
      const casa = (l: Linha) => filtros.every((f) => f(l));
      if (operacao === "insert") {
        const novas: Linha[] = [];
        for (const bruta of carga) {
          const nova = comPadroes(tabela, bruta);
          const erro = violacao(tabela, nova, [...todas, ...novas], origensAceitas);
          if (erro) return { data: null, error: erro };
          novas.push(nova);
        }
        todas.push(...novas);
        return devolver ? saida(novas) : { data: null, error: null };
      }
      if (operacao === "update") {
        const alvo = todas.filter(casa);
        const patch = carga[0] ?? {};
        for (const l of alvo) {
          const erro = violacao(tabela, { ...l, ...patch }, todas.filter((o) => o !== l), origensAceitas);
          if (erro) return { data: null, error: erro };
        }
        for (const l of alvo) Object.assign(l, patch);
        return devolver ? saida(alvo) : { data: null, error: null };
      }
      let linhas = todas.filter(casa);
      if (ordem) {
        const coluna = ordem;
        linhas = [...linhas].sort((a, b) => (texto(a[coluna]) ?? "").localeCompare(texto(b[coluna]) ?? ""));
      }
      // ⚠️ O TETO DO POSTGREST: nenhuma resposta passa de `maxLinhas`, peça a faixa que pedir.
      const de = faixa ? faixa[0] : 0;
      const ate = faixa ? faixa[1] + 1 : Number.POSITIVE_INFINITY;
      return saida(linhas.slice(de, Math.min(ate, de + maxLinhas)));
    };

    const executar = (): Resposta => {
      const consulta: Consulta = { filtros: [...descricao], n: consultas.length, operacao, tabela };
      consultas.push(consulta);
      if (erros.length > 0) {
        problemas.push(...erros);
        return { data: null, error: { code: "42703", message: erros.join("; ") } };
      }
      if (falhas.some((f) => f(consulta))) {
        return { data: null, error: { code: "08006", message: "conexão perdida (falha simulada)" } };
      }
      const resposta = responder();
      if (!resposta.error) {
        for (const gancho of [...ganchos]) {
          if (!gancho.quando(consulta)) continue;
          ganchos.splice(ganchos.indexOf(gancho), 1);
          gancho.fazer(banco);
        }
      }
      return resposta;
    };

    const q: Construtor = {
      eq(coluna, valor) {
        conferir(coluna, "eq");
        descricao.push(`eq:${coluna}=${String(valor)}`);
        filtros.push((l) => texto(l[coluna]) !== null && texto(l[coluna]) === texto(valor));
        return q;
      },
      in(coluna, valores) {
        conferir(coluna, "in");
        const aceitos = new Set(valores.map(texto).filter((v): v is string => v !== null));
        descricao.push(`in:${coluna}=${[...aceitos].join(",")}`);
        filtros.push((l) => {
          const t = texto(l[coluna]);
          return t !== null && aceitos.has(t);
        });
        return q;
      },
      insert(linha) {
        operacao = "insert";
        carga = Array.isArray(linha) ? linha : [linha];
        for (const l of carga) for (const coluna of Object.keys(l)) conferir(coluna, "insert");
        return q;
      },
      is(coluna, valor) {
        conferir(coluna, "is");
        if (valor !== null) erros.push(`is(${coluna}) só é imitado com null`);
        descricao.push(`is:${coluna}=null`);
        filtros.push((l) => texto(l[coluna]) === null);
        return q;
      },
      maybeSingle() {
        unico = true;
        return q;
      },
      not(coluna, operador, valor) {
        conferir(coluna, "not");
        if (operador !== "is" || valor !== null) erros.push(`not(${coluna}, ${operador}) não é imitado`);
        descricao.push(`not:${coluna}=null`);
        filtros.push((l) => texto(l[coluna]) !== null);
        return q;
      },
      or(expressao) {
        const condicoes = separarNoTopo(expressao).map(condicaoDoOr);
        const validas = condicoes.filter((c): c is NonNullable<typeof c> => c !== null);
        if (validas.length !== condicoes.length) erros.push(`or(${expressao}) não é imitado`);
        for (const c of validas) conferir(c.coluna, "or");
        descricao.push(`or:${expressao}`);
        filtros.push((l) => validas.some((c) => c.teste(l)));
        return q;
      },
      order(coluna) {
        conferir(coluna, "order");
        ordem = coluna;
        return q;
      },
      range(de, ate) {
        faixa = [de, ate];
        return q;
      },
      select(lista = "*") {
        const pedidas = lista.split(",").map((c) => c.trim()).filter(Boolean);
        colunas = pedidas.includes("*") ? null : pedidas;
        for (const c of colunas ?? []) conferir(c, "select");
        if (operacao !== "select") devolver = true;
        return q;
      },
      then(aceitar, recusar) {
        // Uma volta no laço de eventos por consulta, como na rede: é o que deixa duas reservas
        // simultâneas se entrelaçarem de verdade no teste da corrida.
        return Promise.resolve().then(executar).then(aceitar, recusar);
      },
      update(patch) {
        operacao = "update";
        carga = [patch];
        for (const coluna of Object.keys(patch)) conferir(coluna, "update");
        return q;
      },
    };
    return q;
  }

  const banco: Banco = {
    cliente: { from } as unknown as SupabaseClient,
    consultas,
    depois: (quando, fazer) => {
      ganchos.push({ fazer, quando });
    },
    falhar: (quando) => {
      falhas.push(quando);
    },
    linhas: (tabela) => daTabela(tabela),
    problemas,
    semear: (tabela, linha) => {
      daTabela(tabela).push(comPadroes(tabela, linha));
    },
  };
  for (const [tabela, linhas] of Object.entries(inicial)) for (const l of linhas) banco.semear(tabela, l);
  return banco;
}

// ── O CADASTRO DE TESTE ────────────────────────────────────────────────────────
//
// Vale do Ouro como ele é no banco: o pai (VLO, 35) guarda as linhas antigas, que apontam por
// `espelho_de` para a viva da gleba (VOC 37, VOR 38). O 12-06 MIGROU DE GLEBA: existe na VOC e na
// VOR, e o pai aponta só para a VOR. Rio de Pedras (RDP 50, RPC 51) repete a numeração em áreas
// diferentes e o pai não tem linha nenhuma.

const VLO = "35";
const VOC = "37";
const VOR = "38";
const RDP = "50";
const RPC = "51";

const unidade = (
  id: string,
  codigo: string,
  enterpriseId: string,
  quadra: string,
  lote: string,
  extra: Linha = {},
): Linha => ({
  atualizado_em: "2026-09-01T00:00:00.000Z",
  codigo,
  enterprise_id: enterpriseId,
  espelho_de: null,
  id,
  lote,
  origem_c2x_id: null,
  quadra,
  situacao: "disponivel",
  workspace_id: "careli",
  ...extra,
});

const reservaDoHercules = (id: string, unidadeId: string, extra: Linha = {}): Linha => ({
  empreendimento_id: "emp-vlo",
  id,
  origem: "coordenador",
  situacao: "ativa",
  unidade_id: unidadeId,
  workspace_id: "careli",
  ...extra,
});

/** Proposta importada do legado: sem reserva, origem `c2x`. */
const propostaImportada = (id: string, unidadeId: string, etapa: string, extra: Linha = {}): Linha => ({
  criado_em_c2x: "2025-11-03T00:00:00.000Z",
  etapa,
  etapa_desde: "2026-09-10T12:00:00.000Z",
  id,
  origem: "c2x",
  reserva_id: null,
  unidade_id: unidadeId,
  workspace_id: "careli",
  ...extra,
});

/** O cupom do salão (`prometeu_reservas`), como o tótem antigo gravava. */
const cupomDoSalao = (id: string, codigo: string, unidadeC2xId: null | string, extra: Linha = {}): Linha => ({
  codigo,
  evento_id: "ev-lancamento",
  id,
  situacao: "reservada",
  unidade_c2x_id: unidadeC2xId,
  ...extra,
});

function bancoDaCasa(opcoes?: { maxLinhas?: number; origensAceitas?: readonly string[] }): Banco {
  return criarBanco(
    {
      hercules_propostas: [],
      hercules_reservas: [],
      hercules_unidades: [
        unidade("vlo-0305", "VLO0305", VLO, "03", "05", { espelho_de: "voc-0305", origem_c2x_id: 9001 }),
        unidade("vlo-1206", "VLO1206", VLO, "12", "06", { espelho_de: "vor-1206", origem_c2x_id: 9002 }),
        unidade("voc-0305", "VOC0305", VOC, "03", "05", { origem_c2x_id: 9101 }),
        unidade("voc-0306", "VOC0306", VOC, "03", "06", { origem_c2x_id: 9103 }),
        unidade("voc-1206", "VOC1206", VOC, "12", "06", { origem_c2x_id: 9102 }),
        unidade("vor-1206", "VOR1206", VOR, "12", "06", { origem_c2x_id: 9201 }),
        unidade("rdp-0101", "RDP0101", RDP, "01", "01", { origem_c2x_id: 9501 }),
        unidade("rpc-0101", "RPC0101", RPC, "01", "01", { origem_c2x_id: 9601 }),
      ],
      prometeu_reservas: [],
    },
    opcoes,
  );
}


const bancosDoTeste: Banco[] = [];
function novoBanco(opcoes?: Parameters<typeof bancoDaCasa>[0]): Banco {
  const banco = bancoDaCasa(opcoes);
  bancosDoTeste.push(banco);
  return banco;
}
beforeEach(() => {
  bancosDoTeste.length = 0;
});
afterEach(() => {
  // Nenhuma consulta pode ter usado coluna inexistente ou operador que o banco falso não imita:
  // seria recusa pelo motivo errado.
  for (const banco of bancosDoTeste) expect(banco.problemas).toEqual([]);
});

/** Lê a situação como a porta única lê (pelo empreendimento da linha) e pergunta à trava. */
async function donosDe(
  banco: Banco,
  linhaId: string,
  enterpriseId: string,
  quem: QuemEstaGravando = {},
): Promise<DonoDoLote[] | null> {
  const situacoes = await lerSituacaoDasUnidades(banco.cliente, [enterpriseId]);
  return outrosDonosDoLote(banco.cliente, situacoes, linhaId, quem);
}

const ids = (donos: DonoDoLote[] | null) => (donos ?? []).map((d) => d.id).sort();
const ordenadas = (lista: readonly string[] | undefined) => [...(lista ?? [])].sort();

// ── O TERRENO ──────────────────────────────────────────────────────────────────

describe("o terreno: quais linhas são o MESMO lote", () => {
  it("a família do pai: a linha antiga e a viva para onde ela aponta são um terreno só", async () => {
    const banco = novoBanco();
    const situacoes = await lerSituacaoDasUnidades(banco.cliente, [VOC]);

    const terreno = situacoes.terreno("voc-0305");
    expect(ordenadas(terreno?.linhas)).toEqual(["vlo-0305", "voc-0305"]);
    expect(ordenadas(terreno?.codigos)).toEqual(["VLO0305", "VOC0305"]);
    expect(ordenadas(terreno?.origens)).toEqual(["9001", "9101"]);
    // Perguntar pela linha antiga dá o mesmo terreno.
    expect(ordenadas(situacoes.terreno("vlo-0305")?.linhas)).toEqual(["vlo-0305", "voc-0305"]);
  });

  it.each([
    { pedido: [VOR], quem: "só a VOR" },
    { pedido: [VOC], quem: "só a VOC" },
    { pedido: [VLO], quem: "só o pai" },
    { pedido: [VOC, VOR], quem: "as duas glebas" },
  ])(
    "⚠️ duas glebas (o 12-06 na VOC E na VOR, o pai apontando só para a VOR): pedindo $quem, o terreno é o mesmo",
    async ({ pedido }) => {
      const banco = novoBanco();
      const situacoes = await lerSituacaoDasUnidades(banco.cliente, pedido);
      const esperado = ["vlo-1206", "voc-1206", "vor-1206"];
      expect(ordenadas(situacoes.terreno("vor-1206")?.linhas)).toEqual(esperado);
      expect(ordenadas(situacoes.terreno("voc-1206")?.linhas)).toEqual(esperado);
      expect(ordenadas(situacoes.terreno("vlo-1206")?.linhas)).toEqual(esperado);
    },
  );

  it.each([{ pedido: [VOR] }, { pedido: [VOC] }, { pedido: [VLO] }, { pedido: [VOC, VOR] }])(
    "a situação do 12-06 é uma só, perguntada por $pedido: a proposta viva da VOC pinta a VOR também",
    async ({ pedido }) => {
      const banco = novoBanco();
      banco.semear("hercules_propostas", propostaImportada("p-voc", "voc-1206", "contrato"));
      const situacoes = await lerSituacaoDasUnidades(banco.cliente, pedido);
      expect(situacoes.porLinha.get("vor-1206")?.situacao).toBe("contrato");
      expect(situacoes.porLinha.get("voc-1206")?.situacao).toBe("contrato");
      expect(situacoes.porCodigo.get("VLO1206")?.situacao).toBe("contrato");
      expect(situacoes.porOrigemC2x.get("9002")?.situacao).toBe("contrato");
    },
  );

  it("o lote vizinho (mesma quadra, outro lote) é um terreno só dele", async () => {
    const banco = novoBanco();
    const situacoes = await lerSituacaoDasUnidades(banco.cliente, [VOC]);
    expect(situacoes.terreno("voc-0306")?.linhas).toEqual(["voc-0306"]);
  });

  describe("⚠️ Rio de Pedras: duas glebas com a mesma quadra e lote e SEM linha no pai NÃO são agrupadas", () => {
    it.each([{ pedido: [RDP] }, { pedido: [RPC] }, { pedido: [RDP, RPC] }])(
      "pedindo $pedido, cada lote é o terreno dele",
      async ({ pedido }) => {
        const banco = novoBanco();
        const situacoes = await lerSituacaoDasUnidades(banco.cliente, pedido);
        if (pedido.includes(RDP)) expect(situacoes.terreno("rdp-0101")?.linhas).toEqual(["rdp-0101"]);
        if (pedido.includes(RPC)) expect(situacoes.terreno("rpc-0101")?.linhas).toEqual(["rpc-0101"]);
      },
    );

    it("a proposta da RPC 01-01 não pinta a RDP 01-01, nem a trava a enxerga", async () => {
      const banco = novoBanco();
      banco.semear("hercules_propostas", propostaImportada("p-rpc", "rpc-0101", "contrato"));

      const situacoes = await lerSituacaoDasUnidades(banco.cliente, [RDP, RPC]);
      expect(situacoes.porLinha.get("rdp-0101")?.situacao).toBe("disponivel");
      expect(situacoes.porLinha.get("rpc-0101")?.situacao).toBe("contrato");
      expect(await donosDe(banco, "rdp-0101", RDP)).toEqual([]);
      expect(ids(await donosDe(banco, "rpc-0101", RPC))).toEqual(["p-rpc"]);
    });

    it("o cupom do salão da RPC também não prende a RDP", async () => {
      const banco = novoBanco();
      banco.semear("prometeu_reservas", cupomDoSalao("cupom-rpc", "RPC0101", "9601"));
      expect(await donosDe(banco, "rdp-0101", RDP)).toEqual([]);
      const situacoes = await lerSituacaoDasUnidades(banco.cliente, [RDP]);
      expect(situacoes.porLinha.get("rdp-0101")?.situacao).toBe("disponivel");
    });
  });
});

// ── OS DONOS ───────────────────────────────────────────────────────────────────

describe("outrosDonosDoLote: quem é dono", () => {
  it("lote sem ninguém: lista vazia (e não null)", async () => {
    const banco = novoBanco();
    expect(await donosDe(banco, "vor-1206", VOR)).toEqual([]);
  });

  it.each(["vlo-1206", "voc-1206", "vor-1206"])("reserva viva na linha %s prende o 12-06 inteiro", async (linha) => {
    const banco = novoBanco();
    banco.semear("hercules_reservas", reservaDoHercules("r-1", linha));
    for (const [pergunta, ent] of [
      ["vor-1206", VOR],
      ["voc-1206", VOC],
    ] as const) {
      const donos = await donosDe(banco, pergunta, ent);
      expect(donos).toEqual([{ descricao: "reserva", id: "r-1", tipo: "reserva" }]);
    }
  });

  it("reserva em 'proposta' ainda é viva; cancelada, expirada e vendida não prendem", async () => {
    const banco = novoBanco();
    banco.semear("hercules_reservas", reservaDoHercules("r-proposta", "vlo-0305", { situacao: "proposta" }));
    for (const situacao of ["cancelada", "expirada", "vendida"]) {
      banco.semear("hercules_reservas", reservaDoHercules(`r-${situacao}`, "voc-0305", { situacao }));
    }
    expect(ids(await donosDe(banco, "voc-0305", VOC))).toEqual(["r-proposta"]);
  });

  it("a reserva do salão diz de onde veio", async () => {
    const banco = novoBanco();
    banco.semear(
      "hercules_reservas",
      reservaDoHercules("r-salao", "voc-0305", { evento_id: "ev-lancamento", origem: "salao" }),
    );
    expect(await donosDe(banco, "voc-0305", VOC)).toEqual([
      { descricao: "reserva feita no salão do lançamento", id: "r-salao", tipo: "reserva" },
    ]);
  });

  it.each([...ETAPAS_DO_FLUXO])("proposta viva em '%s' em qualquer linha do terreno é dona", async (etapa) => {
    const banco = novoBanco();
    banco.semear("hercules_propostas", propostaImportada("p-1", "vlo-1206", etapa));
    const donos = await donosDe(banco, "vor-1206", VOR);
    expect(donos?.map((d) => [d.id, d.tipo])).toEqual([["p-1", "proposta"]]);
  });

  it("proposta cancelada ou em distrato não prende", async () => {
    const banco = novoBanco();
    banco.semear("hercules_propostas", propostaImportada("p-c", "voc-0305", "cancelado"));
    banco.semear("hercules_propostas", propostaImportada("p-d", "vlo-0305", "distrato"));
    expect(await donosDe(banco, "voc-0305", VOC)).toEqual([]);
  });

  describe("⚠️ a proposta que nasce da MINHA reserva não é outro dono", () => {
    const montar = () => {
      const banco = novoBanco();
      banco.semear("hercules_reservas", reservaDoHercules("r-minha", "voc-0305", { situacao: "proposta" }));
      banco.semear(
        "hercules_propostas",
        propostaImportada("p-minha", "voc-0305", "proposta", { origem: "panteon", reserva_id: "r-minha" }),
      );
      return banco;
    };

    it("quem grava pela minha reserva não vê nem a reserva nem a proposta dela", async () => {
      expect(await donosDe(montar(), "voc-0305", VOC, { reservaId: "r-minha" })).toEqual([]);
    });

    it("a filha da minha reserva em OUTRA linha do terreno também é a mesma venda", async () => {
      const banco = montar();
      banco.semear(
        "hercules_propostas",
        propostaImportada("p-minha-pai", "vlo-0305", "contrato", { origem: "panteon", reserva_id: "r-minha" }),
      );
      expect(await donosDe(banco, "voc-0305", VOC, { reservaId: "r-minha" })).toEqual([]);
    });

    it("mas a proposta de OUTRA reserva, ou importada, é dona", async () => {
      const banco = montar();
      banco.semear("hercules_propostas", propostaImportada("p-importada", "vlo-0305", "contrato"));
      banco.semear(
        "hercules_propostas",
        propostaImportada("p-outra", "voc-0305", "proposta", { origem: "panteon", reserva_id: "r-outra" }),
      );
      expect(ids(await donosDe(banco, "voc-0305", VOC, { reservaId: "r-minha" }))).toEqual([
        "p-importada",
        "p-outra",
      ]);
    });

    it("sem dizer quem grava, a mesma reserva e a mesma proposta são donas", async () => {
      expect(ids(await donosDe(montar(), "voc-0305", VOC))).toEqual(["p-minha", "r-minha"]);
    });
  });

  describe("os cupons do salão (`prometeu_reservas`)", () => {
    it.each([
      { cupom: cupomDoSalao("c-1", "VOC0305", "9101"), nome: "pelo id do legado da linha viva" },
      { cupom: cupomDoSalao("c-1", "VLO0305", "9001"), nome: "pelo id do legado da linha do pai" },
      { cupom: cupomDoSalao("c-1", "VLO0305", null), nome: "pelo código da linha do pai, sem id" },
      { cupom: cupomDoSalao("c-1", "VOC0305", "0"), nome: "pelo código, com id do legado que não casa" },
    ])("cupom 'reservada' sem reserva do Hércules é dono: $nome", async ({ cupom }) => {
      const banco = novoBanco();
      banco.semear("prometeu_reservas", cupom);
      expect(await donosDe(banco, "voc-0305", VOC)).toEqual([
        { descricao: "reserva antiga do salão do lançamento", id: "c-1", tipo: "reserva_antiga_do_evento" },
      ]);
    });

    it("cupom cancelado no salão não prende", async () => {
      const banco = novoBanco();
      banco.semear("prometeu_reservas", cupomDoSalao("c-1", "VOC0305", "9101", { situacao: "cancelada" }));
      expect(await donosDe(banco, "voc-0305", VOC)).toEqual([]);
    });

    it("⚠️ cupom ligado a reserva do Hércules CANCELADA não prende: quem manda é a reserva", async () => {
      const banco = novoBanco();
      banco.semear("prometeu_reservas", cupomDoSalao("c-1", "VOC0305", "9101"));
      banco.semear(
        "hercules_reservas",
        reservaDoHercules("r-1", "voc-0305", {
          evento_id: "ev-lancamento",
          origem: "salao",
          prometeu_reserva_id: "c-1",
          situacao: "cancelada",
        }),
      );
      expect(await donosDe(banco, "voc-0305", VOC)).toEqual([]);
      const situacoes = await lerSituacaoDasUnidades(banco.cliente, [VOC]);
      expect(situacoes.porLinha.get("voc-0305")?.situacao).toBe("disponivel");
    });

    it("cupom ligado a reserva do Hércules VIVA conta uma vez só, como a reserva", async () => {
      const banco = novoBanco();
      banco.semear("prometeu_reservas", cupomDoSalao("c-1", "VOC0305", "9101"));
      banco.semear(
        "hercules_reservas",
        reservaDoHercules("r-1", "voc-0305", {
          evento_id: "ev-lancamento",
          origem: "salao",
          prometeu_reserva_id: "c-1",
        }),
      );
      expect(ids(await donosDe(banco, "voc-0305", VOC))).toEqual(["r-1"]);
    });

    it("o MEU cupom (o que está originando a reserva no tótem) não é outro dono; o de outra pessoa é", async () => {
      const banco = novoBanco();
      banco.semear("prometeu_reservas", cupomDoSalao("c-meu", "VOC0305", "9101"));
      expect(await donosDe(banco, "voc-0305", VOC, { reservaDoEventoId: "c-meu" })).toEqual([]);
      banco.semear("prometeu_reservas", cupomDoSalao("c-outro", "VLO0305", null, { evento_id: "ev-2" }));
      expect(ids(await donosDe(banco, "voc-0305", VOC, { reservaDoEventoId: "c-meu" }))).toEqual(["c-outro"]);
    });
  });
});

// ── SEM SABER, NÃO VENDE ───────────────────────────────────────────────────────

describe("⚠️ sem saber, não vende: null = conflito", () => {
  it("linha que a leitura não trouxe: null", async () => {
    const banco = novoBanco();
    expect(await donosDe(banco, "nao-existe", VOC)).toBeNull();
    // Linha que existe, mas de um empreendimento que não foi lido nem é da família.
    expect(await donosDe(banco, "rdp-0101", VOC)).toBeNull();
  });

  it("cada uma das leituras da trava que falha devolve null, com ou sem dono no lote", async () => {
    // Com um cupom do salão no terreno a trava faz as quatro leituras (reservas, propostas, cupons
    // do terreno e quais deles o Hércules absorveu). Sem cupom, a quarta nem acontece.
    const comCupom = (b: Banco) => b.semear("prometeu_reservas", cupomDoSalao("c-1", "VOR1206", null));
    for (const comDono of [false, true]) {
      const ensaio = novoBanco();
      comCupom(ensaio);
      const situacoes = await lerSituacaoDasUnidades(ensaio.cliente, [VOR]);
      const inicio = ensaio.consultas.length;
      await outrosDonosDoLote(ensaio.cliente, situacoes, "vor-1206", {});
      const daTrava = ensaio.consultas.slice(inicio).map((c) => c.n);
      expect(daTrava).toHaveLength(4);

      for (const n of daTrava) {
        const banco = novoBanco();
        comCupom(banco);
        if (comDono) banco.semear("hercules_reservas", reservaDoHercules("r-1", "voc-1206"));
        banco.falhar((c) => c.n === n);
        const lida = await lerSituacaoDasUnidades(banco.cliente, [VOR]);
        expect(await outrosDonosDoLote(banco.cliente, lida, "vor-1206", {}), `leitura nº ${n}`).toBeNull();
      }
    }
  });

  it("a frase para quem clicou", () => {
    expect(fraseDoConflito(null)).toBe(
      "Não foi possível confirmar que o lote está livre. Nada foi gravado; tente de novo em instantes.",
    );
    expect(fraseDoConflito([{ descricao: "proposta em contrato", id: "p", tipo: "proposta" }])).toBe(
      "Este lote já tem dono: proposta em contrato. Nada foi gravado.",
    );
    expect(fraseDoConflito([])).toBe("Este lote já tem dono. Nada foi gravado.");
  });
});

// ── A SITUAÇÃO E A TRAVA CONCORDAM ─────────────────────────────────────────────
//
// As duas respondem à mesma pergunta ("este lote tem dono?") por caminhos diferentes: a situação
// pinta a tela, a trava decide a gravação. Se a trava prende e a tela pinta de verde, o cliente
// escolhe um lote que a reserva vai recusar; se a tela prende e a trava solta, a porta única ainda
// segura (confere as duas), mas a proposta, que só confere a trava, não. Na dúvida a regra da casa
// é OCUPADO, e as duas têm que dizer a mesma coisa.

describe("⚠️ a situação e a trava concordam: o que uma prende a outra não solta", () => {
  it.each<{ ent: string; linha: string; nome: string; preparar: (b: Banco) => void }>([
    { ent: VOC, linha: "voc-0305", nome: "lote sem ninguém", preparar: () => undefined },
    {
      ent: VOC,
      linha: "voc-0305",
      nome: "reserva ativa na linha do pai",
      preparar: (b) => b.semear("hercules_reservas", reservaDoHercules("r", "vlo-0305")),
    },
    {
      ent: VOR,
      linha: "vor-1206",
      nome: "proposta viva na irmã da outra gleba",
      preparar: (b) => b.semear("hercules_propostas", propostaImportada("p", "voc-1206", "assinatura")),
    },
    {
      ent: VOC,
      linha: "voc-0305",
      nome: "cupom antigo do salão",
      preparar: (b) => b.semear("prometeu_reservas", cupomDoSalao("c", "VOC0305", "9101")),
    },
    {
      ent: VOC,
      linha: "voc-0305",
      nome: "cupom ligado a reserva do Hércules cancelada",
      preparar: (b) => {
        b.semear("prometeu_reservas", cupomDoSalao("c", "VOC0305", "9101"));
        b.semear(
          "hercules_reservas",
          reservaDoHercules("r", "voc-0305", {
            evento_id: "ev",
            origem: "salao",
            prometeu_reserva_id: "c",
            situacao: "cancelada",
          }),
        );
      },
    },
    {
      ent: RDP,
      linha: "rdp-0101",
      nome: "Rio de Pedras com proposta na RPC",
      preparar: (b) => b.semear("hercules_propostas", propostaImportada("p", "rpc-0101", "contrato")),
    },
    {
      ent: VOC,
      linha: "voc-0305",
      // O estado que o changelog registra: a proposta saiu do fluxo e a reserva ficou parada em
      // `proposta`. O índice da 0125 e a trava a veem viva; a situação só conta reserva `ativa`.
      // ⚠️ HOJE ESTE CASO FICA VERMELHO: a tela pinta "Disponível" um lote que a trava prende. Não
      // vende duas vezes (a porta única recusa no passo 2), mas oferece ao cliente um lote que não
      // se pode reservar, e fere a regra da dúvida (ocupado).
      nome: "⚠️ reserva do Hércules parada em 'proposta', sem proposta viva, cadastro 'disponivel'",
      preparar: (b) => {
        b.semear("hercules_reservas", reservaDoHercules("r", "voc-0305", { situacao: "proposta" }));
        b.semear("hercules_propostas", propostaImportada("p", "voc-0305", "cancelado", { reserva_id: "r" }));
      },
    },
  ])("$nome", async ({ ent, linha, preparar }) => {
    const banco = novoBanco();
    preparar(banco);
    const situacoes = await lerSituacaoDasUnidades(banco.cliente, [ent]);
    const situacao = situacoes.porLinha.get(linha)?.situacao;
    const donos = await outrosDonosDoLote(banco.cliente, situacoes, linha, {});

    expect(situacao).toBeDefined();
    expect(donos).not.toBeNull();
    expect({ livreNaTela: estaLivre(situacao ?? "bloqueada"), situacao }).toEqual({
      livreNaTela: donos?.length === 0,
      situacao,
    });
  });

  it("⚠️ com mais de 1.000 reservas do salão no Hércules, cupom de reserva CANCELADA continua não prendendo", async () => {
    // A leitura dos cupons já ligados (`ligados`, na trava) não pagina, e o PostgREST corta em 1.000
    // linhas. Toda reserva feita pelo tótem desde 18/09/2026 tem `prometeu_reserva_id`, e o cupom
    // continua 'reservada' depois que a reserva do Hércules é cancelada: é a leitura dos ligados que
    // o solta. Passadas 1.000, o cupom que ficar fora da página volta a contar como dono.
    // ⚠️ HOJE ESTE CASO FICA VERMELHO: a situação (que pagina) diz "Disponível" e a trava recusa. É
    // o lado seguro (não vende duas vezes), mas trava lote livre sem ninguém saber por quê.
    const banco = novoBanco();
    for (let i = 0; i < 1000; i += 1) {
      banco.semear(
        "hercules_reservas",
        reservaDoHercules(`r-antiga-${i}`, "voc-0306", {
          evento_id: "ev-lancamento",
          origem: "salao",
          prometeu_reserva_id: `c-antigo-${i}`,
          situacao: "cancelada",
        }),
      );
    }
    banco.semear("prometeu_reservas", cupomDoSalao("c-alvo", "VOC0305", "9101"));
    banco.semear(
      "hercules_reservas",
      reservaDoHercules("r-alvo", "voc-0305", {
        evento_id: "ev-lancamento",
        origem: "salao",
        prometeu_reserva_id: "c-alvo",
        situacao: "cancelada",
      }),
    );

    const situacoes = await lerSituacaoDasUnidades(banco.cliente, [VOC]);
    expect(situacoes.porLinha.get("voc-0305")?.situacao).toBe("disponivel");
    expect(await outrosDonosDoLote(banco.cliente, situacoes, "voc-0305", {})).toEqual([]);
  });
});

// ── O TERRENO JUNTA, NUNCA PARTE (18/09/2026, achados da revisão) ─────────────────────────
//
// Terreno partido é o mesmo chão em dois grupos: o dono de um grupo não prende o outro, e o lote
// é vendido duas vezes. Duas formas de partir que a primeira versão tinha.

describe("⚠️ o terreno junta, nunca parte", () => {
  it("duas linhas do pai apontando para a mesma viva: o dono da PRIMEIRA prende a viva", async () => {
    // A primeira versão dava um grupo a cada linha do pai e gravava o da viva por cima: ficava o
    // da última lida, e a reserva na primeira não prendia nada.
    const banco = novoBanco();
    banco.semear(
      "hercules_unidades",
      unidade("vlo-0305b", "VLO0305B", VLO, "03", "05", { espelho_de: "voc-0305", origem_c2x_id: 9003 }),
    );
    banco.semear("hercules_reservas", reservaDoHercules("r-no-pai", "vlo-0305"));

    const situacoes = await lerSituacaoDasUnidades(banco.cliente, [VOC]);
    expect(situacoes.porLinha.get("voc-0305")?.situacao).toBe("reservado");
    expect(situacoes.terreno("voc-0305")?.linhas.sort()).toEqual(["vlo-0305", "vlo-0305b", "voc-0305"]);
    const donos = await outrosDonosDoLote(banco.cliente, situacoes, "voc-0305", {});
    expect(donos?.map((d) => d.id)).toEqual(["r-no-pai"]);
  });

  it("quadra e lote com e sem zero à esquerda são o mesmo chão", async () => {
    // A carga grava "06" hoje (medido em 18/09/2026: nenhum caso misto no banco). Basta uma linha
    // escrita "6" para a irmã da outra gleba sair livre com a venda em contrato do lado.
    const banco = novoBanco();
    banco.semear(
      "hercules_unidades",
      unidade("vlo-1301", "VLO1301", VLO, "13", "01", { espelho_de: "voc-1301", origem_c2x_id: 9004 }),
    );
    banco.semear("hercules_unidades", unidade("voc-1301", "VOC1301", VOC, "13", "01", { origem_c2x_id: 9104 }));
    banco.semear("hercules_unidades", unidade("vor-131", "VOR131", VOR, "13", "1", { origem_c2x_id: 9204 }));
    banco.semear("hercules_propostas", propostaImportada("p-vor", "vor-131", "contrato"));

    const situacoes = await lerSituacaoDasUnidades(banco.cliente, [VOC]);
    expect(situacoes.porLinha.get("voc-1301")?.situacao).toBe("contrato");
    const donos = await outrosDonosDoLote(banco.cliente, situacoes, "voc-1301", {});
    expect(donos?.map((d) => d.id)).toEqual(["p-vor"]);
  });

  it("zero à esquerda não junta lotes diferentes", async () => {
    const banco = novoBanco();
    banco.semear("hercules_unidades", unidade("vor-1210", "VOR1210", VOR, "12", "10", { origem_c2x_id: 9205 }));
    banco.semear("hercules_propostas", propostaImportada("p-1210", "vor-1210", "contrato"));

    const situacoes = await lerSituacaoDasUnidades(banco.cliente, [VOR]);
    expect(situacoes.porLinha.get("vor-1206")?.situacao).toBe("disponivel");
    expect(situacoes.porLinha.get("vor-1210")?.situacao).toBe("contrato");
  });
});

describe("⚠️ a irmã da outra gleba com dono no cadastro prende o chão (a mesma regra do espelho público)", () => {
  it("VOR vendida no cadastro: a VOC do mesmo terreno não sai livre, e a porta recusa", async () => {
    const banco = novoBanco();
    banco.semear("hercules_unidades", unidade("vor-1206b", "VOR1206B", VOR, "12", "6", { situacao: "vendida" }));
    const situacoes = await lerSituacaoDasUnidades(banco.cliente, [VOC]);
    expect(situacoes.porLinha.get("voc-1206")?.situacao).toBe("vendida");
    expect(estaLivre(situacoes.porLinha.get("voc-1206")?.situacao ?? "disponivel")).toBe(false);
  });

  it("irmã BLOQUEADA não prende: é a carteira de onde o lote saiu", async () => {
    const banco = novoBanco();
    banco.semear("hercules_unidades", unidade("vor-1206b", "VOR1206B", VOR, "12", "06", { situacao: "bloqueada" }));
    const situacoes = await lerSituacaoDasUnidades(banco.cliente, [VOC]);
    expect(situacoes.porLinha.get("voc-1206")?.situacao).toBe("disponivel");
  });
});
