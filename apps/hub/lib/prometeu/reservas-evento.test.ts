import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O TÓTEM DO SALÃO RESERVA NO HÉRCULES, CONTRA UM BANCO EM MEMÓRIA.
//
// Lucas (18/09/2026): *"toda reserva, proposta deve ser criada no hercules"* · *"essa tela tem que
// puxar a tela de vendas do hercules e quando houver a reserva fosse reservada no hercules"* · *"eu
// não posso vender dois lotes para pessoas diferentes, eu tomo processo por conta disso"*.
//
// ⚠️ NADA DA REGRA É DUBLÊ. `reservas-evento.ts`, a porta única (`criar-reserva.ts`), a trava
// (`trava-do-lote.ts`), a régua (`situacao-da-unidade.ts`) e o cancelamento
// (`cancelar-reserva-server.ts`) rodam de verdade. O que é trocado: o Supabase, por um banco que
// aplica os filtros, os índices únicos das 0101 e 0125 e recusa coluna que não existe; o C2X, que só
// entrega quadra, lote, área e preço; e o cadastro de empreendimentos.

type Linha = Record<string, unknown>;
type Erro = { code: string; message: string };
type Resposta = { data: unknown; error: Erro | null };

const estado = vi.hoisted(() => ({
  c2x: [] as Array<Record<string, unknown>>,
  cadastro: [] as Array<{ c2xEnterpriseId: null | string; id: string; paiId: null | string }>,
  sql: [] as string[],
}));

vi.mock("@/lib/guardian/db", () => ({
  getHadesDbPool: () => ({
    ok: true,
    pool: {
      query: async (sql: string) => {
        estado.sql.push(sql);
        return [estado.c2x];
      },
    },
  }),
}));

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: async () => estado.cadastro,
}));

import { criarReservaNoHercules } from "@/lib/hercules/criar-reserva";
import { lerSituacaoDasUnidades } from "@/lib/hercules/situacao-da-unidade";
import { outrosDonosDoLote } from "@/lib/hercules/trava-do-lote";

import {
  cancelarReservaDoGrupo,
  contadoresDoEvento,
  criarReservaDoEvento,
  empreendimentoDaReserva,
  quadrasDoEvento,
  reservasDoEvento,
  reservasDoGrupo,
  type UnidadeDisponivel,
} from "./reservas-evento";
import { reservasVivasDoPanteon } from "./reservas-do-panteon";
import { reservasVivasPorCodigo } from "./reservas-vivas";

// ── O BANCO EM MEMÓRIA ─────────────────────────────────────────────────────────

const COLUNAS: Record<string, readonly string[]> = {
  hercules_propostas: [
    "aberta", "atualizado_em", "codigo", "criado_em", "criado_em_c2x", "etapa", "etapa_desde", "id",
    "origem", "reserva_id", "unidade_id", "workspace_id",
  ],
  // 0125 + 0129 + 0130.
  hercules_reservas: [
    "atualizado_em", "cancelada_em", "cancelada_motivo", "cancelada_por", "cancelada_por_nome",
    "corretor_entity_id", "criado_em", "criado_por", "criado_por_nome", "empreendimento_id",
    "evento_id", "id", "imobiliaria_entity_id", "observacao", "origem", "prometeu_reserva_id",
    "proponentes", "protocolo_numero", "situacao", "terreno_chave", "unidade_id", "validade_em",
    "venda_id", "workspace_id",
  ],
  hercules_unidades: [
    "atualizado_em", "codigo", "enterprise_id", "espelho_de", "id", "lote", "origem_c2x_id",
    "preco_tabela", "quadra", "situacao", "workspace_id",
  ],
  prometeu_credenciados: ["corretor", "documento", "etapa", "evento_id", "id", "imobiliaria", "nome"],
  // 0101 + 0102.
  prometeu_reservas: [
    "area", "cancelada_em", "cancelada_motivo", "codigo", "created_at", "credenciado_id",
    "criado_por", "criado_por_nome", "evento_id", "grupo_id", "id", "lote", "pa_impressa_em",
    "pa_impressa_vezes", "preco_tabela", "proponentes", "proposta_lancada_em", "proposta_lancada_por",
    "quadra", "situacao", "unidade_c2x_id", "updated_at",
  ],
};

const texto = (v: unknown): null | string => (v === null || v === undefined ? null : String(v));

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

