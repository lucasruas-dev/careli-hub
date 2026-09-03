// A AGREGAÇÃO DO FLUXO DE VENDA — o núcleo puro que a tela Venda consome.
//
// Separado da rota de propósito: é conta, e conta se testa. A rota lê o Supabase (paginado) e
// entrega as linhas cruas aqui; daqui sai a faixa do fluxo, o funil, o ranking, a série mensal e o
// mapa do estoque.
//
// ⚠️ AS CINCO ETAPAS DO FLUXO NÃO SÃO AS SETE DA TABELA. `hercules_propostas.etapa` guarda também
// `cancelado` e `distrato`, que NÃO são passos do caminho — são saídas dele. A faixa mostra os
// cinco passos; os dois terminais vão para o quadro de perdas. Misturá-los faria "cancelado"
// parecer uma fase da venda, e o coordenador contaria como pipeline o que já morreu.

export type EtapaDoFluxo = "assinatura" | "contrato" | "faturado" | "proposta" | "reservado";
export type EtapaDaProposta = EtapaDoFluxo | "cancelado" | "distrato";

export const ETAPAS_DO_FLUXO: readonly EtapaDoFluxo[] = [
  "reservado",
  "proposta",
  "contrato",
  "assinatura",
  "faturado",
];

/**
 * A etapa como a GRADE pinta a unidade.
 *
 * ⚠️ NÃO É A SITUAÇÃO DO C2X. Lucas (03/09/2026): *"quero ter os mesmos status, em vez de vendida,
 * ter propostas, contrato assinatura faturamento"*. `hercules_unidades.situacao` só sabe dizer
 * disponível / reservada / vendida / bloqueada — e "vendida" esconde a diferença entre o lote que
 * tem proposta emitida hoje e o que já faturou. Quem sabe isso é a PROPOSTA viva da unidade, e é
 * ela que decide a cor.
 *
 * `disponivel` e `bloqueada` continuam vindo da unidade: são os dois estados que existem sem
 * proposta nenhuma.
 */
export type EtapaDoEspelho =
  | EtapaDoFluxo
  | "bloqueada"
  | "disponivel"
  /**
   * ⚠️ VENDIDA SEM PROPOSTA VIVA — e este estado existe por segurança, não por capricho. São 114
   * unidades hoje: o cadastro diz vendida e não há proposta no caminho que diga em que etapa ela
   * está (proposta cancelada e status não atualizado, venda antiga, carga incompleta). Sem este
   * estado elas cairiam em `disponivel` e a grade ofereceria lote já vendido — o pior erro que
   * esta tela pode cometer. Aqui elas aparecem ocupadas, e o rótulo diz que falta a proposta.
   */
  | "vendida"
  /** O par de `vendida`: reservada no cadastro, sem proposta que sustente. Hoje, zero casos. */
  | "reservada";

/**
 * A faixa do fluxo, com o estoque na frente: é dele que a venda começa.
 *
 * ⚠️ `bloqueada` NÃO entra. Ela existe na grade (é uma cor no quadro), mas não é passo do caminho:
 * lote bloqueado está fora da oferta, e somá-lo ao pipeline daria ao coordenador um estoque que
 * ele não pode vender.
 */
export const ETAPAS_DA_FAIXA: readonly ("disponivel" | EtapaDoFluxo)[] = [
  "disponivel",
  ...ETAPAS_DO_FLUXO,
];

export type PropostaDaCarga = {
  cliente_documento: null | string;
  contrato_parcelas: null | number;
  plano_correcao: null | string;
  plano_juros: null | number | string;
  plano_parcelas: null | number;
  plano_personalizado: boolean | null;
  cliente_nome: null | string;
  codigo: null | string;
  criado_em_c2x: null | string;
  data_assinatura: null | string;
  data_ato: null | string;
  data_faturamento: null | string;
  empreendimento_codigo: null | string;
  etapa: string;
  etapa_c2x: null | number;
  etapa_desde: null | string;
  id: string;
  imobiliaria_nome: null | string;
  motivo: null | string;
  plano_nome: null | string;
  unidade_id: null | string;
  unidade_nome: null | string;
  valor: null | number | string;
};

export type UnidadeDoMapa = {
  codigo: string;
  enterprise_id: string;
  id: string;
  lote: null | string;
  preco_tabela: null | number | string;
  quadra: null | string;
  situacao: string;
};

