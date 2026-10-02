import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool, PoolConnection } from "mysql2/promise";

import { envelopeVigente } from "@/lib/assinatura/envelope-vigente";
import { abrirLeituraDoC2x, descartarLeituraDoC2x, fecharLeituraDoC2x } from "@/lib/assinatura/espelho-d4sign/c2x";
import { diaEmBrasilia } from "@/lib/assinatura/instante";
import { getHadesDbPool } from "@/lib/guardian/db";
import { terrenosDasUnidades } from "@/lib/hercules/terreno";
import { EMPREENDIMENTOS_DO_LSOFT_NO_FINANCEIRO } from "@/lib/lsoft/carteira-no-financeiro";

import {
  paredeDeBrasilia,
  pedidoComAEntrada,
  pedidoDoEnvio,
  pedidosDasUnidades,
  pedidosDesfeitosDasUnidades,
  TIMEOUT_DA_CONSULTA_NA_TELA_MS,
} from "./c2x";
import { type EloDaEntrada, eloDaEntrada, type EntradaDoElo, olhaOsDesfeitos, type PedidoDoTerreno } from "./elo";
import { type EntradaDoCard, situacaoDaEntrada } from "./regra";

// A ENTRADA DE UMA VENDA, LIDA NA HORA EM QUE O CARD DO PRÉ-FATURAMENTO ABRE (só leitura).
//
// Lucas, 02/10/2026: *"verifica se estamos conseguindo ler o financeiro desses contratos"*. Passo 1
// (decisão dele no mesmo dia, *"So o passo 1"*): a tela mostra a entrada e se está paga; o Faturado
// continua à mão, com a trava que já existe. Por isso aqui não se grava nada, nem no Panteon nem no C2X.
//
// O caminho: (1) no Panteon, a venda (origem, `origem_c2x_id`, unidade com o empreendimento, quando
// nasceu e o documento do comprador, EM MEMÓRIA) e os envelopes de contrato; (2) só para a nativa da
// Clicksign, o terreno da unidade (a mesma união do espelho da D4Sign, `terrenosDasUnidades`) e os
// pedidos que já são de outra venda; (3) no C2X, numa conexão só-leitura, o elo (`elo.ts`), os
// pedidos desfeitos do comprador quando não sobrou candidato vivo, e as parcelas do pedido
// (`c2x.ts`); (4) a regra pura (`regra.ts`) decide o que a tela mostra.
//
// ⚠️ O EMPREENDIMENTO CUJO FINANCEIRO NÃO É O C2X NEM ABRE O C2X (revisão de 02/10/2026). O Garden
// (enterprise 39) tem a carteira no LSoft (`EMPREENDIMENTOS_DO_LSOFT_NO_FINANCEIRO`) e zero parcela no
// legado: lido no C2X, ele sairia "sem pedido", e a tela mandaria digitar no C2X uma venda que não vai
// para lá. A lista é a MESMA do Financeiro do portal, para as duas telas não discordarem.
//
// ⚠️ FALHA NÃO DERRUBA O CARD: tudo o que dá errado vira `{ situacao: "falhou" }`, e a tela diz que não
// conseguiu ler. E HÁ UM TETO PARA A LEITURA INTEIRA (`TETO_DA_LEITURA_MS`): o C2X é produção com
// `max_connections` escasso, e o card não pode ficar preso esperando vaga no pool. Passou do teto, a
// conexão em uso é DESTRUÍDA (a consulta pode seguir rodando no MySQL; devolvida ao pool, levaria a
// transação aberta para o próximo) e a resposta sai.
//
// ⚠️ O DOCUMENTO DO COMPRADOR ENTRA E NÃO SAI: comparado em memória pelo elo, nunca logado nem
// devolvido. O log de falha leva só o código do erro.

/**
 * O teto da leitura inteira (Panteon + C2X) com o card abrindo.
 *
 * ⚠️ 3 s, E NÃO OS 8 s DE ANTES (revisão de 02/10/2026): a rota espera a leitura antes de responder,
 * então um C2X lento segurava a ABERTURA DO CARD inteiro (a análise, os contratos, a assinatura) por
 * até 8 s. A leitura saudável cabe com folga: medida em 02/10/2026 (duas rodadas, os 6 cards de
 * contrato em Pré-faturamento e o VOR Q14 L01), a nativa da Clicksign, que lê a tabela de unidades,
 * levou de 0,9 a 1,2 s; a da D4Sign, de 0,2 a 0,3 s. Passou do teto, a tela diz que não conseguiu ler e
 * oferece "ler de novo".
 */
