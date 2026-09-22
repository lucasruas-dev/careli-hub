import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import { criarReservaNoHercules, type NovaReservaNoHercules } from "./criar-reserva";
import { estaLivre, lerSituacaoDasUnidades } from "./situacao-da-unidade";
import { outrosDonosDoLote } from "./trava-do-lote";

// A PORTA ÚNICA DA RESERVA, CONTRA UM BANCO EM MEMÓRIA.
//
// Lucas (18/09/2026): *"isso é extremamente critico no nosso negocio, eu não posso vender dois
// lotes para pessoas diferentes, eu tomo processo por conta disso. revisa bem revisado e nunca
// permita que isso aconteça"*.
//
// ⚠️ NADA AQUI É DUBLÊ DA REGRA. `criar-reserva.ts`, `trava-do-lote.ts` e `situacao-da-unidade.ts`
// rodam de verdade; o que é trocado é só o Supabase, por um banco que APLICA os filtros (eq, in,
// not is null, is null, or, order, range), respeita o teto de 1.000 linhas do PostgREST, a CHECK de
// origem e o índice `hercules_reservas_uma_viva_por_unidade` (0125). Um dublê que devolvesse a
// resposta pronta provaria só a si mesmo: a pergunta aqui é justamente se os filtros que o código
// manda ao banco acham o dono em QUALQUER linha do terreno.
//
// ⚠️ O BANCO RECUSA COLUNA QUE NÃO EXISTE (as listas abaixo saem das migrations 0112, 0125, 0126,
// 0130, 0131, 0161). Cada teste termina conferindo que nenhuma consulta caiu nisso: uma coluna com
// nome errado viraria "falha de leitura", a trava recusaria tudo e o teste passaria pelo motivo
// errado.

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
    "criado_em_c2x", "data_faturamento", "etapa",
    "etapa_desde", "id", "origem", "origem_c2x_id", "protocolo_numero", "reserva_id", "unidade_id", "workspace_id",
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

/** As regras de `hercules_reservas` que o banco de verdade faz valer (0125 + 0167 + 0176). */
function violacao(
  tabela: string,
  linha: Linha,
  outras: readonly Linha[],
  origensAceitas: readonly string[],
  com0176 = true,
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
  // 0176: uma reserva viva por terreno, quando a chave veio.
  const chave = texto(linha.terreno_chave);
  if (
    com0176 &&
    viva(linha) &&
    chave !== null &&
    outras.some(
      (o) => viva(o) && texto(o.terreno_chave) === chave && texto(o.workspace_id) === texto(linha.workspace_id),
    )
  ) {
    return {
      code: "23505",
      message: 'duplicate key value violates unique constraint "hercules_reservas_um_dono_por_terreno"',
    };
  }
  return null;
}

