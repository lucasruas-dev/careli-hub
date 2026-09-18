import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Opcoes } from "@/lib/assinatura/clicksign/cliente";

import { concluirCancelamentoDoCard, type PedidoDeConclusao } from "./concluir-cancelamento-server";
import { devolverVendaNoIndeferimento } from "./indeferimento-na-venda-server";

// REVISÃO ADVERSARIAL (18/09/2026) — LENTE: O LOTE E O DINHEIRO.
//
// O banco em memória abaixo é CÓPIA do de `concluir-cancelamento-server.test.ts` (o dublê de lá
// não é exportado). Os testes do fim deste arquivo procuram ordens de acontecimentos que deixem o
// lote livre com dono, dinheiro sem distrato, estado inconsistente ou envelope vivo de venda caída.
// Os que têm "DEFEITO" no nome estão VERMELHOS DE PROPÓSITO: afirmam o comportamento certo, e o
// código de hoje não o cumpre. Os demais conferem suspeitas que se mostraram infundadas.
//
// (cabeçalho original da cópia)
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
    "cancelamento_pedido_tipo", "codigo", "criado_em", "criado_em_c2x", "data_assinatura", "data_ato",
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
    "indeferido_por_nome", "proposta_id", "tipo", "workspace_id",
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


// ════════════════════════════════════════════════════════════════════════════════
// REVISÃO: OS TESTES NOVOS
// ════════════════════════════════════════════════════════════════════════════════

const VOR = "41";

/** Simula o que o POST de indeferir grava no card, e o que o item B faz depois (a régua real). */
async function indeferirComoOServidor(banco: Banco, cardId: string, tipo: string) {
  const card = banco.linha("temis_trabalhos", cardId);
  // `.neq("estagio", "faturado")` é a ÚNICA condição do update do indeferir (trabalho-servico.ts).
  if (!card || card.estagio === "faturado") return null;
  card.estagio = "indeferido";
  return devolverVendaNoIndeferimento(
    banco.cliente,
    { id: cardId, proposta_id: String(card.proposta_id), tipo },
    { motivo: "outro", observacao: null, usuarioNome: "Outra pessoa" },
  );
}

describe("REVISÃO (3): corrida e falha no meio", () => {
  it("DEFEITO: Indeferir clicado enquanto a conclusão roda — a venda cai com o pedido recusado", async () => {
    silenciar();
    const banco = cenario();
    // Duas pessoas no mesmo card: a conclusão leu o card em Análise; antes do passo 1 o Indeferir
    // grava o card (só `.neq("estagio","faturado")`) e o item B limpa o carimbo do pedido.
    banco.depois(
      (c) => c.tabela === "hercules_proposta_eventos",
      (b) => {
        const card = b.linha("temis_trabalhos", "card-pedido");
        if (card) card.estagio = "indeferido";
        const venda = b.linha("hercules_propostas", "venda-21");
        if (venda) {
          venda.cancelamento_pedido_em = null;
          venda.cancelamento_pedido_motivo = null;
        }
      },
    );

    await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);

    // O certo: o pedido foi recusado, a venda fica como estava.
    expect(banco.linha("hercules_propostas", "venda-21")?.etapa).toBe("contrato");
  });

  it("(documenta o estado que a corrida acima deixa: sem saída pela tela)", async () => {
    silenciar();
    const banco = cenario();
    banco.depois(
      (c) => c.tabela === "hercules_proposta_eventos",
      (b) => {
        b.linha("temis_trabalhos", "card-pedido")!.estagio = "indeferido";
        b.linha("hercules_propostas", "venda-21")!.cancelamento_pedido_em = null;
      },
    );
    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);
    expect(r.ok).toBe(true);
    expect(banco.linha("hercules_propostas", "venda-21")?.etapa).toBe("cancelado");
    expect(banco.linha("temis_trabalhos", "card-pedido")?.estagio).toBe("indeferido");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
    // E concluir de novo é recusado: o card indeferido diz "pedido recusado" sobre uma venda caída.
    const deNovo = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);
    expect(deNovo.ok).toBe(false);
  });

  it("DEFEITO: falha no passo 2 e alguém clica Indeferir — proposta morta com reserva viva, lote preso sem saída", async () => {
    silenciar();
    const banco = cenario();
    let falhar = true;
    banco.falhar((c) => falhar && c.tabela === "hercules_reservas" && c.operacao === "update");

    const primeira = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);
    expect(primeira.ok).toBe(false);
    expect(banco.linha("hercules_propostas", "venda-21")?.etapa).toBe("cancelado");
    falhar = false;

    // O botão Indeferir continua na tela (card em Análise) e o servidor aceita (só barra `faturado`).
    const b = await indeferirComoOServidor(banco, "card-pedido", "cancelamento");
    expect(b?.feito).toBe("nada"); // venda fora do fluxo: B não mexe

    const retomada = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);
    expect(retomada.ok).toBe(false); // "Este pedido foi indeferido"

    // O certo: nenhuma ordem de cliques deixa reserva viva de venda cancelada.
    expect(banco.linha("hercules_reservas", "res-21")?.situacao).toBe("cancelada");
  });

  it("dois cliques em Concluir ao mesmo tempo: uma venda cancelada, um 409, estado final coerente", async () => {
    silenciar();
    const banco = cenario();

    const [a, b] = await Promise.all([
      concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta),
      concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta),
    ]);

    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    const vendasGravadas = banco.consultas.filter(
      (c) => c.tabela === "hercules_propostas" && c.operacao === "update",
    );
    expect(vendasGravadas.length).toBe(2); // as duas tentam; a condição de etapa deixa uma passar
    expect(banco.linha("hercules_propostas", "venda-21")?.etapa).toBe("cancelado");
    expect(banco.linha("hercules_reservas", "res-21")?.situacao).toBe("cancelada");
    expect(banco.linha("temis_trabalhos", "card-pedido")?.estagio).toBe("faturado");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("disponivel");
  });
});

