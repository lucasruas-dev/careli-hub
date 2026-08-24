// OS RELATÓRIOS DO LANÇAMENTO (Lucas, 24/08) — herdeiros dos BIs do Vale do Ouro, agora POR
// EVENTO e para qualquer lançamento:
//
//   · COMERCIAL — vendas e estoque para o loteador/gestão: situação real das unidades (a AR
//     aberta do C2X manda; reservas vivas do Panteon somam por cima), VGV e o funil do evento.
//   · PERFORMANCE — a régua do backoffice: entrada por hora, onde a fila está agora, tempo em
//     cada etapa (mediana/p90) e o trabalho das mesas.
//
// Padrão visual APROVADO pelo Lucas (02/08, ele rejeitou dark e logo SVG): fundo claro
// #f6f4ef, dourado #A07C3B, terracota #B5451B, wordmark em texto. Página estática com refresh
// de 60s — mesma pegada do BI público (1 consulta/min pela CDN, independente de espectadores).
import type { RowDataPacket } from "mysql2";

import { getHadesDbPool } from "@/lib/guardian/db";

import type { createPrometeuClient } from "./data";
import { rotuloDoLancamento } from "./lancamento";
import type { PrometeuEvento } from "./types";

type AdminClient = NonNullable<ReturnType<typeof createPrometeuClient>>;

const dinheiro = (valor: number): string =>
  valor.toLocaleString("pt-BR", { currency: "BRL", maximumFractionDigits: 0, style: "currency" });

function esc(valor: null | string | undefined): string {
  return (valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── COMERCIAL ───────────────────────────────────────────────────────────────

export type RelatorioComercial = {
  disponiveis: number;
  funil: { finalizadas: number; propostas: number; reservas: number };
  porQuadra: { disponiveis: number; quadra: string; reservados: number; total: number; vendidos: number }[];
  reservados: number;
  total: number;
  vendidos: number;
  vgvReservado: number;
  vgvVendido: number;
};

// As etapas que CONTAM como venda (mesma régua de reservas-c2x.ts: Reservado e Proposta ainda
// voltam para a prateleira; contrato em diante não).
const ETAPAS_DE_VENDA = ["Contrato gerado", "Em assinatura", "Faturado", "Finalizado"];

export async function dadosComerciais(
  client: AdminClient,
  evento: PrometeuEvento,
): Promise<null | RelatorioComercial> {
  const enterpriseId = Number(evento.enterpriseId);
  if (!Number.isFinite(enterpriseId) || enterpriseId <= 0) return null;

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) return null;

  // Situação REAL por unidade: a AR aberta manda (venda > reservado); sem AR, vale o cadastro.
  const [rows] = await poolResult.pool.query<RowDataPacket[]>(
    `SELECT eu.block AS quadra, eu.price,
            CASE
              WHEN EXISTS (
                SELECT 1 FROM acquisition_requests ar
                  JOIN acquisition_request_stages s ON s.id = ar.acquisition_request_stage_id
                 WHERE ar.enterprise_unity_id = eu.id AND ar.open = 1 AND s.name IN (?)
              ) THEN 'vendido'
              WHEN EXISTS (
                SELECT 1 FROM acquisition_requests ar
                 WHERE ar.enterprise_unity_id = eu.id AND ar.open = 1
              ) THEN 'reservado'
              WHEN eu.sale_status_id = 1 AND COALESCE(eu.sale_blocked, 0) = 0 THEN 'disponivel'
              ELSE 'indisponivel'
            END AS situacao,
            eu.name AS codigo
       FROM enterprise_unities eu
      WHERE eu.enterprise_id = ?`,
    [ETAPAS_DE_VENDA, enterpriseId],
  );

  // Reservas vivas do PANTEON entram por cima do que ainda está "disponível" no C2X — o telão
  // e o relatório não podem mostrar como livre o lote que acabou de sair no touch.
  const { data: vivas } = await client
    .from("prometeu_reservas")
    .select("codigo")
    .eq("evento_id", evento.id)
    .eq("situacao", "reservada");
  const reservadosAqui = new Set(
    ((vivas ?? []) as { codigo: string }[]).map((r) => r.codigo.trim().toUpperCase()),
  );

  const porQuadra = new Map<
    string,
    { disponiveis: number; reservados: number; total: number; vendidos: number }
  >();
  let total = 0;
  let disponiveis = 0;
  let reservados = 0;
  let vendidos = 0;
  let vgvVendido = 0;
  let vgvReservado = 0;

  for (const r of rows as Array<Record<string, unknown>>) {
    const quadra = String(r.quadra ?? "").trim() || "—";
    const preco = Number(r.price ?? 0) || 0;
    let situacao = String(r.situacao ?? "");
    const codigo = String(r.codigo ?? "").trim().toUpperCase();
    if (situacao === "disponivel" && reservadosAqui.has(codigo)) situacao = "reservado";

    total += 1;
    const q = porQuadra.get(quadra) ?? { disponiveis: 0, reservados: 0, total: 0, vendidos: 0 };
    q.total += 1;
    if (situacao === "vendido") {
      vendidos += 1;
      q.vendidos += 1;
      vgvVendido += preco;
    } else if (situacao === "reservado") {
      reservados += 1;
      q.reservados += 1;
      vgvReservado += preco;
    } else if (situacao === "disponivel") {
      disponiveis += 1;
      q.disponiveis += 1;
    }
    porQuadra.set(quadra, q);
  }

  // O funil do evento no Panteon: cupons vivos, propostas lançadas na secretária, concluídos.
  const [reservasRes, concluidosRes] = await Promise.all([
    client
      .from("prometeu_reservas")
      .select("grupo_id, situacao, proposta_lancada_em")
      .eq("evento_id", evento.id),
    client
      .from("prometeu_credenciados")
      .select("id", { count: "exact", head: true })
      .eq("evento_id", evento.id)
      .eq("etapa", "concluido"),
  ]);
  const gruposVivos = new Set<string>();
  const gruposComProposta = new Set<string>();
  for (const linha of (reservasRes.data ?? []) as Array<{
    grupo_id: string;
    proposta_lancada_em: null | string;
    situacao: string;
  }>) {
    if (linha.situacao === "reservada") gruposVivos.add(linha.grupo_id);
    if (linha.proposta_lancada_em) gruposComProposta.add(linha.grupo_id);
  }

  return {
    disponiveis,
    funil: {
      finalizadas: concluidosRes.count ?? 0,
      propostas: gruposComProposta.size,
      reservas: gruposVivos.size,
    },
    porQuadra: [...porQuadra.entries()]
      .map(([quadra, q]) => ({ quadra, ...q }))
      .sort((a, b) => a.quadra.localeCompare(b.quadra, "pt-BR", { numeric: true })),
    reservados,
    total,
    vendidos,
    vgvReservado,
    vgvVendido,
  };
}

// ── PERFORMANCE ─────────────────────────────────────────────────────────────

export type RelatorioPerformance = {
  checkinsPorHora: { hora: string; quantidade: number }[];
  chamadas: { atendidas: number; total: number };
  credenciados: number;
  emEvento: number;
  encerrados: number;
  porEtapa: { etapa: string; quantidade: number }[];
  tempos: { etapa: string; mediana: number; p90: number }[];
};

const minutos = (ms: number): number => Math.round(ms / 60_000);

function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const ordenado = [...valores].sort((a, b) => a - b);
  const indice = Math.min(ordenado.length - 1, Math.floor((p / 100) * ordenado.length));
  return ordenado[indice] ?? 0;
}

