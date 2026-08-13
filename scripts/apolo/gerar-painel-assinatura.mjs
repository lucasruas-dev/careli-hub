import fs from "node:fs";

const SAIDA = process.argv[2] || ".";
const dados = JSON.parse(fs.readFileSync(`${SAIDA}/painel-dados.json`, "utf8"));

const AGORA = "13/08/2026";

// O <meta charset> vai na frente de tudo, dentro dos primeiros bytes: se o servidor não mandar
// o charset no cabeçalho, o navegador cai em latin-1 e todo acento vira mojibake ("Cecílio"
// virando "CecÃ­lio"). Aconteceu no teste local.
const html = `<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Painel Assinatura · Vale do Ouro</title>

<style>
  /* Painel operacional: escuro por escolha, como o Painel Assinatura do Power BI que ele
     substitui. Tema único e pintado por inteiro, para não herdar o fundo do hospedeiro. */
  :root {
    --fundo:#0b0d10; --caixa:#14171c; --caixa2:#1a1e25; --linha:rgb(255 255 255 / .07);
    --tinta:#eef2f7; --tinta2:#aab4c2; --tinta3:#6f7b8c;
    --ouro:#c8a04e; --ouro-fraco:rgb(200 160 78 / .13);
    --ok:#5fd08a; --ok-fraco:rgb(95 208 138 / .13);
    --espera:#7f8b9c; --espera-fraco:rgb(127 139 156 / .13);
    --tarde:#e5705f; --tarde-fraco:rgb(229 112 95 / .13);
  }
  * { box-sizing:border-box; }
  body {
    background:var(--fundo); color:var(--tinta); margin:0; padding:0 0 60px;
    font-family:ui-sans-serif,system-ui,"Segoe UI",Roboto,sans-serif; font-size:14px; line-height:1.5;
  }
  .painel { margin:0 auto; max-width:1220px; padding:0 18px; }

  /* ── topo ─────────────────────────────────────────────────────────────── */
  .topo {
    align-items:center; border-bottom:1px solid var(--linha); display:flex;
    flex-wrap:wrap; gap:16px; padding:22px 0 18px;
  }
  .marca { align-items:baseline; display:flex; gap:10px; }
  .marca b { font-size:22px; font-weight:800; letter-spacing:-.02em; }
  /* Nome próprio de propósito: a classe .pt dos pontinhos de status tem 7px fixos e
     border-radius, e cortava este caractere pela metade quando as duas se encontravam. */
  .marca .selo { color:var(--ouro); font-size:22px; line-height:1; }
  .titulo { border-left:1px solid var(--linha); padding-left:16px; }
  .titulo h1 { font-size:16px; font-weight:700; letter-spacing:-.01em; margin:0; }
  .titulo p { color:var(--tinta3); font-size:12px; margin:2px 0 0; }

  /* ── filtros ──────────────────────────────────────────────────────────── */
  .filtros { display:flex; flex-wrap:wrap; gap:10px; padding:16px 0 4px; }
  .campo { display:flex; flex-direction:column; gap:5px; }
  .campo label {
    color:var(--tinta3); font-size:10.5px; font-weight:700; letter-spacing:.1em; text-transform:uppercase;
  }
  select, input[type="search"] {
    background:var(--caixa); border:1px solid var(--linha); border-radius:8px; color:var(--tinta);
    font-family:inherit; font-size:13.5px; height:34px; padding:0 10px; min-width:150px;
  }
  select:focus-visible, input:focus-visible, button:focus-visible { outline:2px solid var(--ouro); outline-offset:2px; }
  .limpar {
    align-self:flex-end; background:transparent; border:1px solid var(--linha); border-radius:8px;
    color:var(--tinta2); cursor:pointer; font-family:inherit; font-size:13px; height:34px; padding:0 12px;
  }
  .limpar:hover { background:var(--caixa); color:var(--tinta); }

  /* ── blocos de número ─────────────────────────────────────────────────── */
  .blocos { display:grid; gap:14px; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); padding-top:16px; }
  .bloco { background:var(--caixa); border:1px solid var(--linha); border-radius:14px; overflow:hidden; }
  .bloco > h2 {
    background:var(--ouro-fraco); border-bottom:1px solid var(--linha); color:var(--ouro);
    font-size:11.5px; font-weight:800; letter-spacing:.13em; margin:0; padding:9px 16px; text-transform:uppercase;
  }
  .kpis { display:flex; gap:8px; padding:18px 16px 20px; }
  .kpi { flex:1; text-align:center; }
  .kpi .v {
    display:block; font-size:34px; font-variant-numeric:tabular-nums; font-weight:750;
    letter-spacing:-.035em; line-height:1;
  }
  .kpi .k { color:var(--tinta3); display:block; font-size:11.5px; line-height:1.3; margin-top:7px; }
  .kpi.ok .v { color:var(--ok); } .kpi.espera .v { color:var(--espera); }
  .kpi.tarde .v { color:var(--tarde); } .kpi.pct .v { color:var(--ouro); }

  /* ── seções ───────────────────────────────────────────────────────────── */
  section { padding-top:26px; }
  section > h2 {
    color:var(--tinta3); font-size:11.5px; font-weight:800; letter-spacing:.13em;
    margin:0 0 12px; text-transform:uppercase;
  }
  /* minmax(0,...) e não 1fr: item de grid tem min-width auto, então a tabela interna, que é
     larga e cheia de nowrap, empurrava a coluna e a página inteira ganhava scroll lateral no
     celular. Com o mínimo em zero, quem rola é o .rolo, que é o certo. */
  .duas { display:grid; gap:14px; grid-template-columns:minmax(0,1fr); }
  @media (min-width:900px) { .duas { grid-template-columns:minmax(0,1.1fr) minmax(0,1fr); } }
  .cartao {
    background:var(--caixa); border:1px solid var(--linha); border-radius:14px;
    min-width:0; padding:16px;
  }
  .cartao h3 { font-size:13.5px; font-weight:700; margin:0 0 12px; }

  /* ── barras da fila ───────────────────────────────────────────────────── */
  .degraus { display:flex; flex-direction:column; gap:9px; }
  .degrau { align-items:center; display:grid; gap:10px; grid-template-columns:112px 1fr 62px; }
  .degrau .nome { color:var(--tinta2); font-size:12.5px; line-height:1.2; }
  .degrau .nome i { color:var(--tinta3); display:block; font-size:11px; font-style:normal; }
  .trilho { background:var(--caixa2); border-radius:3px; height:18px; overflow:hidden; }
  .trilho i { background:var(--ok); display:block; height:100%; transition:width .25s; }
  .degrau .pc { color:var(--tinta2); font-size:12.5px; font-variant-numeric:tabular-nums; text-align:right; }

  /* ── tabelas ──────────────────────────────────────────────────────────── */
  .rolo { max-height:520px; overflow:auto; }
  table { border-collapse:collapse; font-size:13px; width:100%; }
  thead th {
    background:var(--caixa); border-bottom:1px solid var(--linha); color:var(--tinta3);
    font-size:10.5px; font-weight:800; letter-spacing:.08em; padding:9px 10px;
    position:sticky; text-align:left; text-transform:uppercase; top:0; white-space:nowrap; z-index:1;
  }
  tbody td { border-bottom:1px solid rgb(255 255 255 / .04); padding:8px 10px; }
  tbody tr:hover td { background:var(--caixa2); }
  td.n, th.n { font-variant-numeric:tabular-nums; text-align:right; white-space:nowrap; }
  td.un { font-variant-numeric:tabular-nums; font-weight:650; white-space:nowrap; }
  .pill { align-items:center; display:inline-flex; font-size:12.5px; gap:6px; white-space:nowrap; }
  .pt { border-radius:50%; height:7px; width:7px; }
  .pt.ok { background:var(--ok); } .pt.espera { background:var(--espera); } .pt.tarde { background:var(--tarde); }
  .txt-ok { color:var(--ok); } .txt-espera { color:var(--espera); } .txt-tarde { color:var(--tarde); }
  .vazio { color:var(--tinta3); padding:26px 10px; text-align:center; }
  .contagem { color:var(--tinta3); font-size:12px; padding-top:8px; }
  .aviso { color:var(--tinta3); font-size:11.5px; line-height:1.45; margin:10px 0 0; }
  #quadro td i, #tabela-compradores td i { color:var(--tinta3); display:block; font-size:11px; font-style:normal; }

  footer { border-top:1px solid var(--linha); color:var(--tinta3); font-size:11.5px; margin-top:32px; padding-top:18px; }
  footer b { color:var(--tinta2); }
</style>

<div class="painel">

  <div class="topo">
    <span class="marca"><b>C2X</b><span class="selo">●</span></span>
    <div class="titulo">
      <h1>Painel Assinatura · Vale do Ouro</h1>
      <p>VOC (Cecílio) e VOL (Lino) · dados do C2X em ${AGORA}</p>
    </div>
  </div>

  <div class="filtros">
    <div class="campo">
      <label for="f-emp">Empreendimento</label>
      <select id="f-emp"><option value="">Todos</option><option>VOC</option><option>VOL</option></select>
    </div>
    <div class="campo">
      <label for="f-perfil">Perfil</label>
      <select id="f-perfil"><option value="">Todos</option></select>
    </div>
    <div class="campo">
      <label for="f-status">Status assinatura</label>
      <select id="f-status">
        <option value="">Todos</option>
        <option value="sim">Assinado</option>
        <option value="nao">Pendente</option>
        <option value="atraso">Pendente e em atraso</option>
      </select>
    </div>
    <div class="campo">
      <label for="f-unidade">Unidade</label>
      <input id="f-unidade" type="search" placeholder="ex.: VOC0104" />
    </div>
    <div class="campo">
      <label for="f-usuario">Usuário</label>
      <input id="f-usuario" type="search" placeholder="nome de quem assina" />
    </div>
    <button class="limpar" id="limpar" type="button">Limpar</button>
  </div>

  <div class="blocos">
    <div class="bloco">
      <h2>Comprador</h2>
      <div class="kpis">
        <div class="kpi ok"><span class="v" id="k-comp-ok">0</span><span class="k">Unidades assinadas</span></div>
        <div class="kpi espera"><span class="v" id="k-comp-pend">0</span><span class="k">Unidades pendentes</span></div>
        <div class="kpi pct"><span class="v" id="k-comp-pct">0%</span><span class="k">Do total</span></div>
      </div>
    </div>
    <div class="bloco">
      <h2>Geral</h2>
      <div class="kpis">
        <div class="kpi"><span class="v" id="k-total">0</span><span class="k">Total de unidades</span></div>
        <div class="kpi ok"><span class="v" id="k-fim">0</span><span class="k">Unidades finalizadas</span></div>
        <div class="kpi pct"><span class="v" id="k-fim-pct">0%</span><span class="k">Do total</span></div>
      </div>
    </div>
    <div class="bloco">
      <h2>Prazo do comprador · 7 dias</h2>
      <div class="kpis">
        <div class="kpi tarde"><span class="v" id="k-atraso">0</span><span class="k">Em atraso</span></div>
        <div class="kpi"><span class="v" id="k-dias">0</span><span class="k">Dias médios até assinar</span></div>
        <div class="kpi"><span class="v" id="k-envio">0</span><span class="k">Dias médios desde o envio</span></div>
      </div>
    </div>
  </div>

  <section>
    <div class="duas">
      <div class="cartao">
        <h3>A fila, degrau a degrau</h3>
        <div class="degraus" id="fila"></div>
      </div>
      <div class="cartao">
        <h3>Quadro de assinaturas · incorporador e Careli</h3>
        <div class="rolo" style="max-height:330px">
          <table>
            <thead><tr><th>Usuário</th><th>Perfil</th><th class="n">Assinado</th><th class="n">Assinar</th></tr></thead>
            <tbody id="quadro"></tbody>
          </table>
        </div>
        <p class="aviso" id="fixos-fora"></p>
      </div>
    </div>
  </section>

  <section>
    <h2>Unidades com o comprador assinado</h2>
    <div class="cartao" style="padding:0">
      <div class="rolo" style="max-height:420px">
        <table>
          <thead><tr>
            <th>Unidade</th><th>Comprador</th><th class="n">Assinou em</th>
            <th class="n">Dias</th><th>Agora espera</th>
          </tr></thead>
          <tbody id="tabela-compradores"></tbody>
        </table>
      </div>
    </div>
    <p class="contagem" id="contagem-compradores"></p>
  </section>

  <section>
    <h2>Assinaturas</h2>
    <div class="cartao" style="padding:0">
      <div class="rolo">
        <table>
          <thead><tr>
            <th>Unidade</th><th>Envio</th><th>Usuário</th><th>Perfil</th>
            <th class="n">Degrau</th><th>Status</th><th class="n">Assinatura</th>
          </tr></thead>
          <tbody id="tabela"></tbody>
        </table>
      </div>
    </div>
    <p class="contagem" id="contagem"></p>
  </section>

  <footer>
    Fonte: C2X, leitura em ${AGORA}, somente leitura. Segue as regras do modelo do Power BI:
    contrato enviado para assinatura e não cancelado; <b>Comprador</b> é o perfil Cliente do C2X;
    quem tem e-mail <b>@careli.adm.br</b> aparece como Backoffice; o prazo do comprador é de
    <b>7 dias</b>. Unidades finalizadas conta quem tem <b>todas</b> as assinaturas dadas.
  </footer>
</div>

<script type="application/json" id="dados">${JSON.stringify(dados)}</script>
<script>
(function () {
  const D = JSON.parse(document.getElementById("dados").textContent);
  const $ = (id) => document.getElementById(id);
  const filtros = { emp: $("f-emp"), perfil: $("f-perfil"), status: $("f-status"),
                    unidade: $("f-unidade"), usuario: $("f-usuario") };

  // O seletor de perfil nasce dos dados, na ordem em que mais aparecem.
  const contaPerfil = {};
  for (const d of D) contaPerfil[d.pf] = (contaPerfil[d.pf] || 0) + 1;
  for (const p of Object.keys(contaPerfil).sort((a, b) => contaPerfil[b] - contaPerfil[a])) {
    const o = document.createElement("option");
    o.textContent = p; filtros.perfil.appendChild(o);
  }

  // Os degraus da fila, com o rótulo do que cada posição costuma ser.
  const NOMES_DEGRAU = {
    1: "Corretor / imobiliária", 2: "Comprador e cônjuge", 3: "Testemunhas",
    4: "Vendedor", 5: "Sócios e testemunha", 6: "Anuentes", 7: "Careli", 8: "Careli",
  };

  const semAcento = (s) => String(s || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();

  function aplica() {
    const fe = filtros.emp.value, fp = filtros.perfil.value, fs = filtros.status.value;
    const fu = semAcento(filtros.unidade.value.trim());
    const fn = semAcento(filtros.usuario.value.trim());
    return D.filter((d) => {
      if (fe && d.emp !== fe) return false;
      if (fp && d.pf !== fp) return false;
      if (fs === "sim" && !d.as) return false;
      if (fs === "nao" && d.as) return false;
      if (fs === "atraso" && d.pz !== "Pendente e em atraso") return false;
      if (fu && !semAcento(d.un).includes(fu)) return false;
      if (fn && !semAcento(d.us).includes(fn)) return false;
      return true;
    });
  }

  const num = (n) => n.toLocaleString("pt-BR");
  const pct = (a, b) => (b ? Math.round((100 * a) / b) + "%" : "—");

  function desenha() {
    const F = aplica();

    // ⚠️ Os cards NÃO seguem o filtro de perfil nem o de status: eles falam de UNIDADE, e
    // filtrar por perfil dentro deles esconderia justamente a assinatura que falta. É a mesma
    // decisão do REMOVEFILTERS(Perfil) do modelo original.
    const fe = filtros.emp.value;
    const fu = semAcento(filtros.unidade.value.trim());
    const fn = semAcento(filtros.usuario.value.trim());
    const baseUn = D.filter((d) => (!fe || d.emp === fe) && (!fu || semAcento(d.un).includes(fu)));

    const porUn = new Map();
    for (const d of baseUn) {
      if (!porUn.has(d.un)) porUn.set(d.un, []);
      porUn.get(d.un).push(d);
    }
    const unidades = [...porUn.values()];
    const total = unidades.length;
    const compOk = unidades.filter((ls) => {
      const c = ls.filter((x) => x.pf === "Comprador");
      return c.length > 0 && c.every((x) => x.as);
    }).length;
    const compPend = unidades.filter((ls) =>
      ls.some((x) => x.pf === "Comprador" && !x.as)).length;
    const finalizadas = unidades.filter((ls) => ls.every((x) => x.as)).length;

    $("k-comp-ok").textContent = num(compOk);
    $("k-comp-pend").textContent = num(compPend);
    $("k-comp-pct").textContent = pct(compOk, total);
    $("k-total").textContent = num(total);
    $("k-fim").textContent = num(finalizadas);
    $("k-fim-pct").textContent = pct(finalizadas, total);

    const compradores = baseUn.filter((d) => d.pf === "Comprador");
    const atrasados = compradores.filter((d) => d.pz === "Pendente e em atraso").length;
    const assinados = compradores.filter((d) => d.as && d.da);
    const diasAssinar = assinados.length
      ? assinados.reduce((s, d) => s + Math.max(0, Math.round((new Date(d.da) - new Date(d.env)) / 86400000)), 0) / assinados.length
      : 0;
    const envios = new Map();
    for (const d of baseUn) envios.set(d.ct, d.du);
    const diasEnvio = envios.size ? [...envios.values()].reduce((a, b) => a + b, 0) / envios.size : 0;
    $("k-atraso").textContent = num(atrasados);
    $("k-dias").textContent = diasAssinar.toFixed(1).replace(".", ",");
    $("k-envio").textContent = diasEnvio.toFixed(1).replace(".", ",");

    // A fila: percentual assinado em cada degrau, dentro do recorte filtrado.
    const porDegrau = new Map();
    for (const d of F) {
      const k = d.po || 0;
      if (!porDegrau.has(k)) porDegrau.set(k, { t: 0, ok: 0 });
      const x = porDegrau.get(k);
      x.t += 1; if (d.as) x.ok += 1;
    }
    const fila = $("fila");
    fila.textContent = "";
    const degraus = [...porDegrau.entries()].filter(([k]) => k > 0).sort((a, b) => a[0] - b[0]);
    if (!degraus.length) {
      const p = document.createElement("p");
      p.className = "vazio"; p.textContent = "Nada neste recorte.";
      fila.appendChild(p);
    }
    for (const [k, v] of degraus) {
      const p = Math.round((100 * v.ok) / v.t);
      const el = document.createElement("div");
      el.className = "degrau";
      const nome = document.createElement("span");
      nome.className = "nome";
      nome.appendChild(document.createTextNode(k + ". " + (NOMES_DEGRAU[k] || "Degrau " + k)));
      const i = document.createElement("i");
      i.textContent = v.ok + " de " + v.t;
      nome.appendChild(i);
      const trilho = document.createElement("span");
      trilho.className = "trilho";
      const barra = document.createElement("i");
      barra.style.width = p + "%";
      trilho.appendChild(barra);
      const pc = document.createElement("span");
      pc.className = "pc"; pc.textContent = p + "%";
      el.append(nome, trilho, pc);
      fila.appendChild(el);
    }

    // Quadro de assinaturas: SÓ o incorporador e o time da Careli (Backoffice). É quem entra em
    // todo contrato e por isso acumula fila; imobiliária, corretor e comprador vivem na tabela
    // de baixo.
    //
    // ⚠️ Ignora os filtros de PERFIL e de STATUS de propósito: o quadro mostra assinado E a
    // assinar lado a lado, então filtrar por um dos dois esvaziaria metade dele; e filtrar por
    // perfil "Comprador" deixaria o quadro vazio. Empreendimento, unidade e usuário valem.
    const doQuadro = D.filter((d) =>
      (d.pf === "Incorporador" || d.pf === "Backoffice") &&
      (!fe || d.emp === fe) &&
      (!fu || semAcento(d.un).includes(fu)) &&
      (!fn || semAcento(d.us).includes(fn)));

    const quadro = new Map();
    for (const d of doQuadro) {
      // O e-mail entra na chave: a mesma razão social assina por três sócios diferentes, e
      // juntá-los numa linha só esconderia que dois assinaram e um não.
      const k = d.us + "\\u0000" + d.em;
      if (!quadro.has(k)) quadro.set(k, { nome: d.us, perfil: d.pf, email: d.em, ok: 0, falta: 0 });
      quadro.get(k)[d.as ? "ok" : "falta"] += 1;
    }
    const tq = $("quadro");
    tq.textContent = "";
    const lista = [...quadro.values()].sort((a, b) => (b.ok + b.falta) - (a.ok + a.falta) || a.ok - b.ok);
    for (const q of lista) {
      const tr = document.createElement("tr");
      const tdN = document.createElement("td");
      tdN.appendChild(document.createTextNode(q.nome));
      // O e-mail distingue os três sócios da mesma empresa.
      const mail = document.createElement("i");
      mail.textContent = q.email;
      tdN.appendChild(mail);
      tr.appendChild(tdN);
      for (const [txt, cls] of [[q.perfil, ""], [num(q.ok), "n"], [num(q.falta), "n"]]) {
        const td = document.createElement("td");
        td.className = cls; td.textContent = txt;
        tr.appendChild(td);
      }
      tq.appendChild(tr);
    }
    if (!lista.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.className = "vazio"; td.colSpan = 4; td.textContent = "Nada neste recorte.";
      tr.appendChild(td); tq.appendChild(tr);
    }

    // Quem também assina todo contrato mas tem outro perfil no C2X. Sem este aviso o quadro
    // pareceria completo e duas pessoas do grupo fixo sumiriam sem deixar rastro.
    const totalUnidadesRecorte = new Set(D.filter((d) => (!fe || d.emp === fe)).map((d) => d.un)).size;
    const outros = new Map();
    for (const d of D) {
      if (d.pf === "Incorporador" || d.pf === "Backoffice") continue;
      if (fe && d.emp !== fe) continue;
      const k = d.us + "\\u0000" + d.pf;
      if (!outros.has(k)) outros.set(k, { nome: d.us, perfil: d.pf, n: 0 });
      outros.get(k).n += 1;
    }
    const fixosFora = [...outros.values()].filter((o) => o.n >= totalUnidadesRecorte * 0.9);
    $("fixos-fora").textContent = fixosFora.length
      ? "Também assinam todos os contratos, mas com outro perfil no C2X: " +
        fixosFora.map((o) => o.nome + " (" + o.perfil + ")").join(", ") + "."
      : "";

    // ── Quadro das unidades cujo COMPRADOR já assinou ─────────────────────────
    // Responde "o cliente fez a parte dele; estamos esperando quem?". Respeita empreendimento e
    // unidade; ignora perfil e status, porque a pergunta já é sobre um perfil e um status.
    const baseComp = D.filter((d) =>
      (!fe || d.emp === fe) && (!fu || semAcento(d.un).includes(fu)));
    const mapaComp = new Map();
    for (const d of baseComp) {
      if (!mapaComp.has(d.un)) mapaComp.set(d.un, []);
      mapaComp.get(d.un).push(d);
    }
    const prontas = [];
    for (const [un, ls] of mapaComp) {
      const compradores = ls.filter((x) => x.pf === "Comprador");
      if (!compradores.length || !compradores.every((x) => x.as)) continue;
      // A última assinatura do lado do comprador é a data que interessa: é quando ele terminou.
      const datas = compradores.map((x) => x.da).filter(Boolean).sort();
      const ultima = datas[datas.length - 1] || null;
      const pendentes = ls.filter((x) => !x.as);
      const degrau = pendentes.length ? Math.min(...pendentes.map((x) => x.po || 99)) : null;
      const esperando = degrau === null ? [] :
        [...new Set(pendentes.filter((x) => (x.po || 99) === degrau).map((x) => x.us))];
      prontas.push({
        un, emp: ls[0].emp,
        nomes: [...new Set(compradores.map((x) => x.us))].join(", "),
        ultima,
        dias: ultima ? Math.round((new Date(ultima) - new Date(ls[0].env)) / 86400000) : null,
        esperando, degrau,
      });
    }
    prontas.sort((a, b) => (b.ultima || "").localeCompare(a.ultima || "") || a.un.localeCompare(b.un));

    const tc = $("tabela-compradores");
    tc.textContent = "";
    for (const p of prontas) {
      const tr = document.createElement("tr");
      const cel = (txt, cls) => {
        const td = document.createElement("td");
        if (cls) td.className = cls;
        td.textContent = txt;
        return td;
      };
      tr.appendChild(cel(p.un, "un"));
      tr.appendChild(cel(p.nomes));
      tr.appendChild(cel(p.ultima ? p.ultima.split("-").reverse().join("/") : "—", "n"));
      tr.appendChild(cel(p.dias === null ? "—" : String(p.dias), "n"));

      const tdE = document.createElement("td");
      if (!p.esperando.length) {
        const s = document.createElement("span");
        s.className = "pill";
        const pt = document.createElement("span");
        pt.className = "pt ok";
        const r = document.createElement("span");
        r.className = "txt-ok"; r.textContent = "contrato completo";
        s.append(pt, r);
        tdE.appendChild(s);
      } else {
        tdE.textContent = p.esperando.join(", ");
        const i = document.createElement("i");
        i.textContent = "degrau " + p.degrau;
        tdE.appendChild(i);
      }
      tr.appendChild(tdE);
      tc.appendChild(tr);
    }
    if (!prontas.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.className = "vazio"; td.colSpan = 5;
      td.textContent = "Nenhuma unidade com o comprador assinado neste recorte.";
      tr.appendChild(td); tc.appendChild(tr);
    }
    const comEspera = prontas.filter((p) => p.esperando.length).length;
    $("contagem-compradores").textContent = prontas.length
      ? prontas.length + " unidade" + (prontas.length === 1 ? "" : "s") +
        " com o comprador assinado · " + comEspera + " ainda aguardam outra assinatura."
      : "";

    // A tabela: pendentes e mais antigos primeiro, que é a ordem de quem vai cobrar.
    const tb = $("tabela");
    tb.textContent = "";
    const ordenada = F.slice().sort((a, b) =>
      (a.as === b.as ? 0 : a.as ? 1 : -1) || b.du - a.du || a.un.localeCompare(b.un) || a.po - b.po);
    const MOSTRA = 400;
    for (const d of ordenada.slice(0, MOSTRA)) {
      const tr = document.createElement("tr");
      const cel = (txt, cls) => {
        const td = document.createElement("td");
        if (cls) td.className = cls;
        td.textContent = txt;
        return td;
      };
      tr.appendChild(cel(d.un, "un"));
      tr.appendChild(cel(d.env.split("-").reverse().join("/")));
      tr.appendChild(cel(d.us));
      tr.appendChild(cel(d.pf));
      tr.appendChild(cel(String(d.po || "—"), "n"));

      const tdS = document.createElement("td");
      const pill = document.createElement("span");
      pill.className = "pill";
      const ponto = document.createElement("span");
      const atrasado = d.pz === "Pendente e em atraso";
      const tipo = d.as ? "ok" : atrasado ? "tarde" : "espera";
      ponto.className = "pt " + tipo;
      const rot = document.createElement("span");
      rot.className = "txt-" + tipo;
      rot.textContent = d.as ? "Assinado" : atrasado ? "Em atraso" : "Pendente";
      pill.append(ponto, rot);
      tdS.appendChild(pill);
      tr.appendChild(tdS);

      tr.appendChild(cel(d.da ? d.da.split("-").reverse().join("/") : "—", "n"));
      tb.appendChild(tr);
    }
    if (!ordenada.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.className = "vazio"; td.colSpan = 7; td.textContent = "Nenhuma assinatura neste recorte.";
      tr.appendChild(td); tb.appendChild(tr);
    }
    $("contagem").textContent = ordenada.length > MOSTRA
      ? "Mostrando as " + MOSTRA + " primeiras de " + num(ordenada.length) + " assinaturas. Use os filtros para estreitar."
      : num(ordenada.length) + " assinatura" + (ordenada.length === 1 ? "" : "s") + " neste recorte.";
  }

  for (const el of Object.values(filtros)) {
    el.addEventListener("input", desenha);
    el.addEventListener("change", desenha);
  }
  $("limpar").addEventListener("click", () => {
    for (const el of Object.values(filtros)) el.value = "";
    desenha();
  });
  desenha();
})();
</script>
`;

fs.writeFileSync(`${SAIDA}/painel-vale-do-ouro.html`, html, "utf8");
console.log(`painel escrito · ${(fs.statSync(`${SAIDA}/painel-vale-do-ouro.html`).size / 1024).toFixed(0)} KB`);