describe("REVISÃO (1)/(4): o lote nunca volta com dono vivo, nem sai de bloqueada", () => {
  it("cupom do salão ainda vivo no terreno (sem reserva do Hércules ligada) segura o lote", async () => {
    const banco = cenario();
    banco.semear("prometeu_reservas", { codigo: null, id: "cupom-1", situacao: "reservada", unidade_c2x_id: 9101 });

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);

    expect(r.ok && r.unidade.voltou).toBe(false);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
  });

  it("proposta viva na GLEBA IRMÃ (VOR com a mesma quadra e lote) segura o lote", async () => {
    const banco = cenario();
    banco.semear("hercules_unidades", unidade("vlo-1206", "VLO1206", VLO, "12", "06", { espelho_de: "vor-1206" }));
    banco.semear("hercules_unidades", unidade("vor-1206", "VOR1206", VOR, "12", "06"));
    banco.semear("hercules_unidades", unidade("vor-0306", "VOR0306", VOR, "03", "06", { situacao: "vendida" }));
    banco.semear("hercules_propostas", {
      etapa: "assinatura",
      etapa_desde: "2026-09-01T00:00:00.000Z",
      id: "venda-irma",
      origem: "c2x",
      unidade_id: "vor-0306",
      workspace_id: "careli",
    });

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);

    expect(r.ok && r.unidade.voltou).toBe(false);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
  });

  it("venda já desfeita + lote revendido a OUTRO cliente: a retomada não solta o lote nem mexe na reserva nova", async () => {
    const banco = cenario({ venda: { etapa: "cancelado" } });
    banco.linha("hercules_reservas", "res-21")!.situacao = "cancelada";
    banco.semear("hercules_reservas", {
      empreendimento_id: "emp-voc",
      id: "res-nova",
      origem: "coordenador",
      situacao: "ativa",
      unidade_id: "voc-0306",
      workspace_id: "careli",
    });

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);

    expect(r.ok && r.unidade.voltou).toBe(false);
    expect(banco.linha("hercules_reservas", "res-nova")?.situacao).toBe("ativa");
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("reservada");
  });

  it("bloqueio do Apolo entre a trava e a escrita: a condição da escrita segura `bloqueada`", async () => {
    const banco = cenario();
    // A leitura de propostas da trava (por `unidade_id`) é a última antes da escrita do cadastro.
    banco.depois(
      (c) =>
        c.tabela === "hercules_propostas" &&
        c.operacao === "select" &&
        c.filtros.some((f) => f.startsWith("in:unidade_id=")),
      (b) => {
        b.linha("hercules_unidades", "voc-0306")!.situacao = "bloqueada";
      },
    );

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);

    expect(r.ok && r.unidade.voltou).toBe(false);
    expect(banco.linha("hercules_unidades", "voc-0306")?.situacao).toBe("bloqueada");
  });

  it("DEFEITO (menor): cadastro que já dizia disponível com outro dono vivo sai como `voltou: true`", async () => {
    const banco = cenario({ vocSituacao: "disponivel" });
    banco.semear("hercules_reservas", {
      empreendimento_id: "emp-vlo",
      id: "res-outra",
      origem: "coordenador",
      situacao: "ativa",
      unidade_id: "vlo-0306",
      workspace_id: "careli",
    });

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);

    // O certo: o recado e o log (`unidadeVoltou`) não dizem que o lote está livre quando há dono.
    expect(r.ok && r.unidade.voltou).toBe(false);
  });
});

