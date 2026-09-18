import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Opcoes } from "@/lib/assinatura/clicksign/cliente";
import { cardsAbertosDaProposta } from "@/lib/temis/cards-abertos-db";
import { ATIVIDADES } from "@/lib/temis/trabalhos";

import { devolverCadastroDaUnidade, devolverCadastroSeNaoHaOutroDono } from "./cancelar-reserva-server";
import { concluirCancelamentoDoCard, type PedidoDeConclusao } from "./concluir-cancelamento-server";

// CONCLUIR O CANCELAMENTO E O DISTRATO NA TÊMIS, CONTRA UM BANCO EM MEMÓRIA.
//
// Lucas (18/09/2026): *"o time administrativo quando finaliza um cancelamento de contrato, a unidade
// nao esta voltando para disponibilidade"*. O que está travado aqui:
//   • a ORDEM das escritas: venda, reserva, card de contrato, o próprio card, a unidade por último;
//   • a unidade só volta pela TRAVA de verdade (`trava-do-lote.ts` + `situacao-da-unidade.ts` rodam
//     aqui sem dublê): outro dono no terreno segura o lote, e o recado diz qual;
//   • os fatos são REAPURADOS no clique: o cancelamento que agora exige distrato é recusado sem
//     gravar nada;
//   • o envelope do contrato vivo morre na Clicksign antes da venda cair, pela leitura do estado
//     real; assinado ou duvidoso recusa;
//   • o distrato sem as duas declarações não conclui; com elas, não mexe no envelope;
//   • concorrência e leitura que falha param antes de gravar o que vem depois.
//
// ⚠️ O BANCO EM MEMÓRIA É O DE `trava-do-lote.test.ts`, com as tabelas da Têmis a mais (a casa tem
// um dublê por arquivo de teste). Ele confere NOMES DE COLUNA: uma consulta com coluna que não existe
// no banco de verdade falha o teste no `afterEach`, porque o `select` é string e o typecheck não o
// alcança.

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
  limit(n: number): Construtor;
  maybeSingle(): Construtor;
  not(coluna: string, operador: string, valor: unknown): Construtor;
  or(expressao: string): Construtor;
  order(coluna: string, opcoes?: { ascending?: boolean }): Construtor;
  range(de: number, ate: number): Construtor;
  select(colunas?: string): Construtor;
  update(patch: Linha): Construtor;
};

type Banco = {
  cliente: SupabaseClient;
  consultas: Consulta[];
  depois(quando: (c: Consulta) => boolean, fazer: (banco: Banco) => void): void;
  falhar(quando: (c: Consulta) => boolean): void;
  linha(tabela: string, id: string): Linha | undefined;
  linhas(tabela: string): Linha[];
  problemas: string[];
  semear(tabela: string, linha: Linha): void;
};

/** As colunas de verdade (conferidas em `information_schema` em 18/09/2026). */
const COLUNAS: Record<string, readonly string[]> = {
  hercules_proposta_etapas: [
    "autor_nome", "de", "id", "motivo", "observacao", "para", "proposta_id", "quando", "workspace_id",
  ],
  hercules_proposta_eventos: ["id", "proposta_id", "tipo", "valor"],
  hercules_propostas: [
    "aberta", "atualizado_em", "cancelada_em", "cancelada_motivo", "cancelada_por", "cancelada_por_nome",
    "cancelamento_pedido_em", "cancelamento_pedido_motivo", "cancelamento_pedido_por",
    "cancelamento_pedido_tipo", "cliente_documento", "codigo", "criado_em", "criado_em_c2x", "data_assinatura", "data_ato",
    "data_faturamento", "etapa", "etapa_desde", "etapa_por", "id", "origem", "protocolo_numero",
    "reserva_id", "unidade_id", "workspace_id",
  ],
  hercules_reservas: [
    "atualizado_em", "cancelada_em", "cancelada_motivo", "cancelada_por", "cancelada_por_nome",
    "criado_em", "empreendimento_id", "evento_id", "id", "origem", "prometeu_reserva_id",
    "protocolo_numero", "situacao", "unidade_id", "workspace_id",
  ],
  hercules_unidades: [
    "atualizado_em", "codigo", "criado_em", "enterprise_id", "espelho_de", "id", "lote",
    "origem_c2x_id", "quadra", "situacao", "workspace_id",
  ],
  prometeu_reservas: ["codigo", "evento_id", "id", "lote", "quadra", "situacao", "unidade_c2x_id"],
  temis_envelopes: [
    "atualizado_em", "criado_em", "envelope_id", "estado", "estado_cru", "falha", "fechado_em", "id",
    "proposta_id", "provedor", "workspace_id",
  ],
  temis_trabalho_etapas: [
    "de", "id", "motivo", "observacao", "origem", "para", "proposta_id", "quem", "quem_nome",
    "trabalho_id", "trabalho_tipo", "workspace_id",
  ],
  temis_trabalhos: [
    "atividades_feitas", "atualizado_em", "criado_em", "estagio", "estagio_desde", "id",
    "indeferido_em", "indeferido_motivo", "indeferido_observacao", "indeferido_por",
    "indeferido_por_nome", "proposta_id", "tipo", "unidade", "workspace_id",
  ],
};

/** As origens que o check da 0153 aceita HOJE em produção (sem a 0177). */
const ORIGENS_DA_0153 = [
  "abertura", "atividade", "contrato_gerado", "envio_assinatura", "webhook_assinatura",
  "indeferimento", "retorno_para_correcao",
];

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

/** A lista `(a,"b")` do PostgREST, sem parênteses nem aspas. */
function listaDoPostgrest(valor: string): null | Set<string> {
  if (!valor.startsWith("(") || !valor.endsWith(")")) return null;
  return new Set(separarNoTopo(valor.slice(1, -1)).map((v) => v.trim().replace(/^"(.*)"$/, "$1")));
}