/** Os índices únicos que o banco de verdade faz valer. */
function violacao(tabela: string, nova: Linha, outras: readonly Linha[]): Erro | null {
  if (tabela === "hercules_reservas") {
    if (!["coordenador", "salao", "corretor", "interno", "incorporador"].includes(String(nova.origem))) {
      return { code: "23514", message: "hercules_reservas_origem" };
    }
    if (nova.origem === "salao" && texto(nova.evento_id) === null) {
      return { code: "23514", message: "hercules_reservas_salao_tem_evento" };
    }
    const viva = (l: Linha) => l.situacao === "ativa" || l.situacao === "proposta";
    if (viva(nova) && outras.some((o) => viva(o) && texto(o.unidade_id) === texto(nova.unidade_id))) {
      return { code: "23505", message: "hercules_reservas_uma_viva_por_unidade" };
    }
  }
  if (tabela === "prometeu_reservas") {
    const viva = (l: Linha) => l.situacao === "reservada";
    if (
      viva(nova) &&
      outras.some((o) => viva(o) && o.evento_id === nova.evento_id && o.codigo === nova.codigo)
    ) {
      return { code: "23505", message: "prometeu_reservas_unidade_viva" };
    }
  }
  return null;
}

type Operacao = "insert" | "select" | "update";

function criarBanco(inicial: Record<string, Linha[]>) {
  const tabelas: Record<string, Linha[]> = {};
  for (const [t, linhas] of Object.entries(inicial)) tabelas[t] = linhas.map((l) => ({ ...l }));
  const problemas: string[] = [];
  const falhas: Array<(tabela: string, operacao: Operacao) => boolean> = [];
  const antesDoInsert: Array<(tabela: string, linha: Linha) => void> = [];
  let contador = 0;

  const daTabela = (t: string) => (tabelas[t] ??= []);

  function from(tabela: string) {
    let operacao: Operacao = "select";
    let devolver = false;
    let unico = false;
    let carga: Linha[] = [];
    let faixa: null | [number, number] = null;
    const filtros: Array<(l: Linha) => boolean> = [];

    const conferir = (coluna: string) => {
      const conhecidas = COLUNAS[tabela];
      if (!conhecidas) problemas.push(`tabela ${tabela} não imitada`);
      else if (!conhecidas.includes(coluna)) problemas.push(`${tabela}.${coluna} não existe`);
    };

    const responder = (): Resposta => {
      if (falhas.some((f) => f(tabela, operacao))) {
        return { data: null, error: { code: "08006", message: "fora do ar" } };
      }
      const todas = daTabela(tabela);
      const casa = (l: Linha) => filtros.every((f) => f(l));
      if (operacao === "insert") {
        const novas: Linha[] = [];
        for (const bruta of carga) {
          for (const gancho of antesDoInsert) gancho(tabela, bruta);
          contador += 1;
          const nova: Linha =
            tabela === "hercules_reservas"
              ? { id: `res-${contador}`, protocolo_numero: contador, situacao: "ativa", workspace_id: "careli", ...bruta }
              : { id: `${tabela}-${contador}`, ...bruta };
          const erro = violacao(tabela, nova, [...todas, ...novas]);
          if (erro) return { data: null, error: erro };
          novas.push(nova);
        }
        todas.push(...novas);
        const saida = novas.map((l) => ({ ...l }));
        return { data: devolver ? (unico ? (saida[0] ?? null) : saida) : null, error: null };
      }
      if (operacao === "update") {
        const alvo = todas.filter(casa);
        for (const l of alvo) Object.assign(l, carga[0] ?? {});
        return { data: devolver ? alvo.map((l) => ({ ...l })) : null, error: null };
      }
      let linhas = todas.filter(casa).map((l) => ({ ...l }));
      if (faixa) linhas = linhas.slice(faixa[0], faixa[1] + 1);
      return { data: unico ? (linhas[0] ?? null) : linhas, error: null };
    };

    const q = {
      eq(coluna: string, valor: unknown) {
        conferir(coluna);
        filtros.push((l) => texto(l[coluna]) !== null && texto(l[coluna]) === texto(valor));
        return q;
      },
      in(coluna: string, valores: readonly unknown[]) {
        conferir(coluna);
        const aceitos = new Set(valores.map(texto));
        filtros.push((l) => texto(l[coluna]) !== null && aceitos.has(texto(l[coluna])));
        return q;
      },
      insert(linhas: Linha | Linha[]) {
        operacao = "insert";
        carga = Array.isArray(linhas) ? linhas : [linhas];
        for (const l of carga) for (const c of Object.keys(l)) conferir(c);
        return q;
      },
      is(coluna: string, valor: null) {
        conferir(coluna);
        if (valor !== null) problemas.push(`is(${coluna}) só com null`);
        filtros.push((l) => texto(l[coluna]) === null);
        return q;
      },
      limit() {
        return q;
      },
      maybeSingle() {
        unico = true;
        return q;
      },
      not(coluna: string, operador: string, valor: unknown) {
        conferir(coluna);
        if (operador !== "is" || valor !== null) problemas.push(`not(${operador}) não imitado`);
        filtros.push((l) => texto(l[coluna]) !== null);
        return q;
      },
      or(expressao: string) {
        const condicoes = separarNoTopo(expressao).map((parte) => {
          const m = /^([a-z_0-9]+)\.in\.\((.*)\)$/.exec(parte.trim());
          if (!m) {
            problemas.push(`or(${parte}) não imitado`);
            return () => false;
          }
          const coluna = m[1] ?? "";
          conferir(coluna);
          const aceitos = new Set(separarNoTopo(m[2] ?? "").map((v) => v.trim().replace(/^"(.*)"$/, "$1")));
          return (l: Linha) => texto(l[coluna]) !== null && aceitos.has(String(texto(l[coluna])));
        });
        filtros.push((l) => condicoes.some((c) => c(l)));
        return q;
      },
      order() {
        return q;
      },
      range(de: number, ate: number) {
        faixa = [de, ate];
        return q;
      },
      select(colunas?: string) {
        if (operacao !== "select") devolver = true;
        for (const c of String(colunas ?? "").split(",").map((x) => x.trim()).filter(Boolean)) conferir(c);
        return q;
      },
      then<T>(ok: (r: Resposta) => T, falha?: (e: unknown) => T) {
        return Promise.resolve(responder()).then(ok, falha);
      },
      update(patch: Linha) {
        operacao = "update";
        carga = [patch];
        for (const c of Object.keys(patch)) conferir(c);
        return q;
      },
    };
    return q;
  }

  return {
    antesDoInsert,
    cliente: { from } as unknown as SupabaseClient,
    falhas,
    linhas: (t: string) => daTabela(t),
    problemas,
  };
}

