// OS RELATÓRIOS DO LANÇAMENTO (Lucas, 24/08) — no PADRÃO dos entregáveis do Vale do Ouro
// (public/bi/vale-do-ouro-voc.html e fechamento-01-08.html), que o Lucas fixou como o padrão:
//
//   · COMERCIAL — o BI de vendas completo: placar, mapa do estoque, filme do dia, pós-venda,
//     ranking de imobiliárias, planos, entrada parcelada, investidores e perfil do comprador.
//     Motor REUSADO de bi-vale-do-ouro.ts (generalizado por enterpriseId) — payload idêntico.
//   · PERFORMANCE — o fechamento do atendimento AO VIVO: placar, régua da jornada
//     (mediana/média/P90 por etapa), funil, entrada por hora e chamadas de mesa. Motor local
//     (prometeu_credenciados/movimentacoes/chamadas).
//
// SÓ AS CORES mudaram do padrão (Lucas: "só as cores pode alterar, coloca no claro e escuro"):
// as páginas têm os DOIS temas — claro (o original) e escuro (grafite+dourado Panteon), por
// prefers-color-scheme. As páginas são vivas: poll de 60s na própria rota (?formato=json).
import type { createPrometeuClient } from "./data";
import { rotuloDoLancamento } from "./lancamento";
import type { PrometeuEvento } from "./types";

type AdminClient = NonNullable<ReturnType<typeof createPrometeuClient>>;