function condicaoDoOr(expressao: string): null | { coluna: string; teste: (l: Linha) => boolean } {
  const m = /^([a-z_0-9]+)\.(eq|in)\.(.+)$/.exec(expressao.trim());
  if (!m) return null;
  const coluna = m[1] ?? "";
  const valor = m[3] ?? "";
  if (m[2] === "eq") return { coluna, teste: (l) => texto(l[coluna]) === valor };
  const aceitos = listaDoPostgrest(valor);
  if (!aceitos) return null;
  return {
    coluna,
    teste: (l) => {
      const t = texto(l[coluna]);
      return t !== null && aceitos.has(t);
    },
  };
}

/** As regras que o banco de verdade faz valer e que importam aqui. */
function violacao(tabela: string, linha: Linha, outras: readonly Linha[], origens: readonly string[]): ErroDoBanco | null {
  if (tabela === "temis_trabalho_etapas" && !origens.includes(String(linha.origem))) {
    return {
      code: "23514",
      message:
        'new row for relation "temis_trabalho_etapas" violates check constraint "temis_trabalho_etapas_origem_valida"',
    };
  }
  if (tabela !== "hercules_reservas") return null;
  const viva = (l: Linha) => ["ativa", "proposta"].includes(String(l.situacao));
  if (viva(linha) && outras.some((o) => viva(o) && texto(o.unidade_id) === texto(linha.unidade_id))) {
    return {
      code: "23505",
      message: 'duplicate key value violates unique constraint "hercules_reservas_uma_viva_por_unidade"',
    };
  }
  return null;
}