// ── O CENÁRIO: o Jardim das Gerais (C2X 50) no lançamento ─────────────────────

const EVENTO = { config: null, enterpriseId: "50", id: "ev-1" };

function unidade(id: string, codigo: string, origem: string, situacao = "disponivel"): Linha {
  return {
    atualizado_em: "2026-09-01T00:00:00Z",
    codigo,
    enterprise_id: "50",
    espelho_de: null,
    id,
    lote: codigo.slice(-2),
    origem_c2x_id: origem,
    quadra: codigo.slice(3, 5),
    situacao,
    workspace_id: "careli",
  };
}

function doCupom(codigo: string, c2xId: string): UnidadeDisponivel {
  return { area: "250,00", c2xId, codigo, lote: codigo.slice(-2), preco: 150000, quadra: codigo.slice(3, 5) };
}

const PROPONENTES = [
  {
    credenciadoId: "cred-1",
    documento: "123.456.789-09",
    entityId: "ent-1",
    nome: "Maria da Silva",
    origem: "IMOB X · Corretor Y",
    percentual: 100,
  },
];

function bancoDoJardim(extra: Record<string, Linha[]> = {}) {
  return criarBanco({
    hercules_unidades: [
      unidade("u1", "JDG0101", "9001"),
      unidade("u2", "JDG0102", "9002"),
      unidade("u3", "JDG0103", "9003", "bloqueada"),
      unidade("u4", "JDG0104", "9004"),
      unidade("u6", "JDG0106", "9006"),
      unidade("u7", "JDG0107", "9007"),
    ],
    ...extra,
  });
}

function reservar(banco: ReturnType<typeof criarBanco>, codigos: string[], evento: typeof EVENTO | Linha = EVENTO) {
  const origem: Record<string, string> = {
    JDG0101: "9001",
    JDG0102: "9002",
    JDG0103: "9003",
    JDG0104: "9004",
    JDG0105: "9005",
    JDG0106: "9006",
    JDG0107: "9007",
  };
  return criarReservaDoEvento(banco.cliente as never, {
    credenciadoId: "cred-1",
    criadoPor: "op-1",
    criadoPorNome: "vitor",
    evento: evento as typeof EVENTO,
    imobiliariaEntityId: "imob-1",
    proponentes: PROPONENTES,
    unidades: codigos.map((c) => doCupom(c, origem[c] ?? "")),
  });
}

const reservasDoHercules = (banco: ReturnType<typeof criarBanco>) => banco.linhas("hercules_reservas");
const situacaoDe = async (banco: ReturnType<typeof criarBanco>, linhaId: string) =>
  (await lerSituacaoDasUnidades(banco.cliente, ["50"])).porLinha.get(linhaId)?.situacao;
