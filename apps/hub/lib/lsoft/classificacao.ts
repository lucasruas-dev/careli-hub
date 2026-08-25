// A CURADORIA DO SUBSÍDIO DA CAIXA — a máquina propõe, a pessoa confirma.
//
// Pedido do Lucas (25/08/2026): *"tudo com esse valor alto de parcelas vamos considerar que seja,
// ae coloca um botão para gente validar se realmente é a parcela do subsidio"*.
//
// O PORQUÊ: no Vale do Sol (Minha Casa Minha Vida) o financiamento da Caixa está lançado no LSoft
// como se fosse parcela do cliente. Ele não deve esse dinheiro — quem paga é a Caixa, por medição
// de obra. Medido: R$ 15,12 mi dos R$ 21,10 mi da tela são Caixa, e o "vencido" de R$ 8,89 mi cai
// para R$ 99.698,88 (a inadimplência real do empreendimento é ~2,5%, não ~50%).
//
// ⚠️ NENHUMA REGRA AUTOMÁTICA TIRA VALOR DA CARTEIRA. A classificação nasce `a_validar` e a view
// 0104 só desconta o que estiver `confirmada`. Isso é de propósito: a regra por texto erra (existe
// "FINANC" abreviado, "FINANCIMENTO" com erro de digitação, e 56 parcelas sem palavra nenhuma que
// só o valor denuncia), e a regra por valor pega junto uma anomalia conhecida — um cliente com 30
// linhas repetidas que é histórico de saldo, não dívida. Quem decide é quem conhece o contrato.
import { createApoloAdminClient } from "@/lib/apolo/server";

/** O que o botão da tela pode fazer com uma proposta da máquina. */
export const DECISOES = ["confirmada", "rejeitada", "a_validar"] as const;
export type Decisao = (typeof DECISOES)[number];

export type ClassificacaoDaParcela = {
  /** 'caixa' (financiamento/subsídio/FGTS/terreno) ou 'carteira' (dívida do cliente). */
  classe: string;
  id: string;
  /** financiamento · subsidio · fgts · terreno · misto — nulo quando só o valor denunciou. */
  natureza: null | string;
  /** Como a máquina chegou nisso: regra_texto · regra_valor · manual. */
  origemDaClasse: string;
  parcelaId: null | string;
  situacao: Decisao;
  validadoEm: null | string;
  validadoPorNome: null | string;
};

const texto = (valor: unknown): null | string => {
  const t = String(valor ?? "").trim();
  return t === "" ? null : t;
};

function daLinha(linha: Record<string, unknown>): ClassificacaoDaParcela {
  return {
    classe: String(linha.classe ?? "caixa"),
    id: String(linha.id ?? ""),
    natureza: texto(linha.natureza),
    origemDaClasse: String(linha.origem_da_classe ?? ""),
    parcelaId: texto(linha.parcela_id),
    situacao: (texto(linha.situacao) ?? "a_validar") as Decisao,
    validadoEm: texto(linha.validado_em),
    validadoPorNome: texto(linha.validado_por_nome),
  };
}

/** As classificações das parcelas de um cliente, para a tela desenhar o botão em cada linha. */
export async function lerClassificacoesDoCliente(
  clienteCodigo: string,
): Promise<Map<string, ClassificacaoDaParcela>> {
  const admin = createApoloAdminClient();
  if (!admin) return new Map();

  const { data } = await admin
    .from("lsoft_classificacao_de_parcela")
    .select("id, parcela_id, classe, natureza, situacao, origem_da_classe, validado_em, validado_por_nome")
    .eq("cliente_codigo", clienteCodigo);

  const porParcela = new Map<string, ClassificacaoDaParcela>();
  for (const linha of (data ?? []) as Record<string, unknown>[]) {
    const item = daLinha(linha);
    if (item.parcelaId) porParcela.set(item.parcelaId, item);
  }
  return porParcela;
}

/**
 * O botão: confirma, rejeita ou devolve uma proposta para "a validar".
 *
 * ⚠️ QUEM ASSINA É A SESSÃO, nunca o corpo do pedido — mesma regra da edição de parcela. E a
 * decisão é gravada com autor e data porque ela MOVE DINHEIRO de lugar na tela do cliente.
 */