function criarBanco(inicial: Record<string, Linha[]>, opcoes: { origensDaPassagem?: readonly string[] } = {}): Banco {
  const origens = opcoes.origensDaPassagem ?? ORIGENS_DA_0153;
  const tabelas = new Map<string, Linha[]>();
  const consultas: Consulta[] = [];
  const problemas: string[] = [];
  const falhas: Array<(c: Consulta) => boolean> = [];
  const ganchos: Array<{ fazer: (b: Banco) => void; quando: (c: Consulta) => boolean }> = [];
  let contador = 0;

  const daTabela = (tabela: string): Linha[] => {
    const existente = tabelas.get(tabela);
    if (existente) return existente;
    const nova: Linha[] = [];
    tabelas.set(tabela, nova);
    return nova;
  };

  const comPadroes = (tabela: string, linha: Linha): Linha => {
    const base: Linha = Object.fromEntries((COLUNAS[tabela] ?? []).map((c) => [c, null]));
    contador += 1;
    base.id = `${tabela}-${contador}`;
    return { ...base, ...linha };
  };

  function from(tabela: string): Construtor {
    let operacao: Operacao = "select";
    let colunas: null | string[] = null;
    let devolver = false;
    let unico = false;
    let carga: Linha[] = [];
    let ordem: null | { ascendente: boolean; coluna: string } = null;
    let faixa: null | readonly [number, number] = null;
    let teto: null | number = null;
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
      if (projetadas.length > 1) return { data: null, error: { code: "PGRST116", message: "multiple rows" } };
      return { data: projetadas[0] ?? null, error: null };
    };

    const responder = (): Resposta => {
      const todas = daTabela(tabela);
      const casa = (l: Linha) => filtros.every((f) => f(l));
      if (operacao === "insert") {
        const novas: Linha[] = [];
        for (const bruta of carga) {
          const nova = comPadroes(tabela, bruta);
          const erro = violacao(tabela, nova, [...todas, ...novas], origens);
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
          const erro = violacao(tabela, { ...l, ...patch }, todas.filter((o) => o !== l), origens);
          if (erro) return { data: null, error: erro };
        }
        for (const l of alvo) Object.assign(l, patch);
        return devolver ? saida(alvo) : { data: null, error: null };
      }
      let linhas = todas.filter(casa);
      if (ordem) {
        const { ascendente, coluna } = ordem;
        linhas = [...linhas].sort((a, b) => {
          const c = (texto(a[coluna]) ?? "").localeCompare(texto(b[coluna]) ?? "");
          return ascendente ? c : -c;
        });
      }
      const de = faixa ? faixa[0] : 0;
      const ate = faixa ? faixa[1] + 1 : Number.POSITIVE_INFINITY;
      linhas = linhas.slice(de, Math.min(ate, de + 1000));
      if (teto !== null) linhas = linhas.slice(0, teto);
      return saida(linhas);
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
      limit(n) {
        teto = n;
        return q;
      },
      maybeSingle() {
        unico = true;
        return q;
      },
      not(coluna, operador, valor) {
        conferir(coluna, "not");
        if (operador === "is" && valor === null) {
          descricao.push(`not:${coluna}=null`);
          filtros.push((l) => texto(l[coluna]) !== null);
          return q;
        }
        const lista = operador === "in" ? listaDoPostgrest(String(valor)) : null;
        if (!lista) {
          erros.push(`not(${coluna}, ${operador}) não é imitado`);
          return q;
        }
        descricao.push(`not-in:${coluna}=${[...lista].join(",")}`);
        filtros.push((l) => {
          const t = texto(l[coluna]);
          return t !== null && !lista.has(t);
        });
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
      order(coluna, opcoesDaOrdem) {
        conferir(coluna, "order");
        ordem = { ascendente: opcoesDaOrdem?.ascending !== false, coluna };
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
    linha: (tabela, id) => daTabela(tabela).find((l) => l.id === id),
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
// O Vale do Ouro como ele é: o pai (VLO, 35) guarda as linhas antigas, que apontam por `espelho_de`
// para a viva da gleba (VOC 37). A venda nativa do VOC0306 (COD 000021) é o caso real que abriu isto:
// reserva em `proposta`, venda em `contrato`, cadastro `reservada`, dois cards (contrato e pedido).

const VLO = "35";
const VOC = "37";

const unidade = (id: string, codigo: string, enterpriseId: string, quadra: string, lote: string, extra: Linha = {}): Linha => ({
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

type Cenario = {
  /** Cards a mais além do pedido (o de contrato, por padrão aberto em Análise). */
  cardDeContrato?: null | Linha;
  envelopes?: Linha[];
  eventos?: Linha[];
  origensDaPassagem?: readonly string[];
  pedido?: Linha;
  semReserva?: boolean;
  venda?: Linha;
  vocSituacao?: string;
};

function cenario(c: Cenario = {}): Banco {
  const banco = criarBanco(
    {
      hercules_proposta_eventos: c.eventos ?? [],
      hercules_propostas: [
        {
          aberta: true,
          cancelamento_pedido_em: "2026-09-17T12:00:00.000Z",
          cancelamento_pedido_motivo: "Cliente desistiu da compra",
          cancelamento_pedido_por: "Nivea",
          cancelamento_pedido_tipo: "cancelamento",
          codigo: null,
          criado_em: "2026-09-10T12:00:00.000Z",
          etapa: "contrato",
          etapa_desde: "2026-09-12T12:00:00.000Z",
          id: "venda-21",
          origem: "panteon",
          protocolo_numero: 21,
          reserva_id: "res-21",
          unidade_id: "voc-0306",
          workspace_id: "careli",
          ...c.venda,
        },
      ],
      // A venda importada do C2X não tem reserva do Hércules (`semReserva`).
      hercules_reservas: c.semReserva
        ? []
        : [
            {
              empreendimento_id: "emp-voc",
              id: "res-21",
              origem: "coordenador",
              situacao: "proposta",
              unidade_id: "voc-0306",
              workspace_id: "careli",
            },
          ],
      hercules_unidades: [
        unidade("vlo-0306", "VLO0306", VLO, "03", "06", { espelho_de: "voc-0306", origem_c2x_id: 9001 }),
        unidade("voc-0306", "VOC0306", VOC, "03", "06", {
          origem_c2x_id: 9101,
          situacao: c.vocSituacao ?? "reservada",
        }),
        unidade("voc-0307", "VOC0307", VOC, "03", "07", { origem_c2x_id: 9102 }),
      ],
      prometeu_reservas: [],
      temis_envelopes: c.envelopes ?? [],
      temis_trabalho_etapas: [],
      temis_trabalhos: [
        {
          atividades_feitas: [],
          criado_em: "2026-09-17T12:00:01.000Z",
          estagio: "analise",
          estagio_desde: "2026-09-17T12:00:01.000Z",
          id: "card-pedido",
          proposta_id: "venda-21",
          tipo: "cancelamento",
          workspace_id: "careli",
          ...c.pedido,
        },
        ...(c.cardDeContrato === null
          ? []
          : [
              {
                atividades_feitas: [],
                criado_em: "2026-09-12T12:00:00.000Z",
                estagio: "analise",
                estagio_desde: "2026-09-12T12:00:00.000Z",
                id: "card-contrato",
                proposta_id: "venda-21",
                tipo: "contrato",
                workspace_id: "careli",
                ...c.cardDeContrato,
              },
            ]),
      ],
    },
    { origensDaPassagem: c.origensDaPassagem },
  );
  bancosDoTeste.push(banco);
  return banco;
}

const bancosDoTeste: Banco[] = [];
beforeEach(() => {
  bancosDoTeste.length = 0;
});
afterEach(() => {
  // Nenhuma consulta pode ter usado coluna inexistente ou operador que o banco falso não imita.
  for (const banco of bancosDoTeste) expect(banco.problemas).toEqual([]);
  vi.restoreAllMocks();
});

const pedido = (extra: Partial<PedidoDeConclusao> = {}): PedidoDeConclusao => ({
  trabalhoId: "card-pedido",
  usuarioId: "u-nivea",
  usuarioNome: "Nivea",
  ...extra,
});

const DECLAROU_TUDO = { devolucaoAcertada: true, termoAssinado: true };

/** As escritas, na ordem em que chegaram ao banco: `tabela` (e o id escrito quando dá para saber). */
function escritas(banco: Banco): string[] {
  return banco.consultas
    .filter((c) => c.operacao !== "select")
    .map((c) => {
      const id = c.filtros.find((f) => f.startsWith("eq:id="));
      return id ? `${c.tabela}:${id.slice("eq:id=".length)}` : c.tabela;
    });
}

/** O duplo da porta HTTP da Clicksign: registra o que foi pedido. */
function portaDeTeste(respostas: { get?: Error | unknown; patch?: Error | unknown } = {}) {
  const chamadas: { caminho: string; metodo: string }[] = [];
  const porta = async <T = unknown>(caminho: string, opcoes: Opcoes = {}): Promise<T> => {
    const metodo = opcoes.metodo ?? "GET";
    chamadas.push({ caminho, metodo });
    const resposta = metodo === "GET" ? respostas.get : respostas.patch;
    if (resposta instanceof Error) throw resposta;
    return (resposta ?? {}) as T;
  };
  return { chamadas, porta };
}

const envelope = (extra: Linha = {}): Linha => ({
  criado_em: "2026-09-13T12:00:00.000Z",
  envelope_id: "env-vivo",
  estado: "aguardando",
  falha: null,
  id: "reg-env",
  proposta_id: "venda-21",
  provedor: "clicksign",
  ...extra,
});

const silenciar = () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
};

// ── O CAMINHO FELIZ, E A ORDEM ─────────────────────────────────────────────────

describe("concluir o cancelamento: a venda cai e o lote volta", () => {
  it("VOC0306: venda cancelada, reserva caída, contrato indeferido, card concluído, lote disponível", async () => {
    const banco = cenario();

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const venda = banco.linha("hercules_propostas", "venda-21");
    expect(venda).toMatchObject({
      aberta: false,
      cancelada_por: "u-nivea",
      cancelada_por_nome: "Nivea",
      etapa: "cancelado",
      etapa_por: "Nivea",
    });
    expect(venda?.cancelada_em).toBe(venda?.etapa_desde);
    expect(String(venda?.cancelada_motivo)).toContain("Cliente desistiu da compra");
    expect(String(venda?.cancelada_motivo)).toContain("Cancelamento concluído na Têmis por Nivea");

    // A reserva cai só na situação, sem os campos `cancelada_*` (como no cancelamento da proposta).
    expect(banco.linha("hercules_reservas", "res-21")).toMatchObject({ cancelada_em: null, situacao: "cancelada" });

    expect(banco.linha("temis_trabalhos", "card-contrato")).toMatchObject({
      estagio: "indeferido",
      indeferido_motivo: "outro",
      // Sem id interno em texto que alguém lê (revisão de 18/09/2026): o COD da venda.
      indeferido_observacao: "Venda cancelada pelo pedido de cancelamento (COD 000021)",
      indeferido_por_nome: "Nivea",
    });

    const card = banco.linha("temis_trabalhos", "card-pedido");
    expect(card?.estagio).toBe("faturado");
    expect(card?.atividades_feitas).toEqual(ATIVIDADES.cancelamento.map((a) => a.texto));

    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
    expect(r.unidade).toEqual({ frase: "a unidade voltou para a disponibilidade", voltou: true });
    expect(r.recado).toBe(
      "Cancelamento concluído: a venda COD 000021 foi cancelada, a reserva caiu e a unidade voltou para a disponibilidade.",
    );
    expect(r.contratosIndeferidos).toEqual(["card-contrato"]);
  });

  // ⚠️ A ORDEM É O DESENHO INTEIRO: soltar a unidade POR ÚLTIMO é o que garante que nenhuma falha no
  // meio deixe um lote livre com dono.
  it("a ordem das escritas: venda, reserva, card de contrato, o próprio card, a unidade por último", async () => {
    const banco = cenario();

    await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);

    const ordem = escritas(banco).filter((e) => !e.startsWith("temis_trabalho_etapas"));
    expect(ordem).toEqual([
      "hercules_propostas:venda-21",
      "hercules_reservas:res-21",
      "temis_trabalhos:card-contrato",
      "temis_trabalhos:card-pedido",
      "hercules_unidades:voc-0306",
    ]);
  });

  it("as duas passagens vão para o histórico: a do contrato indeferido e a da conclusão", async () => {
    silenciar();
    const banco = cenario();

    await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);

    const passagens = banco.linhas("temis_trabalho_etapas");
    expect(passagens.find((p) => p.trabalho_id === "card-contrato")).toMatchObject({
      de: "analise",
      origem: "indeferimento",
      para: "indeferido",
      quem_nome: "Nivea",
    });
    // ⚠️ SEM A 0177 A ORIGEM `conclusao` É RECUSADA PELO CHECK, e a passagem entra como `atividade`
    // (a mais próxima), em vez de sumir do histórico.
    const daConclusao = passagens.find((p) => p.trabalho_id === "card-pedido");
    expect(daConclusao).toMatchObject({ de: "analise", origem: "atividade", para: "faturado", quem: "u-nivea" });
    expect(String(daConclusao?.observacao)).toContain("Venda COD 000021 cancelada");
    expect(String(daConclusao?.observacao)).toContain("A unidade voltou para a disponibilidade");
  });

  it("com a 0177 aplicada, a passagem da conclusão entra com a origem própria", async () => {
    const banco = cenario({ origensDaPassagem: [...ORIGENS_DA_0153, "conclusao"] });

    await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);

    expect(
      banco.linhas("temis_trabalho_etapas").find((p) => p.trabalho_id === "card-pedido")?.origem,
    ).toBe("conclusao");
  });

  it("de Contrato (e não só da Análise) o card também conclui", async () => {
    const banco = cenario({ pedido: { estagio: "contrato" } });
    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);
    expect(r.ok).toBe(true);
    expect(banco.linha("temis_trabalhos", "card-pedido")?.estagio).toBe("faturado");
  });
});

// ── A TRAVA DECIDE O LOTE ──────────────────────────────────────────────────────

describe("a unidade só volta se o terreno ficou sem dono", () => {
  it("outro dono vivo na linha do pai segura o lote, e o recado diz quem", async () => {
    const banco = cenario();
    banco.semear("hercules_reservas", {
      empreendimento_id: "emp-vlo",
      id: "res-outra",
      origem: "coordenador",
      situacao: "ativa",
      unidade_id: "vlo-0306",
      workspace_id: "careli",
    });

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // A venda caiu mesmo assim: a trava segura o LOTE, não a conclusão.
    expect(banco.linha("hercules_propostas", "venda-21")?.etapa).toBe("cancelado");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
    expect(r.unidade.voltou).toBe(false);
    expect(r.unidade.frase).toContain("o lote tem outro dono (reserva)");
    expect(r.recado).toContain("a unidade NÃO voltou para a disponibilidade");
  });

  // ⚠️ AS VENDAS IMPORTADAS DO C2X (medido em 18/09/2026: VOL2, VOC1, VOC3, VOR1) têm a mesma venda
  // copiada na linha do pai, em `reservado`. A trava conta essa cópia como dono, e o lote fica.
  it("a proposta viva na linha do pai (a cópia do C2X) também segura", async () => {
    const banco = cenario();
    banco.semear("hercules_propostas", {
      criado_em_c2x: "2025-11-03T00:00:00.000Z",
      etapa: "reservado",
      etapa_desde: "2025-11-03T00:00:00.000Z",
      id: "copia-no-pai",
      origem: "c2x",
      unidade_id: "vlo-0306",
      workspace_id: "careli",
    });

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);

    expect(r.ok && r.unidade.voltou).toBe(false);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
  });

  it("cadastro bloqueado no Apolo nunca volta por aqui", async () => {
    const banco = cenario({ vocSituacao: "bloqueada" });
    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("bloqueada");
    expect(r.unidade).toEqual({
      frase: "a unidade NÃO voltou para a disponibilidade: ela está bloqueada no cadastro",
      voltou: false,
    });
  });

  it("leitura do terreno que falha não afirma que o lote está livre", async () => {
    silenciar();
    const banco = cenario();
    banco.falhar((c) => c.tabela === "hercules_unidades" && c.operacao === "select");

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.unidade.voltou).toBe(false);
    expect(r.unidade.frase).toContain("não deu para conferir se o lote tem outro dono");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
  });
});

