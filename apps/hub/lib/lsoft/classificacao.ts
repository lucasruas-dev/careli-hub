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
import { unidadeParaExibir } from "@/lib/lsoft/unidade";

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

/**
 * UM CREDITO DO EXTRATO CIWEB — uma medicao de obra que a Caixa depositou.
 *
 * Lucas (25/08/2026): *"eu queria que ao clicar nos clientes do subsidio, viesse a relacao de
 * pagamentos da caixa, tem 9 liberacoes e essas nao vieram"*.
 */
export type LiberacaoDaCaixa = {
  data: null | string;
  /** false nos creditos menores do mesmo dia (o rateio). */
  ehPrincipal: boolean;
  /** true no credito reconhecido como a liberacao do TERRENO. */
  ehTerreno: boolean;
  historico: string;
  valor: number;
};

/**
 * A LINHA QUE O LUCAS PEDIU: um cliente, uma unidade, o contratado e o que a Caixa ja pagou.
 *
 * Lucas (25/08/2026): *"o financiamento e subsidio e a mesma coisa, tem que trazer essas
 * informacoes agrupadas por cliente / unidade"*. Financiamento, subsidio, FGTS e terreno sao
 * bolsos do MESMO dinheiro da Caixa — separa-los em linhas soltas obrigava a somar de cabeca.
 *
 * ⚠️ DUAS FONTES QUE NUNCA SE FALARAM: o CONTRATADO vem do LSoft (as parcelas), o PAGO vem do
 * extrato CIWEB da construtora. E esse encontro que a tela existe para mostrar.
 */
export type ClienteDeSubsidio = {
  /** Quanto a Caixa ja liberou para este cliente, pelo extrato. */
  caixaPagou: number;
  /** A parte dos creditos menores (rateio) dentro do que foi pago. */
  caixaPagouSecundario: number;
  clienteCodigo: string;
  clienteNome: string;
  /** Soma das parcelas marcadas como Caixa (confirmadas + a validar). */
  contratado: number;
  /** So o que ja foi confirmado por gente. */
  contratadoConfirmado: number;
  /** Os creditos do extrato, do mais novo para o mais antigo. */
  liberacoes: LiberacaoDaCaixa[];
  /** true quando o pago alcancou o contratado. */
  liquidado: boolean;
  parcelas: ParcelaDeSubsidio[];
  /** contratado - pago, nunca negativo. */
  saldo: number;
  /** Data do ultimo credito no extrato. */
  ultimaLiberacao: null | string;
  unidade: null | string;
};