const cadastroDe = (banco: ReturnType<typeof criarBanco>, linhaId: string) =>
  banco.linhas("hercules_unidades").find((l) => l.id === linhaId)?.situacao;

let bancoDoTeste: null | ReturnType<typeof criarBanco> = null;

beforeEach(() => {
  estado.c2x = [];
  estado.sql = [];
  estado.cadastro = [
    { c2xEnterpriseId: "50", id: "emp-jdg", paiId: null },
    { c2xEnterpriseId: "50", id: "emp-jdg-visao", paiId: "emp-jdg" },
  ];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  // Coluna com nome errado viraria "falha de leitura", a trava recusaria tudo e o teste passaria
  // pelo motivo errado.
  if (bancoDoTeste) expect(bancoDoTeste.problemas).toEqual([]);
  bancoDoTeste = null;
  vi.restoreAllMocks();
});

function novoBanco(extra: Record<string, Linha[]> = {}) {
  bancoDoTeste = bancoDoJardim(extra);
  return bancoDoTeste;
}

// ── A OFERTA ──────────────────────────────────────────────────────────────────

describe("a oferta do tótem sai da situação única, e não do C2X", () => {
  beforeEach(() => {
    estado.c2x = ["01", "02", "03", "04", "05", "06", "07"].map((lote) => ({
      area: "250,00",
      block: "01",
      id: 9000 + Number(lote),
      lot: lote,
      name: `JDG01${lote}`,
      price: "150000.00",
    }));
  });

  it("oferece só o que a régua dá livre; do C2X vêm só quadra, lote, área e preço", async () => {
    const banco = novoBanco({
      hercules_reservas: [{ id: "h-venda", origem: "coordenador", situacao: "ativa", unidade_id: "u4", workspace_id: "careli" }],
    });

    const { error, quadras } = await quadrasDoEvento(banco.cliente as never, {
      ...EVENTO,
      config: { lotesBloqueados: ["JDG0106"] },
    });

    expect(error).toBeUndefined();
    // 0103 bloqueado no Apolo · 0104 reservado na Venda · 0105 sem cadastro no Panteon · 0106 travado
    // no Setup. O 0107 aparece mesmo que o C2X o dê vendido: a situação mora no Panteon.
    expect(quadras.flatMap((q) => q.disponiveis.map((u) => u.codigo))).toEqual(["JDG0101", "JDG0102", "JDG0107"]);
    expect(quadras[0]?.disponiveis[0]).toEqual({
      area: "250,00",
      c2xId: "9001",
      codigo: "JDG0101",
      lote: "01",
      preco: 150000,
      quadra: "01",
    });
    expect(estado.sql.join(" ")).not.toMatch(/sale_status_id|sale_blocked|acquisition_requests/);
  });

  it("cupom antigo do salão, sem reserva do Hércules, continua ocupando o lote", async () => {
    const banco = novoBanco({
      prometeu_reservas: [{ codigo: "JDG0102", evento_id: "ev-1", id: "cupom-velho", situacao: "reservada", unidade_c2x_id: "9002" }],
    });

    const { quadras } = await quadrasDoEvento(banco.cliente as never, EVENTO);

    expect(quadras.flatMap((q) => q.disponiveis.map((u) => u.codigo))).not.toContain("JDG0102");
  });

  it("sem conseguir ler a situação, erro e prateleira vazia", async () => {
    const banco = novoBanco();
    banco.falhas.push((tabela) => tabela === "hercules_propostas");

    const { error, quadras } = await quadrasDoEvento(banco.cliente as never, EVENTO);

    expect(error).toBeTruthy();
    expect(quadras).toEqual([]);
  });
});

// ── A RESERVA ─────────────────────────────────────────────────────────────────