// ── OS FATOS DE AGORA ──────────────────────────────────────────────────────────

describe("os fatos são reapurados no clique", () => {
  it("cancelamento cujo cliente pagou depois do pedido: RECUSADO, nada gravado", async () => {
    const banco = cenario({ eventos: [{ proposta_id: "venda-21", tipo: "pagamento" }] });
    const { chamadas, porta } = portaDeTeste();

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toContain("A situação mudou: agora exige distrato");
    expect(escritas(banco)).toEqual([]);
    expect(chamadas).toEqual([]);
  });

  it("cancelamento com o contrato assinado por todos no banco: RECUSADO", async () => {
    const banco = cenario({ envelopes: [envelope({ estado: "assinado", fechado_em: "2026-09-15T12:00:00.000Z" })] });
    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain("agora exige distrato");
    expect(escritas(banco)).toEqual([]);
  });

  it("leitura dos fatos que falha é recusa, e não 'não pagou'", async () => {
    silenciar();
    const banco = cenario();
    banco.falhar((c) => c.tabela === "hercules_proposta_eventos");
    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(503);
    expect(escritas(banco)).toEqual([]);
  });
});

// ── O ENVELOPE DO CONTRATO NA CLICKSIGN ─────────────────────────────────────────

describe("o envelope do contrato ainda vivo", () => {
  it("a Clicksign diz running: o envelope morre ANTES de a venda cair, e o registro diz quem cancelou", async () => {
    const banco = cenario({ envelopes: [envelope()] });
    const { chamadas, porta } = portaDeTeste({ get: { data: { attributes: { status: "running" } } } });

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(chamadas).toEqual([
      { caminho: "/envelopes/env-vivo", metodo: "GET" },
      { caminho: "/envelopes/env-vivo", metodo: "PATCH" },
    ]);
    expect(r.envelopeCancelado).toBe("env-vivo");
    expect(banco.linha("temis_envelopes", "reg-env")).toMatchObject({
      estado: "cancelado",
      estado_cru: "panteon:conclusao_do_cancelamento",
    });
    // O carimbo do envelope vem antes de qualquer escrita da venda.
    expect(escritas(banco)[0]).toBe("temis_envelopes:reg-env");
  });

  // O webhook atrasado: o banco diz `aguardando`, e a última assinatura já entrou.
  it("a Clicksign diz closed: RECUSA sem cancelar nada nem gravar nada", async () => {
    const banco = cenario({ envelopes: [envelope({ estado: "parcial" })] });
    const { chamadas, porta } = portaDeTeste({ get: { data: { attributes: { status: "closed" } } } });

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain('"closed"');
    expect(chamadas.some((c) => c.metodo === "PATCH")).toBe(false);
    expect(escritas(banco)).toEqual([]);
  });

  it("a leitura na Clicksign falha: RECUSA no escuro não se cancela", async () => {
    const banco = cenario({ envelopes: [envelope()] });
    const { chamadas, porta } = portaDeTeste({ get: new Error("timeout") });

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(502);
    expect(chamadas.some((c) => c.metodo === "PATCH")).toBe(false);
    expect(escritas(banco)).toEqual([]);
  });

  it("a Clicksign já cancelou lá: segue sem mandar PATCH", async () => {
    const banco = cenario({ envelopes: [envelope()] });
    const { chamadas, porta } = portaDeTeste({ get: { data: { attributes: { status: "canceled" } } } });

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), porta);

    expect(r.ok).toBe(true);
    expect(chamadas.some((c) => c.metodo === "PATCH")).toBe(false);
  });

  it("envio sem desfecho (linha viva sem envelope_id): RECUSA, sem chamar a Clicksign", async () => {
    const banco = cenario({ envelopes: [envelope({ envelope_id: null })] });
    const { chamadas, porta } = portaDeTeste();
    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), porta);
    expect(r.ok).toBe(false);
    expect(chamadas).toEqual([]);
    expect(escritas(banco)).toEqual([]);
  });
});