export const TETO_DA_LEITURA_MS = 3_000;

/**
 * Os `enterprises.id` do C2X (o `hercules_unidades.enterprise_id`) cujo financeiro mora no LSoft. Hoje,
 * só o Garden (39). Vem da lista do Financeiro do portal, e não de uma cópia: o dia em que outro
 * empreendimento entrar lá, ele sai do C2X aqui também.
 */
const ENTERPRISES_FORA_DO_C2X: ReadonlySet<number> = new Set(
  EMPREENDIMENTOS_DO_LSOFT_NO_FINANCEIRO.map((e) => e.c2xEnterpriseId),
);

const WORKSPACE = "careli";
const PAGINA = 1000;
const COLUNAS_DA_UNIDADE = "id, enterprise_id, espelho_de, quadra, lote, origem_c2x_id";

type LinhaDaUnidade = {
  enterprise_id: number | string;
  espelho_de: null | string;
  id: string;
  lote: null | string;
  origem_c2x_id: null | number | string;
  quadra: null | string;
};

type LinhaDoEnvelope = {
  c2x_contract_signature_id: null | number | string;
  criado_em: string;
  envelope_id: null | string;
  enviado_em: null | string;
  estado: string;
  falha: null | string;
  finalidade: null | string;
  id: string;
  provedor: string;
};

type VendaLida = {
  cliente_documento: null | string;
  /** Quando a venda nasceu no Panteon (ISO). O pedido do terreno mais velho que ela não casa sozinho. */
  criado_em: null | string;
  id: string;
  origem: null | string;
  origem_c2x_id: null | number | string;
  /** A unidade embutida (`hercules_unidades` pela FK `unidade_id`), só com o empreendimento no C2X. */
  unidade?: null | UnidadeDaVenda | UnidadeDaVenda[];
  unidade_id: null | string;
};

type UnidadeDaVenda = { enterprise_id: null | number | string };

/** O financeiro desta venda mora fora do C2X (o empreendimento da unidade está na lista do LSoft). */
function financeiroForaDoC2x(venda: VendaLida): boolean {
  const unidade = Array.isArray(venda.unidade) ? venda.unidade[0] : venda.unidade;
  const enterprise = inteiroPositivo(unidade?.enterprise_id);
  return enterprise !== null && ENTERPRISES_FORA_DO_C2X.has(enterprise);
}

/** O que se pode trocar no teste: o relógio, o pool do C2X e o teto. */
export type PortasDaLeitura = {
  agora?: () => Date;
  /** O pool do C2X. Ausente = `getHadesDbPool()`; `null` = não configurado. */
  pool?: null | Pick<Pool, "getConnection">;
  tetoMs?: number;
};

class FalhaNoPanteon extends Error {}

