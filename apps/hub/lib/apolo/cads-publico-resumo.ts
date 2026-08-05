// Resumo do funil no APOLO para o dashboard público de CADs.
//
// A tela nasceu lendo só o Asana. Hoje a esteira anda no APOLO, então a divisão das fontes é:
//   Asana → Recebidas (total), Validação, Duplicados e CAD's Incorretas.
//   Apolo → Análise de Crédito, Crédito em Revisão, Pré-Venda, Credenciado e PIX Compensado.
// Este módulo cobre a parte do Apolo: os números (carregarResumoApolo) e as listas por etapa
// (carregarListasCredenciamento), para os cards do funil de crédito baterem com a lista ao clicar.
//
// Ver [[project_asaas_prevenda]] e [[project_esteira_credenciamento_venda]].

import { createApoloAdminClient } from "@/lib/apolo/server";

export type ApoloFunilResumo = {
  analiseCredito: number;
  credenciados: number;
  creditoRevisao: number;
  correcao: number;
  pagos: number;
  prevenda: number;
  validacao: number;
  valorPago: number;
};

type EsteiraRow = {
  etapa: string | null;
  pagamento_ref: string | null;
  pago_em: string | null;
};

export async function carregarResumoApolo(
  empreendimento: string,
): Promise<ApoloFunilResumo | null> {
  const client = createApoloAdminClient();
  if (!client) return null;

  const alvo = empreendimento.trim();
  if (!alvo) return null;

  // Filtro por NOME (texto), não por `enterprise_id`: este resumo é público e recebe o nome do
  // empreendimento na URL. Continua correto com a chave nova — cada linha é uma CAD, e é isso que
  // o funil conta. Migrar para `enterprise_id` exigiria o id do C2X na rota pública; fica como
  // melhoria, não como correção.
  const { data, error } = await client
    .from("apolo_esteira")
    .select("etapa, pago_em, pagamento_ref")
    .ilike("empreendimento", `%${alvo}%`);

  if (error) return null;

  const linhas = (data ?? []) as EsteiraRow[];
  const conta = (etapa: string) => linhas.filter((l) => l.etapa === etapa).length;

  const pagas = linhas.filter((l) => Boolean(l.pago_em));
  const refs = pagas.map((l) => l.pagamento_ref).filter((r): r is string => Boolean(r));

  // Valor recebido: vem do evento do Asaas que confirmou cada cobrança (a esteira guarda só a
  // referência do pagamento). Sem referência, conta na quantidade mas não no valor.
  let valorPago = 0;
  if (refs.length) {
    const { data: eventos } = await client
      .from("apolo_asaas_eventos")
      .select("asaas_payment_id, value, evento")
      .in("asaas_payment_id", refs)
      .in("evento", ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"]);

    // Um pagamento pode gerar CONFIRMED e RECEIVED: só o primeiro por cobrança entra na soma.
    const vistos = new Set<string>();
    for (const ev of (eventos ?? []) as Array<{
      asaas_payment_id: string | null;
      value: number | string | null;
    }>) {
      const id = ev.asaas_payment_id ?? "";
      if (!id || vistos.has(id)) continue;
      vistos.add(id);
      const valor = typeof ev.value === "number" ? ev.value : Number(ev.value ?? 0);
      if (Number.isFinite(valor)) valorPago += valor;
    }
  }

  return {
    analiseCredito: conta("credito"),
    correcao: conta("correcao"),
    credenciados: conta("credenciado"),
    creditoRevisao: conta("revisao"),
    pagos: pagas.length,
    prevenda: conta("prevenda"),
    validacao: conta("validacao"),
    valorPago,
  };
}

// Um item da LISTA (não só o número): nome do cliente, imobiliária e data, para os cards do fim do
// funil (Credenciado, PIX Compensado) ficarem CLICÁVEIS e mostrarem quem está em cada um.
export type CadApoloListaItem = {
  cliente: string;
  data: string | null;
  imobiliaria: string | null;
};

// As listas por etapa do funil no APOLO (mesma fonte de `carregarResumoApolo`, por isso o número
// do card bate com a lista aberta):
//   credito  = Análise de Crédito (etapa 'credito')
//   revisao  = Crédito em Revisão (etapa 'revisao')
//   prevenda = Pré-Venda          (etapa 'prevenda')
//   credenciados = quem está credenciado (etapa 'credenciado')
//   pagos        = quem já pagou (pago_em ≠ null)
export async function carregarListasCredenciamento(
  empreendimento: string,
): Promise<{
  credenciados: CadApoloListaItem[];
  credito: CadApoloListaItem[];
  pagos: CadApoloListaItem[];
  prevenda: CadApoloListaItem[];
  revisao: CadApoloListaItem[];
} | null> {
  const client = createApoloAdminClient();
  if (!client) return null;

  const alvo = empreendimento.trim();
  if (!alvo) return null;

  const vazio = {
    credenciados: [] as CadApoloListaItem[],
    credito: [] as CadApoloListaItem[],
    pagos: [] as CadApoloListaItem[],
    prevenda: [] as CadApoloListaItem[],
    revisao: [] as CadApoloListaItem[],
  };

  // Estágios do funil que vêm do Apolo (crédito, revisão, pré-venda, credenciado) OU já pago (pago
  // sem estar em 'credenciado' também conta como pagamento). Uma consulta só; separa por etapa embaixo.
  const { data, error } = await client
    .from("apolo_esteira")
    .select("entity_id, etapa, imobiliaria, chegou_em, pago_em")
    .ilike("empreendimento", `%${alvo}%`)
    .or(
      "etapa.eq.credito,etapa.eq.revisao,etapa.eq.prevenda,etapa.eq.credenciado,pago_em.not.is.null",
    );

  if (error || !data) return vazio;

  const linhas = data as Array<{
    chegou_em: string | null;
    entity_id: string;
    etapa: string | null;
    imobiliaria: string | null;
    pago_em: string | null;
  }>;

  // Nome do cliente vem de apolo_entities (a esteira guarda só o entity_id).
  const ids = [...new Set(linhas.map((l) => l.entity_id))];
  const nomePorId = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data: ents } = await client
      .from("apolo_entities")
      .select("id, display_name, legal_name")
      .in("id", ids.slice(i, i + 300));
    for (const e of (ents ?? []) as Array<{
      display_name: string | null;
      id: string;
      legal_name: string | null;
    }>) {
      nomePorId.set(e.id, (e.legal_name || e.display_name || "").trim() || "Sem nome");
    }
  }

  const credenciados: CadApoloListaItem[] = [];
  const credito: CadApoloListaItem[] = [];
  const pagos: CadApoloListaItem[] = [];
  const prevenda: CadApoloListaItem[] = [];
  const revisao: CadApoloListaItem[] = [];
  for (const l of linhas) {
    const cliente = nomePorId.get(l.entity_id) ?? "Sem nome";
    // Estágios do meio do funil: data = quando a CAD chegou àquela etapa (chegou_em).
    if (l.etapa === "credito") {
      credito.push({ cliente, data: l.chegou_em, imobiliaria: l.imobiliaria });
    }
    if (l.etapa === "revisao") {
      revisao.push({ cliente, data: l.chegou_em, imobiliaria: l.imobiliaria });
    }
    if (l.etapa === "prevenda") {
      prevenda.push({ cliente, data: l.chegou_em, imobiliaria: l.imobiliaria });
    }
    if (l.etapa === "credenciado") {
      credenciados.push({ cliente, data: l.chegou_em, imobiliaria: l.imobiliaria });
    }
    if (l.pago_em) {
      pagos.push({ cliente, data: l.pago_em, imobiliaria: l.imobiliaria });
    }
  }

  // Pagos primeiro os mais recentes; as demais por chegada da CAD (mais antigos primeiro).
  pagos.sort((a, b) => (b.data ?? "").localeCompare(a.data ?? ""));
  const porChegada = (a: CadApoloListaItem, b: CadApoloListaItem) =>
    (a.data ?? "").localeCompare(b.data ?? "");
  credito.sort(porChegada);
  revisao.sort(porChegada);
  prevenda.sort(porChegada);
  credenciados.sort(porChegada);

  return { credenciados, credito, pagos, prevenda, revisao };
}