// ── O DISTRATO ─────────────────────────────────────────────────────────────────

describe("concluir o distrato", () => {
  // As vendas importadas do C2X: etapa `assinatura`, cadastro `vendida` pela carga, sem reserva.
  const distratoImportado = (extra: Cenario = {}) =>
    cenario({
      cardDeContrato: null,
      pedido: { tipo: "distrato" },
      semReserva: true,
      venda: {
        cancelamento_pedido_tipo: "distrato",
        codigo: "VOC3",
        data_assinatura: "2025-11-10",
        etapa: "assinatura",
        origem: "c2x",
        protocolo_numero: null,
        reserva_id: null,
      },
      vocSituacao: "vendida",
      ...extra,
    });

  it("sem as duas declarações não conclui, e não grava nada", async () => {
    const banco = distratoImportado();
    const r = await concluirCancelamentoDoCard(banco.cliente, pedido({ declaracoes: { termoAssinado: true } }), portaDeTeste().porta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(422);
    expect(r.erro).toContain("devolução de valores acertada com o cliente");
    expect(escritas(banco)).toEqual([]);
  });

  it("com as duas: a venda vira distrato, o cadastro `vendida` volta e as declarações ficam gravadas", async () => {
    silenciar();
    const banco = distratoImportado();

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido({ declaracoes: DECLAROU_TUDO }), portaDeTeste().porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const venda = banco.linha("hercules_propostas", "venda-21");
    expect(venda?.etapa).toBe("distrato");
    expect(String(venda?.cancelada_motivo)).toContain(
      "Declarado: Termo de distrato assinado; Devolução de valores acertada com o cliente",
    );
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
    expect(banco.linha("temis_trabalhos", "card-pedido")?.atividades_feitas).toEqual(
      ATIVIDADES.distrato.map((a) => a.texto),
    );
    const passagem = banco.linhas("temis_trabalho_etapas").find((p) => p.trabalho_id === "card-pedido");
    expect(String(passagem?.observacao)).toContain("Declarado: Termo de distrato assinado");
    expect(r.recado).toContain("Distrato concluído: a venda COD VOC3 foi distratada e a unidade voltou");
  });

  // ⚠️ MUDOU NA REVISÃO DE 18/09/2026: o envelope que ainda se pode assinar MORRE também no distrato
  // (senão alguém assinaria o contrato de um lote que já voltou para a venda). Só o assinado por
  // todos fica quieto.
  it("envelope ainda assinável: morre na Clicksign antes de a venda cair, e o histórico do card conta", async () => {
    silenciar();
    const banco = distratoImportado({ envelopes: [envelope({ estado: "parcial" })] });
    const { chamadas, porta } = portaDeTeste({ get: { data: { attributes: { status: "running" } } } });

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido({ declaracoes: DECLAROU_TUDO }), porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(chamadas.map((c) => c.metodo)).toEqual(["GET", "PATCH"]);
    expect(r.envelopeCancelado).toBe("env-vivo");
    expect(banco.linha("temis_envelopes", "reg-env")?.estado).toBe("cancelado");
    const passagem = banco.linhas("temis_trabalho_etapas").find((p) => p.trabalho_id === "card-pedido");
    expect(String(passagem?.observacao)).toContain("envelope env-vivo cancelado na Clicksign");
  });

  it("contrato assinado por todos: o envelope fica quieto, e o distrato conclui", async () => {
    const banco = distratoImportado({ envelopes: [envelope({ estado: "assinado" })] });
    const { chamadas, porta } = portaDeTeste();

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido({ declaracoes: DECLAROU_TUDO }), porta);

    expect(r.ok).toBe(true);
    expect(chamadas).toEqual([]);
    expect(banco.linha("temis_envelopes", "reg-env")?.estado).toBe("assinado");
  });

  it("a Clicksign diz assinado por todos no distrato: não cancela, e o card de contrato assinado não vira indeferido", async () => {
    silenciar();
    const banco = distratoImportado({
      cardDeContrato: { estagio: "assinatura" },
      envelopes: [envelope({ estado: "parcial" })],
    });
    const { chamadas, porta } = portaDeTeste({ get: { data: { attributes: { status: "closed", signers_count: 2 } } } });

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido({ declaracoes: DECLAROU_TUDO }), porta);

    // "closed" sem saber se todos assinaram cai em CONFERIR: recusa sem gravar nada (falha fechada).
    expect(r.ok).toBe(false);
    expect(chamadas.map((c) => c.metodo)).toEqual(["GET"]);
    expect(escritas(banco)).toEqual([]);
  });

  it("card de contrato em Pré-faturamento (contrato assinado): fica onde está, e o recado diz", async () => {
    const banco = distratoImportado({ cardDeContrato: { estagio: "prazo_legal" } });

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido({ declaracoes: DECLAROU_TUDO }), portaDeTeste().porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(banco.linha("temis_trabalhos", "card-contrato")?.estagio).toBe("prazo_legal");
    expect(r.contratosIndeferidos).toEqual([]);
    expect(r.avisos.join(" ")).toContain("fica em Pré-faturamento: o contrato foi assinado");
  });

  it("card de distrato com fatos que hoje dariam cancelamento simples segue (o distrato é o instrumento maior)", async () => {
    const banco = distratoImportado({ venda: { codigo: "X", data_assinatura: null, etapa: "contrato" } });
    const r = await concluirCancelamentoDoCard(banco.cliente, pedido({ declaracoes: DECLAROU_TUDO }), portaDeTeste().porta);
    expect(r.ok).toBe(true);
    expect(banco.linha("hercules_propostas", "venda-21")?.etapa).toBe("distrato");
  });
});

