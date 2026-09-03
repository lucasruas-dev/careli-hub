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

export type PropostaDaCarga = {
  cliente_documento: null | string;
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
  etapa: EtapaDoFluxo;
  propostas: number;
  vgv: number;
};

export type LinhaDaLista = {
  cliente: null | string;
  desde: null | string;
  etapa: string;
  id: string;
  imobiliaria: null | string;
  plano: null | string;
  produto: null | string;
  unidade: null | string;
  valor: number;
};

export type FluxoDeVenda = {
  fluxo: PassoDoFluxo[];
  /** As propostas, já enxutas para a tela. A ordem é a mais recente primeiro. */
  lista: LinhaDaLista[];
  mapa: { grupo: string; unidades: { codigo: string; lote: null | string; situacao: string }[] }[];
  perdas: { canceladas: number; distratos: number; vgvCancelado: number };
  /** Os motivos de cancelamento que EXISTEM na base — ver o aviso sobre o legado. */
  motivos: { motivo: string; n: number }[];
  ranking: { imobiliaria: string; propostas: number; vendidas: number; vgv: number }[];
  serie: { canceladas: number; faturadas: number; mes: string }[];
  totais: {
    estoque: Record<string, number>;
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

export function agregarFluxo({
  propostas,
  unidades,
}: {
  propostas: PropostaDaCarga[];
  unidades: UnidadeDoMapa[];
}): FluxoDeVenda {
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

    if (ehDoFluxo(p.etapa)) {
      const atual = porEtapa.get(p.etapa)!;
      atual.propostas += 1;
      atual.vgv += valor;
      if (p.etapa === "faturado") vgvFaturado += valor;
    } else if (p.etapa === "cancelado") {
      canceladas += 1;
      vgvCancelado += valor;
    } else if (p.etapa === "distrato") {
      distratos += 1;
      vgvCancelado += valor;
    }

    // ⚠️ O RANKING CONTA A IMOBILIÁRIA DE TODAS AS PROPOSTAS, e separa quantas VIRARAM venda: quem
    // abre muita proposta e fecha pouca é justamente o que o coordenador precisa enxergar.
    const imob = String(p.imobiliaria_nome ?? "").trim();
    if (imob) {
      const atual = porImobiliaria.get(imob) ?? { propostas: 0, vendidas: 0, vgv: 0 };
      atual.propostas += 1;
      if (p.etapa === "faturado") {
        atual.vendidas += 1;
        atual.vgv += valor;
      }
      porImobiliaria.set(imob, atual);
    }

    const mes = mesDe(p);
    if (mes && (p.etapa === "faturado" || p.etapa === "cancelado")) {
      const atual = porMes.get(mes) ?? { canceladas: 0, faturadas: 0 };
      if (p.etapa === "faturado") atual.faturadas += 1;
      else atual.canceladas += 1;
      porMes.set(mes, atual);
    }

    const motivo = String(p.motivo ?? "").trim();
    if (motivo && (p.etapa === "cancelado" || p.etapa === "distrato")) {
      porMotivo.set(motivo, (porMotivo.get(motivo) ?? 0) + 1);
    }
  }

  // ── O estoque, pelas unidades ────────────────────────────────────────────
  const estoque: Record<string, number> = {};
  const grupos = new Map<string, { codigo: string; lote: null | string; situacao: string }[]>();
  for (const u of unidades) {
    estoque[u.situacao] = (estoque[u.situacao] ?? 0) + 1;
    const g = grupoDaUnidade(u);
    const lista = grupos.get(g);
    const item = { codigo: u.codigo, lote: u.lote, situacao: u.situacao };
    if (lista) lista.push(item);
    else grupos.set(g, [item]);
  }

  return {
    fluxo: ETAPAS_DO_FLUXO.map((etapa) => ({
      etapa,
      propostas: porEtapa.get(etapa)!.propostas,
      vgv: Math.round(porEtapa.get(etapa)!.vgv * 100) / 100,
    })),
    lista: propostas.map((p) => ({
      cliente: p.cliente_nome,
      desde: p.etapa_desde,
      etapa: p.etapa,
      id: p.id,
      imobiliaria: p.imobiliaria_nome,
      plano: p.plano_nome,
      produto: p.empreendimento_codigo,
      unidade: p.unidade_nome,
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
    serie: [...porMes.entries()]
      .map(([mes, v]) => ({ mes, ...v }))
      .sort((a, b) => a.mes.localeCompare(b.mes)),
    totais: {
      estoque,
      propostas: propostas.length,
      unidades: unidades.length,
      vgvFaturado: Math.round(vgvFaturado * 100) / 100,
    },
  };
}