describe("a reserva do salão nasce no Hércules", () => {
  it("um cupom de dois lotes vira duas reservas do Hércules, e o cupom nasce já ligado a elas", async () => {
    const banco = novoBanco();

    const r = await reservar(banco, ["JDG0101", "JDG0102"]);

    expect(r.error).toBeUndefined();
    expect(r.grupoId).toBeTruthy();

    const doHercules = reservasDoHercules(banco);
    expect(doHercules).toHaveLength(2);
    for (const h of doHercules) {
      expect(h).toMatchObject({
        criado_por: "op-1",
        criado_por_nome: "vitor",
        empreendimento_id: "emp-jdg",
        evento_id: "ev-1",
        imobiliaria_entity_id: "imob-1",
        origem: "salao",
        situacao: "ativa",
      });
      // O `cpf` é o que a proposta do Hércules usa para achar a CAD do titular.
      expect((h.proponentes as Linha[])[0]).toMatchObject({ cpf: "12345678909", entity_id: "ent-1", nome: "Maria da Silva" });
    }

    const cupom = banco.linhas("prometeu_reservas");
    expect(cupom).toHaveLength(2);
    expect(new Set(cupom.map((l) => l.grupo_id))).toEqual(new Set([r.grupoId]));
    // ⚠️ O vínculo nasce no INSERT: cada reserva do Hércules aponta para a SUA linha do cupom.
    for (const h of doHercules) {
      const linha = cupom.find((l) => l.id === h.prometeu_reserva_id);
      expect(linha?.codigo).toBe(h.unidade_id === "u1" ? "JDG0101" : "JDG0102");
    }

    // O cadastro acompanha, e a régua única diz reservado em qualquer tela.
    expect(cadastroDe(banco, "u1")).toBe("reservada");
    expect(await situacaoDe(banco, "u1")).toBe("reservado");
    expect(await situacaoDe(banco, "u2")).toBe("reservado");
  });

  it("depois do salão, a Venda não reserva o mesmo lote, e a proposta da própria reserva passa na trava", async () => {
    const banco = novoBanco();
    await reservar(banco, ["JDG0101"]);

    const naVenda = await criarReservaNoHercules(banco.cliente, {
      empreendimentoId: "emp-jdg",
      enterpriseId: "50",
      origem: "coordenador",
      proponentes: [{ cpf: "98765432100", nome: "Outro Cliente", telefone: "" }],
      unidadeId: "u1",
    });
    expect(naVenda.ok).toBe(false);

    // O cupom do salão não conta como OUTRO dono da reserva do Hércules que ele originou: a proposta
    // gerada na Venda a partir dela passa na trava.
    const reserva = reservasDoHercules(banco).find((h) => h.situacao === "ativa");
    const situacoes = await lerSituacaoDasUnidades(banco.cliente, ["50"]);
    expect(await outrosDonosDoLote(banco.cliente, situacoes, "u1", { reservaId: String(reserva?.id) })).toEqual([]);
  });

  it("lote que não está livre: nada é gravado, nem no Hércules nem no cupom", async () => {
    const banco = novoBanco({
      hercules_reservas: [{ id: "h-venda", origem: "coordenador", situacao: "ativa", unidade_id: "u4", workspace_id: "careli" }],
    });

    const r = await reservar(banco, ["JDG0101", "JDG0104", "JDG0103", "JDG0105"]);

    expect(r.conflitos).toEqual(["JDG0104", "JDG0103", "JDG0105"]);
    expect(r.error).toMatch(/JDG0104/);
    expect(reservasDoHercules(banco)).toHaveLength(1);
    expect(banco.linhas("prometeu_reservas")).toHaveLength(0);
    expect(cadastroDe(banco, "u1")).toBe("disponivel");
  });

  it("código de um lote com o id do legado de outro: recusa, e nada é gravado", async () => {
    const banco = novoBanco();

    // A tela pede o JDG0101 (o que sai impresso) com o id do legado do JDG0102.
    const r = await criarReservaDoEvento(banco.cliente as never, {
      credenciadoId: "cred-1",
      criadoPor: "op-1",
      criadoPorNome: "vitor",
      evento: EVENTO,
      proponentes: PROPONENTES,
      unidades: [doCupom("JDG0101", "9002")],
    });

    expect(r.conflitos).toEqual(["JDG0101"]);
    expect(reservasDoHercules(banco)).toHaveLength(0);
  });

  it("lote travado no Setup do evento não entra no cupom", async () => {
    const banco = novoBanco();

    const r = await reservar(banco, ["JDG0101"], { ...EVENTO, config: { lotesBloqueados: ["jdg0101"] } });

    expect(r.conflitos).toEqual(["JDG0101"]);
    expect(reservasDoHercules(banco)).toHaveLength(0);
  });

  it("o segundo lote perde a corrida na Venda: o primeiro é desfeito e o cupom não nasce", async () => {
    const banco = novoBanco();
    // Um coordenador reserva o JDG0102 na Venda no mesmo instante em que o tótem grava o dele.
    banco.antesDoInsert.push((tabela, linha) => {
      if (tabela !== "hercules_reservas" || linha.unidade_id !== "u2") return;
      if (banco.linhas("hercules_reservas").some((l) => l.id === "h-concorrente")) return;
      banco.linhas("hercules_reservas").push({
        id: "h-concorrente",
        origem: "coordenador",
        situacao: "ativa",
        unidade_id: "u2",
        workspace_id: "careli",
      });
    });

    const r = await reservar(banco, ["JDG0101", "JDG0102"]);

    expect(r.grupoId).toBeUndefined();
    expect(r.conflitos).toEqual(["JDG0102"]);
    const doTotem = reservasDoHercules(banco).filter((h) => h.origem === "salao");
    expect(doTotem).toHaveLength(1);
    expect(doTotem[0]).toMatchObject({ cancelada_por_nome: "Sistema", situacao: "cancelada", unidade_id: "u1" });
    // Cupom pela metade não existe, e o JDG0101 volta a ser oferecido.
    expect(banco.linhas("prometeu_reservas")).toHaveLength(0);
    expect(cadastroDe(banco, "u1")).toBe("disponivel");
    expect(await situacaoDe(banco, "u1")).toBe("disponivel");
    expect(await situacaoDe(banco, "u2")).toBe("reservado");
  });

  it("o cupom que não grava desfaz as reservas do Hércules deste cupom", async () => {
    const banco = novoBanco();
    banco.falhas.push((tabela, operacao) => tabela === "prometeu_reservas" && operacao === "insert");

    const r = await reservar(banco, ["JDG0101", "JDG0102"]);

    expect(r.grupoId).toBeUndefined();
    expect(r.error).toMatch(/Nada ficou reservado/);
    expect(reservasDoHercules(banco).map((h) => h.situacao)).toEqual(["cancelada", "cancelada"]);
    expect(cadastroDe(banco, "u1")).toBe("disponivel");
    expect(cadastroDe(banco, "u2")).toBe("disponivel");
  });

  it("cupom velho cuja reserva do Hércules foi cancelada na Venda não trava o lote no salão", async () => {
    const banco = novoBanco({
      hercules_reservas: [
        {
          cancelada_em: "2026-09-18T12:00:00Z",
          id: "h-velha",
          origem: "salao",
          prometeu_reserva_id: "cupom-velho",
          situacao: "cancelada",
          unidade_id: "u1",
          workspace_id: "careli",
        },
      ],
      prometeu_reservas: [
        { codigo: "JDG0101", evento_id: "ev-1", grupo_id: "g-velho", id: "cupom-velho", situacao: "reservada", unidade_c2x_id: "9001" },
      ],
    });
    // A régua segue a reserva do Hércules: o lote está livre.
    expect(await situacaoDe(banco, "u1")).toBe("disponivel");

    const r = await reservar(banco, ["JDG0101"]);

    // Sem soltar o cupom velho, o índice da 0101 recusaria o novo com o lote verde na tela.
    expect(r.error).toBeUndefined();
    expect(banco.linhas("prometeu_reservas").find((l) => l.id === "cupom-velho")?.situacao).toBe("cancelada");
    expect(await situacaoDe(banco, "u1")).toBe("reservado");
  });

  it("sem conseguir ler a situação, nada é gravado", async () => {
    const banco = novoBanco();
    banco.falhas.push((tabela, operacao) => tabela === "hercules_propostas" && operacao === "select");

    const r = await reservar(banco, ["JDG0101"]);

    expect(r.error).toMatch(/Nada foi gravado/);
    expect(reservasDoHercules(banco)).toHaveLength(0);
    expect(banco.linhas("prometeu_reservas")).toHaveLength(0);
  });

  it("empreendimento fora do cadastro do Hércules: nada é gravado", async () => {
    const banco = novoBanco();
    estado.cadastro = [];

    const r = await reservar(banco, ["JDG0101"]);

    expect(r.error).toMatch(/cadastro do Hércules/);
    expect(reservasDoHercules(banco)).toHaveLength(0);
  });

  it("o empreendimento da reserva é o pai do cadastro, como na Venda", () => {
    expect(
      empreendimentoDaReserva(
        [
          { c2xEnterpriseId: "37", id: "voc", paiId: "vlo" },
          { c2xEnterpriseId: "50", id: "visao", paiId: "pai" },
          { c2xEnterpriseId: "50", id: "pai", paiId: null },
        ],
        "50",
      ),
    ).toBe("pai");
    expect(empreendimentoDaReserva([{ c2xEnterpriseId: "37", id: "voc", paiId: "vlo" }], "37")).toBe("voc");
    expect(empreendimentoDaReserva([], "37")).toBeNull();
  });
});