// ── CONCORRÊNCIA, IDEMPOTÊNCIA E O QUE NÃO SE CONCLUI ───────────────────────────

describe("o que para antes de gravar", () => {
  it("a venda mudou entre a leitura e a escrita: para antes da reserva e do lote", async () => {
    const banco = cenario();
    // Outra pessoa concluiu no meio: quando a leitura dos fatos termina, a venda já é outra.
    banco.depois(
      (c) => c.tabela === "hercules_proposta_eventos",
      (b) => {
        const venda = b.linha("hercules_propostas", "venda-21");
        if (venda) venda.etapa = "cancelado";
      },
    );

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
    expect(r.erro).toContain("A venda mudou enquanto a tela estava aberta");
    expect(escritas(banco)).toEqual(["hercules_propostas:venda-21"]);
    expect(banco.linha("hercules_reservas", "res-21")?.situacao).toBe("proposta");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
  });

  it("a reserva não cai: para ANTES de soltar o lote, e o clique de novo retoma sem repetir a venda", async () => {
    silenciar();
    const banco = cenario();
    let falhar = true;
    banco.falhar((c) => falhar && c.tabela === "hercules_reservas" && c.operacao === "update");

    const primeira = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);
    expect(primeira.ok).toBe(false);
    expect(banco.linha("hercules_propostas", "venda-21")?.etapa).toBe("cancelado");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");

    falhar = false;
    const segunda = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);
    expect(segunda.ok).toBe(true);
    if (!segunda.ok) return;
    expect(segunda.jaEstavaDesfeita).toBe(true);
    expect(banco.linha("hercules_reservas", "res-21")?.situacao).toBe("cancelada");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
    expect(banco.linha("temis_trabalhos", "card-pedido")?.estagio).toBe("faturado");
  });

  it("venda já cancelada: nada a fazer nela, o card fecha", async () => {
    const banco = cenario({ venda: { etapa: "cancelado" } });
    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.jaEstavaDesfeita).toBe(true);
    expect(escritas(banco)).not.toContain("hercules_propostas:venda-21");
    expect(banco.linha("temis_trabalhos", "card-pedido")?.estagio).toBe("faturado");
    expect(r.recado).toMatch(/^A venda COD 000021 já estava cancelada/);
  });

  it.each([["indeferido", "foi indeferido"]])("card %s não conclui", async (estagio, frase) => {
    const banco = cenario({ pedido: { estagio } });
    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.erro).toContain(frase);
    expect(escritas(banco)).toEqual([]);
  });

  it("card de contrato não conclui por aqui", async () => {
    const banco = cenario();
    const r = await concluirCancelamentoDoCard(banco.cliente, pedido({ trabalhoId: "card-contrato" }), portaDeTeste().porta);
    expect(r.ok).toBe(false);
    expect(escritas(banco)).toEqual([]);
  });

  it("leitura do card que falha: 503, nada gravado", async () => {
    silenciar();
    const banco = cenario();
    banco.falhar((c) => c.tabela === "temis_trabalhos" && c.operacao === "select");
    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(503);
    expect(escritas(banco)).toEqual([]);
  });

  it("card sem venda ligada não conclui", async () => {
    const banco = cenario({ pedido: { proposta_id: null } });
    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);
    expect(r.ok).toBe(false);
    expect(escritas(banco)).toEqual([]);
  });
});