export async function decidirClassificacao(entrada: {
  autor: null | string;
  autorNome?: null | string;
  /** 'careli' ou 'cliente' (portal do CER), no espírito do `autor_origem` da 0098. */
  autorOrigem?: null | string;
  decisao: Decisao;
  /** Só quando o operador corrige o que a máquina chutou. */
  natureza?: null | string;
  parcelaId: string;
}): Promise<{ erro: string; ok: false } | { classificacao: ClassificacaoDaParcela; ok: true }> {
  const admin = createApoloAdminClient();
  if (!admin) return { erro: "Supabase indisponível.", ok: false };

  if (!DECISOES.includes(entrada.decisao)) {
    return { erro: "Decisão inválida.", ok: false };
  }

  const patch: Record<string, unknown> = {
    situacao: entrada.decisao,
    updated_at: new Date().toISOString(),
  };

  // Voltar para "a validar" limpa a assinatura: senão a tela mostraria alguém como responsável
  // por uma decisão que foi desfeita.
  if (entrada.decisao === "a_validar") {
    patch.validado_por = null;
    patch.validado_por_nome = null;
    patch.validado_em = null;
    patch.validado_origem = null;
  } else {
    patch.validado_por = entrada.autor;
    patch.validado_por_nome = entrada.autorNome ?? null;
    patch.validado_em = new Date().toISOString();
    patch.validado_origem = entrada.autorOrigem ?? "careli";
  }

  if (entrada.natureza !== undefined) patch.natureza = entrada.natureza;

  const { data, error } = await admin
    .from("lsoft_classificacao_de_parcela")
    .update(patch)
    .eq("parcela_id", entrada.parcelaId)
    .select("id, parcela_id, classe, natureza, situacao, origem_da_classe, validado_em, validado_por_nome")
    .maybeSingle();

  if (error) return { erro: error.message, ok: false };
  if (!data) return { erro: "Essa parcela não tem classificação para decidir.", ok: false };

  return { classificacao: daLinha(data as Record<string, unknown>), ok: true };
}

/** O contador do topo: quantas ainda esperam decisão neste empreendimento. */
export async function contarPendentesDeValidacao(empreendimento: string): Promise<number> {
  const admin = createApoloAdminClient();
  if (!admin) return 0;

  const { count } = await admin
    .from("lsoft_classificacao_de_parcela")
    .select("id", { count: "exact", head: true })
    .eq("empreendimento", empreendimento)
    .eq("situacao", "a_validar");

  return count ?? 0;
}

/** Uma linha da TELA DE SUBSIDIO: a parcela com o cliente e a unidade junto. */
export type ParcelaDeSubsidio = {
  classificacaoId: string;
  clienteCodigo: string;
  clienteNome: string;
  natureza: null | string;
  observacoes: null | string;
  /** regra_texto · regra_valor · manual — a tela conta POR QUE foi proposta. */
  origemDaClasse: string;
  paga: boolean;
  parcelaId: string;
  situacao: Decisao;
  unidade: null | string;
  validadoEm: null | string;
  validadoPorNome: null | string;
  valor: number;
  valorRecebido: number;
  vencimento: null | string;
};

export type ResumoDoSubsidio = {
  /** Quantas ainda esperam decisao. */
  aValidar: number;
  clientes: number;
  /** Ja confirmadas como Caixa. */
  confirmadas: number;
  parcelas: number;
  rejeitadas: number;
  /** Total ja liberado pela Caixa (valor_recebido das confirmadas). */
  totalLiberado: number;
  /** Total confirmado como Caixa. */
  totalConfirmado: number;
  /** Total esperando decisao. */
  totalAValidar: number;
};

/**
 * A TELA DO SUBSIDIO: todas as parcelas da Caixa daquele empreendimento, uma a uma.
 *
 * Pedido do Lucas (25/08/2026): *"eu queria uma tela diferente para os subsidio, eu precisava
 * enxergar esses valores separados... parcela por parcela"*. A lista da carteira responde "quanto
 * o cliente deve"; esta responde "o que a Caixa tem para pagar, item a item".
 */
export async function lerParcelasDeSubsidio(entrada: {
  busca?: null | string;
  empreendimento: string;
  situacao?: null | string;
}): Promise<
  | { erro: string; ok: false }
  | { linhas: ParcelaDeSubsidio[]; ok: true; resumo: ResumoDoSubsidio }