const ETAPA_ROTULO: Record<string, string> = {
  concluido: "Concluído",
  recepcao: "Recepção",
  salao: "Salão",
  secretaria: "Secretária",
};

export async function dadosPerformance(
  client: AdminClient,
  evento: PrometeuEvento,
): Promise<RelatorioPerformance> {
  const [credRes, chamRes] = await Promise.all([
    client
      .from("prometeu_credenciados")
      .select("id, etapa, entrou_em, encerrado_em")
      .eq("evento_id", evento.id),
    client
      .from("prometeu_chamadas")
      .select("id, atendido_em")
      .eq("evento_id", evento.id),
  ]);

  const credenciados = (credRes.data ?? []) as Array<{
    encerrado_em: null | string;
    entrou_em: null | string;
    etapa: string;
    id: string;
  }>;
  const ids = new Set(credenciados.map((c) => c.id));

  // `prometeu_movimentacoes` NÃO tem evento_id: o recorte é pelos credenciados do evento —
  // em LOTES de 100 (o `.in()` do PostgREST estoura a URL com listas grandes).
  const listaIds = [...ids];
  const movimentacoes: Array<{
    credenciado_id: string;
    de_etapa: null | string;
    em: string;
    para_etapa: string;
  }> = [];
  for (let inicio = 0; inicio < listaIds.length; inicio += 100) {
    const { data } = await client
      .from("prometeu_movimentacoes")
      .select("credenciado_id, de_etapa, para_etapa, em")
      .in("credenciado_id", listaIds.slice(inicio, inicio + 100))
      .order("em", { ascending: true })
      .limit(5_000);
    movimentacoes.push(
      ...((data ?? []) as Array<{
        credenciado_id: string;
        de_etapa: null | string;
        em: string;
        para_etapa: string;
      }>),
    );
  }
  const movRes = { data: movimentacoes };

  // Entrada por hora (check-ins): a onda da fila.
  const porHora = new Map<string, number>();
  for (const c of credenciados) {
    if (!c.entrou_em) continue;
    const hora = new Date(c.entrou_em).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      timeZone: "America/Sao_Paulo",
    });
    porHora.set(hora, (porHora.get(hora) ?? 0) + 1);
  }

  // Onde a fila está AGORA.
  const porEtapa = new Map<string, number>();
  for (const c of credenciados) {
    if (c.encerrado_em) continue;
    porEtapa.set(c.etapa, (porEtapa.get(c.etapa) ?? 0) + 1);
  }

  // Tempo em cada etapa: da movimentação que ENTROU na etapa até a próxima do mesmo credenciado.
  const movimentos = ((movRes.data ?? []) as Array<{
    credenciado_id: string;
    de_etapa: null | string;
    em: string;
    para_etapa: string;
  }>).filter((m) => ids.has(m.credenciado_id));
  const porCredenciado = new Map<string, { em: number; para: string }[]>();
  for (const m of movimentos) {
    const lista = porCredenciado.get(m.credenciado_id) ?? [];
    lista.push({ em: new Date(m.em).getTime(), para: m.para_etapa });
    porCredenciado.set(m.credenciado_id, lista);
  }
  const duracoes = new Map<string, number[]>();
  for (const lista of porCredenciado.values()) {
    for (let i = 0; i < lista.length - 1; i += 1) {
      const atual = lista[i]!;
      const proxima = lista[i + 1]!;
      const duracao = proxima.em - atual.em;
      if (duracao <= 0) continue;
      const chave = atual.para;
      const valores = duracoes.get(chave) ?? [];
      valores.push(duracao);
      duracoes.set(chave, valores);
    }
  }

  const chamadas = (chamRes.data ?? []) as Array<{ atendido_em: null | string; id: string }>;

  return {
    chamadas: {
      atendidas: chamadas.filter((c) => c.atendido_em).length,
      total: chamadas.length,
    },
    checkinsPorHora: [...porHora.entries()]
      .map(([hora, quantidade]) => ({ hora, quantidade }))
      .sort((a, b) => a.hora.localeCompare(b.hora)),
    credenciados: credenciados.length,
    emEvento: credenciados.filter((c) => c.entrou_em && !c.encerrado_em).length,
    encerrados: credenciados.filter((c) => c.encerrado_em).length,
    porEtapa: [...porEtapa.entries()]
      .map(([etapa, quantidade]) => ({ etapa: ETAPA_ROTULO[etapa] ?? etapa, quantidade }))
      .sort((a, b) => b.quantidade - a.quantidade),
    tempos: [...duracoes.entries()]
      .map(([etapa, valores]) => ({
        etapa: ETAPA_ROTULO[etapa] ?? etapa,
        mediana: minutos(percentil(valores, 50)),
        p90: minutos(percentil(valores, 90)),
      }))
      .filter((t) => t.mediana > 0)
      .sort((a, b) => b.mediana - a.mediana),
  };
}