// ── AS PEÇAS REUSADAS ──────────────────────────────────────────────────────────

describe("a devolução do cadastro, com os estados de origem", () => {
  it("o padrão continua só `reservada`: `vendida` não volta sem pedir", async () => {
    const banco = cenario({ vocSituacao: "vendida" });
    // Sem dono vivo no terreno.
    banco.linha("hercules_reservas", "res-21")!.situacao = "cancelada";
    banco.linha("hercules_propostas", "venda-21")!.etapa = "cancelado";

    expect(await devolverCadastroSeNaoHaOutroDono(banco.cliente, "voc-0306", {})).toBe(false);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("vendida");

    expect(await devolverCadastroSeNaoHaOutroDono(banco.cliente, "voc-0306", {}, undefined, ["reservada", "vendida"])).toBe(true);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
  });

  it("`bloqueada` nunca sai, nem pedida", async () => {
    const banco = cenario({ vocSituacao: "bloqueada" });
    banco.linha("hercules_reservas", "res-21")!.situacao = "cancelada";
    banco.linha("hercules_propostas", "venda-21")!.etapa = "cancelado";

    const d = await devolverCadastroDaUnidade(banco.cliente, "voc-0306", {}, { aceitos: ["bloqueada", "reservada"] });
    expect(d).toEqual({ devolvida: false, porque: "bloqueada" });
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("bloqueada");
  });
});

describe("os cards abertos de uma venda", () => {
  it("aberto é fora de Concluído e de Indeferido", async () => {
    const banco = cenario({ cardDeContrato: { estagio: "indeferido" } });
    banco.semear("temis_trabalhos", {
      criado_em: "2026-09-01T00:00:00.000Z",
      estagio: "faturado",
      id: "card-velho",
      proposta_id: "venda-21",
      tipo: "cancelamento",
      workspace_id: "careli",
    });

    const r = await cardsAbertosDaProposta(banco.cliente, {
      propostaId: "venda-21",
      tipos: ["cancelamento", "contrato", "distrato"],
    });

    expect(r).toEqual({ cards: [{ estagio: "analise", id: "card-pedido", tipo: "cancelamento" }], ok: true });
  });

  it("leitura que falha nunca vira lista vazia", async () => {
    silenciar();
    const banco = cenario();
    banco.falhar((c) => c.tabela === "temis_trabalhos");
    expect(await cardsAbertosDaProposta(banco.cliente, { propostaId: "venda-21", tipos: ["contrato"] })).toEqual({ ok: false });
  });
});

// ── RODADA 2 DA REVISÃO (18/09/2026) ───────────────────────────────────────────

describe("a retomada: card concluído com o lote ainda preso", () => {
  it("card em Concluído com a venda já desfeita: só tenta devolver o lote, sem pedir as declarações de novo", async () => {
    const banco = cenario({
      pedido: { estagio: "faturado", tipo: "distrato" },
      venda: { cancelada_em: "2026-09-18T12:00:00.000Z", etapa: "distrato" },
    });
    banco.linha("hercules_reservas", "res-21")!.situacao = "cancelada";

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.jaEstavaDesfeita).toBe(true);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
    // O card já estava concluído: não é regravado, e a tentativa vai para o histórico dele.
    expect(escritas(banco)).not.toContain("temis_trabalhos:card-pedido");
    const passagem = banco.linhas("temis_trabalho_etapas").find((l) => l.trabalho_id === "card-pedido");
    expect(String(passagem?.observacao)).toContain("Nova tentativa de liberar a unidade");
  });

  it("retomada tardia: cadastro `vendida` atualizado DEPOIS da queda da venda não é da venda, e não volta", async () => {
    const banco = cenario({
      pedido: { estagio: "faturado", tipo: "distrato" },
      venda: { cancelada_em: "2026-09-18T12:00:00.000Z", etapa: "distrato" },
      vocSituacao: "vendida",
    });
    banco.linha("hercules_reservas", "res-21")!.situacao = "cancelada";
    banco.linha("hercules_unidades", "voc-0306")!.atualizado_em = "2026-09-19T08:00:00.000Z";

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);

    expect(r.ok && r.unidade.voltou).toBe(false);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("vendida");
  });

  it("retomada: `vendida` nunca volta sozinho (a carga não carimba a data; quem confere é gente)", async () => {
    const banco = cenario({
      pedido: { estagio: "faturado", tipo: "distrato" },
      venda: { cancelada_em: "2026-09-18T12:00:00.000Z", etapa: "distrato" },
      vocSituacao: "vendida",
    });
    banco.linha("hercules_reservas", "res-21")!.situacao = "cancelada";
    banco.linha("hercules_unidades", "voc-0306")!.atualizado_em = "2026-09-18T11:00:00.000Z";

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);

    expect(r.ok && r.unidade.voltou).toBe(false);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("vendida");
  });
});