export type PassoDoFluxo = {
  etapa: EtapaDoEspelho;
  /**
   * Quantas. No `disponivel` são UNIDADES (não existe proposta num lote livre); nas outras são
   * propostas — e como uma unidade tem no máximo uma proposta viva, dá no mesmo.
   */
  quantidade: number;
  vgv: number;
};

export type LinhaDaLista = {
  cliente: null | string;
  desde: null | string;
  etapa: string;
  id: string;
  imobiliaria: null | string;
  /** O FLUXO do contrato — "60x · IPCA ANUAL · juros 8% a.a." —, não o nome do plano. */
  plano: null | string;
  produto: null | string;
  unidade: null | string;
  /**
   * A unidade no Panteon — a chave que liga o LOTE DO MAPA a esta proposta.
   *
   * ⚠️ CASAR POR NOME NÃO SERVE: o nome da unidade na proposta vem do `block + lot` do legado e o
   * do mapa vem de `hercules_unidades.codigo`, que a carga pode ter normalizado de outro jeito. O
   * id é exato, e é o mesmo dos dois lados porque a carga casou por `origem_c2x_id`.
   */
  unidadeId: null | string;
  valor: number;
};

/**
 * O funil de CADASTRO — o começo do processo, que não está em `hercules_propostas`.
 *
 * ⚠️ VEM DE OUTRA FONTE, E POR ISSO É OUTRO CAMPO. CAD é do Apolo (`apolo_esteira`); proposta é do
 * C2X importado. Pedido do Lucas: *"quantas cads foram geradas, quantas reservas, propostas"* — as
 * duas coisas na mesma escada. Somá-las num único número seria misturar pessoa com unidade: uma CAD
 * credenciada pode não reservar nada, e uma unidade pode ter tido três propostas de gente
 * diferente.
 */
export type CadsDoEscopo = {
  credenciados: number;
  emAndamento: number;
  emCorrecao: number;
  reprovadas: number;
  total: number;
};

/** O recorte de tempo do painel, em competência (AAAA-MM). Ausente = a base inteira. */
export type PeriodoDoPainel = { ate?: string; de?: string };

export type FluxoDeVenda = {
  /** Nulo quando a leitura do cadastro falhou — a tela mostra o funil sem as duas primeiras barras. */
  cads: CadsDoEscopo | null;
  fluxo: PassoDoFluxo[];
  /** As propostas, já enxutas para a tela. A ordem é a mais recente primeiro. */
  lista: LinhaDaLista[];
  mapa: {
    grupo: string;
    unidades: {
      codigo: string;
      /** A etapa que pinta o quadrado — ver `EtapaDoEspelho`. */
      etapa: EtapaDoEspelho;
      id: string;
      lote: null | string;
      preco: number;
      /** A quadra, para a tela escrever "03 07" em vez do código interno da unidade. */
      quadra: null | string;
      /** A situação crua da unidade, para quem precisar do dado original. */
      situacao: string;
    }[];
  }[];
  perdas: { canceladas: number; distratos: number; vgvCancelado: number };
  /** Os motivos de cancelamento que EXISTEM na base — ver o aviso sobre o legado. */
  motivos: { motivo: string; n: number }[];
  ranking: { imobiliaria: string; propostas: number; vendidas: number; vgv: number }[];
  serie: { canceladas: number; faturadas: number; mes: string }[];
  /** O que o recorte de tempo pegou, para a tela poder dizer de que período está falando. */
  periodo: { ate: null | string; de: null | string; propostasNoPeriodo: number };
  totais: {
    /** Quantas unidades em cada `EtapaDoEspelho` — é a legenda da grade. */
    estoque: Record<string, number>;
    /** Faturadas DENTRO da janela — o par do `vgvFaturado`, para o ticket médio fechar. */
    faturadasNoPeriodo: number;
    propostas: number;
    unidades: number;
    vgvFaturado: number;
  };
};