function criarBanco(
  inicial: Record<string, Linha[]>,
  opcoes: { maxLinhas?: number; origensAceitas?: readonly string[]; sem0176?: boolean } = {},
): Banco {
  const maxLinhas = opcoes.maxLinhas ?? 1000;
  const origensAceitas = opcoes.origensAceitas ?? ORIGENS_COM_A_0167;
  const com0176 = opcoes.sem0176 !== true;
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
    let semAColunaDoTerreno = false;

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
          const erro = violacao(tabela, nova, [...todas, ...novas], origensAceitas, com0176);
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
          const erro = violacao(tabela, { ...l, ...patch }, todas.filter((o) => o !== l), origensAceitas, com0176);
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
      if (semAColunaDoTerreno) {
        // O que o PostgREST responde quando a 0176 ainda não rodou.
        return {
          data: null,
          error: {
            code: "PGRST204",
            message: "Could not find the 'terreno_chave' column of 'hercules_reservas' in the schema cache",
          },
        };
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
        if (!com0176 && tabela === "hercules_reservas" && carga.some((l) => "terreno_chave" in l)) {
          semAColunaDoTerreno = true;
        }
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

function bancoDaCasa(opcoes?: { maxLinhas?: number; origensAceitas?: readonly string[]; sem0176?: boolean }): Banco {
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

const pedido = (
  unidadeId: string,
  enterpriseId: string,
  extra: Partial<NovaReservaNoHercules> = {},
): NovaReservaNoHercules => ({
  criadoPor: "u-nivea",
  criadoPorNome: "Nivea",
  empreendimentoId: "emp-vlo",
  enterpriseId,
  imobiliariaEntityId: "imo-1",
  origem: "coordenador",
  proponentes: [{ cpf: "529.982.247-25", nome: "Maria da Silva" }],
  unidadeId,
  validadeEm: "2026-09-25T02:59:59.000Z",
  ...extra,
});

const reservar = (banco: Banco, nova: NovaReservaNoHercules, opcoes?: Parameters<typeof criarReservaNoHercules>[2]) =>
  criarReservaNoHercules(banco.cliente, nova, opcoes);

const vivas = (banco: Banco) =>
  banco.linhas("hercules_reservas").filter((r) => VIVAS_DA_RESERVA.includes(String(r.situacao)));
const cadastroDe = (banco: Banco, id: string) =>
  banco.linhas("hercules_unidades").find((l) => l.id === id)?.situacao;
const escritas = (banco: Banco) => banco.consultas.filter((c) => c.operacao !== "select");

/** A situação que as telas mostram para a linha, lida de novo do banco. */
async function situacaoNaTela(banco: Banco, linhaId: string, enterpriseId: string) {
  const situacoes = await lerSituacaoDasUnidades(banco.cliente, [enterpriseId]);
  return situacoes.porLinha.get(linhaId)?.situacao;
}

const bancosDoTeste: Banco[] = [];
function novoBanco(opcoes?: Parameters<typeof bancoDaCasa>[0]): Banco {
  const banco = bancoDaCasa(opcoes);
  bancosDoTeste.push(banco);
  return banco;
}

let erroNoLog: MockInstance<typeof console.error>;
beforeEach(() => {
  bancosDoTeste.length = 0;
  erroNoLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  // Nenhuma consulta pode ter usado coluna inexistente ou operador que o banco falso não imita:
  // seria recusa pelo motivo errado.
  for (const banco of bancosDoTeste) expect(banco.problemas).toEqual([]);
  erroNoLog.mockRestore();
});

// ── OS CASOS ───────────────────────────────────────────────────────────────────

describe("o lote livre", () => {
  it("grava a reserva viva e passa o cadastro a 'reservada'", async () => {
    const banco = novoBanco();
    const r = await reservar(banco, pedido("voc-0305", VOC));

    expect(r.ok).toBe(true);
    const gravadas = vivas(banco);
    expect(gravadas).toHaveLength(1);
    expect(gravadas[0]).toMatchObject({
      criado_por: "u-nivea",
      empreendimento_id: "emp-vlo",
      origem: "coordenador",
      prometeu_reserva_id: null,
      situacao: "ativa",
      unidade_id: "voc-0305",
      workspace_id: "careli",
    });
    if (r.ok) {
      expect(r.reserva.id).toBe(gravadas[0]?.id);
      expect(typeof r.reserva.protocolo_numero).toBe("number");
    }
    expect(cadastroDe(banco, "voc-0305")).toBe("reservada");
    // A linha antiga do pai não é o cadastro que se vende: fica como estava.
    expect(cadastroDe(banco, "vlo-0305")).toBe("disponivel");
    // E toda tela passa a ver o mesmo: reservado, pela gleba e pelo código do pai.
    expect(await situacaoNaTela(banco, "voc-0305", VOC)).toBe("reservado");
    const peloPai = await lerSituacaoDasUnidades(banco.cliente, [VLO]);
    expect(peloPai.porCodigo.get("VLO0305")?.situacao).toBe("reservado");
  });

  it("a ordem é a regra: confere, grava, confere DE NOVO, e só então mexe no cadastro", async () => {
    const banco = novoBanco();
    await reservar(banco, pedido("voc-0305", VOC));

    const insercao = banco.consultas.findIndex((c) => c.operacao === "insert");
    const cadastro = banco.consultas.findIndex((c) => c.operacao === "update" && c.tabela === "hercules_unidades");
    expect(insercao).toBeGreaterThan(0);
    expect(cadastro).toBe(banco.consultas.length - 1);
    // Antes do INSERT, a trava leu reservas, propostas e cupons do terreno...
    const antes = banco.consultas.slice(0, insercao).map((c) => c.tabela);
    // ...e depois dele leu tudo de novo, fresco.
    const depois = banco.consultas.slice(insercao + 1, cadastro).map((c) => c.tabela);
    for (const tabela of ["hercules_reservas", "hercules_propostas", "prometeu_reservas"]) {
      expect(antes).toContain(tabela);
      expect(depois).toContain(tabela);
    }
    expect(escritas(banco).map((c) => `${c.operacao}:${c.tabela}`)).toEqual([
      "insert:hercules_reservas",
      "update:hercules_unidades",
    ]);
  });

  it("Rio de Pedras: a proposta da RPC 01-01 não prende a RDP 01-01, que é outro lote", async () => {
    const banco = novoBanco();
    banco.semear("hercules_propostas", propostaImportada("p-rpc", "rpc-0101", "contrato"));

    const r = await reservar(banco, pedido("rdp-0101", RDP));

    expect(r.ok).toBe(true);
    expect(vivas(banco).map((v) => v.unidade_id)).toEqual(["rdp-0101"]);
    expect(await situacaoNaTela(banco, "rpc-0101", RPC)).toBe("contrato");
  });

  it("o lote vizinho não herda o dono do lado (o terreno não vaza para a quadra)", async () => {
    const banco = novoBanco();
    banco.semear("hercules_reservas", reservaDoHercules("r-0305", "voc-0305"));

    const r = await reservar(banco, pedido("voc-0306", VOC));

    expect(r.ok).toBe(true);
  });
});

// Cada caso monta o dono e pede a reserva de uma linha VIVA com cadastro `disponivel` (menos o
// bloqueio, que é o cadastro falando).
const LOTES_COM_DONO: Array<{
  nome: string;
  pedir: NovaReservaNoHercules;
  preparar: (banco: Banco) => void;
}> = [
  {
    nome: "proposta IMPORTADA viva (contrato) e cadastro ainda 'disponivel'",
    pedir: pedido("voc-0305", VOC),
    preparar: (b) => b.semear("hercules_propostas", propostaImportada("p-c2x", "voc-0305", "contrato")),
  },
  {
    nome: "reserva viva na linha ANTIGA do pai (espelho_de) e a viva 'disponivel'",
    pedir: pedido("voc-0305", VOC),
    preparar: (b) => b.semear("hercules_reservas", reservaDoHercules("r-pai", "vlo-0305")),
  },
  {
    nome: "proposta importada na linha antiga do pai",
    pedir: pedido("voc-0305", VOC),
    preparar: (b) => b.semear("hercules_propostas", propostaImportada("p-pai", "vlo-0305", "assinatura")),
  },
  {
    nome: "DUAS GLEBAS: o pai aponta para a VOR livre, a VOC da mesma quadra e lote tem proposta viva",
    pedir: pedido("vor-1206", VOR),
    preparar: (b) => b.semear("hercules_propostas", propostaImportada("p-voc", "voc-1206", "proposta")),
  },
  {
    nome: "duas glebas, ao contrário: reserva viva na VOR e o pedido na VOC",
    pedir: pedido("voc-1206", VOC),
    preparar: (b) => b.semear("hercules_reservas", reservaDoHercules("r-vor", "vor-1206")),
  },
  {
    nome: "cupom antigo do salão ('reservada', sem reserva do Hércules), pelo id do legado",
    pedir: pedido("voc-0305", VOC),
    preparar: (b) => b.semear("prometeu_reservas", cupomDoSalao("cupom-1", "VOC0305", "9101")),
  },
  {
    nome: "cupom antigo do salão pelo CÓDIGO da linha do pai, sem id do legado",
    pedir: pedido("voc-0305", VOC),
    preparar: (b) => b.semear("prometeu_reservas", cupomDoSalao("cupom-2", "VLO0305", null)),
  },
  {
    nome: "bloqueada no cadastro do Apolo (tem que refletir no Hércules)",
    pedir: pedido("voc-0305", VOC),
    preparar: (b) => {
      const linha = b.linhas("hercules_unidades").find((l) => l.id === "voc-0305");
      if (linha) linha.situacao = "bloqueada";
    },
  },
  {
    nome: "vendida no cadastro, sem proposta que a sustente",
    pedir: pedido("voc-0305", VOC),
    preparar: (b) => {
      const linha = b.linhas("hercules_unidades").find((l) => l.id === "voc-0305");
      if (linha) linha.situacao = "vendida";
    },
  },
];

describe("⚠️ o lote que já tem dono é RECUSADO, e nada é gravado", () => {
  it.each(LOTES_COM_DONO)("$nome", async ({ pedir, preparar }) => {
    const banco = novoBanco();
    preparar(banco);
    const vivasAntes = vivas(banco).length;

    const r = await reservar(banco, pedir);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
    expect(escritas(banco)).toEqual([]);
    expect(vivas(banco)).toHaveLength(vivasAntes);
    expect(cadastroDe(banco, pedir.unidadeId)).not.toBe("reservada");
  });

  it("a linha antiga do pai não se reserva: reserva é sempre na linha viva", async () => {
    const banco = novoBanco();
    const r = await reservar(banco, pedido("vlo-0305", VLO));
    expect(r).toMatchObject({ ok: false, status: 409 });
    if (!r.ok) expect(r.motivo).toContain("Reserve pela unidade da gleba");
    expect(escritas(banco)).toEqual([]);
  });

  it("unidade que o cadastro não tem: recusa, sem gravar", async () => {
    const banco = novoBanco();
    const r = await reservar(banco, pedido("nao-existe", VOC));
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(escritas(banco)).toEqual([]);
  });

  it("⚠️ reserva do Hércules parada em 'proposta' (sem proposta viva): a SITUAÇÃO já recusa, como a trava", async () => {
    // É o estado que o changelog registra ("a reserva parada em `proposta`"): o índice ainda a vê
    // viva. Até 18/09/2026 a situação contava só `ativa`, pintava o lote de verde, e só a trava
    // segurava. Agora as duas contam `ativa` e `proposta`: a tela mostra Reservado e a primeira
    // barreira recusa.
    const banco = novoBanco();
    banco.semear("hercules_reservas", reservaDoHercules("r-parada", "voc-0305", { situacao: "proposta" }));

    const r = await reservar(banco, pedido("voc-0305", VOC));

    expect(r).toMatchObject({ ok: false, status: 409 });
    if (!r.ok) expect(r.motivo).toContain("Reservado");
    expect(escritas(banco)).toEqual([]);
  });
});

// A corrida: a primeira conferência passou, o INSERT gravou, e ENTRE o INSERT e a segunda
// conferência outro dono apareceu em outra linha do mesmo terreno. O índice da 0125 não pega (é
// outra linha); a segunda conferência tem que pegar.
const DONOS_QUE_CHEGAM_NA_CORRIDA: Array<{ id: string; nome: string; chegar: (banco: Banco) => void }> = [
  {
    id: "r-rival-pai",
    nome: "reserva viva na linha antiga do pai",
    chegar: (b) => b.semear("hercules_reservas", reservaDoHercules("r-rival-pai", "vlo-1206")),
  },
  {
    id: "r-rival-voc",
    nome: "reserva viva na irmã da outra gleba (VOC 12-06)",
    chegar: (b) => b.semear("hercules_reservas", reservaDoHercules("r-rival-voc", "voc-1206")),
  },
  {
    id: "p-sync",
    nome: "proposta viva trazida pelo sync na irmã da outra gleba",
    chegar: (b) => b.semear("hercules_propostas", propostaImportada("p-sync", "voc-1206", "proposta")),
  },
  {
    id: "cupom-velho",
    nome: "cupom antigo do salão pelo código da irmã",
    chegar: (b) => b.semear("prometeu_reservas", cupomDoSalao("cupom-velho", "VOC1206", null)),
  },
];

describe("⚠️ a corrida: outro dono aparece entre o INSERT e a segunda conferência", () => {
  it.each(DONOS_QUE_CHEGAM_NA_CORRIDA)("$nome: a reserva nova é CANCELADA pelo sistema e a resposta é 409", async ({ chegar, id }) => {
    const banco = novoBanco();
    banco.depois((c) => c.operacao === "insert" && c.tabela === "hercules_reservas", chegar);

    const r = await reservar(banco, pedido("vor-1206", VOR));

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.donos?.map((d) => d.id)).toContain(id);
    }
    const minha = banco
      .linhas("hercules_reservas")
      .find((l) => l.unidade_id === "vor-1206");
    expect(minha).toMatchObject({ cancelada_por_nome: "Sistema", situacao: "cancelada" });
    expect(String(minha?.cancelada_motivo)).toContain("Conflito");
    expect(vivas(banco).some((v) => v.unidade_id === "vor-1206")).toBe(false);
    // O cadastro não acompanha uma reserva que não ficou de pé.
    expect(cadastroDe(banco, "vor-1206")).toBe("disponivel");
  });

  it("a reserva do rival continua de pé: quem desiste é quem gravou por último e viu o outro", async () => {
    const banco = novoBanco();
    banco.depois(
      (c) => c.operacao === "insert" && c.tabela === "hercules_reservas",
      (b) => b.semear("hercules_reservas", reservaDoHercules("r-rival", "voc-1206")),
    );
    await reservar(banco, pedido("vor-1206", VOR));
    expect(vivas(banco).map((v) => v.id)).toEqual(["r-rival"]);
  });

  it("23505: a MESMA linha reservada por outro no mesmo instante vira 409 com a frase certa", async () => {
    const banco = novoBanco();
    // O rival grava depois da última leitura da trava e antes do nosso INSERT.
    banco.depois(
      (c) => c.tabela === "prometeu_reservas" && c.filtros.some((f) => f.startsWith("or:")),
      (b) => b.semear("hercules_reservas", reservaDoHercules("r-mesma-linha", "voc-0305")),
    );

    const r = await reservar(banco, pedido("voc-0305", VOC));

    expect(r).toMatchObject({ ok: false, status: 409 });
    if (!r.ok) expect(r.motivo).toBe("Esta unidade acabou de ser reservada por outra pessoa.");
    expect(vivas(banco).map((v) => v.id)).toEqual(["r-mesma-linha"]);
  });
});

describe("⚠️ sem saber, não vende: falha de leitura em QUALQUER etapa", () => {
  // As leituras de um caminho feliz, uma por uma. O lote de duas glebas tem mais leituras (a linha
  // que falta e as irmãs da outra gleba), por isso entra também.
  it.each([
    { enterpriseId: VOC, linha: "voc-0305" },
    { enterpriseId: VOR, linha: "vor-1206" },
  ])("$linha: cada leitura que falha termina em recusa, sem reserva viva e sem mexer no cadastro", async ({ enterpriseId, linha }) => {
    const ensaio = novoBanco();
    const feliz = await reservar(ensaio, pedido(linha, enterpriseId));
    expect(feliz.ok).toBe(true);
    const leituras = ensaio.consultas.filter((c) => c.operacao === "select").map((c) => c.n);
    // Leitura da situação (5 a 8), trava antes (4) e trava depois (4).
    expect(leituras.length).toBeGreaterThanOrEqual(13);

    for (const n of leituras) {
      const banco = novoBanco();
      banco.falhar((c) => c.n === n);

      const r = await reservar(banco, pedido(linha, enterpriseId));

      expect(r.ok, `leitura nº ${n} falhou e a reserva passou`).toBe(false);
      expect(vivas(banco), `leitura nº ${n} falhou e ficou reserva viva`).toEqual([]);
      expect(cadastroDe(banco, linha)).toBe("disponivel");
    }
  });

  it("o INSERT que falha não deixa nada gravado: 500", async () => {
    const banco = novoBanco();
    banco.falhar((c) => c.operacao === "insert");
    const r = await reservar(banco, pedido("voc-0305", VOC));
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(banco.linhas("hercules_reservas")).toEqual([]);
    expect(cadastroDe(banco, "voc-0305")).toBe("disponivel");
  });

  it("se a segunda conferência não consegue ler, a reserva recém-gravada é desfeita", async () => {
    const banco = novoBanco();
    let gravou = false;
    banco.depois((c) => c.operacao === "insert", () => {
      gravou = true;
    });
    banco.falhar((c) => gravou && c.operacao === "select");

    const r = await reservar(banco, pedido("voc-0305", VOC));

    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(vivas(banco)).toEqual([]);
    expect(banco.linhas("hercules_reservas")[0]).toMatchObject({ situacao: "cancelada" });
  });

  it("⚠️ se a segunda conferência falha E o desfazer também falha, o lote fica OCUPADO (nunca livre) e o log grita", async () => {
    // É o único caminho em que a trava depende de uma segunda escrita (ver criar-reserva.ts). O
    // resultado é o lado seguro: a reserva fica viva, prende o lote, e a resposta é recusa.
    const banco = novoBanco();
    let gravou = false;
    banco.depois((c) => c.operacao === "insert", () => {
      gravou = true;
    });
    banco.falhar((c) => gravou && (c.operacao === "select" || c.operacao === "update"));

    const r = await reservar(banco, pedido("voc-0305", VOC));

    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(vivas(banco)).toHaveLength(1);
    expect(erroNoLog).toHaveBeenCalledWith("[hercules][reserva] CONFLITO NÃO DESFEITO", expect.anything());
    gravou = false;
    expect(await situacaoNaTela(banco, "voc-0305", VOC)).toBe("reservado");
  });

  it("se o cadastro não acompanha (passo 5), a reserva vale e a situação única já mostra Reservado", async () => {
    const banco = novoBanco();
    banco.falhar((c) => c.operacao === "update" && c.tabela === "hercules_unidades");

    const r = await reservar(banco, pedido("voc-0305", VOC));

    expect(r.ok).toBe(true);
    expect(cadastroDe(banco, "voc-0305")).toBe("disponivel");
    const situacao = await situacaoNaTela(banco, "voc-0305", VOC);
    expect(situacao).toBe("reservado");
    expect(estaLivre(situacao ?? "disponivel")).toBe(false);
  });
});

describe("o salão do lançamento", () => {
  it("cupom ligado a reserva do Hércules CANCELADA não prende o lote", async () => {
    const banco = novoBanco();
    banco.semear("prometeu_reservas", cupomDoSalao("cupom-1", "VOC0305", "9101"));
    banco.semear(
      "hercules_reservas",
      reservaDoHercules("r-desistiu", "voc-0305", {
        evento_id: "ev-lancamento",
        origem: "salao",
        prometeu_reserva_id: "cupom-1",
        situacao: "cancelada",
      }),
    );

    const r = await reservar(banco, pedido("voc-0305", VOC));

    expect(r.ok).toBe(true);
  });

  it("cupom ligado a reserva do Hércules VIVA prende o lote (pela reserva)", async () => {
    const banco = novoBanco();
    banco.semear("prometeu_reservas", cupomDoSalao("cupom-1", "VOC0305", "9101"));
    banco.semear(
      "hercules_reservas",
      reservaDoHercules("r-salao", "voc-0305", {
        evento_id: "ev-lancamento",
        origem: "salao",
        prometeu_reserva_id: "cupom-1",
      }),
    );

    const r = await reservar(banco, pedido("voc-0305", VOC));

    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(escritas(banco)).toEqual([]);
  });

  it("a reserva do tótem na ordem do salão: Hércules primeiro (com o id do cupom já escolhido), o cupom depois", async () => {
    // É a ordem de `lib/prometeu/reservas-evento.ts`: a porta única grava a reserva apontando para
    // um id de cupom que ainda não existe, e o cupom entra depois com esse id.
    const banco = novoBanco();
    const r = await reservar(
      banco,
      pedido("voc-0305", VOC, { eventoId: "ev-lancamento", origem: "salao", prometeuReservaId: "cupom-novo" }),
    );

    expect(r).toMatchObject({ ok: true });
    expect(vivas(banco)[0]).toMatchObject({
      evento_id: "ev-lancamento",
      origem: "salao",
      prometeu_reserva_id: "cupom-novo",
    });

    // O cupom chega com o id que a reserva já aponta: é a MESMA reserva, e não um segundo dono.
    banco.semear("prometeu_reservas", cupomDoSalao("cupom-novo", "VOC0305", "9101"));
    const reservaId = r.ok ? r.reserva.id : "";
    const situacoes = await lerSituacaoDasUnidades(banco.cliente, [VOC]);
    expect(situacoes.porLinha.get("voc-0305")?.situacao).toBe("reservado");
    expect(
      await outrosDonosDoLote(banco.cliente, situacoes, "voc-0305", { reservaDoEventoId: "cupom-novo", reservaId }),
    ).toEqual([]);
    expect((await outrosDonosDoLote(banco.cliente, situacoes, "voc-0305", {}))?.map((d) => d.id)).toEqual([reservaId]);
    // E o próximo que tentar o mesmo lote é recusado.
    expect(await reservar(banco, pedido("voc-0305", VOC))).toMatchObject({ ok: false, status: 409 });
  });

  // ⚠️ HOJE A PORTA ÚNICA RECUSA ESTA ORDEM, e o salão não depende dela (grava a reserva do Hércules
  // ANTES do cupom, teste acima). Mas o contrato escrito em `trava-do-lote.ts`
  // (`QuemEstaGravando.reservaDoEventoId`) descreve a ordem inversa: *"O tótem grava o cupom e, em
  // seguida, a reserva do Hércules ligada a ele"*. Nela, a trava pula o próprio cupom, mas o passo 1
  // (`lerSituacaoDasUnidades`) não sabe qual é o cupom de quem grava, conta-o como reserva viva e a
  // resposta é "Esta unidade está Reservado". `it.fails` registra o comportamento de hoje: quando a
  // porta única (ou o comentário da trava) for acertada, este teste fica vermelho e vira `it`.
  it.fails("com o PRÓPRIO cupom gravado ANTES, a reserva do tótem passa (o contrato escrito na trava)", async () => {
    const banco = novoBanco();
    banco.semear("prometeu_reservas", cupomDoSalao("cupom-meu", "VOC0305", "9101"));

    const r = await reservar(
      banco,
      pedido("voc-0305", VOC, { eventoId: "ev-lancamento", origem: "salao", prometeuReservaId: "cupom-meu" }),
    );

    expect(r).toMatchObject({ ok: true });
  });

  it("o cupom de OUTRA pessoa no mesmo lote continua prendendo, mesmo pelo tótem", async () => {
    const banco = novoBanco();
    banco.semear("prometeu_reservas", cupomDoSalao("cupom-outro", "VOC0305", "9101"));
    banco.semear("prometeu_reservas", cupomDoSalao("cupom-meu", "VOC0305", "9101", { evento_id: "ev-2" }));

    const r = await reservar(
      banco,
      pedido("voc-0305", VOC, { eventoId: "ev-2", origem: "salao", prometeuReservaId: "cupom-meu" }),
    );

    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(escritas(banco)).toEqual([]);
  });
});

describe("a origem recusada pela CHECK (a rede da 0167)", () => {
  it("tenta de novo com a origem da rede, e só DEPOIS da recusa da primeira", async () => {
    const banco = novoBanco({ origensAceitas: ["coordenador", "salao", "corretor", "interno"] });
    const rede = vi.fn((_erro: { code?: string; message?: string }) => "coordenador");

    const r = await reservar(banco, pedido("voc-0305", VOC, { origem: "incorporador" }), {
      origemSeRecusada: rede,
    });

    expect(r.ok).toBe(true);
    expect(rede).toHaveBeenCalledTimes(1);
    expect(rede.mock.calls[0]?.[0]).toMatchObject({ code: "23514" });
    expect(banco.consultas.filter((c) => c.operacao === "insert")).toHaveLength(2);
    expect(vivas(banco)).toHaveLength(1);
    expect(vivas(banco)[0]?.origem).toBe("coordenador");
  });

  it("com a 0167 no banco, a origem pedida é gravada e a rede nem é chamada", async () => {
    const banco = novoBanco();
    const rede = vi.fn(() => "coordenador");
    await reservar(banco, pedido("voc-0305", VOC, { origem: "incorporador" }), { origemSeRecusada: rede });
    expect(rede).not.toHaveBeenCalled();
    expect(vivas(banco)[0]?.origem).toBe("incorporador");
  });

  it("sem rede, a recusa da CHECK vira 500 e nada é gravado", async () => {
    const banco = novoBanco({ origensAceitas: ["coordenador"] });
    const r = await reservar(banco, pedido("voc-0305", VOC, { origem: "incorporador" }));
    expect(r).toMatchObject({ ok: false, status: 500 });
    expect(banco.linhas("hercules_reservas")).toEqual([]);
  });

  it("a trava vale também para a segunda tentativa: a corrida depois da rede ainda é desfeita", async () => {
    const banco = novoBanco({ origensAceitas: ["coordenador", "salao", "corretor", "interno"] });
    // O gancho só dispara em consulta bem-sucedida: a primeira tentativa (recusada pela CHECK) não
    // conta, e o rival chega logo depois da SEGUNDA.
    banco.depois(
      (c) => c.operacao === "insert" && c.tabela === "hercules_reservas",
      (b) => b.semear("hercules_reservas", reservaDoHercules("r-rival", "vlo-0305")),
    );

    const r = await reservar(banco, pedido("voc-0305", VOC, { origem: "incorporador" }), {
      origemSeRecusada: () => "coordenador",
    });

    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(vivas(banco).map((v) => v.id)).toEqual(["r-rival"]);
  });
});

describe("⚠️ duas reservas AO MESMO TEMPO no mesmo terreno: nunca dois donos", () => {
  // Cada volta atrasa a segunda reserva um pouco mais, e as duas se entrelaçam de um jeito
  // diferente: da largada junta (as duas passam pela primeira conferência antes de qualquer INSERT)
  // até a segunda chegar depois da primeira ter terminado. Em NENHUMA ordem as duas ficam de pé.
  const atrasar = async (voltas: number) => {
    for (let i = 0; i < voltas; i += 1) await Promise.resolve();
  };

  it.each([
    { a: { enterpriseId: VOR, linha: "vor-1206" }, b: { enterpriseId: VOC, linha: "voc-1206" }, nome: "linhas diferentes do terreno (VOR 12-06 × VOC 12-06)", sem0176: false },
    { a: { enterpriseId: VOC, linha: "voc-0305" }, b: { enterpriseId: VOC, linha: "voc-0305" }, nome: "a mesma linha (VOC 03-05)", sem0176: false },
    { a: { enterpriseId: VOR, linha: "vor-1206" }, b: { enterpriseId: VOC, linha: "voc-1206" }, nome: "linhas diferentes do terreno, banco SEM a 0176", sem0176: true },
  ])("$nome", async ({ a, b, sem0176 }) => {
    const desfechos = new Set<string>();
    const terreno = new Set(["vlo-1206", "vor-1206", "voc-1206", "vlo-0305", "voc-0305"]);

    for (let atraso = 0; atraso <= 200; atraso += 1) {
      const banco = novoBanco({ sem0176 });
      const [ra, rb] = await Promise.all([
        reservar(banco, pedido(a.linha, a.enterpriseId, { criadoPor: "u-a" })),
        atrasar(atraso).then(() => reservar(banco, pedido(b.linha, b.enterpriseId, { criadoPor: "u-b" }))),
      ]);
      const vivasNoTerreno = vivas(banco).filter((v) => terreno.has(String(v.unidade_id)));
      const aceitas = [ra, rb].filter((r) => r.ok);

      expect(vivasNoTerreno.length, `atraso ${atraso}: dois donos vivos`).toBeLessThanOrEqual(1);
      expect(aceitas.length, `atraso ${atraso}: duas respostas de sucesso`).toBeLessThanOrEqual(1);
      // Quem ouviu "reservado" é quem está de pé no banco.
      expect(aceitas.length).toBe(vivasNoTerreno.length);
      desfechos.add(`${aceitas.length}`);
    }

    // O ensaio passou pelos dois mundos: o de uma vencedora e (nas linhas diferentes) o das duas
    // que se enxergaram depois do INSERT e desistiram juntas. Sem isto o teste poderia estar
    // rodando as duas em fila e provando nada.
    expect(desfechos.has("1")).toBe(true);
  });

  it("sem a 0176, nas linhas diferentes existe o entrelaçamento em que as DUAS desistem (o pior caso aceito)", async () => {
    const atrasoZero = novoBanco({ sem0176: true });
    const respostas = await Promise.all([
      reservar(atrasoZero, pedido("vor-1206", VOR)),
      reservar(atrasoZero, pedido("voc-1206", VOC)),
    ]);
    expect(respostas.map((r) => r.ok)).toEqual([false, false]);
    expect(vivas(atrasoZero)).toEqual([]);
    expect(atrasoZero.linhas("hercules_reservas").map((l) => l.situacao)).toEqual(["cancelada", "cancelada"]);
  });

  it("com a 0176, o mesmo entrelaçamento tem UMA vencedora: a segunda morre no INSERT", async () => {
    const atrasoZero = novoBanco();
    const respostas = await Promise.all([
      reservar(atrasoZero, pedido("vor-1206", VOR)),
      reservar(atrasoZero, pedido("voc-1206", VOC)),
    ]);
    expect(respostas.filter((r) => r.ok)).toHaveLength(1);
    expect(vivas(atrasoZero)).toHaveLength(1);
  });
});

// ── A 0176: A TRAVA QUE NÃO DEPENDE DE O SERVIDOR SOBREVIVER ─────────────────────────────
//
// As duas conferências da porta única fecham toda corrida em que o servidor termina o que começou.
// A que sobra: a outra reserva entra (numa linha irmã do terreno) entre a minha primeira conferência
// e o meu INSERT, e o servidor cai logo depois do INSERT, antes da segunda conferência. Sem a 0176,
// ficam dois donos e ninguém para desfazer. Com ela, o meu INSERT morre no banco.

describe("⚠️ 0176: um dono por terreno, garantido pelo banco", () => {
  const rivalNaIrma = (banco: Banco, terrenoChave: null | string) => () =>
    banco.semear(
      "hercules_reservas",
      reservaDoHercules("r-rival", "vor-1206", terrenoChave ? { terreno_chave: terrenoChave } : {}),
    );
  const depoisDaPrimeiraConferencia = (c: Consulta) =>
    c.tabela === "hercules_reservas" && c.operacao === "select" && c.filtros.some((f) => f.startsWith("in:situacao"));
  const servidorCaiDepoisDoInsert = (banco: Banco) =>
    banco.depois(
      (c) => c.tabela === "hercules_reservas" && c.operacao === "insert",
      () => {
        throw new Error("servidor caiu");
      },
    );

  it("a reserva grava a chave do terreno: o menor id entre as linhas do mesmo chão", async () => {
    const banco = novoBanco();
    const r = await reservar(banco, pedido("voc-1206", VOC));
    expect(r.ok).toBe(true);
    expect(vivas(banco).map((v) => v.terreno_chave)).toEqual(["vlo-1206"]);
  });

  it("⚠️ com a 0176: o rival entrou na irmã e o servidor cairia depois do INSERT, mas o INSERT já morre no banco", async () => {
    const banco = novoBanco();
    banco.depois(depoisDaPrimeiraConferencia, rivalNaIrma(banco, "vlo-1206"));
    servidorCaiDepoisDoInsert(banco);

    const r = await reservar(banco, pedido("voc-1206", VOC));

    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(vivas(banco).map((v) => v.id)).toEqual(["r-rival"]);
  });

  it("⚠️ sem a 0176, o mesmo acidente deixa DOIS donos (é por isso que a migration existe)", async () => {
    const banco = novoBanco({ sem0176: true });
    banco.depois(depoisDaPrimeiraConferencia, rivalNaIrma(banco, null));
    servidorCaiDepoisDoInsert(banco);

    await expect(reservar(banco, pedido("voc-1206", VOC))).rejects.toThrow("servidor caiu");
    expect(vivas(banco)).toHaveLength(2);
  });

  it("banco sem a 0176: a reserva grava sem a chave, e as duas conferências seguram como antes", async () => {
    const banco = novoBanco({ sem0176: true });
    const r = await reservar(banco, pedido("voc-1206", VOC));
    expect(r.ok).toBe(true);
    expect(vivas(banco)).toHaveLength(1);
    expect(vivas(banco)[0]?.terreno_chave ?? null).toBeNull();

    const outra = await reservar(banco, pedido("vor-1206", VOR));
    expect(outra).toMatchObject({ ok: false, status: 409 });
    expect(vivas(banco)).toHaveLength(1);
  });
});