// ── O CANCELAMENTO ─────────────────────────────────────────────────────────────

describe("cancelar no Prometeu cancela no Hércules", () => {
  it("devolver um lote do cupom: a linha e a reserva do Hércules caem, e o cadastro volta", async () => {
    const banco = novoBanco();
    const { grupoId } = await reservar(banco, ["JDG0101", "JDG0102"]);

    const r = await cancelarReservaDoGrupo(banco.cliente as never, {
      canceladoPor: "op-2",
      canceladoPorNome: "joana",
      codigos: ["JDG0101"],
      grupoId: String(grupoId),
      motivo: "cliente desistiu",
    });

    expect(r.error).toBeUndefined();
    expect(r.resultado).toEqual({ codigos: ["JDG0101"], quantos: 1, reservasDoHercules: 1 });
    const cupom = banco.linhas("prometeu_reservas");
    expect(cupom.find((l) => l.codigo === "JDG0101")?.situacao).toBe("cancelada");
    expect(cupom.find((l) => l.codigo === "JDG0102")?.situacao).toBe("reservada");
    expect(reservasDoHercules(banco).find((h) => h.unidade_id === "u1")).toMatchObject({
      cancelada_por: "op-2",
      cancelada_por_nome: "joana",
      situacao: "cancelada",
    });
    expect(String(reservasDoHercules(banco).find((h) => h.unidade_id === "u1")?.cancelada_motivo)).toMatch(
      /cliente desistiu/,
    );
    expect(cadastroDe(banco, "u1")).toBe("disponivel");
    expect(await situacaoDe(banco, "u1")).toBe("disponivel");
    expect(await situacaoDe(banco, "u2")).toBe("reservado");
  });

  it("lote que já virou proposta no Hércules não se cancela pelo salão, e nada cai", async () => {
    const banco = novoBanco();
    const { grupoId } = await reservar(banco, ["JDG0101"]);
    const reserva = reservasDoHercules(banco)[0] as Linha;
    reserva.situacao = "proposta";

    const r = await cancelarReservaDoGrupo(banco.cliente as never, {
      canceladoPor: "op-2",
      grupoId: String(grupoId),
      motivo: "engano",
    });

    expect(r.error).toMatch(/proposta no Hércules/);
    expect(banco.linhas("prometeu_reservas")[0]?.situacao).toBe("reservada");
    expect(reserva.situacao).toBe("proposta");
  });

  it("com outro dono no terreno, o cadastro NÃO volta a disponível", async () => {
    const banco = novoBanco();
    const { grupoId } = await reservar(banco, ["JDG0101"]);
    // Uma proposta importada do legado aparece no lote enquanto a reserva do salão estava viva.
    banco.linhas("hercules_propostas").push({
      criado_em_c2x: "2026-09-18T10:00:00Z",
      etapa: "proposta",
      etapa_desde: "2026-09-18T10:00:00Z",
      id: "p-importada",
      reserva_id: null,
      unidade_id: "u1",
      workspace_id: "careli",
    });

    await cancelarReservaDoGrupo(banco.cliente as never, { canceladoPor: "op-2", grupoId: String(grupoId), motivo: "x" });

    expect(reservasDoHercules(banco)[0]?.situacao).toBe("cancelada");
    expect(cadastroDe(banco, "u1")).toBe("reservada");
    expect(await situacaoDe(banco, "u1")).toBe("proposta");
  });

  it("lote bloqueado no Apolo durante a reserva continua bloqueado depois do cancelamento", async () => {
    const banco = novoBanco();
    const { grupoId } = await reservar(banco, ["JDG0101"]);
    const linha = banco.linhas("hercules_unidades").find((l) => l.id === "u1") as Linha;
    linha.situacao = "bloqueada";

    await cancelarReservaDoGrupo(banco.cliente as never, { canceladoPor: "op-2", grupoId: String(grupoId), motivo: "x" });

    expect(cadastroDe(banco, "u1")).toBe("bloqueada");
  });

  it("a reserva do Hércules que não caiu é retomada no cancelamento seguinte", async () => {
    const banco = novoBanco();
    const { grupoId } = await reservar(banco, ["JDG0101"]);
    const falha = (tabela: string, operacao: Operacao) => tabela === "hercules_reservas" && operacao === "update";
    banco.falhas.push(falha);

    const primeira = await cancelarReservaDoGrupo(banco.cliente as never, {
      canceladoPor: "op-2",
      grupoId: String(grupoId),
      motivo: "x",
    });
    expect(primeira.error).toMatch(/Hércules não/);
    expect(banco.linhas("prometeu_reservas")[0]?.situacao).toBe("cancelada");
    // Enquanto a reserva do Hércules não cai, o lote segue ocupado: nunca livre com dono no papel.
    expect(await situacaoDe(banco, "u1")).toBe("reservado");

    banco.falhas.splice(banco.falhas.indexOf(falha), 1);
    const segunda = await cancelarReservaDoGrupo(banco.cliente as never, {
      canceladoPor: "op-2",
      grupoId: String(grupoId),
      motivo: "x",
    });

    expect(segunda.error).toBeUndefined();
    expect(segunda.resultado).toEqual({ codigos: [], quantos: 0, reservasDoHercules: 1 });
    expect(reservasDoHercules(banco)[0]?.situacao).toBe("cancelada");
    expect(await situacaoDe(banco, "u1")).toBe("disponivel");
  });

  it("cupom antigo, sem reserva do Hércules, cancela como sempre", async () => {
    const banco = novoBanco({
      prometeu_reservas: [
        { codigo: "JDG0102", evento_id: "ev-1", grupo_id: "g-velho", id: "cupom-velho", situacao: "reservada", unidade_c2x_id: "9002" },
      ],
    });
    expect(await situacaoDe(banco, "u2")).toBe("reservado");

    const r = await cancelarReservaDoGrupo(banco.cliente as never, { canceladoPor: null, grupoId: "g-velho", motivo: "x" });

    expect(r.resultado).toEqual({ codigos: ["JDG0102"], quantos: 1, reservasDoHercules: 0 });
    expect(await situacaoDe(banco, "u2")).toBe("disponivel");
  });

  it("cancelar de novo o que já caiu é resultado zero, não erro", async () => {
    const banco = novoBanco();
    const { grupoId } = await reservar(banco, ["JDG0101"]);
    await cancelarReservaDoGrupo(banco.cliente as never, { canceladoPor: null, grupoId: String(grupoId), motivo: "x" });

    const r = await cancelarReservaDoGrupo(banco.cliente as never, { canceladoPor: null, grupoId: String(grupoId), motivo: "x" });

    expect(r).toEqual({ resultado: { codigos: [], quantos: 0, reservasDoHercules: 0 } });
  });
});