const numero = (v: null | number | string | undefined): number => {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const ehDoFluxo = (etapa: string): etapa is EtapaDoFluxo =>
  (ETAPAS_DO_FLUXO as readonly string[]).includes(etapa);

/**
 * A etapa de uma unidade SEM proposta viva — o que o cadastro sozinho consegue afirmar.
 *
 * Situação desconhecida cai em `bloqueada`, e não em `disponivel`: na dúvida, fora da oferta. Um
 * lote a menos no estoque é um aviso; um lote vendido oferecido de novo é um cliente perdido.
 */
function etapaDaSituacao(situacao: string): EtapaDoEspelho {
  switch (situacao) {
    case "disponivel":
      return "disponivel";
    case "reservada":
      return "reservada";
    case "vendida":
      return "vendida";
    default:
      return "bloqueada";
  }
}

/** `8` → `8%`; `8.5` → `8,5%`. A mesma escrita do extrato. */
function porcentagem(valor: number): string {
  return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/**
 * O FLUXO do contrato, no lugar do nome do plano.
 *
 * ⚠️ PEDIDO DO LUCAS (03/09/2026): *"não queria trazer o nome do plano, mas sim o fluxo, igual
 * estamos trazendo nesse relatório de Extrato"*. "PLANO NORMAL" não diz nada a quem vende;
 * "60x · IPCA ANUAL · juros 8% a.a." é o que o comprador reconhece como o contrato dele. A régua é
 * a mesma de `descricaoDoPlano` no extrato (extrato-cliente-pdf.ts).
 *
 * ⚠️ O PARCELAMENTO VEM DA PARCELA, NÃO DO PLANO. `commercial_plans.parcels` descreve o PRODUTO que
 * a mesa vende — um molde serve centenas de contratos —, e foi ele que fez o extrato do TIAGO
 * estampar "144x" num contrato de 62 parcelas. Quem sabe o tamanho do contrato é
 * `payments.total_parcels`; o do molde só entra quando o contrato não tem o dele.
 *
 * ⚠️ E OS TRÊS JUNTOS PORQUE UM SÓ NÃO SE CONFERE: com o parcelamento sozinho um número errado
 * passa; com os três, quem lê reconhece o próprio contrato.
 */
function fluxoDoPlano(p: PropostaDaCarga): null | string {
  const partes: string[] = [];

  const parcelas = p.contrato_parcelas ?? p.plano_parcelas;
  if (parcelas) partes.push(`${parcelas}x`);
  // ⚠️ A SIGLA FICA, O RESTO NÃO GRITA. O legado grava "IPCA ANUAL"; o Lucas não quer caixa alta
  // na tela ("deixa somente a primeira letra"), mas IPCA e INCC são siglas e viram outra coisa em
  // caixa baixa. Então só a primeira palavra — a sigla — mantém a caixa: "IPCA anual".
  const correcao = p.plano_correcao?.trim();
  if (correcao) {
    const [sigla, ...resto] = correcao.split(/\s+/);
    partes.push([sigla, ...resto.map((w) => w.toLocaleLowerCase("pt-BR"))].join(" "));
  }

  const juros = numero(p.plano_juros);
  if (juros > 0) partes.push(`juros ${porcentagem(juros)} a.a.`);

  // Sem nenhum dos três, o nome do plano é melhor do que um travessão — mas só aí.
  return partes.length > 0 ? partes.join(" · ") : (p.plano_nome?.trim() || null);
}

/** "Q07" de "Q07 L12" — o agrupamento do mapa quando a unidade não traz quadra própria. */
function grupoDaUnidade(u: UnidadeDoMapa): string {
  if (u.quadra) return u.quadra;
  const partes = String(u.codigo ?? "").trim().split(/\s+/);
  return partes.length > 1 ? (partes[0] ?? "Unidades") : "Unidades";
}

/**
 * O mês de referência de uma proposta faturada ou cancelada.
 *
 * ⚠️ FATURADA USA A DATA DE FATURAMENTO, e só cai para `etapa_desde` quando ela falta: `etapa_desde`
 * é quando o registro MUDOU de etapa, e uma correção feita hoje numa venda de março jogaria a venda
 * para o mês errado no gráfico.
 */
function mesDe(p: PropostaDaCarga): null | string {
  const bruta =
    p.etapa === "faturado" ? (p.data_faturamento ?? p.etapa_desde) : (p.etapa_desde ?? p.criado_em_c2x);
  if (!bruta) return null;
  const m = /^(\d{4})-(\d{2})/.exec(String(bruta));
  return m ? `${m[1]}-${m[2]}` : null;
}

/**
 * ⚠️ O PERÍODO NÃO VALE PARA A FAIXA DO FLUXO, e isso é decisão de desenho, não esquecimento.
 *
 * A faixa responde "o que está na minha mão AGORA": uma reserva feita em julho e ainda viva é
 * pipeline de hoje, e sumir dela porque o filtro está em setembro faria o coordenador trabalhar com
 * menos do que tem. Já o Panorama responde "como fui no período" — aí faturamento, cancelamento,
 * ranking e série só contam o que aconteceu na janela.
 */
export function agregarFluxo({
  cads = null,
  periodo,
  propostas,
  unidades,
}: {
  cads?: CadsDoEscopo | null;
  periodo?: PeriodoDoPainel;
  propostas: PropostaDaCarga[];
  unidades: UnidadeDoMapa[];
}): FluxoDeVenda {
  const de = periodo?.de ?? null;
  const ate = periodo?.ate ?? null;
  /** A proposta caiu na janela? Sem janela, tudo cai. */
  const naJanela = (p: PropostaDaCarga): boolean => {
    if (!de && !ate) return true;
    const mes = mesDe(p);
    if (!mes) return false;
    if (de && mes < de) return false;
    if (ate && mes > ate) return false;
    return true;
  };
  let propostasNoPeriodo = 0;
  // ── A faixa do fluxo ──────────────────────────────────────────────────────
  const porEtapa = new Map<EtapaDoFluxo, { propostas: number; vgv: number }>();
  for (const etapa of ETAPAS_DO_FLUXO) porEtapa.set(etapa, { propostas: 0, vgv: 0 });

  let canceladas = 0;
  let distratos = 0;
  let vgvCancelado = 0;
  let vgvFaturado = 0;

  const porImobiliaria = new Map<
    string,
    { propostas: number; vendidas: number; vgv: number }
  >();
  const porMes = new Map<string, { canceladas: number; faturadas: number }>();
  const porMotivo = new Map<string, number>();

  for (const p of propostas) {
    const valor = numero(p.valor);

    // A FAIXA: estado atual, sem janela.
    if (ehDoFluxo(p.etapa)) {
      const atual = porEtapa.get(p.etapa)!;
      atual.propostas += 1;
      atual.vgv += valor;
    }

    // O DESEMPENHO: só o que caiu na janela.
    const dentro = naJanela(p);
    if (dentro) propostasNoPeriodo += 1;
    if (dentro && p.etapa === "faturado") vgvFaturado += valor;
    if (dentro && p.etapa === "cancelado") {
      canceladas += 1;
      vgvCancelado += valor;
    }
    if (dentro && p.etapa === "distrato") {
      distratos += 1;
      vgvCancelado += valor;
    }

    // ⚠️ O RANKING CONTA A IMOBILIÁRIA DE TODAS AS PROPOSTAS, e separa quantas VIRARAM venda: quem
    // abre muita proposta e fecha pouca é justamente o que o coordenador precisa enxergar.
    const imob = String(p.imobiliaria_nome ?? "").trim();
    if (imob && dentro) {
      const atual = porImobiliaria.get(imob) ?? { propostas: 0, vendidas: 0, vgv: 0 };
      atual.propostas += 1;
      if (p.etapa === "faturado") {
        atual.vendidas += 1;
        atual.vgv += valor;
      }
      porImobiliaria.set(imob, atual);
    }

    const mes = mesDe(p);
    if (mes && dentro && (p.etapa === "faturado" || p.etapa === "cancelado")) {
      const atual = porMes.get(mes) ?? { canceladas: 0, faturadas: 0 };
      if (p.etapa === "faturado") atual.faturadas += 1;
      else atual.canceladas += 1;
      porMes.set(mes, atual);
    }

    const motivo = String(p.motivo ?? "").trim();
    if (motivo && dentro && (p.etapa === "cancelado" || p.etapa === "distrato")) {
      porMotivo.set(motivo, (porMotivo.get(motivo) ?? 0) + 1);
    }
  }

  // ── O estoque, pelas unidades ────────────────────────────────────────────
  const estoque: Record<string, number> = {};
  // ⚠️ A ETAPA DA UNIDADE VEM DA PROPOSTA VIVA MAIS RECENTE. Uma unidade acumula propostas ao
  // longo do tempo (revenda, cancelamento e nova venda): a que vale é a última que ainda está no
  // caminho. Pegar qualquer uma pintaria de "faturado" um lote que voltou para o estoque.
  const vivaPorUnidade = new Map<string, { desde: string; etapa: EtapaDoFluxo }>();
  for (const p of propostas) {
    if (!p.unidade_id || !ehDoFluxo(p.etapa)) continue;
    const desde = String(p.etapa_desde ?? p.criado_em_c2x ?? "");
    const atual = vivaPorUnidade.get(p.unidade_id);
    if (!atual || desde > atual.desde) vivaPorUnidade.set(p.unidade_id, { desde, etapa: p.etapa });
  }

  const grupos = new Map<
    string,
    {
      codigo: string;
      etapa: EtapaDoEspelho;
      id: string;
      lote: null | string;
      preco: number;
      quadra: null | string;
      situacao: string;
    }[]
  >();
  /** Unidades livres, para o passo `disponivel` da faixa. */
  let disponiveis = 0;
  let vgvDisponivel = 0;
  for (const u of unidades) {
    // ⚠️ A PROPOSTA VIVA REFINA, MAS A SITUAÇÃO NUNCA É REBAIXADA PARA LIVRE. Com proposta, ela
    // manda (é ela que sabe se está em contrato ou já faturou). Sem proposta, vale o cadastro — e
    // "vendida" ou "reservada" continuam ocupadas, nunca disponíveis: dizer que um lote vendido
    // está livre é convidar a segunda venda.
    const etapa: EtapaDoEspelho = vivaPorUnidade.get(u.id)?.etapa ?? etapaDaSituacao(u.situacao);

    estoque[etapa] = (estoque[etapa] ?? 0) + 1;
    if (etapa === "disponivel") {
      disponiveis += 1;
      vgvDisponivel += numero(u.preco_tabela);
    }

    const g = grupoDaUnidade(u);
    const lista = grupos.get(g);
    const item = {
      codigo: u.codigo,
      etapa,
      id: u.id,
      lote: u.lote,
      preco: numero(u.preco_tabela),
      quadra: u.quadra,
      situacao: u.situacao,
    };
    if (lista) lista.push(item);
    else grupos.set(g, [item]);
  }

  return {
    cads,
    fluxo: ETAPAS_DA_FAIXA.map((etapa) =>
      etapa === "disponivel"
        ? { etapa, quantidade: disponiveis, vgv: Math.round(vgvDisponivel * 100) / 100 }
        : {
            etapa,
            quantidade: porEtapa.get(etapa)!.propostas,
            vgv: Math.round(porEtapa.get(etapa)!.vgv * 100) / 100,
          },
    ),
    lista: propostas.map((p) => ({
      cliente: p.cliente_nome,
      desde: p.etapa_desde,
      etapa: p.etapa,
      id: p.id,
      imobiliaria: p.imobiliaria_nome,
      plano: fluxoDoPlano(p),
      produto: p.empreendimento_codigo,
      unidade: p.unidade_nome,
      unidadeId: p.unidade_id,
      valor: numero(p.valor),
    })),
    mapa: [...grupos.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "pt-BR", { numeric: true }))
      .map(([grupo, lista]) => ({
        grupo,
        unidades: lista.sort((a, b) =>
          String(a.lote ?? a.codigo).localeCompare(String(b.lote ?? b.codigo), "pt-BR", {
            numeric: true,
          }),
        ),
      })),
    motivos: [...porMotivo.entries()]
      .map(([motivo, n]) => ({ motivo, n }))
      .sort((a, b) => b.n - a.n),
    perdas: { canceladas, distratos, vgvCancelado: Math.round(vgvCancelado * 100) / 100 },
    ranking: [...porImobiliaria.entries()]
      .map(([imobiliaria, v]) => ({ imobiliaria, ...v, vgv: Math.round(v.vgv * 100) / 100 }))
      .sort((a, b) => b.vgv - a.vgv || b.vendidas - a.vendidas),
    periodo: { ate, de, propostasNoPeriodo },
    serie: [...porMes.entries()]
      .map(([mes, v]) => ({ mes, ...v }))
      .sort((a, b) => a.mes.localeCompare(b.mes)),
    totais: {
      estoque,
      // ⚠️ `faturadasNoPeriodo` existe porque `fluxo` conta o TOTAL faturado e `vgvFaturado` só o
      // do período: dividir um pelo outro daria um ticket médio inventado.
      faturadasNoPeriodo: propostas.filter((p) => p.etapa === "faturado" && naJanela(p)).length,
      propostas: propostas.length,
      unidades: unidades.length,
      vgvFaturado: Math.round(vgvFaturado * 100) / 100,
    },
  };
}