export type ResumoDoSubsidio = {
  /** Quantas ainda esperam decisao. */
  aValidar: number;
  clientes: number;
  /** Ja confirmadas como Caixa. */
  confirmadas: number;
  parcelas: number;
  rejeitadas: number;
  /**
   * O QUE A CAIXA JA PAGOU — soma dos creditos do EXTRATO CIWEB, nao da baixa no LSoft.
   *
   * Lucas (25/08/2026): *"a baixa da caixa vem dos extratos e nao do lsoft"*. O LSoft registra
   * R$ 598 mil baixados; o extrato mostra R$ 7,75 mi ligados a cliente. A diferenca e dinheiro
   * que a Caixa pagou e o sistema da construtora nunca soube.
   */
  totalLiberado: number;
  /** A parte dos creditos menores (rateio): somada no total, mostrada a parte. */
  totalLiberadoSecundario: number;
  /** Creditos do extrato que ainda nao casaram com cliente nenhum. */
  totalSemVinculo: number;
  /** Quantos clientes ja receberam alguma liberacao. */
  clientesComLiberacao: number;
  /** Quantas unidades ja tiveram o contratado alcancado pelo pago. */
  liquidados: number;
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
  | { clientes: ClienteDeSubsidio[]; linhas: ParcelaDeSubsidio[]; ok: true; resumo: ResumoDoSubsidio }
  | { erro: string; ok: false }
> {
  const admin = createApoloAdminClient();
  if (!admin) return { erro: "Supabase indisponível.", ok: false };

  let consulta = admin
    .from("lsoft_classificacao_de_parcela")
    .select("id, parcela_id, cliente_codigo, natureza, situacao, origem_da_classe, validado_em, validado_por_nome, valor_no_momento, observacao_no_momento")
    .eq("empreendimento", entrada.empreendimento)
    .eq("classe", "caixa");

  // ⚠️ NAO FILTRE SITUACAO NO BANCO. Igual a busca: recortar parcelas quebra a conta da unidade,
  // porque o pago vem do extrato e e SEMPRE o total do cliente. "So o que falta validar" tem que
  // significar "unidades que tem algo a validar", com o contratado inteiro — nao "meia unidade".
  const situacao =
    texto(entrada.situacao) && DECISOES.includes(texto(entrada.situacao) as Decisao)
      ? (texto(entrada.situacao) as Decisao)
      : null;

  const { data: marcas, error } = await consulta;
  if (error) return { erro: error.message, ok: false };

  const linhasMarcadas = (marcas ?? []) as Record<string, unknown>[];
  if (linhasMarcadas.length === 0) {
    return {
      clientes: [],
      linhas: [],
      ok: true,
      resumo: {
        aValidar: 0, clientes: 0, clientesComLiberacao: 0, confirmadas: 0, liquidados: 0,
        parcelas: 0, rejeitadas: 0, totalAValidar: 0, totalConfirmado: 0, totalLiberado: 0,
        totalLiberadoSecundario: 0, totalSemVinculo: 0,
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

  // ⚠️ A BUSCA ESCOLHE CLIENTES, NAO PARCELAS. Recortar parcela a parcela quebrava a conta da
  // unidade: buscar "FGTS" deixava o contratado so com a linha do FGTS (R$ 2.708) enquanto o pago
  // continuava sendo o total do cliente (R$ 125 mil) — a unidade aparecia LIQUIDADA sem ser.
  // Quem casa com o texto define quais unidades entram; a unidade sempre entra INTEIRA.
  const busca = texto(entrada.busca)?.toLowerCase();
  const casa = (l: ParcelaDeSubsidio) =>
    l.clienteNome.toLowerCase().includes(busca ?? "") ||
    (l.unidade ?? "").toLowerCase().includes(busca ?? "") ||
    (l.observacoes ?? "").toLowerCase().includes(busca ?? "");

  const recorta = busca || situacao;
  const clientesVisiveis = recorta
    ? new Set(
        linhas
          .filter((l) => (!busca || casa(l)) && (!situacao || l.situacao === situacao))
          .map((l) => l.clienteCodigo),
      )
    : null;
  const filtradas = clientesVisiveis
    ? linhas.filter((l) => clientesVisiveis.has(l.clienteCodigo))
    : linhas;

  filtradas.sort(
    (a, b) =>
      a.clienteNome.localeCompare(b.clienteNome, "pt-BR") ||
      (a.vencimento ?? "").localeCompare(b.vencimento ?? ""),
  );

  // ── O QUE A CAIXA JA PAGOU, PELO EXTRATO ──────────────────────────────────
  //
  // ⚠️ NAO USE `valor_recebido` DO LSOFT AQUI. Foi o erro que a tela mostrou ao Lucas: R$ 598 mil
  // onde o certo eram R$ 7,75 mi. A Caixa deposita na conta da construtora por medicao de obra, e
  // o LSoft so registra o punhado de baixas que alguem digitou.
  //
  // O credito nao aponta para uma PARCELA — aponta para o CONTRATO. Por isso o pago mora no
  // cliente, nunca na linha da parcela: distribuir R$ 7,7 mi entre parcelas seria inventar.
  const pagoPorCliente = new Map<
    string,
    { linhas: LiberacaoDaCaixa[]; secundario: number; total: number; ultima: null | string }
  >();
  let totalSemVinculo = 0;

  for (let i = 0; i < codigos.length; i += 100) {
    const { data } = await admin
      .from("lsoft_credito_da_caixa")
      .select("cliente_codigo, valor, eh_principal, eh_terreno, data_movimento, historico")
      .in("cliente_codigo", codigos.slice(i, i + 100));

    for (const c of (data ?? []) as Record<string, unknown>[]) {
      const codigo = String(c.cliente_codigo ?? "");
      if (!codigo) continue;
      const atual = pagoPorCliente.get(codigo) ?? {
        linhas: [] as LiberacaoDaCaixa[],
        secundario: 0,
        total: 0,
        ultima: null as null | string,
      };
      const valor = numero(c.valor);
      const data_ = texto(c.data_movimento);
      atual.total += valor;
      if (!c.eh_principal) atual.secundario += valor;
      atual.linhas.push({
        data: data_,
        ehPrincipal: Boolean(c.eh_principal),
        ehTerreno: Boolean(c.eh_terreno),
        historico: texto(c.historico) ?? "",
        valor,
      });
      if (data_ && (!atual.ultima || data_ > atual.ultima)) atual.ultima = data_;
      pagoPorCliente.set(codigo, atual);
    }
  }

  // Os creditos que ainda nao acharam dono. Medido em 25/08: 6 contratos, R$ 692.132,94. Ficam
  // visiveis de proposito — sumir com eles esconderia dinheiro real da construtora.
  const { data: orfaos } = await admin
    .from("lsoft_credito_da_caixa")
    .select("valor")
    .is("cliente_codigo", null);
  for (const o of (orfaos ?? []) as Record<string, unknown>[]) totalSemVinculo += numero(o.valor);

  // ── UMA LINHA POR CLIENTE / UNIDADE ───────────────────────────────────────
  const porCliente = new Map<string, ClienteDeSubsidio>();
  for (const linha of filtradas) {
    const codigo = linha.clienteCodigo;
    let cliente = porCliente.get(codigo);
    if (!cliente) {
      const pago = pagoPorCliente.get(codigo);
      cliente = {
        caixaPagou: pago?.total ?? 0,
        caixaPagouSecundario: pago?.secundario ?? 0,
        clienteCodigo: codigo,
        clienteNome: linha.clienteNome,
        contratado: 0,
        contratadoConfirmado: 0,
        // Do mais novo para o mais antigo: a ultima medicao e o que interessa primeiro.
        liberacoes: [...(pago?.linhas ?? [])].sort((a, b) =>
          (b.data ?? "").localeCompare(a.data ?? ""),
        ),
        liquidado: false,
        parcelas: [],
        saldo: 0,
        ultimaLiberacao: pago?.ultima ?? null,
        unidade: unidadeParaExibir({ observacoes: linha.observacoes }) ?? linha.unidade,
      };
      porCliente.set(codigo, cliente);
    }
    // A unidade so aparece em algumas parcelas: a primeira que trouxer, vale para o grupo.
    if (!cliente.unidade) {
      cliente.unidade = unidadeParaExibir({ observacoes: linha.observacoes }) ?? linha.unidade;
    }
    // ⚠️ REJEITADA NAO SOMA: quem disse "isso nao e Caixa" tirou a parcela da conta.
    if (linha.situacao !== "rejeitada") {
      cliente.contratado += linha.valor;
      if (linha.situacao === "confirmada") cliente.contratadoConfirmado += linha.valor;
    }
    cliente.parcelas.push(linha);
  }

  const clientes = [...porCliente.values()]
    .map((c) => ({
      ...c,
      liquidado: c.contratado > 0 && c.caixaPagou >= c.contratado,
      saldo: Math.max(c.contratado - c.caixaPagou, 0),
    }))
    .sort((a, b) => b.saldo - a.saldo || a.clienteNome.localeCompare(b.clienteNome, "pt-BR"));

  const soma = (quais: ParcelaDeSubsidio[]) => quais.reduce((t, l) => t + l.valor, 0);
  const confirmadas = filtradas.filter((l) => l.situacao === "confirmada");
  const aValidar = filtradas.filter((l) => l.situacao === "a_validar");

  return {
    clientes,
    linhas: filtradas,
    ok: true,
    resumo: {
      aValidar: aValidar.length,
      clientes: porCliente.size,
      clientesComLiberacao: clientes.filter((c) => c.liberacoes.length > 0).length,
      confirmadas: confirmadas.length,
      liquidados: clientes.filter((c) => c.liquidado).length,
      parcelas: filtradas.length,
      rejeitadas: filtradas.filter((l) => l.situacao === "rejeitada").length,
      totalAValidar: soma(aValidar),
      totalConfirmado: soma(confirmadas),
      totalLiberado: clientes.reduce((t, c) => t + c.caixaPagou, 0),
      totalLiberadoSecundario: clientes.reduce((t, c) => t + c.caixaPagouSecundario, 0),
      totalSemVinculo,
    },
  };
}