function esc(valor: null | string | undefined): string {
  return (valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── PERFORMANCE: o payload ──────────────────────────────────────────────────

export type PayloadPerformance = {
  chamadas: { atendidas: number; medianaMin: number; total: number };
  checkins: { melhorQuartoDeHora: number; porHora: { hora: string; qtd: number }[]; total: number };
  concluidos: number;
  emEvento: number;
  encerrados: number;
  etapas: { etapa: string; media: number; mediana: number; p90: number; qtd: number }[];
  funil: { etapa: string; qtd: number }[];
  geradoEm: string;
  jornadaTipicaMin: number;
  porEtapaAgora: { etapa: string; qtd: number }[];
};

const minutos = (ms: number): number => Math.round(ms / 60_000);

function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const ordenado = [...valores].sort((a, b) => a - b);
  const indice = Math.min(ordenado.length - 1, Math.floor((p / 100) * ordenado.length));
  return ordenado[indice] ?? 0;
}

const media = (valores: number[]): number =>
  valores.length ? valores.reduce((s, v) => s + v, 0) / valores.length : 0;

const ETAPA_ROTULO: Record<string, string> = {
  concluido: "Concluído",
  recepcao: "Recepção",
  salao: "Salão de vendas",
  secretaria: "Secretária",
};
const ORDEM_FUNIL = ["recepcao", "salao", "secretaria", "concluido"];

export async function payloadPerformance(
  client: AdminClient,
  evento: PrometeuEvento,
): Promise<PayloadPerformance> {
  const [credRes, chamRes] = await Promise.all([
    client
      .from("prometeu_credenciados")
      .select("id, etapa, entrou_em, encerrado_em")
      .eq("evento_id", evento.id),
    client
      .from("prometeu_chamadas")
      .select("id, chamado_em, atendido_em")
      .eq("evento_id", evento.id),
  ]);

  const credenciados = (credRes.data ?? []) as Array<{
    encerrado_em: null | string;
    entrou_em: null | string;
    etapa: string;
    id: string;
  }>;
  const ids = [...new Set(credenciados.map((c) => c.id))];

  // Movimentações do evento — a tabela não tem evento_id: recorte pelos credenciados, em
  // lotes de 100 (regra do .in() do PostgREST).
  const movimentos: Array<{ credenciado_id: string; em: string; para_etapa: string }> = [];
  for (let inicio = 0; inicio < ids.length; inicio += 100) {
    const { data } = await client
      .from("prometeu_movimentacoes")
      .select("credenciado_id, para_etapa, em")
      .in("credenciado_id", ids.slice(inicio, inicio + 100))
      .order("em", { ascending: true })
      .limit(5_000);
    movimentos.push(
      ...((data ?? []) as Array<{ credenciado_id: string; em: string; para_etapa: string }>),
    );
  }

  // Check-ins por hora e o melhor quarto de hora.
  const porHora = new Map<string, number>();
  const porQuarto = new Map<string, number>();
  for (const c of credenciados) {
    if (!c.entrou_em) continue;
    const d = new Date(c.entrou_em);
    const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", timeZone: "America/Sao_Paulo" });
    porHora.set(hora, (porHora.get(hora) ?? 0) + 1);
    const minuto = Number(
      d.toLocaleTimeString("pt-BR", { minute: "2-digit", timeZone: "America/Sao_Paulo" }),
    );
    const quarto = `${hora}:${String(Math.floor(minuto / 15) * 15).padStart(2, "0")}`;
    porQuarto.set(quarto, (porQuarto.get(quarto) ?? 0) + 1);
  }

  // Onde a fila está agora.
  const porEtapaAgora = new Map<string, number>();
  for (const c of credenciados) {
    if (c.encerrado_em) continue;
    porEtapaAgora.set(c.etapa, (porEtapaAgora.get(c.etapa) ?? 0) + 1);
  }

  // Tempos por etapa + funil (quantos ENTRARAM em cada etapa) + jornada típica.
  const porCredenciado = new Map<string, { em: number; para: string }[]>();
  for (const m of movimentos) {
    const lista = porCredenciado.get(m.credenciado_id) ?? [];
    lista.push({ em: new Date(m.em).getTime(), para: m.para_etapa });
    porCredenciado.set(m.credenciado_id, lista);
  }
  const duracoes = new Map<string, number[]>();
  const passaramPor = new Map<string, Set<string>>();
  const jornadas: number[] = [];
  const entrouEmPorId = new Map(
    credenciados.filter((c) => c.entrou_em).map((c) => [c.id, new Date(c.entrou_em!).getTime()]),
  );
  for (const [credId, lista] of porCredenciado) {
    for (let i = 0; i < lista.length; i += 1) {
      const atual = lista[i]!;
      const conjunto = passaramPor.get(atual.para) ?? new Set<string>();
      conjunto.add(credId);
      passaramPor.set(atual.para, conjunto);
      const proxima = lista[i + 1];
      if (proxima && proxima.em > atual.em) {
        const valores = duracoes.get(atual.para) ?? [];
        valores.push(proxima.em - atual.em);
        duracoes.set(atual.para, valores);
      }
      if (atual.para === "concluido") {
        const inicio = entrouEmPorId.get(credId);
        if (inicio && atual.em > inicio) jornadas.push(atual.em - inicio);
      }
    }
  }

  const chamadas = (chamRes.data ?? []) as Array<{
    atendido_em: null | string;
    chamado_em: null | string;
    id: string;
  }>;
  const esperaDaChamada = chamadas
    .filter((c) => c.chamado_em && c.atendido_em)
    .map((c) => new Date(c.atendido_em!).getTime() - new Date(c.chamado_em!).getTime())
    .filter((v) => v > 0);

  return {
    chamadas: {
      atendidas: chamadas.filter((c) => c.atendido_em).length,
      medianaMin: minutos(percentil(esperaDaChamada, 50)),
      total: chamadas.length,
    },
    checkins: {
      melhorQuartoDeHora: Math.max(0, ...porQuarto.values()),
      porHora: [...porHora.entries()]
        .map(([hora, qtd]) => ({ hora, qtd }))
        .sort((a, b) => a.hora.localeCompare(b.hora)),
      total: credenciados.filter((c) => c.entrou_em).length,
    },
    concluidos: credenciados.filter((c) => c.etapa === "concluido").length,
    emEvento: credenciados.filter((c) => c.entrou_em && !c.encerrado_em).length,
    encerrados: credenciados.filter((c) => c.encerrado_em).length,
    etapas: ORDEM_FUNIL.filter((e) => e !== "concluido")
      .map((etapa) => {
        const valores = duracoes.get(etapa) ?? [];
        return {
          etapa: ETAPA_ROTULO[etapa] ?? etapa,
          media: minutos(media(valores)),
          mediana: minutos(percentil(valores, 50)),
          p90: minutos(percentil(valores, 90)),
          qtd: valores.length,
        };
      })
      .filter((t) => t.qtd > 0),
    funil: ORDEM_FUNIL.map((etapa) => ({
      etapa: ETAPA_ROTULO[etapa] ?? etapa,
      qtd:
        etapa === "recepcao"
          ? credenciados.filter((c) => c.entrou_em).length
          : (passaramPor.get(etapa)?.size ?? 0),
    })),
    geradoEm: new Date().toISOString(),
    jornadaTipicaMin: minutos(percentil(jornadas, 50)),
    porEtapaAgora: [...porEtapaAgora.entries()]
      .map(([etapa, qtd]) => ({ etapa: ETAPA_ROTULO[etapa] ?? etapa, qtd }))
      .sort((a, b) => b.qtd - a.qtd),
  };
}

// ── AS PÁGINAS ──────────────────────────────────────────────────────────────
// CSS base do PADRÃO (vale-do-ouro-voc.html), com as cores em VARIÁVEIS e os dois temas:
// claro = o original aprovado; escuro = grafite+dourado do Panteon (prefers-color-scheme).

// PADRÃO PANTEON nos dois temas (Lucas, 24/08: "as cores é padrão panteon... claro e escuro"):
// claro = neutros do hub com grafite e dourado; escuro = grafite com preto (#0a0a0a/#101820)
// e o dourado #cba25a/#A07C3B — a mesma paleta do rail e do telão.
const CSS_BASE = `
  *{box-sizing:border-box;margin:0;padding:0}
  :root{
    --canvas:#f4f4f3; --surface:#ffffff; --linha:#e4e3e0;
    --ink:#1c1c1a; --fraca:#6f6d68;
    --ouro:#a07c3b; --ouro-claro:#c9a45c; --terracota:#8a6a30; --terra-claro:#b08d4e;
    --verde:#4d7c43; --alerta:#b91c1c;
    --chip-bg:#f4efe4; --chip-borda:#dccfb2; --trilho:#ebeae7; --kpi-grad:linear-gradient(165deg,#fdfcf9,#f6f1e6);
    --erow-bg:#fafaf9; --gargalo-bg:#f9efec; --gargalo-borda:#dfb3a6; --tracinho:#e8e7e4;
  }
  @media(prefers-color-scheme:dark){
    :root{
      --canvas:#0a0a0a; --surface:#101820; --linha:#232c36;
      --ink:#e8e6e1; --fraca:#8b8678;
      --ouro:#cba25a; --ouro-claro:#a07c3b; --terracota:#8a6a30; --terra-claro:#b08d4e;
      --verde:#5e9a52; --alerta:#e05252;
      --chip-bg:#1a2029; --chip-borda:#3a4250; --trilho:#1a222b; --kpi-grad:linear-gradient(165deg,#141c25,#101820);
      --erow-bg:#0d141b; --gargalo-bg:#221114; --gargalo-borda:#5e2c2c; --tracinho:#232c36;
    }
  }
  body{background:var(--canvas);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1100px;margin:0 auto;padding:26px 20px 60px}
  .num{font-variant-numeric:tabular-nums}
  header{display:flex;flex-wrap:wrap;align-items:center;gap:18px;padding:6px 0 22px;border-bottom:2px solid var(--linha)}
  .marca-nome .vale{font-size:26px;font-weight:800;letter-spacing:.05em}
  .marca-nome .cidade{font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:var(--fraca);margin-top:2px}
  .hero-right{margin-left:auto;text-align:right}
  .badge-vivo,.badge{display:inline-flex;align-items:center;gap:7px;background:var(--chip-bg);border:1px solid var(--chip-borda);border-radius:99px;padding:5px 12px;font-size:11.5px;font-weight:800;letter-spacing:.07em;color:var(--ouro)}
  .badge-vivo .p{width:8px;height:8px;border-radius:50%;background:var(--verde);box-shadow:0 0 6px var(--verde);animation:pulsa 2s infinite}
  @keyframes pulsa{50%{opacity:.35}}
  @media(prefers-reduced-motion:reduce){.badge-vivo .p{animation:none}}
  .hero-right .quando{color:var(--fraca);font-size:12.5px;margin-top:6px}
  .placar{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin:24px 0 6px}
  .kpi{background:var(--surface);border:1px solid var(--linha);border-radius:14px;padding:18px 20px;box-shadow:0 1px 2px #00000008}
  .kpi.destaque{border-color:var(--chip-borda);background:var(--kpi-grad)}
  .kpi .lb{font-size:11px;letter-spacing:.15em;text-transform:uppercase;color:var(--fraca);font-weight:800}
  .kpi .v{font-size:40px;font-weight:800;line-height:1.15;margin-top:5px;letter-spacing:-.01em}
  .kpi.destaque .v{color:var(--ouro)}
  .kpi .sub{color:var(--fraca);font-size:12.5px;margin-top:3px}
  section{margin-top:30px}
  h2{font-size:19px;font-weight:800;margin-bottom:3px}
  .h-sub{color:var(--fraca);font-size:13px;margin-bottom:12px}
  .card{background:var(--surface);border:1px solid var(--linha);border-radius:14px;padding:18px 20px;box-shadow:0 1px 2px #00000008}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
  @media(max-width:820px){.grid2,.grid3{grid-template-columns:1fr}}
  .estoque{display:flex;height:34px;border-radius:9px;overflow:hidden;border:1px solid var(--linha)}
  .estoque div{display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:#fff;white-space:nowrap;overflow:hidden}
  .leg{display:flex;flex-wrap:wrap;gap:14px;margin-top:10px;font-size:12.5px;color:var(--fraca)}
  .leg b{color:var(--ink)}
  .dot{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px;vertical-align:1px}
  .hrow{display:grid;grid-template-columns:minmax(120px,220px) 1fr 92px;gap:10px;align-items:center;padding:5px 0;font-size:13.5px}
  .hrow .nome{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .hrow .trilho{background:var(--trilho);border-radius:6px;height:15px;overflow:hidden}
  .hrow .fill{height:100%;border-radius:6px;background:linear-gradient(90deg,var(--ouro),var(--ouro-claro))}
  .hrow .val{text-align:right;color:var(--fraca);font-size:12.5px}
  .hrow .val b{color:var(--ink);font-size:13.5px}
  .curva-wrap{overflow-x:auto}
  .curva-svg{width:100%;min-width:520px;display:block}
  .split{display:flex;height:26px;border-radius:8px;overflow:hidden;border:1px solid var(--linha);font-size:12px;font-weight:800}
  .split div{display:flex;align-items:center;justify-content:center;color:#fff;white-space:nowrap;overflow:hidden}
  .mini-lb{font-size:11px;letter-spacing:.13em;text-transform:uppercase;color:var(--fraca);font-weight:800;margin-bottom:8px}
  .kv{display:flex;justify-content:space-between;gap:10px;padding:4.5px 0;font-size:13.5px;border-bottom:1px dashed var(--tracinho)}
  .kv:last-child{border-bottom:0}
  .kv .q{color:var(--fraca)}
  .kv .q b{color:var(--ink)}
  .regua{display:flex;border-radius:10px;overflow:hidden;border:1px solid var(--linha);height:44px;margin:6px 0 14px}
  .regua div{display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:800;line-height:1.25;white-space:nowrap;overflow:hidden}
  .etapas{display:grid;gap:8px}
  .erow{display:grid;grid-template-columns:minmax(120px,190px) 1fr;gap:12px;align-items:center;padding:9px 12px;border:1px solid var(--linha);border-radius:12px;background:var(--erow-bg)}
  .erow.gargalo{border-color:var(--gargalo-borda);background:var(--gargalo-bg)}
  .erow .nome{font-weight:800;font-size:13.5px}
  .erow .nome small{display:block;font-weight:600;color:var(--fraca);font-size:11px}
  .erow .nums{display:flex;gap:18px;flex-wrap:wrap;font-size:13px}
  .erow .nums b{font-size:16px}
  .erow .nums span{color:var(--fraca);font-size:11px;display:block}
  .erow.gargalo .nums b{color:var(--alerta)}
  .fstep{display:grid;grid-template-columns:190px 1fr 120px;gap:12px;align-items:center;margin-top:8px}
  @media(max-width:640px){.fstep{grid-template-columns:120px 1fr 90px}}
  .fstep .rot{font-size:13px;font-weight:700}
  .fstep .trilho{background:var(--trilho);border-radius:8px;height:28px;overflow:hidden}
  .fstep .fill{height:100%;border-radius:8px;background:linear-gradient(90deg,var(--ouro),var(--ouro-claro));display:flex;align-items:center;justify-content:flex-end;padding-right:10px;color:#fff;font-weight:800;font-size:13px}
  .fstep .pct{text-align:right;color:var(--fraca);font-size:12.5px}
  footer{margin-top:40px;padding-top:14px;border-top:2px solid var(--linha);display:flex;flex-wrap:wrap;gap:8px;justify-content:space-between;color:var(--fraca);font-size:12px}
`;

// ── PÁGINA COMERCIAL — a estrutura e o script do padrão, ligados na rota tokenizada ─────────

export function paginaComercial(evento: PrometeuEvento, token: string): string {
  const nome = rotuloDoLancamento(evento);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(nome)} · BI de Vendas</title>
<style>${CSS_BASE}</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="marca-nome">
      <div class="vale">${esc(nome.toUpperCase())}</div>
      <div class="cidade">Relatório comercial · Careli</div>
    </div>
    <div class="hero-right">
      <div class="badge-vivo"><span class="p"></span> AO VIVO</div>
      <div class="quando">BI de Vendas · <span id="carimbo">carregando…</span></div>
    </div>
  </header>

  <div class="placar" id="placar"></div>

  <section>
    <h2>O mapa das <span id="tot-unidades">…</span> unidades postas à venda</h2>
    <div class="h-sub" id="estoque-sub">Situação das unidades neste momento</div>
    <div class="card">
      <div class="estoque" id="estoque"></div>
      <div class="leg" id="estoque-leg"></div>
      <div class="leg" id="estoque-nota"></div>
    </div>
  </section>

  <section>
    <h2>O filme do dia</h2>
    <div class="h-sub">Contratos por hora, hoje</div>
    <div class="card curva-wrap">
      <div id="curva"></div>
      <div class="leg" id="curva-leg"></div>
    </div>
  </section>

  <section>
    <h2>Pós-venda em tempo real</h2>
    <div class="h-sub">Contratos e entrada, direto do C2X</div>
    <div class="grid3" id="posvenda"></div>
  </section>

  <section>
    <h2>Ranking das imobiliárias</h2>
    <div class="h-sub" id="ranking-sub">Vendas e VGV por parceiro</div>
    <div class="card" id="ranking"></div>
  </section>

  <section>
    <div class="grid2">
      <div class="card">
        <h2>Plano comercial</h2>
        <div class="h-sub">Como as vendas foram fechadas</div>
        <div id="planos"></div>
      </div>
      <div class="card">
        <h2>Entrada parcelada</h2>
        <div class="h-sub">Em quantas vezes o sinal foi dividido</div>
        <div id="parcelas"></div>
      </div>
    </div>
  </section>

  <section>
    <h2>Investidores &amp; multi-lote</h2>
    <div class="h-sub" id="inv-sub">A leitura fina da carteira</div>
    <div class="grid3" id="investidores"></div>
  </section>

  <section>
    <h2>Quem é o comprador</h2>
    <div class="h-sub">Perfil dos compradores — cadastro C2X + endereço real</div>
    <div class="grid3" id="perfil"></div>
  </section>

  <footer>
    <span>${esc(nome)} · Careli Empreendimentos</span>
    <span id="rodape">Fonte: C2X ao vivo · Panteon</span>
  </footer>
</div>

<script>
(function(){
  "use strict";
  var API = "/api/publico/prometeu/relatorio?formato=json&t=${token}";
  var $ = function(id){ return document.getElementById(id); };
  var esc = function(s){ var d=document.createElement("div"); d.textContent=String(s==null?"":s); return d.innerHTML; };
  var n = function(v){ return Number(v||0); };
  var pt = function(v){ return n(v).toLocaleString("pt-BR"); };
  var reais = function(v){
    v = n(v);
    if (v >= 1e6) return "R$ " + (v/1e6).toLocaleString("pt-BR",{maximumFractionDigits:2}) + " mi";
    if (v >= 1e3) return "R$ " + Math.round(v/1e3).toLocaleString("pt-BR") + " mil";
    return "R$ " + pt(v);
  };
  var pc = function(parte,todo){ return todo ? Math.round(100*parte/todo) : 0; };

  function totalComercial(d){
    var un = d.unidades||{};
    return n(un.comerciais) || (d.statusUnidades||[]).reduce(function(s,x){return s+n(x.qtd)},0);
  }

  function kpis(d){
    var v = d.vendas||{}, r = d.reservas||{};
    var tot = totalComercial(d);
    var disp = (d.statusUnidades||[]).filter(function(x){return x.status==="Disponível"})[0];
    $("placar").innerHTML =
      '<div class="kpi destaque"><div class="lb">Unidades vendidas</div><div class="v num">'+pt(v.unidades)+'</div><div class="sub">'+pc(n(v.unidades),tot)+'% do que foi posto à venda</div></div>'+
      '<div class="kpi destaque"><div class="lb">VGV vendido</div><div class="v num">'+reais(v.vgv)+'</div><div class="sub">ticket médio '+reais(v.ticket)+'</div></div>'+
      '<div class="kpi"><div class="lb">Reservas ativas</div><div class="v num">'+pt(r.unidades)+'</div><div class="sub">'+reais(r.vgv)+' em negociação</div></div>'+
      '<div class="kpi"><div class="lb">Ainda disponíveis</div><div class="v num">'+pt(disp?disp.qtd:0)+'</div><div class="sub">de '+pt(tot)+' unidades postas à venda</div></div>';
    $("tot-unidades").textContent = pt(tot);
  }

  function estoque(d){
    var ordem = ["Vendido","Em negociação","Reservado","Disponível","Bloqueado para venda"];
    var cores = {"Vendido":"var(--ouro)","Em negociação":"var(--ouro)","Reservado":"var(--terra-claro)","Disponível":"var(--verde)","Bloqueado para venda":"#a49c8b"};
    var rot   = {"Vendido":"vendidas","Em negociação":"vendidas","Reservado":"reservadas","Disponível":"disponíveis","Bloqueado para venda":"bloqueadas"};
    var itens = (d.statusUnidades||[]).slice().sort(function(a,b){return ordem.indexOf(a.status)-ordem.indexOf(b.status)});
    var tot = itens.reduce(function(s,x){return s+n(x.qtd)},0) || 1;
    $("estoque").innerHTML = itens.map(function(x){
      var w = (100*n(x.qtd)/tot).toFixed(1);
      var texto = w > 14 ? pt(x.qtd)+" "+(rot[x.status]||x.status) : (w > 6 ? pt(x.qtd) : "");
      return '<div style="width:'+w+'%;background:'+(cores[x.status]||"#999")+'">'+texto+'</div>';
    }).join("");
    $("estoque-leg").innerHTML = itens.map(function(x){
      return '<span><span class="dot" style="background:'+(cores[x.status]||"#999")+'"></span><b>'+pt(x.qtd)+'</b> '+(rot[x.status]||esc(x.status))+' ('+pc(n(x.qtd),tot)+'%)</span>';
    }).join("");
    var un = d.unidades||{};
    var sub = "Situação das unidades postas à venda";
    if (n(un.naoLancadas) > 0) sub += " · outras "+pt(un.naoLancadas)+" unidades ainda não foram lançadas";
    $("estoque-sub").textContent = sub;
    var co = d.coerencia||{};
    var pend = [];
    if (n(co.carimboSemVenda)) pend.push("<b>"+pt(co.carimboSemVenda)+"</b> lote(s) marcados como vendidos sem proposta ativa");
    if (n(co.vendaSemCarimbo)) pend.push("<b>"+pt(co.vendaSemCarimbo)+"</b> venda(s) ativas em lotes ainda não marcados");
    if (n(co.reservaSemLastro)) pend.push("<b>"+pt(co.reservaSemLastro)+"</b> lote(s) reservados sem proposta de reserva");
    $("estoque-nota").innerHTML = pend.length
      ? '<span>Conferindo com o C2X: '+pend.join(", ")+'. Vale revisar a situação desses lotes no cadastro.</span>' : "";
  }

  function curva(d){
    var hs = d.vendasHoje||[];
    if (!hs.length){ $("curva").innerHTML=""; $("curva-leg").innerHTML="<span>Sem vendas registradas hoje.</span>"; return; }
    var max = Math.max.apply(null, hs.map(function(h){return n(h.qtd)})) || 1;
    var W=720, H=210, x0=46, x1=700, y0=170, alt=150;
    var passo = hs.length>1 ? (x1-x0)/(hs.length-1) : 0;
    var pts = hs.map(function(h,i){ return { x: x0+i*passo, y: y0 - (n(h.qtd)/max)*alt, q:n(h.qtd), hora:(h.hora||"").slice(0,2)+"h" }; });
    var linha = pts.map(function(p,i){ return (i?"L":"M")+p.x.toFixed(1)+" "+p.y.toFixed(1); }).join(" ");
    var melhor = pts.reduce(function(a,b){ return b.q>a.q?b:a; });
    var svg = '<svg class="curva-svg" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet">'
      +'<defs><linearGradient id="ar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a07c3b" stop-opacity=".35"/><stop offset="1" stop-color="#a07c3b" stop-opacity="0"/></linearGradient></defs>'
      +'<line x1="'+x0+'" y1="'+y0+'" x2="'+x1+'" y2="'+y0+'" stroke="#8b867833"/>'
      +'<path d="'+linha+' L'+pts[pts.length-1].x.toFixed(1)+' '+y0+' L'+x0+' '+y0+' Z" fill="url(#ar)"/>'
      +'<path d="'+linha+'" fill="none" stroke="#a07c3b" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>'
      + pts.map(function(p){ return '<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="'+(p===melhor?5.5:4)+'" fill="#a07c3b"'+(p===melhor?' stroke="#fff" stroke-width="2"':'')+'/>'; }).join("")
      + pts.map(function(p){ return '<text x="'+p.x.toFixed(1)+'" y="'+(p.y-10).toFixed(1)+'" text-anchor="middle" font-size="'+(p===melhor?15:12)+'" font-weight="800" fill="'+(p===melhor?'#a07c3b':'currentColor')+'" font-family="system-ui">'+p.q+'</text>'; }).join("")
      + pts.map(function(p){ return '<text x="'+p.x.toFixed(1)+'" y="188" text-anchor="middle" font-size="11" fill="#8b8678" font-family="system-ui">'+esc(p.hora)+'</text>'; }).join("")
      +'</svg>';
    $("curva").innerHTML = svg;
    $("curva-leg").innerHTML = '<span>Pico às <b>'+esc(melhor.hora)+': '+melhor.q+' contratos numa hora</b>.</span>';
  }

  function posvenda(d){
    var v = n((d.vendas||{}).unidades), c = d.contratos||{}, cb = d.cobranca||{};
    $("posvenda").innerHTML =
      '<div class="card"><div class="mini-lb">Contratos</div>'
      +'<div class="kv"><span class="k">Contrato gerado</span><span class="q num"><b>'+pt(c.gerados)+'</b> de '+pt(v)+' · '+pc(n(c.gerados),v)+'%</span></div>'
      +'<div class="kv"><span class="k">Vendas em proposta</span><span class="q num"><b>'+pt(Math.max(0,v-n(c.gerados)))+'</b></span></div></div>'
      +'<div class="card"><div class="mini-lb">Entrada (ato + sinal)</div>'
      +'<div class="kv"><span class="k">Cobrança gerada</span><span class="q num"><b>'+pt(cb.vendas_com_cobranca)+'</b> de '+pt(v)+' vendas</span></div>'
      +'<div class="kv"><span class="k">Total de entrada</span><span class="q num"><b>'+reais(cb.entrada_gerada)+'</b></span></div></div>'
      +'<div class="card"><div class="mini-lb">Caixa</div>'
      +'<div class="kv"><span class="k">Liquidado</span><span class="q num"><b>'+reais(cb.liquidado)+'</b></span></div>'
      +'<div class="kv"><span class="k">A liquidar</span><span class="q num"><b>'+reais(n(cb.entrada_gerada)-n(cb.liquidado))+'</b></span></div></div>';
  }

  function barras(el, itens, campoNome, campoQtd, extra){
    var max = Math.max.apply(null, itens.map(function(i){return n(i[campoQtd])})) || 1;
    el.innerHTML = itens.map(function(i,idx){
      var medalha = el.id==="ranking" ? (idx===0?"🥇 ":idx===1?"🥈 ":idx===2?"🥉 ":"") : "";
      var w = (100*n(i[campoQtd])/max).toFixed(1);
      return '<div class="hrow"><div class="nome">'+medalha+esc(i[campoNome])+'</div>'
        +'<div class="trilho"><div class="fill" style="width:'+w+'%"></div></div>'
        +'<div class="val num"><b>'+pt(i[campoQtd])+'</b>'+(extra?extra(i):"")+'</div></div>';
    }).join("") || '<div class="leg"><span>Sem dados ainda.</span></div>';
  }

  function investidores(d){
    var inv = d.investidores||{};
    var v = n(inv.propostas) || n((d.vendas||{}).unidades);
    var vgv = n(inv.vgv_proposta) || n((d.vendas||{}).vgv);
    $("inv-sub").textContent = pt(v)+" lotes para "+pt(inv.titulares)+" compradores — a leitura fina da carteira";
    $("investidores").innerHTML =
      '<div class="card"><div class="mini-lb">Concentração</div>'
      +'<div class="kv"><span class="k">Compradores titulares</span><span class="q num"><b>'+pt(inv.titulares)+'</b></span></div>'
      +'<div class="kv"><span class="k">Compraram 1 lote</span><span class="q num"><b>'+pt(n(inv.titulares)-n(inv.multi_lote))+'</b></span></div>'
      +'<div class="kv"><span class="k">Compraram 2+ lotes</span><span class="q num"><b>'+pt(inv.multi_lote)+'</b> → '+pt(inv.unidades_multi)+' unidades</span></div></div>'
      +'<div class="card"><div class="mini-lb">Peso dos investidores</div>'
      +'<div class="kv"><span class="k">Das vendas</span><span class="q num"><b>'+pc(n(inv.unidades_multi),v)+'%</b></span></div>'
      +'<div class="kv"><span class="k">Do VGV</span><span class="q num"><b>'+pc(n(inv.vgv_multi),vgv)+'%</b> · '+reais(inv.vgv_multi)+'</span></div></div>'
      +'<div class="card"><div class="mini-lb">Maior comprador</div>'
      +'<div class="kv"><span class="k">Lotes de um só comprador</span><span class="q num"><b>'+pt(inv.maior_lotes)+'</b></span></div></div>';
  }

  function perfil(d){
    var v = n((d.investidores||{}).propostas) || n((d.vendas||{}).unidades) || 1;
    var sx = {}; (d.sexo||[]).forEach(function(s){ sx[s.k]=n(s.qtd); });
    var m = sx["Masculino"]||0, f = sx["Feminino"]||0;
    var linhasKv = function(itens, lim){ return (itens||[]).slice(0,lim).map(function(i){
      return '<div class="kv"><span class="k">'+esc(i.k)+'</span><span class="q num"><b>'+pt(i.qtd)+'</b> · '+pc(n(i.qtd),v)+'%</span></div>'; }).join(""); };
    var ordemIdade = ["Até 24","25 a 34","35 a 44","45 a 54","55+","Não informado"];
    var idades = (d.idades||[]).slice().sort(function(a,b){return ordemIdade.indexOf(a.k)-ordemIdade.indexOf(b.k)});
    $("perfil").innerHTML =
      '<div class="card"><div class="mini-lb">Sexo</div>'
      +'<div class="split"><div style="width:'+pc(m,m+f)+'%;background:var(--ouro)">'+pc(m,m+f)+'% homens</div><div style="width:'+pc(f,m+f)+'%;background:var(--terra-claro)">'+pc(f,m+f)+'% mulheres</div></div>'
      +'<div class="mini-lb" style="margin-top:18px">Idade</div>'+linhasKv(idades,6)+'</div>'
      +'<div class="card"><div class="mini-lb">Estado civil</div>'+linhasKv(d.estadoCivil,4)
      +'<div class="mini-lb" style="margin-top:18px">Renda familiar</div>'+linhasKv(d.faixaSalarial,5)+'</div>'
      +'<div class="card"><div class="mini-lb">Profissões mais comuns</div>'+linhasKv(d.profissoes,6)
      +'<div class="mini-lb" style="margin-top:18px">Onde mora</div>'+linhasKv(d.cidades,5)+'</div>';
  }

  function render(d){
    kpis(d); estoque(d); curva(d); posvenda(d); investidores(d); perfil(d);
    barras($("ranking"), d.rankingImob||[], "imob", "vendas", function(i){ return " · "+reais(i.vgv); });
    $("ranking-sub").textContent = "Vendas e VGV por parceiro — "+pt((d.rankingImob||[]).length)+" imobiliárias pontuaram";
    barras($("planos"), d.planos||[], "plano", "qtd");
    var rotP = function(p){ return n(p.parcelas)<=1 ? "À vista (1×)" : pt(p.parcelas)+"×"; };
    barras($("parcelas"), (d.parcelasEntrada||[]).map(function(p){ return { nome: rotP(p), qtd: p.qtd }; }).sort(function(a,b){return n(b.qtd)-n(a.qtd)}), "nome", "qtd");
    var quando = new Date(d.geradoEm);
    var hhmm = quando.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
    $("carimbo").textContent = "atualizado às "+hhmm+" · direto do C2X";
    $("rodape").textContent = "Fonte: C2X ao vivo · atualizado às "+hhmm+" · Panteon";
  }

  var falhas = 0;
  function carregar(){
    fetch(API, {cache:"no-store"}).then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); })
      .then(function(j){
        if (!j || !j.data) throw new Error("vazio");
        falhas = 0;
        render(j.data);
      })
      .catch(function(){
        falhas++;
        if (falhas >= 3) $("carimbo").textContent = "sem conexão — mostrando o último dado";
      });
  }
  carregar();
  setInterval(carregar, 60000);
})();
</script>
</body>
</html>`;
}

// ── PÁGINA PERFORMANCE — a estrutura do fechamento, AO VIVO ─────────────────

export function paginaPerformance(evento: PrometeuEvento, token: string): string {
  const nome = rotuloDoLancamento(evento);
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(nome)} · Performance do Atendimento</title>
<style>${CSS_BASE}</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="marca-nome">
      <div class="vale">${esc(nome.toUpperCase())}</div>
      <div class="cidade">Performance do atendimento · fila e mesas</div>
    </div>
    <div class="hero-right">
      <div class="badge-vivo"><span class="p"></span> AO VIVO</div>
      <div class="quando">Prometeu · <span id="carimbo">carregando…</span></div>
    </div>
  </header>

  <div class="placar" id="placar"></div>

  <section>
    <h2>A régua da jornada</h2>
    <div class="h-sub">Quanto tempo o cliente passa em cada etapa — mediana, média e o pior caso (10% mais lentos)</div>
    <div class="card">
      <div class="regua" id="regua"></div>
      <div class="etapas" id="etapas"></div>
    </div>
  </section>

  <section>
    <h2>O funil do evento</h2>
    <div class="h-sub">Quantos chegaram a cada etapa</div>
    <div class="card" id="funil"></div>
  </section>

  <section>
    <h2>A onda da fila</h2>
    <div class="h-sub">Check-ins por hora — e onde a casa está agora</div>
    <div class="grid2">
      <div class="card curva-wrap"><div id="curva"></div><div class="leg" id="curva-leg"></div></div>
      <div class="card"><div class="mini-lb">Onde a casa está agora</div><div id="agora"></div></div>
    </div>
  </section>

  <footer>
    <span>${esc(nome)} · Careli Empreendimentos</span>
    <span id="rodape">Fonte: Prometeu (fila, mesas e jornadas) · Panteon</span>
  </footer>
</div>

<script>
(function(){
  "use strict";
  var API = "/api/publico/prometeu/relatorio?formato=json&t=${token}";
  var $ = function(id){ return document.getElementById(id); };
  var esc = function(s){ var d=document.createElement("div"); d.textContent=String(s==null?"":s); return d.innerHTML; };
  var n = function(v){ return Number(v||0); };
  var pt = function(v){ return n(v).toLocaleString("pt-BR"); };
  var pc = function(parte,todo){ return todo ? Math.round(100*parte/todo) : 0; };
  var tempo = function(min){
    min = n(min);
    if (min >= 60) return Math.floor(min/60)+"h"+String(min%60).padStart(2,"0");
    return min+"m";
  };

  function kpis(d){
    var ci = d.checkins||{}, ch = d.chamadas||{};
    $("placar").innerHTML =
      '<div class="kpi destaque"><div class="lb">Check-ins na recepção</div><div class="v num">'+pt(ci.total)+'</div><div class="sub">melhor quarto de hora: '+pt(ci.melhorQuartoDeHora)+' pessoas</div></div>'+
      '<div class="kpi destaque"><div class="lb">Atendimentos concluídos</div><div class="v num">'+pt(d.concluidos)+'</div><div class="sub">'+pc(n(d.concluidos),n(ci.total))+'% de quem fez check-in fechou o fluxo</div></div>'+
      '<div class="kpi"><div class="lb">Jornada típica</div><div class="v num">'+tempo(d.jornadaTipicaMin)+'</div><div class="sub">do check-in à conclusão (mediana)</div></div>'+
      '<div class="kpi"><div class="lb">Chamadas de mesa</div><div class="v num">'+pt(ch.total)+'</div><div class="sub">'+pc(n(ch.atendidas),n(ch.total))+'% resolvidas · '+tempo(ch.medianaMin)+' da chamada até sentar</div></div>';
  }

  function regua(d){
    var etapas = d.etapas||[];
    var soma = etapas.reduce(function(s,e){return s+n(e.mediana)},0) || 1;
    var cores = ["#c9a45c","#8a6a30","#b08d4e","#4d7c43"];
    $("regua").innerHTML = etapas.map(function(e,i){
      var w = Math.max(4,(100*n(e.mediana)/soma));
      return '<div style="width:'+w+'%;background:'+cores[i%cores.length]+'">'+esc(e.etapa.toUpperCase())+' · '+tempo(e.mediana)+'</div>';
    }).join("");
    var pior = etapas.slice().sort(function(a,b){return n(b.mediana)-n(a.mediana)})[0];
    $("etapas").innerHTML = etapas.map(function(e,i){
      var gargalo = pior && e.etapa===pior.etapa && etapas.length>1;
      return '<div class="erow'+(gargalo?' gargalo':'')+'">'
        +'<div class="nome">'+(i+1)+' · '+esc(e.etapa)+(gargalo?'<small>o gargalo do momento</small>':'<small>'+pt(e.qtd)+' passagens medidas</small>')+'</div>'
        +'<div class="nums">'
        +'<div><b class="num">'+tempo(e.mediana)+'</b><span>mediana</span></div>'
        +'<div><b class="num">'+tempo(e.media)+'</b><span>média</span></div>'
        +'<div><b class="num">'+tempo(e.p90)+'</b><span>10% levaram mais que</span></div>'
        +'</div></div>';
    }).join("") || '<div class="leg"><span>Ainda sem movimentações suficientes.</span></div>';
  }

  function funil(d){
    var itens = d.funil||[];
    var max = Math.max.apply(null, itens.map(function(i){return n(i.qtd)})) || 1;
    $("funil").innerHTML = itens.map(function(i){
      var w = Math.max(6,(100*n(i.qtd)/max));
      return '<div class="fstep"><div class="rot">'+esc(i.etapa)+'</div>'
        +'<div class="trilho"><div class="fill" style="width:'+w+'%">'+pt(i.qtd)+'</div></div>'
        +'<div class="pct num">'+pc(n(i.qtd),max)+'%</div></div>';
    }).join("");
  }

  function curva(d){
    var hs = (d.checkins||{}).porHora||[];
    if (!hs.length){ $("curva").innerHTML=""; $("curva-leg").innerHTML="<span>Sem check-ins ainda.</span>"; return; }
    var max = Math.max.apply(null, hs.map(function(h){return n(h.qtd)})) || 1;
    var W=720, H=210, x0=46, x1=700, y0=170, alt=150;
    var passo = hs.length>1 ? (x1-x0)/(hs.length-1) : 0;
    var pts = hs.map(function(h,i){ return { x: x0+i*passo, y: y0 - (n(h.qtd)/max)*alt, q:n(h.qtd), hora:(h.hora||"")+"h" }; });
    var linha = pts.map(function(p,i){ return (i?"L":"M")+p.x.toFixed(1)+" "+p.y.toFixed(1); }).join(" ");
    var melhor = pts.reduce(function(a,b){ return b.q>a.q?b:a; });
    var svg = '<svg class="curva-svg" viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="xMidYMid meet">'
      +'<defs><linearGradient id="ar2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a07c3b" stop-opacity=".35"/><stop offset="1" stop-color="#a07c3b" stop-opacity="0"/></linearGradient></defs>'
      +'<line x1="'+x0+'" y1="'+y0+'" x2="'+x1+'" y2="'+y0+'" stroke="#8b867833"/>'
      +'<path d="'+linha+' L'+pts[pts.length-1].x.toFixed(1)+' '+y0+' L'+x0+' '+y0+' Z" fill="url(#ar2)"/>'
      +'<path d="'+linha+'" fill="none" stroke="#a07c3b" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>'
      + pts.map(function(p){ return '<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="'+(p===melhor?5.5:4)+'" fill="#a07c3b"'+(p===melhor?' stroke="#fff" stroke-width="2"':'')+'/>'; }).join("")
      + pts.map(function(p){ return '<text x="'+p.x.toFixed(1)+'" y="'+(p.y-10).toFixed(1)+'" text-anchor="middle" font-size="'+(p===melhor?15:12)+'" font-weight="800" fill="'+(p===melhor?'#a07c3b':'currentColor')+'" font-family="system-ui">'+p.q+'</text>'; }).join("")
      + pts.map(function(p){ return '<text x="'+p.x.toFixed(1)+'" y="188" text-anchor="middle" font-size="11" fill="#8b8678" font-family="system-ui">'+esc(p.hora)+'</text>'; }).join("")
      +'</svg>';
    $("curva").innerHTML = svg;
    $("curva-leg").innerHTML = '<span>Pico às <b>'+esc(melhor.hora)+': '+melhor.q+' check-ins numa hora</b>.</span>';
  }

  function agora(d){
    var itens = d.porEtapaAgora||[];
    $("agora").innerHTML = itens.map(function(i){
      return '<div class="kv"><span class="k">'+esc(i.etapa)+'</span><span class="q num"><b>'+pt(i.qtd)+'</b></span></div>';
    }).join("") || '<div class="kv"><span class="k">Sem gente em fluxo agora.</span></div>';
  }

  function render(d){
    kpis(d); regua(d); funil(d); curva(d); agora(d);
    var quando = new Date(d.geradoEm);
    var hhmm = quando.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
    $("carimbo").textContent = "atualizado às "+hhmm;
    $("rodape").textContent = "Fonte: Prometeu (fila, mesas e jornadas) · atualizado às "+hhmm+" · Panteon";
  }

  var falhas = 0;
  function carregar(){
    fetch(API, {cache:"no-store"}).then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); })
      .then(function(j){
        if (!j || !j.data) throw new Error("vazio");
        falhas = 0;
        render(j.data);
      })
      .catch(function(){
        falhas++;
        if (falhas >= 3) $("carimbo").textContent = "sem conexão — mostrando o último dado";
      });
  }
  carregar();
  setInterval(carregar, 60000);
})();
</script>
</body>
</html>`;
}