const inteiroPositivo = (valor: unknown): null | number => {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const codigoDoErro = (erro: unknown): string => {
  const codigo = (erro as { code?: unknown } | null)?.code;
  return typeof codigo === "string" && codigo ? codigo : erro instanceof Error ? erro.name : "erro";
};

/**
 * A tabela de unidades inteira (a união do terreno precisa da família toda, como no espelho e na F8).
 *
 * ⚠️ PÁGINAS DE 1.000 COM `order`, E AS QUE SOBRAM EM PARALELO: são ~5.500 linhas (medido em
 * 02/10/2026), e seis idas em fila somariam um segundo ao card. O teto do PostgREST é 1.000 por
 * página; sem `order`, página de 1.000 pula e repete linha.
 *
 * ⚠️ PENDÊNCIA CONHECIDA (revisão de 02/10/2026), SEM MUDANÇA DE COMPORTAMENTO AQUI: CADA ABERTURA DE
 * CARD DE VENDA NATIVA DA CLICKSIGN LÊ `hercules_unidades` INTEIRA (~5.500 linhas em 02/10/2026) só
 * para achar a família de UMA unidade. É o mesmo preço que o espelho da D4Sign e a F8 pagam, e cabe no
 * teto hoje; cresce com a tabela. O conserto é ler só a família (pelo `espelho_de` e pela quadra e
 * lote do terreno) ou guardar o terreno na unidade, e fica para quando a leitura apertar o teto.
 */
async function lerTodasAsUnidades(sb: SupabaseClient): Promise<LinhaDaUnidade[]> {
  const pagina = (de: number, comContagem: boolean) =>
    sb
      .from("hercules_unidades")
      .select(COLUNAS_DA_UNIDADE, comContagem ? { count: "exact" } : undefined)
      .eq("workspace_id", WORKSPACE)
      .order("id", { ascending: true })
      .range(de, de + PAGINA - 1);
  const primeira = await pagina(0, true);
  if (primeira.error) throw new FalhaNoPanteon("hercules_unidades");
  const porId = new Map<string, LinhaDaUnidade>();
  for (const l of (primeira.data ?? []) as LinhaDaUnidade[]) porId.set(l.id, l);
  const total = typeof primeira.count === "number" ? primeira.count : null;
  if (total !== null) {
    const resto = [];
    for (let de = PAGINA; de < total; de += PAGINA) resto.push(pagina(de, false));
    for (const r of await Promise.all(resto)) {
      if (r.error) throw new FalhaNoPanteon("hercules_unidades");
      for (const l of (r.data ?? []) as LinhaDaUnidade[]) porId.set(l.id, l);
    }
    return [...porId.values()];
  }
  // Sem a contagem, em fila até a página vir menor que o teto.
  for (let de = PAGINA, ultima = (primeira.data ?? []).length; ultima === PAGINA; de += PAGINA) {
    const r = await pagina(de, false);
    if (r.error) throw new FalhaNoPanteon("hercules_unidades");
    ultima = (r.data ?? []).length;
    for (const l of (r.data ?? []) as LinhaDaUnidade[]) porId.set(l.id, l);
  }
  return [...porId.values()];
}

/**
 * O TERRENO DA NATIVA DA CLICKSIGN, lido no PANTEON ANTES de abrir o C2X (a mesma ordem da F8: nenhuma
 * ida ao Supabase segura a conexão do legado). Devolve os ids no C2X das unidades do terreno e os
 * pedidos do C2X que já são de outra venda do Panteon nele.
 */
async function terrenoDaVenda(
  sb: SupabaseClient,
  venda: VendaLida,
): Promise<{ outrasVendas: Set<number>; unidadesC2x: number[] }> {
  const unidadeId = venda.unidade_id as string;
  const todas = await lerTodasAsUnidades(sb);
  const grupoDe = terrenosDasUnidades(todas);
  const grupo = grupoDe.get(unidadeId);
  const membros = grupo ? todas.filter((u) => grupoDe.get(u.id) === grupo).map((u) => u.id) : [unidadeId];
  const porId = new Map(todas.map((u) => [u.id, u]));
  const unidadesC2x = [
    ...new Set(membros.map((id) => inteiroPositivo(porId.get(id)?.origem_c2x_id)).filter((n): n is number => n !== null)),
  ];

  const { data, error } = await sb
    .from("hercules_propostas")
    .select("id, origem_c2x_id")
    .eq("workspace_id", WORKSPACE)
    .in("unidade_id", membros)
    .not("origem_c2x_id", "is", null)
    .order("id", { ascending: true });
  if (error) throw new FalhaNoPanteon("hercules_propostas:terreno");
  const outrasVendas = new Set<number>();
  for (const o of (data ?? []) as Array<{ id: string; origem_c2x_id: null | number | string }>) {
    if (o.id === venda.id) continue;
    const ar = inteiroPositivo(o.origem_c2x_id);
    if (ar !== null) outrasVendas.add(ar);
  }
  return { outrasVendas, unidadesC2x };
}

/** O pool do C2X: o das portas (teste) ou o do Hades. `null` = sem configuração. */
function poolDoC2x(portas: PortasDaLeitura): null | Pick<Pool, "getConnection"> {
  if (portas.pool !== undefined) return portas.pool;
  const r = getHadesDbPool();
  return r.ok ? r.pool : null;
}

/**
 * O elo que não é elo vira a situação da tela (sem pedido ou ambíguo). O pedido anterior à venda e o
 * desfeito levam o número: a frase da tela diz qual pedido conferir no C2X.
 */
function semElo(elo: Exclude<EloDaEntrada, { tipo: "elo" }>): EntradaDoCard {
  if (elo.tipo === "ambiguo") {
    return elo.motivo === "pedido_anterior_a_venda"
      ? { motivo: elo.motivo, pedido: elo.arId, situacao: "ambiguo" }
      : { motivo: elo.motivo, situacao: "ambiguo" };
  }
  return elo.motivo === "pedido_desfeito_no_c2x"
    ? { motivo: elo.motivo, pedido: elo.arId, situacao: "sem_pedido_no_c2x" }
    : { motivo: elo.motivo, situacao: "sem_pedido_no_c2x" };
}

/**
 * A ENTRADA DA VENDA NO C2X, para o card do Pré-faturamento. NUNCA LANÇA.
 *
 * @param sb O cliente com service_role (o mesmo que abriu o card).
 */
export async function lerEntradaDaVenda(
  sb: SupabaseClient,
  propostaId: string,
  portas: PortasDaLeitura = {},
): Promise<EntradaDoCard> {
  const controle: { conexao: null | PoolConnection; encerrada: boolean } = { conexao: null, encerrada: false };
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const noTeto = new Promise<EntradaDoCard>((responder) => {
    relogio = setTimeout(() => {
      controle.encerrada = true;
      // ⚠️ DESTRUÍDA, E NÃO DEVOLVIDA: a consulta presa iria junto para o pool.
      descartarLeituraDoC2x(controle.conexao);
      controle.conexao = null;
      responder({ motivo: "tempo", situacao: "falhou" });
    }, portas.tetoMs ?? TETO_DA_LEITURA_MS);
  });
  try {
    return await Promise.race([ler(), noTeto]);
  } finally {
    clearTimeout(relogio);
  }

  async function ler(): Promise<EntradaDoCard> {
    let venda: VendaLida;
    let csDoVigente: null | number = null;
    let terreno: null | { outrasVendas: Set<number>; unidadesC2x: number[] } = null;
    try {
      // ── 1. O PANTEON: a venda e os envelopes de contrato ──
      const [lida, envelopes] = await Promise.all([
        sb
          .from("hercules_propostas")
          .select("id, origem, origem_c2x_id, unidade_id, cliente_documento, criado_em, unidade:hercules_unidades(enterprise_id)")
          .eq("id", propostaId)
          .maybeSingle<VendaLida>(),
        sb
          .from("temis_envelopes")
          .select("id, criado_em, envelope_id, enviado_em, estado, falha, finalidade, provedor, c2x_contract_signature_id")
          .eq("proposta_id", propostaId)
          .order("criado_em", { ascending: false })
          .limit(50),
      ]);
      if (lida.error || !lida.data) throw new FalhaNoPanteon("hercules_propostas");
      if (envelopes.error) throw new FalhaNoPanteon("temis_envelopes");
      venda = lida.data;
      // ── O financeiro desta venda é do C2X? Se não (o Garden), nem o terreno nem o C2X são lidos ──
      if (financeiroForaDoC2x(venda)) return { motivo: "financeiro_no_lsoft", situacao: "fora_do_c2x" };
      const nativa = String(venda.origem ?? "") === "panteon";
      if (nativa) {
        // O vigente é escolhido entre os envelopes de CONTRATO (a régua de `envelopeVigente` pede só eles).
        const doContrato = ((envelopes.data ?? []) as LinhaDoEnvelope[]).filter((e) => e.finalidade === "contrato");
        const vigente = envelopeVigente(doContrato).vigente;
        csDoVigente = vigente && vigente.provedor === "d4sign" ? inteiroPositivo(vigente.c2x_contract_signature_id) : null;
        // ── 2. Só a nativa sem o envio da D4Sign vai ao terreno ──
        if (csDoVigente === null && venda.unidade_id) terreno = await terrenoDaVenda(sb, venda);
      }
    } catch (falha) {
      console.error("[temis][entrada] leitura do Panteon falhou", {
        codigo: falha instanceof FalhaNoPanteon ? falha.message : codigoDoErro(falha),
      });
      return { motivo: "panteon", situacao: "falhou" };
    }

    // A carga casa pelo `origem_c2x_id` sem ir ao C2X; o terreno sem unidade no C2X não tem candidato.
    const precisaDoC2x =
      String(venda.origem ?? "") !== "panteon"
        ? inteiroPositivo(venda.origem_c2x_id) !== null
        : csDoVigente !== null || (terreno?.unidadesC2x.length ?? 0) > 0;
    if (!precisaDoC2x) {
      const elo = eloDaEntrada({
        arIdDoEnvioD4Sign: null,
        documentoDoComprador: "",
        origem: venda.origem,
        origemC2xId: venda.origem_c2x_id,
        pedidosDoTerreno: terreno ? [] : null,
      });
      return elo.tipo === "elo" ? { motivo: "pedido_nao_achado_no_c2x", situacao: "sem_pedido_no_c2x" } : semElo(elo);
    }

    // ── 3. O C2X: só SELECT, numa conexão só-leitura ──
    // O teto passou durante a leitura do Panteon: a resposta já saiu, e o C2X nem é aberto.
    if (controle.encerrada) return { motivo: "tempo", situacao: "falhou" };
    const pool = poolDoC2x(portas);
    if (!pool) return { motivo: "c2x_sem_configuracao", situacao: "falhou" };

    let documento = String(venda.cliente_documento ?? "").replace(/\D/g, "");
    try {
      // O teto do START TRANSACTION é o das consultas do card (5 s), e não os 20 s do espelho.
      const conexao = await abrirLeituraDoC2x(pool, TIMEOUT_DA_CONSULTA_NA_TELA_MS);
      if (controle.encerrada) {
        // O teto passou enquanto se esperava vaga no pool: a resposta já saiu, a conexão volta inteira.
        await fecharLeituraDoC2x(conexao);
        return { motivo: "tempo", situacao: "falhou" };
      }
      controle.conexao = conexao;

      const arIdDoEnvioD4Sign = csDoVigente !== null ? await pedidoDoEnvio(conexao, csDoVigente) : null;
      const pedidosDoTerreno: null | PedidoDoTerreno[] = terreno ? await pedidosDasUnidades(conexao, terreno.unidadesC2x) : null;
      const doElo: EntradaDoElo = {
        arIdDoEnvioD4Sign,
        criadoEmDaVenda: venda.criado_em,
        documentoDoComprador: documento,
        origem: venda.origem,
        origemC2xId: venda.origem_c2x_id,
        pedidosDeOutrasVendas: terreno?.outrasVendas,
        pedidosDoTerreno,
      };
      let elo = eloDaEntrada(doElo);
      // ⚠️ SEM CANDIDATO VIVO DO COMPRADOR, OS DESFEITOS DELE (revisão de 02/10/2026): sem isto, a venda
      // digitada e já cancelada ou distratada no C2X saía "ainda não foi digitada". Só no terreno, só
      // com o documento e a data da venda, e só os nascidos a partir dela (o corte é no SQL: o documento
      // de terceiros de pedidos desfeitos antigos nem sai do C2X).
      const desde = paredeDeBrasilia(venda.criado_em);
      let pedidosDesfeitos: null | PedidoDoTerreno[] = null;
      if (terreno && documento && desde && olhaOsDesfeitos(elo)) {
        pedidosDesfeitos = await pedidosDesfeitosDasUnidades(conexao, terreno.unidadesC2x, desde);
        elo = eloDaEntrada({ ...doElo, pedidosDesfeitosDoTerreno: pedidosDesfeitos });
      }
      // ⚠️ OS DÍGITOS SAEM DA MEMÓRIA AQUI: o elo já comparou.
      documento = "";
      doElo.documentoDoComprador = "";
      for (const p of [...(pedidosDoTerreno ?? []), ...(pedidosDesfeitos ?? [])]) p.documentoDoComprador = "";

      if (elo.tipo !== "elo") {
        await fecharLeituraDoC2x(conexao);
        controle.conexao = null;
        return semElo(elo);
      }
      const pedido = await pedidoComAEntrada(conexao, elo.arId);
      await fecharLeituraDoC2x(conexao);
      controle.conexao = null;
      if (!pedido) return { motivo: "pedido_nao_achado_no_c2x", situacao: "sem_pedido_no_c2x" };

      const hoje = diaEmBrasilia((portas.agora?.() ?? new Date()).toISOString()) ?? "";
      return { ...situacaoDaEntrada(pedido, hoje), pedido: pedido.arId, regra: elo.regra, situacao: "lida" };
    } catch (falha) {
      // ⚠️ A CONEXÃO QUE FALHOU É DESTRUÍDA, não devolvida (a consulta pode seguir rodando no MySQL).
      descartarLeituraDoC2x(controle.conexao);
      controle.conexao = null;
      if (!controle.encerrada) console.error("[temis][entrada] leitura do C2X falhou", { codigo: codigoDoErro(falha) });
      return { motivo: "c2x", situacao: "falhou" };
    }
  }
}
