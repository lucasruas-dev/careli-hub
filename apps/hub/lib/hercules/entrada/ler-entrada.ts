import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pool, PoolConnection } from "mysql2/promise";

import { envelopeVigente } from "@/lib/assinatura/envelope-vigente";
import { abrirLeituraDoC2x, descartarLeituraDoC2x, fecharLeituraDoC2x } from "@/lib/assinatura/espelho-d4sign/c2x";
import { diaEmBrasilia } from "@/lib/assinatura/instante";
import { getHadesDbPool } from "@/lib/guardian/db";
import { terrenosDasUnidades } from "@/lib/hercules/terreno";

import { pedidoComAEntrada, pedidoDoEnvio, pedidosDasUnidades } from "./c2x";
import { type EloDaEntrada, eloDaEntrada, type PedidoDoTerreno } from "./elo";
import { type EntradaDoCard, situacaoDaEntrada } from "./regra";

// A ENTRADA DE UMA VENDA, LIDA NA HORA EM QUE O CARD DO PRÉ-FATURAMENTO ABRE (só leitura).
//
// Lucas, 02/10/2026: *"verifica se estamos conseguindo ler o financeiro desses contratos"*. Passo 1
// (decisão dele no mesmo dia, *"So o passo 1"*): a tela mostra a entrada e se está paga; o Faturado
// continua à mão, com a trava que já existe. Por isso aqui não se grava nada, nem no Panteon nem no C2X.
//
// O caminho: (1) no Panteon, a venda (origem, `origem_c2x_id`, unidade e o documento do comprador, EM
// MEMÓRIA) e os envelopes de contrato; (2) só para a nativa da Clicksign, o terreno da unidade (a
// mesma união do espelho da D4Sign, `terrenosDasUnidades`) e os pedidos que já são de outra venda;
// (3) no C2X, numa conexão só-leitura, o elo (`elo.ts`) e as parcelas do pedido (`c2x.ts`); (4) a regra
// pura (`regra.ts`) decide o que a tela mostra.
//
// ⚠️ FALHA NÃO DERRUBA O CARD: tudo o que dá errado vira `{ situacao: "falhou" }`, e a tela diz que não
// conseguiu ler. E HÁ UM TETO PARA A LEITURA INTEIRA (`TETO_DA_LEITURA_MS`): o C2X é produção com
// `max_connections` escasso, e o card não pode ficar preso esperando vaga no pool. Passou do teto, a
// conexão em uso é DESTRUÍDA (a consulta pode seguir rodando no MySQL; devolvida ao pool, levaria a
// transação aberta para o próximo) e a resposta sai.
//
// ⚠️ O DOCUMENTO DO COMPRADOR ENTRA E NÃO SAI: comparado em memória pelo elo, nunca logado nem
// devolvido. O log de falha leva só o código do erro.

/** O teto da leitura inteira (Panteon + C2X) com o card abrindo. */
export const TETO_DA_LEITURA_MS = 8_000;

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
  id: string;
  origem: null | string;
  origem_c2x_id: null | number | string;
  unidade_id: null | string;
};

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

/** O elo que não é elo vira a situação da tela (sem pedido ou ambíguo). */
function semElo(elo: Exclude<EloDaEntrada, { tipo: "elo" }>): EntradaDoCard {
  return elo.tipo === "ambiguo"
    ? { motivo: elo.motivo, situacao: "ambiguo" }
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
          .select("id, origem, origem_c2x_id, unidade_id, cliente_documento")
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
      const conexao = await abrirLeituraDoC2x(pool);
      if (controle.encerrada) {
        // O teto passou enquanto se esperava vaga no pool: a resposta já saiu, a conexão volta inteira.
        await fecharLeituraDoC2x(conexao);
        return { motivo: "tempo", situacao: "falhou" };
      }
      controle.conexao = conexao;

      const arIdDoEnvioD4Sign = csDoVigente !== null ? await pedidoDoEnvio(conexao, csDoVigente) : null;
      const pedidosDoTerreno: null | PedidoDoTerreno[] = terreno ? await pedidosDasUnidades(conexao, terreno.unidadesC2x) : null;
      const elo = eloDaEntrada({
        arIdDoEnvioD4Sign,
        documentoDoComprador: documento,
        origem: venda.origem,
        origemC2xId: venda.origem_c2x_id,
        pedidosDeOutrasVendas: terreno?.outrasVendas,
        pedidosDoTerreno,
      });
      // ⚠️ OS DÍGITOS SAEM DA MEMÓRIA AQUI: o elo já comparou.
      documento = "";
      for (const p of pedidosDoTerreno ?? []) p.documentoDoComprador = "";

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