// ── O CUPOM SEGUE A RESERVA DO HÉRCULES ────────────────────────────────────────

describe("o cupom que a PA imprime segue a reserva do Hércules", () => {
  it("reserva cancelada na Venda sai do cupom como cancelada", async () => {
    const banco = novoBanco();
    const { grupoId } = await reservar(banco, ["JDG0101", "JDG0102"]);
    const naVenda = reservasDoHercules(banco).find((h) => h.unidade_id === "u1") as Linha;
    naVenda.situacao = "cancelada";

    const { error, reservas } = await reservasDoGrupo(banco.cliente as never, String(grupoId));

    expect(error).toBeUndefined();
    expect(reservas.find((r) => r.codigo === "JDG0101")?.situacao).toBe("cancelada");
    expect(reservas.find((r) => r.codigo === "JDG0102")?.situacao).toBe("reservada");
  });

  it("sem conseguir ler o Hércules, erro, e não o cupom cru", async () => {
    const banco = novoBanco();
    const { grupoId } = await reservar(banco, ["JDG0101"]);
    banco.falhas.push((tabela, operacao) => tabela === "hercules_reservas" && operacao === "select");

    const { error, reservas } = await reservasDoGrupo(banco.cliente as never, String(grupoId));

    expect(error).toBeTruthy();
    expect(reservas).toEqual([]);
  });

  it("a Central, a lista do evento, o mini dash e o nome no Apolo também seguem a reserva do Hércules", async () => {
    const banco = novoBanco({
      prometeu_credenciados: [
        { corretor: "Y", documento: "123.456.789-09", evento_id: "ev-1", id: "cred-1", imobiliaria: "X", nome: "Maria da Silva" },
      ],
    });
    const { grupoId } = await reservar(banco, ["JDG0101", "JDG0102"]);
    (reservasDoHercules(banco).find((h) => h.unidade_id === "u1") as Linha).situacao = "cancelada";

    const central = await reservasVivasDoPanteon(banco.cliente as never, "ev-1");
    expect(central.reservas.map((r) => r.unidade)).toEqual(["JDG0102"]);

    const nomes = await reservasVivasPorCodigo(banco.cliente as never);
    expect([...nomes.keys()]).toEqual(["JDG0102"]);

    // O cupom continua vivo enquanto um lote dele estiver vivo.
    const lista = await reservasDoEvento(banco.cliente as never, "ev-1");
    expect(lista.reservas?.find((r) => r.grupoId === grupoId)?.situacao).toBe("reservada");
    expect((await contadoresDoEvento(banco.cliente as never, "ev-1")).reservas).toBe(1);

    (reservasDoHercules(banco).find((h) => h.unidade_id === "u2") as Linha).situacao = "cancelada";
    const depois = await reservasDoEvento(banco.cliente as never, "ev-1");
    expect(depois.reservas?.find((r) => r.grupoId === grupoId)?.situacao).toBe("cancelada");
    expect((await contadoresDoEvento(banco.cliente as never, "ev-1")).reservas).toBe(0);
  });
});