// ── RENDER ──────────────────────────────────────────────────────────────────

const CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #f6f4ef; color: #262523; font-family: "Segoe UI", system-ui, sans-serif; padding: 28px 20px 48px; }
  .wrap { max-width: 880px; margin: 0 auto; }
  .marca { font-size: 13px; letter-spacing: 0.32em; color: #A07C3B; font-weight: 700; }
  h1 { font-size: 26px; margin-top: 6px; }
  .sub { color: #6b675f; font-size: 13px; margin-top: 3px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-top: 22px; }
  .card { background: #fff; border: 1px solid #e5e0d5; border-radius: 12px; padding: 16px; }
  .card b { display: block; font-size: 30px; font-variant-numeric: tabular-nums; }
  .card span { font-size: 12px; color: #6b675f; }
  .card.destaque b { color: #B5451B; }
  h2 { font-size: 14px; letter-spacing: 0.12em; text-transform: uppercase; color: #A07C3B; margin: 30px 0 10px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e0d5; border-radius: 12px; overflow: hidden; font-size: 14px; }
  th { text-align: left; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #6b675f; padding: 10px 14px; border-bottom: 1px solid #e5e0d5; }
  td { padding: 9px 14px; border-bottom: 1px solid #f0ece3; font-variant-numeric: tabular-nums; }
  tr:last-child td { border-bottom: 0; }
  .num { text-align: right; }
  .barra { height: 9px; border-radius: 6px; background: #eee7d9; overflow: hidden; }
  .barra i { display: block; height: 100%; background: #A07C3B; }
  .rodape { margin-top: 34px; font-size: 11px; color: #9a958a; text-align: center; }
`;

function pagina(titulo: string, sub: string, corpo: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>${esc(titulo)}</title><style>${CSS}</style></head>
<body><div class="wrap">
  <div class="marca">PANTEON</div>
  <h1>${esc(titulo)}</h1>
  <div class="sub">${esc(sub)}</div>
  ${corpo}
  <div class="rodape">Atualiza sozinho a cada minuto · gerado pelo Panteon</div>
</div></body></html>`;
}

export function renderComercial(
  evento: PrometeuEvento,
  dados: RelatorioComercial,
): string {
  const linhas = dados.porQuadra
    .map((q) => {
      const pct = q.total ? Math.round(((q.vendidos + q.reservados) / q.total) * 100) : 0;
      return `<tr><td><b>${esc(q.quadra)}</b></td><td class="num">${q.total}</td><td class="num">${q.disponiveis}</td><td class="num">${q.reservados}</td><td class="num">${q.vendidos}</td><td style="width:30%"><div class="barra"><i style="width:${pct}%"></i></div></td></tr>`;
    })
    .join("");

  const corpo = `
  <div class="cards">
    <div class="card destaque"><b>${dados.vendidos}</b><span>Vendidos · ${esc(dinheiro(dados.vgvVendido))}</span></div>
    <div class="card"><b>${dados.reservados}</b><span>Reservados · ${esc(dinheiro(dados.vgvReservado))}</span></div>
    <div class="card"><b>${dados.disponiveis}</b><span>Disponíveis</span></div>
    <div class="card"><b>${dados.total}</b><span>Unidades no total</span></div>
  </div>
  <h2>Funil do lançamento</h2>
  <div class="cards">
    <div class="card"><b>${dados.funil.reservas}</b><span>Reservas</span></div>
    <div class="card"><b>${dados.funil.propostas}</b><span>Propostas</span></div>
    <div class="card destaque"><b>${dados.funil.finalizadas}</b><span>Finalizadas</span></div>
  </div>
  <h2>Por quadra</h2>
  <table><tr><th>Quadra</th><th class="num">Total</th><th class="num">Disp.</th><th class="num">Reserv.</th><th class="num">Vend.</th><th>Comercializado</th></tr>${linhas}</table>`;

  return pagina(rotuloDoLancamento(evento), "Relatório comercial · vendas e estoque", corpo);
}

export function renderPerformance(
  evento: PrometeuEvento,
  dados: RelatorioPerformance,
): string {
  const maxHora = Math.max(1, ...dados.checkinsPorHora.map((h) => h.quantidade));
  const onda = dados.checkinsPorHora
    .map(
      (h) =>
        `<tr><td>${esc(h.hora)}h</td><td class="num">${h.quantidade}</td><td style="width:55%"><div class="barra"><i style="width:${Math.round((h.quantidade / maxHora) * 100)}%"></i></div></td></tr>`,
    )
    .join("");
  const etapas = dados.porEtapa
    .map((e) => `<tr><td>${esc(e.etapa)}</td><td class="num">${e.quantidade}</td></tr>`)
    .join("");
  const tempos = dados.tempos
    .map(
      (t) =>
        `<tr><td>${esc(t.etapa)}</td><td class="num">${t.mediana} min</td><td class="num">${t.p90} min</td></tr>`,
    )
    .join("");

  const corpo = `
  <div class="cards">
    <div class="card"><b>${dados.credenciados}</b><span>Credenciados</span></div>
    <div class="card destaque"><b>${dados.emEvento}</b><span>No evento agora</span></div>
    <div class="card"><b>${dados.encerrados}</b><span>Saíram / no-show</span></div>
    <div class="card"><b>${dados.chamadas.atendidas}/${dados.chamadas.total}</b><span>Chamadas atendidas</span></div>
  </div>
  <h2>Onde a fila está agora</h2>
  <table><tr><th>Etapa</th><th class="num">Pessoas</th></tr>${etapas || `<tr><td colspan="2">Sem gente em fluxo.</td></tr>`}</table>
  <h2>Tempo em cada etapa</h2>
  <table><tr><th>Etapa</th><th class="num">Mediana</th><th class="num">P90</th></tr>${tempos || `<tr><td colspan="3">Ainda sem movimentações suficientes.</td></tr>`}</table>
  <h2>Entrada por hora</h2>
  <table><tr><th>Hora</th><th class="num">Check-ins</th><th></th></tr>${onda || `<tr><td colspan="3">Sem check-ins ainda.</td></tr>`}</table>`;

  return pagina(
    rotuloDoLancamento(evento),
    "Relatório de performance · fila e atendimento",
    corpo,
  );
}