> {
  const admin = createApoloAdminClient();
  if (!admin) return { erro: "Supabase indisponível.", ok: false };

  let consulta = admin
    .from("lsoft_classificacao_de_parcela")
    .select("id, parcela_id, cliente_codigo, natureza, situacao, origem_da_classe, validado_em, validado_por_nome, valor_no_momento, observacao_no_momento")
    .eq("empreendimento", entrada.empreendimento)
    .eq("classe", "caixa");

  const situacao = texto(entrada.situacao);
  if (situacao && DECISOES.includes(situacao as Decisao)) {
    consulta = consulta.eq("situacao", situacao);
  }

  const { data: marcas, error } = await consulta;
  if (error) return { erro: error.message, ok: false };

  const linhasMarcadas = (marcas ?? []) as Record<string, unknown>[];
  if (linhasMarcadas.length === 0) {
    return {
      linhas: [],
      ok: true,
      resumo: {
        aValidar: 0, clientes: 0, confirmadas: 0, parcelas: 0, rejeitadas: 0,
        totalAValidar: 0, totalConfirmado: 0, totalLiberado: 0,
      },
    };
  }

  // ⚠️ LOTES DE 100 no `.in()`: lista grande estoura o tamanho da URL do PostgREST.
  const idsDeParcela = linhasMarcadas.map((m) => String(m.parcela_id ?? "")).filter(Boolean);
  const parcelaPorId = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < idsDeParcela.length; i += 100) {
    const { data } = await admin
      .from("lsoft_parcelas")
      .select("id, vencimento, paga, valor, valor_recebido, quadra, lote, observacoes")
      .in("id", idsDeParcela.slice(i, i + 100));
    for (const p of (data ?? []) as Record<string, unknown>[]) {
      parcelaPorId.set(String(p.id), p);
    }
  }

  const codigos = [...new Set(linhasMarcadas.map((m) => String(m.cliente_codigo ?? "")))].filter(Boolean);
  const nomePorCodigo = new Map<string, string>();
  for (let i = 0; i < codigos.length; i += 100) {
    const { data } = await admin
      .from("lsoft_clientes")
      .select("codigo, nome")
      .in("codigo", codigos.slice(i, i + 100));
    for (const c of (data ?? []) as { codigo: string; nome: string }[]) {
      nomePorCodigo.set(c.codigo, c.nome);
    }
  }

  const numero = (v: unknown) => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };

  const linhas: ParcelaDeSubsidio[] = linhasMarcadas.map((m) => {
    const parcelaId = String(m.parcela_id ?? "");
    const p = parcelaPorId.get(parcelaId) ?? {};
    const quadra = texto(p.quadra);
    const lote = texto(p.lote);
    return {
      classificacaoId: String(m.id ?? ""),
      clienteCodigo: String(m.cliente_codigo ?? ""),
      clienteNome: nomePorCodigo.get(String(m.cliente_codigo ?? "")) ?? "",
      natureza: texto(m.natureza),
      // O texto original do LSoft: e nele que o operador confere se e subsidio mesmo.
      observacoes: texto(p.observacoes) ?? texto(m.observacao_no_momento),
      origemDaClasse: String(m.origem_da_classe ?? ""),
      paga: Boolean(p.paga),
      parcelaId,
      situacao: (texto(m.situacao) ?? "a_validar") as Decisao,
      unidade: quadra || lote ? [quadra ? `Q${quadra}` : "", lote ? `L${lote}` : ""].filter(Boolean).join(" ") : null,
      validadoEm: texto(m.validado_em),
      validadoPorNome: texto(m.validado_por_nome),
      valor: numero(p.valor ?? m.valor_no_momento),
      valorRecebido: numero(p.valor_recebido),
      vencimento: texto(p.vencimento),
    };
  });

  const busca = texto(entrada.busca)?.toLowerCase();
  const filtradas = busca
    ? linhas.filter(
        (l) =>
          l.clienteNome.toLowerCase().includes(busca) ||
          (l.unidade ?? "").toLowerCase().includes(busca) ||
          (l.observacoes ?? "").toLowerCase().includes(busca),
      )
    : linhas;

  filtradas.sort(
    (a, b) =>
      a.clienteNome.localeCompare(b.clienteNome, "pt-BR") ||
      (a.vencimento ?? "").localeCompare(b.vencimento ?? ""),
  );

  const soma = (quais: ParcelaDeSubsidio[]) => quais.reduce((t, l) => t + l.valor, 0);
  const confirmadas = filtradas.filter((l) => l.situacao === "confirmada");
  const aValidar = filtradas.filter((l) => l.situacao === "a_validar");

  return {
    linhas: filtradas,
    ok: true,
    resumo: {
      aValidar: aValidar.length,
      clientes: new Set(filtradas.map((l) => l.clienteCodigo)).size,
      confirmadas: confirmadas.length,
      parcelas: filtradas.length,
      rejeitadas: filtradas.filter((l) => l.situacao === "rejeitada").length,
      totalAValidar: soma(aValidar),
      totalConfirmado: soma(confirmadas),
      totalLiberado: confirmadas.reduce((t, l) => t + l.valorRecebido, 0),
    },
  };
}