describe("REVISÃO (2): dinheiro do cliente", () => {
  it("cancelamento de venda com ato pago (data_ato) é recusado", async () => {
    const banco = cenario({ venda: { data_ato: "2026-09-10" } });
    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);
    expect(r.ok).toBe(false);
    expect(escritas(banco)).toEqual([]);
  });

  it("cancelamento de venda faturada é recusado", async () => {
    const banco = cenario({ venda: { data_faturamento: "2026-09-10", etapa: "faturado" } });
    const r = await concluirCancelamentoDoCard(banco.cliente, pedido(), portaDeTeste().porta);
    expect(r.ok).toBe(false);
    expect(escritas(banco)).toEqual([]);
  });
});

describe("REVISÃO (5): envelope vivo de venda caída", () => {
  // Venda nativa, contrato em assinatura (um comprador assinou, falta a Careli), pedido classificado
  // DISTRATO por AJUSTE MANUAL (PIX por fora, o caso para o qual o ajuste existe).
  const distratoComEnvelopeVivo = () =>
    cenario({
      cardDeContrato: { estagio: "assinatura" },
      envelopes: [envelope({ estado: "parcial" })],
      pedido: { tipo: "distrato" },
      venda: { cancelamento_pedido_tipo: "distrato" },
    });

  it("DEFEITO: o distrato solta o lote com o contrato ainda assinável na Clicksign", async () => {
    silenciar();
    const banco = distratoComEnvelopeVivo();
    const { chamadas, porta } = portaDeTeste({ get: { data: { attributes: { status: "running" } } } });

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido({ declaracoes: DECLAROU_TUDO }), porta);

    const envelopeMorreu = chamadas.some((c) => c.metodo === "PATCH");
    const loteLivre = banco.linha("hercules_unidades", "voc-0306")?.situacao === "disponivel";
    // O certo: ou o envelope não assinado por todos morre (como no cancelamento), ou a conclusão
    // é recusada. Hoje: r.ok, envelope intacto, card de contrato indeferido e lote disponível.
    expect(r.ok && loteLivre && !envelopeMorreu).toBe(false);
  });

  it("DEFEITO: o aviso do envelope vivo só vai no recado da tela, e não no histórico do card", async () => {
    silenciar();
    const banco = distratoComEnvelopeVivo();

    const r = await concluirCancelamentoDoCard(banco.cliente, pedido({ declaracoes: DECLAROU_TUDO }), portaDeTeste().porta);
    expect(r.ok && r.avisos.join(" ")).toContain("ainda corre na Clicksign");

    const passagem = banco.linhas("temis_trabalho_etapas").find((p) => p.trabalho_id === "card-pedido");
    expect(String(passagem?.observacao)).toContain("Clicksign");
  });
});

describe("REVISÃO (2): o contrato indeferido com pedido de distrato aberto", () => {
  it("DEFEITO: indeferir o CONTRATO com o distrato na fila devolve a venda para Proposta, e o 'Cancelar proposta' da Venda a derruba sem distrato", async () => {
    silenciar();
    // O padrão real da Nívea: pedido e contrato abertos na mesma venda. Aqui o pedido saiu DISTRATO
    // (ajuste manual: PIX por fora), e o card de contrato é indeferido antes do pedido andar.
    const banco = cenario({
      pedido: { tipo: "distrato" },
      venda: { cancelamento_pedido_tipo: "distrato" },
    });

    const naVenda = await devolverVendaNoIndeferimento(
      banco.cliente,
      { id: "card-contrato", proposta_id: "venda-21", tipo: "contrato" },
      { motivo: "outro", observacao: null, usuarioNome: "Nivea" },
    );

    expect(naVenda.feito).toBe("voltou_para_proposta"); // hoje
    // Em `proposta`, o PATCH de /api/incorporador/venda/proposta cancela só com `origem = panteon` e
    // `etapa = proposta`: não olha carimbo nem card de distrato. O certo: com pedido de cancelamento
    // ou distrato aberto, a venda NÃO sai de Contrato pelo indeferimento do contrato.
    expect(banco.linha("hercules_propostas", "venda-21")?.etapa).toBe("contrato");
  });
});