describe("a cópia antiga do C2X do mesmo cliente, na linha do pai", () => {
  // O formato real medido em 18/09/2026 (VOL0710, VOC0911, VOC1102, VOR1401): distrato da venda da
  // gleba, e na linha do VLO uma proposta `reservado` do MESMO cliente, cópia da carga do C2X.
  const comCopia = (documentoDaCopia: string, extraDaCopia: Linha = {}) => {
    const banco = cenario({
      cardDeContrato: null,
      pedido: { tipo: "distrato" },
      semReserva: true,
      venda: {
        cancelamento_pedido_tipo: "distrato",
        cliente_documento: "529.982.247-25",
        codigo: "VOC3",
        data_assinatura: "2025-11-10",
        etapa: "assinatura",
        origem: "c2x",
        protocolo_numero: null,
        reserva_id: null,
      },
      vocSituacao: "vendida",
    });
    banco.semear("hercules_propostas", {
      cliente_documento: documentoDaCopia,
      // Antes do pedido de cancelamento (17/09 no cenário): é resíduo, e cai junto.
      criado_em_c2x: "2026-09-10T18:20:15.000Z",
      etapa: "reservado",
      etapa_desde: "2025-10-01T00:00:00.000Z",
      id: "copia-vlo",
      origem: "c2x",
      unidade_id: "vlo-0306",
      workspace_id: "careli",
      ...extraDaCopia,
    });
    return banco;
  };

  it("mesmo cliente (CPF com ou sem máscara): a cópia é encerrada e o lote volta", async () => {
    const banco = comCopia("52998224725");

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido({ declaracoes: DECLAROU_TUDO }), portaDeTeste().porta);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.copiasEncerradas).toBe(1);
    expect(banco.linha("hercules_propostas", "copia-vlo")).toMatchObject({ etapa: "cancelado" });
    expect(String(banco.linha("hercules_propostas", "copia-vlo")?.cancelada_motivo)).toContain("Cópia do C2X encerrada");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
    expect(r.recado).toContain("a cópia antiga do C2X do mesmo cliente foi encerrada");
  });

  it("mesmo cliente, criada DEPOIS do pedido (a renegociação): não é cópia, não é tocada, e segura o lote", async () => {
    const banco = comCopia("52998224725", { criado_em_c2x: "2026-09-18T09:00:00.000Z" });

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido({ declaracoes: DECLAROU_TUDO }), portaDeTeste().porta);

    expect(r.ok && r.copiasEncerradas).toBe(0);
    expect(banco.linha("hercules_propostas", "copia-vlo")?.etapa).toBe("reservado");
    expect(r.ok && r.unidade.voltou).toBe(false);
  });

  it("cópia sem data de criação: não se prova que é anterior ao pedido, e não é tocada", async () => {
    const banco = comCopia("52998224725", { criado_em_c2x: null });
    const r = await concluirCancelamentoDoCard(banco.cliente, pedido({ declaracoes: DECLAROU_TUDO }), portaDeTeste().porta);
    expect(r.ok && r.copiasEncerradas).toBe(0);
  });

  it("OUTRO cliente: a cópia não é tocada, e ela segura o lote", async () => {
    const banco = comCopia("11144477735");

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido({ declaracoes: DECLAROU_TUDO }), portaDeTeste().porta);

    expect(r.ok && r.copiasEncerradas).toBe(0);
    expect(banco.linha("hercules_propostas", "copia-vlo")?.etapa).toBe("reservado");
    expect(r.ok && r.unidade.voltou).toBe(false);
  });

  it("mesmo cliente mas em outra etapa (contrato): não é cópia de reserva, não é tocada", async () => {
    const banco = comCopia("52998224725", { etapa: "contrato" });

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido({ declaracoes: DECLAROU_TUDO }), portaDeTeste().porta);

    expect(banco.linha("hercules_propostas", "copia-vlo")?.etapa).toBe("contrato");
    expect(r.ok && r.unidade.voltou).toBe(false);
  });

  it("mesmo cliente mas nascida no Panteon: não é tocada", async () => {
    const banco = comCopia("52998224725", { origem: "panteon" });

    await concluirCancelamentoDoCard(banco.cliente, pedido({ declaracoes: DECLAROU_TUDO }), portaDeTeste().porta);

    expect(banco.linha("hercules_propostas", "copia-vlo")?.etapa).toBe("reservado");
  });

  it("venda sem documento do cliente: nenhuma cópia casa (documento vazio não casa com nada)", async () => {
    const banco = comCopia("");
    banco.linha("hercules_propostas", "venda-21")!.cliente_documento = null;

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido({ declaracoes: DECLAROU_TUDO }), portaDeTeste().porta);

    expect(r.ok && r.copiasEncerradas).toBe(0);
    expect(banco.linha("hercules_propostas", "copia-vlo")?.etapa).toBe("reservado");
  });
});

describe("a corrida com o Indeferir", () => {
  it("o card indeferido enquanto a conclusão reapurava: a venda NÃO cai (releitura do card)", async () => {
    silenciar();
    const banco = cenario();
    banco.depois(
      (c) => c.tabela === "hercules_proposta_eventos",
      (b) => {
        b.linha("temis_trabalhos", "card-pedido")!.estagio = "indeferido";
      },
    );

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);

    expect(r.ok).toBe(false);
    expect(banco.linha("hercules_propostas", "venda-21")?.etapa).toBe("contrato");
    expect(banco.linha("hercules_reservas", "res-21")?.situacao).toBe("proposta");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
  });

  it("a marca do pedido limpa entre a releitura e a escrita: a condição do passo 1 segura a venda", async () => {
    silenciar();
    const banco = cenario();
    // A releitura do card (a SEGUNDA leitura dele) passa; a marca some logo depois, antes do passo 1.
    let leiturasDoCard = 0;
    banco.depois(
      (c) => c.tabela === "temis_trabalhos" && c.operacao === "select" && ++leiturasDoCard === 2,
      (b) => {
        b.linha("hercules_propostas", "venda-21")!.cancelamento_pedido_em = null;
      },
    );

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);

    expect(r.ok).toBe(false);
    expect(banco.linha("hercules_propostas", "venda-21")?.etapa).toBe("contrato");
  });
});
