// GERADO A PARTIR DO MOCKUP APROVADO (cockpit.html).
//
// É o CSS ORIGINAL do mockup, só escopado em `.pcx` para não vazar no resto do hub e com
// o dark ligado no tema do Panteon (`data-uix-theme`) em vez de `body.dark`. Não reescreva as
// regras à mão: se o mockup mudar, rode de novo o escopador e substitua este arquivo inteiro.

export const COCKPIT_CSS = `.pcx{
    --canvas:#f7f8fa;
    --panel:#ffffff;
    --subtle:#eef1f4;
    --line:#dce2ea;
    --line-strong:#c5ceda;
    --text:#121722;
    --text2:#485466;
    --muted:#667085;
    --brand:#a07c3b;
    --brand-soft:rgba(160,124,59,.12);
    --ok:#14804a;
    --ok-soft:rgba(20,128,74,.12);
    --warn:#b7791f;
    --warn-soft:rgba(183,121,31,.15);
    --danger:#c24135;
    --danger-soft:rgba(194,65,53,.14);
    --info:#2563eb;
    --info-soft:rgba(37,99,235,.10);
    --shadow:0 8px 24px rgb(18 23 34 / 0.10);
    --shadow-sm:0 2px 6px rgb(18 23 34 / 0.08);
  }
[data-uix-theme="dark"] .pcx{
    --canvas:#101211; --panel:#181a19; --subtle:#26292a; --line:#2b2e2c; --line-strong:#3a3e3c;
    --text:#e9edeb; --text2:#cfd3d0; --muted:#98a09a;
    --brand:#cba25a; --brand-soft:rgba(203,162,90,.16);
    --ok:#3fae74; --ok-soft:rgba(63,174,116,.16);
    --warn:#d69a3d; --warn-soft:rgba(214,154,61,.18);
    --danger:#e0655a; --danger-soft:rgba(224,101,90,.18);
    --info:#5b8def;
    --shadow:0 10px 30px rgb(0 0 0 / .5); --shadow-sm:0 2px 8px rgb(0 0 0 / .4);
  }
.pcx *{margin:0;padding:0;box-sizing:border-box}
.pcx{
    background:var(--canvas);
    color:var(--text);
    font-family:Arial, Helvetica, sans-serif;
    min-height:100vh;padding:20px 24px 28px;
    transition:background .25s, color .25s;
  }
.pcx #ana-lista, .pcx #ana-kanban{max-height:calc(100vh - 300px);overflow-y:auto}
.pcx .tabnum{font-variant-numeric:tabular-nums}
.pcx header{display:flex;align-items:center;gap:18px;margin-bottom:18px}
.pcx .mod-icon{
    width:42px;height:42px;border-radius:11px;flex-shrink:0;
    background:#101820;color:#cba25a;border:1px solid rgba(160,124,59,.55);
    display:flex;align-items:center;justify-content:center;
  }
.pcx .mod-icon svg{width:22px;height:22px}
.pcx .brand h1{font-size:21px;font-weight:700;letter-spacing:-.01em}
.pcx .brand .sub{font-size:11px;color:var(--muted);letter-spacing:.14em;text-transform:uppercase;margin-top:1px}
.pcx .h-event{margin-left:4px;padding-left:18px;border-left:1px solid var(--line)}
.pcx .h-event .ev{font-size:14px;font-weight:700}
.pcx .h-event .evsub{font-size:12px;color:var(--muted);margin-top:2px}
.pcx .switch{margin-left:auto;display:flex;gap:3px;background:var(--subtle);border:1px solid var(--line);border-radius:11px;padding:4px}
.pcx .switch button{
    border:0;background:transparent;color:var(--muted);cursor:pointer;
    font:inherit;font-size:13px;font-weight:700;padding:8px 20px;border-radius:8px;transition:all .2s;
  }
.pcx .switch button.on{background:var(--panel);color:var(--brand);box-shadow:var(--shadow-sm)}
.pcx .themetog{display:flex;gap:3px;background:var(--subtle);border:1px solid var(--line);border-radius:11px;padding:4px;margin-left:10px}
.pcx .themetog button{border:0;background:transparent;color:var(--muted);cursor:pointer;width:36px;height:34px;border-radius:8px;display:flex;align-items:center;justify-content:center;transition:all .2s}
.pcx .themetog button svg{width:17px;height:17px}
.pcx .themetog button.on{background:var(--panel);color:var(--brand);box-shadow:var(--shadow-sm)}
.pcx .h-right{display:flex;align-items:center;gap:20px;margin-left:20px}
.pcx .live{display:flex;align-items:center;gap:7px;font-size:12px;font-weight:700;letter-spacing:.1em;color:var(--ok)}
.pcx .live .dot{width:9px;height:9px;border-radius:50%;background:var(--ok);animation:pcx-pulse 1.6s infinite}
@keyframes pcx-pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(20,128,74,.4)}50%{opacity:.55;box-shadow:0 0 0 7px rgba(20,128,74,0)}}
.pcx .clock{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
.pcx .kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:13px;margin-bottom:16px}
.pcx .kpi{background:var(--panel);border:1px solid var(--line);border-radius:13px;padding:14px 17px;box-shadow:var(--shadow-sm)}
.pcx .kpi .kv{font-size:31px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.pcx .kpi .kl{font-size:12px;color:var(--muted);margin-top:7px}
.pcx .kpi .kv.ok{color:var(--ok)}
.pcx .kpi .kv.brand{color:var(--brand)}
.pcx .kpi .kd{font-size:11px;color:var(--muted);margin-top:3px}
.pcx .view{display:none}
.pcx .view.on{display:block}
.pcx .grid{display:grid;grid-template-columns:1fr 336px;gap:15px;align-items:start}
.pcx .maptitle{display:flex;align-items:center;gap:12px;margin:2px 0 11px}
.pcx .maptitle h2{font-size:13px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted);font-weight:700}
.pcx .legend{margin-left:auto;display:flex;gap:15px;font-size:11.5px;color:var(--muted)}
.pcx .legend span{display:flex;align-items:center;gap:6px}
.pcx .lg-i{width:14px;height:14px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;font-size:9px}
.pcx .lg-qr{background:var(--brand-soft);color:var(--brand);border:1px solid var(--brand)}
.pcx .lg-data{background:var(--subtle);color:var(--muted);border:1px solid var(--line-strong)}
.pcx .zone{background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:13px 15px;margin-bottom:12px;box-shadow:var(--shadow-sm)}
.pcx .zone-head{display:flex;align-items:center;gap:10px;margin-bottom:11px}
.pcx .zone-name{font-size:12.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--brand)}
.pcx .zone-badge{font-size:10px;font-weight:700;letter-spacing:.05em;padding:2px 8px;border-radius:20px;background:var(--brand-soft);color:var(--brand)}
.pcx .zone-total{margin-left:auto;font-size:12px;color:var(--muted)}
.pcx .zone-total b{color:var(--text);font-size:16px;font-weight:800}
.pcx .cells{display:flex;gap:11px;flex-wrap:wrap}
.pcx .subline{margin-bottom:12px}
.pcx .subline:last-child{margin-bottom:0}
.pcx .subline-lab{font-size:10.5px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;display:flex;align-items:center;gap:8px}
.pcx .subline-lab::before{content:"";width:15px;height:2px;background:var(--brand);border-radius:2px}
.pcx .cell{flex:1;min-width:148px;background:var(--subtle);border:1px solid var(--line);border-radius:11px;padding:12px 14px;position:relative;transition:all .3s}
.pcx .cell{cursor:pointer}
.pcx .cell:hover{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
.pcx .cell.gargalo:hover{box-shadow:0 0 0 4px var(--danger-soft)}
.pcx .cell.done:hover{box-shadow:0 0 0 4px var(--ok-soft)}
.pcx .cell .ctop{display:flex;align-items:baseline;gap:9px}
.pcx .cell .cn{font-size:29px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.pcx .cell .csrc{width:19px;height:19px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:10px;margin-left:auto}
.pcx .csrc.qr{background:var(--brand-soft);color:var(--brand);border:1px solid var(--brand)}
.pcx .csrc.data{background:var(--panel);color:var(--muted);border:1px solid var(--line-strong)}
.pcx .cell .clabel{font-size:13px;color:var(--text);margin-top:8px;font-weight:600}
.pcx .cell .ctime{font-size:11.5px;color:var(--muted);margin-top:3px;font-variant-numeric:tabular-nums}
.pcx .cell.gargalo{border-color:var(--danger);box-shadow:0 0 0 3px var(--danger-soft)}
.pcx .cell.gargalo .cn, .pcx .cell.gargalo .ctime{color:var(--danger)}
.pcx .cell.done{border-color:var(--ok);background:var(--ok-soft)}
.pcx .cell.done .cn{color:var(--ok)}
.pcx .tag-gargalo{position:absolute;top:-8px;right:12px;font-size:9.5px;font-weight:800;letter-spacing:.06em;background:var(--danger);color:#fff;padding:2px 8px;border-radius:20px}
.pcx .side{display:flex;flex-direction:column;gap:15px}
.pcx .card{background:var(--panel);border:1px solid var(--line);border-radius:15px;padding:15px 17px;box-shadow:var(--shadow-sm)}
.pcx .card h3{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:13px}
.pcx .funil{display:flex;flex-direction:column;gap:10px}
.pcx .frow{display:flex;align-items:center;gap:11px}
.pcx .fbar{flex:1;height:33px;background:var(--subtle);border-radius:9px;overflow:hidden;position:relative;border:1px solid var(--line)}
.pcx .fbar .fill{height:100%;background:linear-gradient(90deg,#b98f45,var(--brand));border-radius:8px 0 0 8px;transition:width .6s}
.pcx .fbar.ok .fill{background:linear-gradient(90deg,#1a9c5b,var(--ok))}
.pcx .fbar .flabel{position:absolute;inset:0;display:flex;align-items:center;padding:0 12px;font-size:12.5px;font-weight:700;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.15)}
.pcx .fbar .fval{position:absolute;right:6px;top:50%;transform:translateY(-50%);font-size:14px;font-weight:800;color:var(--text);font-variant-numeric:tabular-nums;background:var(--panel);padding:2px 9px;border-radius:7px;box-shadow:var(--shadow-sm)}
.pcx .fmoney{font-size:11px;color:var(--muted);width:72px;text-align:right;font-variant-numeric:tabular-nums}
.pcx .call{display:flex;align-items:center;gap:11px;padding:8px 0;border-bottom:1px solid var(--line)}
.pcx .call:last-child{border-bottom:0}
.pcx .call .cavatar{width:34px;height:34px;border-radius:9px;background:var(--brand-soft);color:var(--brand);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0}
.pcx .call .cinfo{flex:1;min-width:0}
.pcx .call .cname{font-size:13.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pcx .call .cdest{font-size:11.5px;color:var(--brand);margin-top:1px;font-weight:600}
.pcx .call .cwhen{font-size:11px;color:var(--muted);flex-shrink:0}
.pcx .call.new{animation:pcx-flash 1.4s}
@keyframes pcx-flash{0%{background:var(--brand-soft)}100%{background:transparent}}
.pcx .feed{display:flex;flex-direction:column;gap:1px;max-height:186px;overflow:hidden}
.pcx .fitem{display:flex;gap:9px;font-size:12px;padding:5px 0;color:var(--text2);align-items:center}
.pcx .fitem .fic{width:20px;height:20px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0}
.pcx .fitem .fic.qr{background:var(--brand-soft);color:var(--brand)}
.pcx .fitem .fic.data{background:var(--subtle);color:var(--muted)}
.pcx .fitem .fic.ok{background:var(--ok-soft);color:var(--ok)}
.pcx .fitem b{color:var(--text);font-weight:700}
.pcx .fitem .ft{margin-left:auto;font-size:10.5px;color:var(--muted);flex-shrink:0}
.pcx #hall{
    display:grid;grid-template-columns:0.8fr 1.1fr 1fr 0.72fr 1fr;grid-template-rows:auto auto;gap:14px;
  }
.pcx .room.cancel{border-color:var(--danger);cursor:pointer;transition:all .2s}
.pcx .room.cancel:hover{box-shadow:0 0 0 3px var(--danger-soft)}
.pcx .room.cancel .room-count b{color:var(--danger)}
.pcx .cancel-bk{display:flex;flex-direction:column;gap:8px;margin-bottom:12px}
.pcx .cancel-bk div{font-size:12.5px;color:var(--text2)}
.pcx .cancel-bk b{color:var(--danger);font-weight:800;margin-right:5px;font-size:15px}
.pcx .room{
    background:var(--panel);border:1px solid var(--line);border-radius:15px;
    box-shadow:var(--shadow-sm);padding:16px 18px;min-height:240px;
    position:relative;display:flex;flex-direction:column;
  }
.pcx .room.wide{grid-column:span 1}
.pcx .room-head{display:flex;align-items:center;gap:9px;margin-bottom:11px}
.pcx .room-name{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text2)}
.pcx .room-count{margin-left:auto;display:flex;align-items:baseline;gap:5px}
.pcx .room-count b{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums}
.pcx .room-count span{font-size:11px;color:var(--muted)}
.pcx .room.hot{border-color:var(--danger);box-shadow:0 0 0 3px var(--danger-soft)}
.pcx .room.hot .room-count b{color:var(--danger)}
.pcx .room.exit{border-color:var(--ok);background:var(--ok-soft)}
.pcx .room.exit .room-count b{color:var(--ok)}
.pcx .dots{display:flex;flex-wrap:wrap;gap:7px;align-content:flex-start;flex:1;margin-top:6px}
.pcx .dot-p{width:17px;height:17px;border-radius:50%;background:var(--muted);opacity:.9;transition:all .4s;box-shadow:0 1px 2px rgba(0,0,0,.12)}
.pcx .dot-p.wait{background:#9aa5b4}
.pcx .dot-p.brand{background:var(--ok)}
.pcx .dot-p.laranja{background:#e8792b}
.pcx .dot-p.info{background:var(--info)}
.pcx .dot-p.ok{background:var(--ok)}
.pcx .dot-p.cancel{background:var(--danger)}
.pcx .dot-p.pulse{animation:pcx-dotpulse 1.8s infinite}
@keyframes pcx-dotpulse{50%{transform:scale(1.18);opacity:.6}}
.pcx .sec-fila{display:flex;flex-direction:column;margin-bottom:16px}
.pcx .fila-lab{font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.02em;margin-bottom:8px;display:flex;align-items:center;gap:7px}
.pcx .fila-lab b{color:var(--text);font-size:14px}
.pcx .atds{display:flex;flex-wrap:wrap;gap:10px;margin-top:auto}
.pcx .atd{flex:1 1 calc(20% - 8px);min-width:148px;background:var(--subtle);border:1.5px solid var(--line-strong);border-radius:12px;padding:12px 13px;display:flex;flex-direction:column}
.pcx .atd.click{cursor:pointer;transition:all .2s}
.pcx .atd.click:hover{border-color:var(--brand);box-shadow:0 0 0 3px var(--brand-soft);transform:translateY(-1px)}
.pcx .atd.atende{border-color:var(--ok);background:var(--ok-soft)}
.pcx .atd.busy{border-color:var(--warn);background:var(--warn-soft)}
.pcx .atd-top{display:flex;align-items:center;justify-content:space-between}
.pcx .atd-num{font-size:22px;font-weight:800;color:var(--text);line-height:1}
.pcx .atd-st{font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;padding:3px 8px;border-radius:20px;color:#fff}
.pcx .atd.atende .atd-st{background:var(--ok)}
.pcx .atd.busy .atd-st{background:var(--warn)}
.pcx .atd.livre .atd-st{background:#9aa5b4}
.pcx .atd-who{display:flex;align-items:center;gap:8px;margin-top:11px}
.pcx .atd-av{width:27px;height:27px;border-radius:7px;background:var(--panel);border:1px solid var(--line);color:var(--text2);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.pcx .atd-nome{font-size:12.5px;font-weight:700;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pcx .atd-metrics{display:flex;flex-wrap:wrap;gap:3px 12px;margin-top:auto;padding-top:11px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted);align-items:baseline}
.pcx .atd-metrics .mt{white-space:nowrap}
.pcx .atd-metrics b{color:var(--text);font-weight:800;font-size:14px;font-variant-numeric:tabular-nums}
.pcx .atd-cliente{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-top:9px}
.pcx .atd-cliente-nome{font-size:13px;font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pcx .atd-cliente-tempo{font-size:12px;font-weight:700;color:var(--muted);font-variant-numeric:tabular-nums;flex-shrink:0}
.pcx .atd-tot{color:var(--muted);font-size:10.5px}
.pcx .sec-stats{display:flex;gap:26px;margin-bottom:14px}
.pcx .ss{display:flex;flex-direction:column}
.pcx .ss b{font-size:19px;font-weight:800;color:var(--text);font-variant-numeric:tabular-nums;line-height:1}
.pcx .ss span{font-size:11px;color:var(--muted);margin-top:5px}
.pcx .salao-grupo{margin-bottom:10px;display:flex;flex-direction:column;min-height:0}
.pcx .grupo-lab{font-size:11px;font-weight:700;color:var(--muted);margin-bottom:8px;display:flex;align-items:center;gap:7px}
.pcx .grupo-lab b{color:var(--text);font-size:14px;margin-left:2px}
.pcx .gl-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.pcx .espelho{background:linear-gradient(135deg,#2b3444,#1f2633);color:#e7ecf3;border-radius:9px;padding:9px 12px;font-size:11px;font-weight:700;letter-spacing:.05em;text-align:center;margin-bottom:10px}
.pcx .espelho .es-sub{font-size:10px;font-weight:400;color:#aab6c6;margin-top:2px;letter-spacing:0}
.pcx .mesas{display:flex;flex-wrap:wrap;gap:8px;margin-top:auto}
.pcx .mesa{
    width:52px;height:44px;border-radius:9px;border:1.5px solid var(--line-strong);background:var(--subtle);
    display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;transition:all .3s;
  }
.pcx .mesa .mnum{font-size:15px;font-weight:800;line-height:1}
.pcx .mesa .mst{font-size:8.5px;color:var(--muted);margin-top:1px;letter-spacing:.04em}
.pcx .mesa.atende{border-color:var(--ok);background:var(--ok-soft);color:var(--ok)}
.pcx .mesa.busy{border-color:var(--warn);background:var(--warn-soft);color:var(--warn)}
.pcx .mesa.atende .mst, .pcx .mesa.busy .mst{color:inherit;font-weight:700}
.pcx .mesa .who{position:absolute;top:-9px;right:-6px;width:20px;height:20px;border-radius:50%;background:var(--panel);border:1.5px solid currentColor;font-size:8.5px;font-weight:700;display:flex;align-items:center;justify-content:center}
.pcx .flowarrow{position:absolute;z-index:2;color:var(--line-strong);font-size:22px;font-weight:700}
.pcx .reserva-fila{display:flex;align-items:center;gap:6px;margin-top:9px;padding:7px 10px;background:var(--warn-soft);border-radius:8px}
.pcx .reserva-fila .rlab{font-size:10.5px;font-weight:700;color:var(--warn);letter-spacing:.03em}
.pcx .reserva-fila .rdots{display:flex;gap:4px;margin-left:auto}
.pcx .reserva-fila .rdots i{width:11px;height:11px;border-radius:50%;background:var(--warn);opacity:.7;display:block}
.pcx .maplegend{display:flex;gap:22px;justify-content:center;margin-top:16px;font-size:12px;color:var(--muted)}
.pcx .maplegend span{display:flex;align-items:center;gap:7px}
.pcx .ml-dot{width:12px;height:12px;border-radius:50%}
.pcx .note{margin-top:16px;font-size:11px;color:var(--muted);text-align:center;opacity:.75}
.pcx .lista-bar{display:flex;align-items:center;gap:14px;margin-bottom:14px;flex-wrap:wrap}
.pcx .lista-search{flex:0 1 340px;min-width:220px;height:40px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--text);padding:0 14px;font:inherit;font-size:14px;box-shadow:var(--shadow-sm)}
.pcx .lista-search::placeholder{color:var(--muted)}
.pcx .lista-filtros{display:flex;gap:7px;flex-wrap:wrap}
.pcx .fchip{border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:20px;padding:7px 15px;font-size:12.5px;font-weight:700;cursor:pointer;transition:all .2s}
.pcx .fchip:hover{border-color:var(--line-strong)}
.pcx .fchip.on{background:var(--brand-soft);color:var(--brand);border-color:var(--brand)}
.pcx .lista-count{margin-left:auto;font-size:13px;color:var(--muted)}
.pcx .ltable-wrap{background:var(--panel);border:1px solid var(--line);border-radius:15px;box-shadow:var(--shadow-sm)}
.pcx .ltable{width:100%;border-collapse:collapse}
.pcx .ltable thead th{position:sticky;top:0;z-index:2;text-align:left;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted);font-weight:700;padding:13px 20px;border-bottom:1px solid var(--line);background:var(--subtle)}
.pcx .ltable tbody td{padding:11px 20px;border-bottom:1px solid var(--line);font-size:14px;color:var(--text2)}
.pcx .ltable tbody tr:last-child td{border-bottom:0}
.pcx .ltable tbody tr:hover{background:var(--subtle)}
.pcx .lt-nome{display:flex;align-items:center;gap:11px}
.pcx .lt-av{width:32px;height:32px;border-radius:8px;background:var(--brand-soft);color:var(--brand);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex-shrink:0}
.pcx .lt-nm{font-weight:700;color:var(--text)}
.pcx .et-chip{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700}
.pcx .et-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.pcx .lt-tempo{font-variant-numeric:tabular-nums}
.pcx .lista-empty{padding:30px;text-align:center;color:var(--muted);font-size:14px}
.pcx .ana-bar{display:flex;align-items:center;gap:14px;margin-bottom:14px;flex-wrap:wrap}
.pcx .ana-subtabs{display:flex;gap:3px;background:var(--subtle);border:1px solid var(--line);border-radius:10px;padding:3px}
.pcx .ana-subtabs button{border:0;background:transparent;color:var(--muted);cursor:pointer;font:inherit;font-size:13px;font-weight:700;padding:7px 16px;border-radius:7px;transition:all .2s}
.pcx .ana-subtabs button.on{background:var(--panel);color:var(--brand);box-shadow:var(--shadow-sm)}
.pcx .ana-verpor{display:flex;align-items:center;gap:6px}
.pcx .ana-verpor>span{font-size:12px;color:var(--muted);margin-right:2px}
.pcx .ana-verpor button{border:1px solid var(--line);background:var(--panel);color:var(--muted);border-radius:20px;padding:6px 13px;font-size:12.5px;font-weight:700;cursor:pointer;transition:all .2s}
.pcx .ana-verpor button.on{background:var(--brand-soft);color:var(--brand);border-color:var(--brand)}
.pcx .unid-wrap{display:flex;gap:5px;flex-wrap:wrap}
.pcx .unid-chip{font-size:11.5px;font-weight:700;font-family:Consolas,monospace;background:var(--subtle);border:1px solid var(--line);color:var(--text2);padding:2px 7px;border-radius:6px;letter-spacing:.02em}
.pcx .unid-chip.lg{font-size:13.5px;padding:4px 11px;color:var(--text)}
.pcx .imob-group{margin-bottom:18px}
.pcx .imob-head{display:flex;align-items:baseline;gap:12px;padding:8px 4px;cursor:pointer}
.pcx .imob-nm{font-size:15px;font-weight:800}
.pcx .imob-meta{font-size:12px;color:var(--muted)}
.pcx .imob-head:hover .imob-nm{color:var(--brand)}
.pcx .kanban{display:flex;gap:12px;overflow-x:auto;padding-bottom:8px}
.pcx .kcol{flex:0 0 224px;background:var(--subtle);border:1px solid var(--line);border-radius:12px;padding:10px;display:flex;flex-direction:column}
.pcx .kcol-head{display:flex;align-items:center;gap:8px;padding:4px 6px 11px}
.pcx .kcol-nm{font-size:12px;font-weight:700;color:var(--text2);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pcx .kcol-n{font-size:11.5px;font-weight:800;color:var(--muted);background:var(--panel);border:1px solid var(--line);border-radius:20px;padding:1px 9px}
.pcx .kcol-body{display:flex;flex-direction:column;gap:8px;max-height:62vh;overflow-y:auto}
.pcx .kcard{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 11px;cursor:pointer;transition:all .2s;box-shadow:var(--shadow-sm)}
.pcx .kcard:hover{border-color:var(--brand);transform:translateY(-1px)}
.pcx .kcard-top{display:flex;align-items:center;gap:8px}
.pcx .lt-av.sm{width:26px;height:26px;font-size:10px}
.pcx .kcard-nm{font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pcx .kcard-imob{font-size:11.5px;color:var(--muted);margin-top:5px}
.pcx .kcard-foot{display:flex;align-items:center;justify-content:space-between;margin-top:9px;gap:6px}
.pcx .kcard-tempo{font-size:11px;color:var(--muted);white-space:nowrap}
.pcx .tl{display:flex;flex-direction:column;padding:6px 2px}
.pcx .tl-item{display:flex;gap:14px;position:relative;padding-bottom:18px}
.pcx .tl-item:not(:last-child)::before{content:"";position:absolute;left:6px;top:16px;bottom:0;width:2px;background:var(--line)}
.pcx .tl-item.done:not(:last-child)::before{background:var(--ok)}
.pcx .tl-dot{width:14px;height:14px;border-radius:50%;border:2px solid var(--line-strong);background:var(--panel);flex-shrink:0;margin-top:2px;z-index:1}
.pcx .tl-item.done .tl-dot{background:var(--ok);border-color:var(--ok)}
.pcx .tl-item.cur .tl-dot{background:var(--brand);border-color:var(--brand);box-shadow:0 0 0 4px var(--brand-soft)}
.pcx .tl-item.cancel .tl-dot{background:var(--danger);border-color:var(--danger)}
.pcx .tl-txt{font-size:14px;font-weight:600;color:var(--text)}
.pcx .tl-item.cur .tl-txt{color:var(--brand)}
.pcx .tl-item.cancel .tl-txt{color:var(--danger)}
.pcx .tl-when{font-size:12px;color:var(--muted);margin-top:2px;font-variant-numeric:tabular-nums}
.pcx .modal-ov{position:fixed;inset:0;background:rgba(18,23,34,.42);backdrop-filter:blur(2px);z-index:100;display:flex;align-items:center;justify-content:center;padding:24px;opacity:0;pointer-events:none;transition:opacity .2s}
.pcx .modal-ov.open{opacity:1;pointer-events:auto}
.pcx .modal{background:var(--panel);border-radius:16px;box-shadow:0 24px 60px rgb(18 23 34 / .28);width:min(560px,94vw);max-height:82vh;display:flex;flex-direction:column;transform:translateY(8px);transition:transform .2s}
.pcx .modal-ov.open .modal{transform:none}
.pcx .modal-head{display:flex;align-items:center;gap:14px;padding:18px 20px;border-bottom:1px solid var(--line)}
.pcx .modal-stage{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--brand)}
.pcx .modal-title{font-size:19px;font-weight:800;margin-top:2px}
.pcx .modal-count{font-size:12px;color:var(--muted);margin-top:2px}
.pcx .modal-toggle{margin-left:auto;display:flex;gap:3px;background:var(--subtle);border:1px solid var(--line);border-radius:10px;padding:3px}
.pcx .modal-toggle button{border:0;background:transparent;color:var(--muted);cursor:pointer;font:inherit;font-size:12px;font-weight:700;padding:6px 13px;border-radius:7px;transition:all .2s}
.pcx .modal-toggle button.on{background:var(--panel);color:var(--brand);box-shadow:var(--shadow-sm)}
.pcx .modal-close{width:32px;height:32px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--muted);cursor:pointer;font-size:15px;flex-shrink:0}
.pcx .modal-close:hover{background:var(--subtle);color:var(--text)}
.pcx .modal-body{overflow-y:auto;padding:10px 20px 18px}
/* Rodapé do modal da ficha: onde mora o "Saiu do evento". Fica preso embaixo, separado por uma
   linha, para não se misturar com a jornada — é uma ação que tira a pessoa da operação. */
.pcx .modal-foot{display:flex;align-items:center;justify-content:flex-end;gap:10px;padding:12px 20px;border-top:1px solid var(--line);background:var(--panel)}
.pcx .modal-foot .note{margin:0;font-size:12px;color:var(--danger,#b42318)}
.pcx .btn-sec{padding:8px 14px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--text);font-size:13px;font-weight:600;cursor:pointer}
.pcx .btn-sec:hover:not(:disabled){background:var(--subtle)}
.pcx .btn-sec:disabled{opacity:.55;cursor:default}
.pcx .crow{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.pcx .crow:last-child{border-bottom:0}
.pcx .cav{width:36px;height:36px;border-radius:9px;background:var(--brand-soft);color:var(--brand);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex-shrink:0}
.pcx .cinf .cnm{font-size:14px;font-weight:700}
.pcx .cinf .cim{font-size:12px;color:var(--muted);margin-top:1px}
.pcx .cwait{margin-left:auto;font-size:11.5px;color:var(--muted);font-variant-numeric:tabular-nums}
.pcx .ghead{display:flex;align-items:center;gap:8px;margin:16px 0 4px;padding-bottom:6px;border-bottom:2px solid var(--brand-soft)}
.pcx .ghead:first-child{margin-top:4px}
.pcx .ghead .gnm{font-size:12.5px;font-weight:800;color:var(--text)}
.pcx .ghead .gct{font-size:11px;font-weight:700;color:var(--brand);background:var(--brand-soft);padding:1px 8px;border-radius:20px}
.pcx .bipscan-ov{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:20px}
.pcx .bipscan-card{width:min(420px,92vw);background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:hidden;box-shadow:0 24px 60px rgba(0,0,0,.5);display:flex;flex-direction:column}
.pcx .bipscan-head{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid var(--line)}
.pcx .bipscan-head span{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:800;color:var(--text)}
.pcx .bipscan-head button{width:32px;height:32px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center}
.pcx .bipscan-head button:hover{background:var(--subtle);color:var(--text)}
.pcx .bipscan-cam{position:relative;width:100%;aspect-ratio:1;background:#000}
.pcx .bipscan-video{width:100%;height:100%;object-fit:cover;display:block}
.pcx .bipscan-mira{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:62%;aspect-ratio:1;border:3px solid rgba(255,255,255,.9);border-radius:14px;pointer-events:none}
.pcx .bipscan-info{padding:12px 16px;font-size:12.5px;color:var(--muted);text-align:center}
.pcx .bipscan-aviso{margin:0 16px 14px;padding:8px 12px;border-radius:8px;background:var(--danger-soft);color:var(--danger);font-size:12.5px;font-weight:700;text-align:center}
.pcx #reserva-lista{max-height:calc(100vh - 300px);overflow-y:auto}
.pcx .reserva-sel{height:40px;border:1px solid var(--line);border-radius:10px;background:var(--panel);color:var(--text);padding:0 12px;font:inherit;font-size:13px;max-width:240px}
.pcx .lt-tempo.lt-alerta{color:var(--danger);font-weight:800}
.pcx .reserva-flag{margin-left:8px;display:inline-flex;align-items:center;font-size:10.5px;font-weight:800;color:var(--danger);background:var(--danger-soft);padding:2px 8px;border-radius:20px;vertical-align:middle}
`;
