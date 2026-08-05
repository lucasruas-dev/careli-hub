// GERADO A PARTIR DO MOCKUP APROVADO (atendente.html).
//
// É o CSS ORIGINAL do mockup, só escopado em `.pat` para não vazar no resto do hub e com
// o dark ligado no tema do Panteon (`data-uix-theme`) em vez de `body.dark`. Não reescreva as
// regras à mão: se o mockup mudar, rode de novo o escopador e substitua este arquivo inteiro.

export const ATENDENTE_CSS = `.pat{
    --canvas:#f7f8fa; --panel:#ffffff; --subtle:#eef1f4; --line:#dce2ea; --line-strong:#c5ceda;
    --text:#121722; --text2:#485466; --muted:#667085; --inverse:#f7f8fa;
    --brand:#a07c3b; --brand-soft:rgba(160,124,59,.12);
    --ok:#14804a; --ok-soft:rgba(20,128,74,.12);
    --warn:#b7791f; --warn-soft:rgba(183,121,31,.15);
    --danger:#c24135; --danger-soft:rgba(194,65,53,.14);
    --info:#2563eb; --info-soft:rgba(37,99,235,.10);
    --shadow:0 8px 24px rgb(18 23 34 / 0.10); --shadow-sm:0 2px 6px rgb(18 23 34 / 0.08);
  }
[data-uix-theme="dark"] .pat{
    --canvas:#101211; --panel:#181a19; --subtle:#26292a; --line:#2b2e2c; --line-strong:#3a3e3c;
    --text:#e9edeb; --text2:#cfd3d0; --muted:#98a09a; --inverse:#101211;
    --brand:#cba25a; --brand-soft:rgba(203,162,90,.16);
    --ok:#3fae74; --ok-soft:rgba(63,174,116,.16);
    --warn:#d69a3d; --warn-soft:rgba(214,154,61,.18);
    --danger:#e0655a; --danger-soft:rgba(224,101,90,.18);
    --info:#5b8def;
    --shadow:0 10px 30px rgb(0 0 0 / .5); --shadow-sm:0 2px 8px rgb(0 0 0 / .4);
  }
.pat *{margin:0;padding:0;box-sizing:border-box}
.pat{background:var(--canvas);color:var(--text);font-family:Arial,Helvetica,sans-serif;height:100vh;overflow:hidden;display:flex;flex-direction:column;padding:16px 18px}
.pat header{display:flex;align-items:center;gap:16px;margin-bottom:14px;flex-shrink:0}
.pat .mod-icon{width:44px;height:44px;border-radius:11px;background:#232832;color:#dce2ea;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.pat .mod-icon svg{width:23px;height:23px}
.pat .brand h1{font-size:20px;font-weight:700}
.pat .brand .sub{font-size:11px;color:var(--muted);letter-spacing:.14em;text-transform:uppercase;margin-top:1px}
.pat .postos{margin-left:22px;display:flex;gap:4px;background:var(--subtle);border:1px solid var(--line);border-radius:12px;padding:4px}
.pat .postos button{border:0;background:transparent;color:var(--muted);cursor:pointer;font:inherit;font-size:14px;font-weight:700;padding:10px 20px;border-radius:9px;transition:all .2s}
.pat .postos button.on{background:var(--text);color:var(--inverse)}
.pat .postos button:disabled{opacity:.32;cursor:not-allowed}
.pat .role-tag{margin-left:12px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:5px 11px;border-radius:20px;background:var(--subtle);color:var(--muted);border:1px solid var(--line)}
.pat .h-right{margin-left:auto;display:flex;align-items:center;gap:18px}
.pat .atend{display:flex;align-items:center;gap:9px;font-size:14px;font-weight:700}
.pat .atend .av{width:34px;height:34px;border-radius:9px;background:var(--subtle);color:var(--text2);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px}
.pat .atend small{display:block;font-size:11px;color:var(--muted);font-weight:400}
.pat .clock{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}
.pat .tbtn{width:38px;height:38px;border-radius:9px;border:1px solid var(--line);background:var(--panel);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center}
.pat .tbtn svg{width:18px;height:18px}
.pat .grid{flex:1;display:grid;grid-template-columns:1fr 430px;gap:16px;min-height:0}
.pat .card{background:var(--panel);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow-sm);display:flex;flex-direction:column;min-height:0}
.pat .card-head{display:flex;align-items:center;gap:12px;padding:15px 20px;border-bottom:1px solid var(--line);flex-shrink:0}
.pat .card-head h2{font-size:13px;letter-spacing:.11em;text-transform:uppercase;color:var(--muted);font-weight:700}
.pat .card-head .badge{margin-left:auto;font-size:13px;color:var(--muted)}
.pat .card-head .badge b{color:var(--text);font-size:16px}
.pat .fila-tit{padding:14px 18px 0;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);flex-shrink:0}
.pat .ftabs{display:flex;gap:4px;padding:8px 16px 0;flex-shrink:0}
.pat .ftabs button{border:0;background:transparent;color:var(--muted);cursor:pointer;font:inherit;font-size:13.5px;font-weight:700;padding:9px 16px;border-radius:9px 9px 0 0;transition:all .2s;border-bottom:2px solid transparent}
.pat .ftabs button.on{color:var(--text);border-bottom-color:var(--text)}
.pat .ftabs .n{font-size:11px;background:var(--subtle);border:1px solid var(--line);border-radius:20px;padding:1px 8px;margin-left:6px;color:var(--muted)}
.pat .fila{flex:1;overflow-y:auto;padding:6px 12px}
.pat .frow{display:flex;align-items:center;gap:14px;padding:12px 10px;border-radius:12px;transition:background .15s}
.pat .frow:hover{background:var(--subtle)}
.pat .fpos{width:34px;height:34px;border-radius:9px;background:var(--subtle);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;color:var(--muted);flex-shrink:0}
.pat .frow.prox .fpos{background:var(--text);color:var(--inverse);border-color:var(--text)}
.pat .fav{width:42px;height:42px;border-radius:11px;background:var(--subtle);color:var(--text2);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;flex-shrink:0}
.pat .finfo{flex:1;min-width:0}
.pat .fnome{font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pat .fimob{font-size:13px;color:var(--muted);margin-top:2px}
.pat .fwait{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.pat .fwait.old{color:var(--danger)}
.pat .fcall{border:1px solid var(--line-strong);background:var(--panel);color:var(--text2);border-radius:10px;padding:9px 16px;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap;transition:all .15s}
.pat .fcall:hover{background:var(--text);color:var(--inverse);border-color:var(--text)}
.pat .fcall.no-show{border-color:var(--danger);color:var(--danger);background:var(--danger-soft)}
.pat .fcall.no-show:hover{background:var(--danger);color:#fff;border-color:var(--danger)}
.pat .fila-empty{padding:40px;text-align:center;color:var(--muted);font-size:15px}
.pat .cta{display:flex;gap:12px;margin:14px;flex-shrink:0}
.pat .chamar-prox{flex:1;border:0;border-radius:14px;background:var(--text);color:var(--inverse);font-size:19px;font-weight:800;padding:19px;cursor:pointer;box-shadow:var(--shadow);display:flex;align-items:center;justify-content:center;gap:12px;transition:transform .1s}
.pat .chamar-prox:hover{transform:translateY(-1px)}
.pat .chamar-prox:active{transform:translateY(1px)}
.pat .chamar-prox svg{width:24px;height:24px}
.pat .chamar-prox:disabled{opacity:.4;cursor:not-allowed;transform:none}
.pat .btn-ocupado{flex-shrink:0;border:1.5px solid var(--line-strong);background:var(--panel);color:var(--text2);border-radius:14px;font-size:15px;font-weight:700;padding:0 24px;cursor:pointer;display:flex;align-items:center;gap:9px;transition:all .15s}
.pat .btn-ocupado svg{width:19px;height:19px}
.pat .btn-ocupado.on{background:var(--warn);border-color:var(--warn);color:#fff}
.pat .btn-bipar{flex:1;border:1.5px solid var(--line-strong);background:var(--panel);color:var(--text);border-radius:14px;font-size:17px;font-weight:800;padding:19px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:11px;transition:all .15s}
.pat .btn-bipar svg{width:23px;height:23px}
.pat .btn-bipar:hover{border-color:var(--brand);color:var(--brand);background:var(--brand-soft)}
.pat:not(.can-chamar) #btn-prox, .pat:not(.can-chamar) #btn-ocupado{display:none}
.pat:not(.can-bipar) #btn-bipar{display:none}
.pat .perso-badge{display:inline-flex;align-items:center;gap:4px;font-size:10.5px;font-weight:800;color:var(--brand);background:var(--brand-soft);border:1px solid var(--brand);border-radius:20px;padding:2px 8px;margin-left:8px;vertical-align:middle}
.pat .frow.perso{box-shadow:inset 3px 0 0 var(--brand)}
.pat .side{display:flex;flex-direction:column;gap:16px;min-height:0}
.pat .atual{flex-shrink:0;padding:22px;text-align:center}
.pat .atual.ativa{border-color:var(--text);box-shadow:0 0 0 2px var(--text),var(--shadow-sm)}
.pat .atual .ring{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--text2)}
.pat .atual .ring .pulse{width:10px;height:10px;border-radius:50%;background:var(--info);animation:pat-pulse 1.4s infinite}
@keyframes pat-pulse{50%{opacity:.35;box-shadow:0 0 0 6px var(--info-soft)}}
.pat .atual .anome{font-size:34px;font-weight:800;margin-top:12px;line-height:1.1}
.pat .atual .aimob{font-size:14px;color:var(--muted);margin-top:4px}
.pat .atual .adest{display:inline-flex;align-items:center;gap:8px;margin-top:16px;background:var(--info-soft);color:var(--info);border:1px solid var(--info);border-radius:30px;padding:9px 22px;font-size:18px;font-weight:800}
.pat .atual .atimer{font-size:13px;color:var(--muted);margin-top:12px;font-variant-numeric:tabular-nums}
.pat .atual .acts{display:flex;gap:10px;margin-top:18px}
.pat .atual .acts button{flex:1;border-radius:11px;padding:14px 6px;font-size:14px;font-weight:700;cursor:pointer;border:1px solid var(--line-strong);background:var(--panel);color:var(--text2)}
.pat .b-rechamar:hover{background:var(--subtle)}
.pat .b-ausencia{background:var(--danger-soft)!important;color:var(--danger)!important;border-color:var(--danger)!important}
.pat .b-ausencia:hover{background:var(--danger)!important;color:#fff!important}
.pat .b-compareceu{background:var(--ok-soft)!important;color:var(--ok)!important;border-color:var(--ok)!important}
.pat .b-compareceu:hover{background:var(--ok)!important;color:#fff!important}
.pat .atual-vazio{padding:42px 22px;text-align:center;color:var(--muted)}
.pat .mesas-strip{display:none;flex-wrap:wrap;gap:8px;padding:14px 18px}
.pat .minha-mesa-card{display:none}
.pat.can-atender .minha-mesa-card{display:flex;flex-direction:column}
.pat .mm-badge{font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;padding:4px 11px;border-radius:20px;background:var(--subtle);color:var(--muted);border:1px solid var(--line)}
.pat .mm-body{display:flex;align-items:center;gap:16px;padding:16px 18px}
.pat .mm-num{width:66px;height:66px;border-radius:16px;background:var(--subtle);color:var(--text2);display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;flex-shrink:0;border:1.5px solid var(--line-strong)}
.pat .mm-lb{font-size:12px;color:var(--muted)}
.pat .mm-sub{font-size:16px;font-weight:700;margin-top:2px}
.pat .minha-mesa-card.atendimento .mm-num, .pat .minha-mesa-card.atendimento .mm-badge{background:var(--ok-soft);color:var(--ok);border-color:var(--ok)}
.pat .minha-mesa-card.ocupada .mm-num, .pat .minha-mesa-card.ocupada .mm-badge{background:var(--warn-soft);color:var(--warn);border-color:var(--warn)}
.pat .negociacao-card{display:none;flex-direction:column;min-height:0;max-height:52vh}
.pat[data-posto="salao"] .negociacao-card{display:flex}
.pat .negociacao-card .fila{padding-bottom:8px}
.pat .neg-chip{flex-shrink:0;font-size:11px;font-weight:600;color:var(--ok);background:var(--ok-soft);border:1px solid color-mix(in srgb,var(--ok) 35%,transparent);border-radius:20px;padding:3px 10px}
.pat .neg-time{flex-shrink:0;font-size:12.5px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--muted)}
.pat .wpp-btn{flex-shrink:0;width:34px;height:34px;border-radius:9px;border:1px solid color-mix(in srgb,#25d366 45%,var(--line));background:color-mix(in srgb,#25d366 12%,transparent);color:#1ba64e;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .15s}
.pat .wpp-btn:hover{background:#25d366;color:#fff;border-color:#25d366}
.pat .wpp-btn.big{width:auto;gap:8px;padding:0 16px;height:42px;font:inherit;font-size:14px;font-weight:700}
.pat .fnome.link, .pat .unome.link{cursor:pointer}
.pat .fnome.link:hover, .pat .unome.link:hover{text-decoration:underline;text-underline-offset:2px}
.pat .mchip{width:54px;height:48px;border-radius:10px;border:1.5px solid var(--line-strong);background:var(--subtle);display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--muted)}
.pat .mchip .mn{font-size:15px;font-weight:800}
.pat .mchip .ms{font-size:8px;margin-top:1px;letter-spacing:.02em}
.pat .mchip.atendimento{border-color:var(--ok);background:var(--ok-soft);color:var(--ok)}
.pat .mchip.ocupada{border-color:var(--warn);background:var(--warn-soft);color:var(--warn)}
.pat .ult{flex:1;overflow-y:auto;padding:6px 14px 14px}
.pat .ucall{display:flex;align-items:center;gap:11px;padding:9px 6px;border-bottom:1px solid var(--line)}
.pat .ucall:last-child{border-bottom:0}
.pat .uav{width:32px;height:32px;border-radius:8px;background:var(--subtle);color:var(--text2);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px}
.pat .uinfo{flex:1;min-width:0}
.pat .unome{font-size:13.5px;font-weight:700}
.pat .udest{font-size:11.5px;color:var(--muted)}
.pat .ust{font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px}
.pat .ust.ok{background:var(--ok-soft);color:var(--ok)}
.pat .ust.aus{background:var(--danger-soft);color:var(--danger)}
.pat .ust.dir{background:var(--info-soft);color:var(--info)}
.pat #atendimento{display:none;position:fixed;bottom:20px;right:20px;width:392px;background:var(--panel);border:1px solid var(--line);border-radius:18px;box-shadow:0 24px 60px rgba(0,0,0,.42);z-index:95;flex-direction:column;overflow:hidden}
.pat.em-atendimento:not(.pip-out):not(.pip-solo) #atendimento{display:flex;top:78px;bottom:22px;left:50%;transform:translateX(-50%);right:auto;width:min(720px,94vw)}
.pat.em-atendimento:not(.pip-out) .grid{display:none}
.pat.em-atendimento.pip-out #atendimento{display:none}
.pat.pip-solo{margin:0;background:var(--panel)}
.pat.pip-solo #atendimento{display:flex!important;position:static;width:100%;height:100vh;border:0;border-radius:0;box-shadow:none;transform:none}
.pat.pip-solo .pip-head{cursor:default}
.pat.pip-solo .pip-body{flex:1}
.pat.pip-solo .at-actions{margin-top:auto}
.pat.pip-solo .b-popout{display:none}
.pat .pip-head-r{display:flex;align-items:center;gap:12px}
.pat .b-popout{background:rgba(255,255,255,.22);border:0;color:#fff;border-radius:8px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer}
.pat .b-popout:hover{background:rgba(255,255,255,.38)}
.pat .pip-head{display:flex;align-items:center;justify-content:space-between;padding:13px 18px;background:var(--ok);color:#fff;user-select:none}
.pat .pip-head .em{display:flex;align-items:center;gap:8px;font-size:11.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
.pat .pip-head .em .pulse{width:9px;height:9px;border-radius:50%;background:#fff;animation:pat-pulse2 1.3s infinite}
@keyframes pat-pulse2{50%{opacity:.4}}
.pat .pip-head .cr{font-size:27px;font-weight:800;font-variant-numeric:tabular-nums}
.pat .pip-head.paused{background:var(--warn)}
.pat .pip-body{padding:16px 18px}
.pat .at-cli{display:flex;align-items:center;gap:12px}
.pat .at-av{width:46px;height:46px;border-radius:12px;background:var(--subtle);color:var(--text2);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px;flex-shrink:0}
.pat .at-nome{font-size:19px;font-weight:800}
.pat .at-sub{font-size:12.5px;color:var(--muted);margin-top:2px}
.pat .u-wrap{display:flex;flex-wrap:wrap;gap:6px;margin-top:14px}
.pat .u-chip{font-size:12.5px;font-weight:700;font-family:Consolas,monospace;background:var(--subtle);border:1px solid var(--line);color:var(--text);padding:4px 9px;border-radius:7px}
/* REGISTRAR RESERVA: dois campos curtos + botão, na mesma linha. Quadra e lote são numéricos e
   curtos, então caixas largas só atrapalhariam a digitação rápida no meio do atendimento. */
.pat .res-form{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}
.pat .res-in{width:74px;font-size:14px;font-weight:700;font-family:Consolas,monospace;text-align:center;background:var(--panel);border:1px solid var(--line);color:var(--text);padding:8px 6px;border-radius:8px}
.pat .res-in:focus{outline:none;border-color:var(--brand)}
.pat .res-lb{font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.pat .res-bt{font:inherit;font-size:13px;font-weight:800;background:var(--brand);color:#101820;border:none;padding:9px 16px;border-radius:8px;cursor:pointer}
.pat .res-bt:disabled{opacity:.5;cursor:not-allowed}
.pat .res-erro{width:100%;font-size:12.5px;color:var(--danger)}
.pat .pip-perso{display:inline-flex;align-items:center;gap:6px;margin-top:12px;font-size:11.5px;font-weight:800;color:var(--brand);background:var(--brand-soft);border:1px solid var(--brand);border-radius:20px;padding:4px 11px}
.pat .at-actions{display:flex;gap:8px;padding:2px 18px 16px}
.pat .at-actions button{flex:1;border-radius:11px;padding:12px 4px;font-size:13px;font-weight:700;cursor:pointer;border:1.5px solid var(--line-strong);background:var(--panel);color:var(--text2)}
.pat .at-actions .b-pausar:hover{background:var(--warn-soft);border-color:var(--warn);color:var(--warn)}
.pat .at-actions .b-direcionar:hover{background:var(--info-soft);border-color:var(--info);color:var(--info)}
.pat .at-actions .b-finalizar{background:var(--ok);border-color:var(--ok);color:#fff}
.pat .at-actions .b-finalizar:hover{filter:brightness(1.08)}
.pat .modal-ov{position:fixed;inset:0;background:rgba(18,23,34,.5);backdrop-filter:blur(2px);z-index:100;display:none;align-items:center;justify-content:center;padding:24px}
.pat .modal-ov.open{display:flex}
.pat .modal{background:var(--panel);border-radius:16px;box-shadow:0 24px 60px rgb(18 23 34 /.3);width:min(480px,94vw);padding:24px}
.pat .modal h3{font-size:19px;font-weight:800;margin-bottom:4px}
.pat .modal p{font-size:13px;color:var(--muted);margin-bottom:18px}
.pat .modal label{display:block;font-size:12px;font-weight:700;color:var(--text2);margin:14px 0 7px;letter-spacing:.03em}
.pat .dir-opts{display:flex;flex-wrap:wrap;gap:8px}
.pat .dir-opts button{border:1px solid var(--line);background:var(--panel);color:var(--text2);border-radius:10px;padding:10px 15px;font-size:13.5px;font-weight:700;cursor:pointer}
.pat .dir-opts button.on{background:var(--info-soft);color:var(--info);border-color:var(--info)}
.pat .modal textarea{width:100%;min-height:80px;border:1px solid var(--line);border-radius:11px;background:var(--subtle);color:var(--text);padding:12px;font:inherit;font-size:14px;resize:vertical}
.pat .modal-acts{display:flex;gap:10px;margin-top:20px}
.pat .modal-acts button{flex:1;border-radius:11px;padding:13px;font-size:14px;font-weight:700;cursor:pointer;border:1px solid var(--line-strong);background:var(--panel);color:var(--text2)}
.pat .modal-acts .conf{background:var(--info);border-color:var(--info);color:#fff}
.pat .modal select{width:100%;border:1px solid var(--line);border-radius:11px;background:var(--subtle);color:var(--text);padding:12px;font:inherit;font-size:14px}
.pat .bip-scan{display:flex;align-items:center;gap:14px;border:1.5px dashed var(--line-strong);border-radius:12px;padding:16px;background:var(--subtle)}
.pat .bip-scan svg{width:34px;height:34px;color:var(--text2);flex-shrink:0}
.pat .bip-scan.lido{border-style:solid;border-color:var(--ok);background:var(--ok-soft)}
.pat .bip-scan.lido svg{color:var(--ok)}
.pat .bs-nome{font-size:16px;font-weight:800}
.pat .bs-cod{font-size:12px;color:var(--muted);font-family:Consolas,monospace;margin-top:2px}
.pat .pa-shot{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;border:1.5px dashed var(--line-strong);border-radius:12px;padding:22px;cursor:pointer;color:var(--text2);background:var(--subtle);transition:all .15s}
.pat .pa-shot:hover{border-color:var(--brand);color:var(--brand)}
.pat .pa-shot svg{width:30px;height:30px}
.pat .pa-shot.ok{border-style:solid;border-color:var(--ok);background:var(--ok-soft);color:var(--ok)}
.pat .chk{display:flex;align-items:center;gap:9px;cursor:pointer;font-size:14px;font-weight:700;color:var(--text);margin-top:14px}
.pat .chk small{font-weight:400;color:var(--muted)}
.pat .chk .box{width:20px;height:20px;border:1.5px solid var(--line-strong);border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center}
.pat .chk .box.on{background:var(--brand);border-color:var(--brand)}
.pat .chk .box.on::after{content:"✓";color:#fff;font-size:13px;font-weight:900}
.pat #bip-modal{background:rgba(8,11,17,.62);backdrop-filter:blur(7px);padding:40px}
.pat #bip-modal .modal{width:min(640px,94vw);border-radius:24px;box-shadow:0 40px 100px rgba(0,0,0,.5);padding:38px 40px 34px}
.pat #bip-modal h3{font-size:26px}
.pat #bip-modal>.modal>p{font-size:14.5px;margin-bottom:22px}
.pat #bip-modal .bip-scan{padding:22px 24px;gap:18px;border-radius:16px}
.pat #bip-modal .bip-scan svg{width:44px;height:44px}
.pat #bip-modal .bs-nome{font-size:24px}
.pat #bip-modal .bs-cod{font-size:13px}
.pat #bip-modal .modal-acts{margin-top:26px;gap:14px}
.pat #bip-modal .modal-acts button{padding:17px;font-size:16px;border-radius:14px}
.pat .bip-manual{margin-top:14px}
.pat .bm-label{font-size:12.5px;color:var(--muted)}
.pat .bm-row{display:flex;gap:8px;margin-top:7px}
.pat .bm-row input{flex:1;border:1px solid var(--line);border-radius:11px;background:var(--subtle);color:var(--text);padding:12px;font:inherit;font-size:14px;text-transform:uppercase}
.pat .bm-row button{border:1px solid var(--line-strong);background:var(--panel);color:var(--text);border-radius:11px;padding:0 16px;font:inherit;font-size:13.5px;font-weight:700;cursor:pointer}
.pat .bm-row button:hover{border-color:var(--brand);color:var(--brand)}
.pat #cli-modal .modal{padding:0}
.pat .cli-card{width:min(560px,94vw);max-height:88vh;overflow:hidden;display:flex;flex-direction:column}
.pat .cli-head{display:flex;align-items:center;gap:16px;padding:24px 26px 18px}
.pat .cli-av{width:58px;height:58px;border-radius:15px;background:var(--subtle);color:var(--text2);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;flex-shrink:0}
.pat .cli-hi{flex:1;min-width:0}
.pat .cli-nome{font-size:22px;font-weight:800}
.pat .cli-sub{font-size:13.5px;color:var(--muted);margin-top:2px}
.pat #cli-perso{margin-top:7px}
.pat .cli-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px 18px;padding:4px 26px 6px}
.pat .cli-lb{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
.pat .cli-vl{font-size:14.5px;font-weight:600;margin-top:2px}
.pat .cli-sec{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:16px 26px 8px}
.pat #cli-unids{padding:0 26px}
.pat .clt{padding:4px 26px 8px;overflow-y:auto}
.pat .clt-item{display:flex;gap:13px;position:relative;padding-bottom:15px}
.pat .clt-item:not(.last)::before{content:"";position:absolute;left:6px;top:15px;bottom:0;width:2px;background:var(--ok)}
.pat .clt-dot{width:14px;height:14px;border-radius:50%;background:var(--ok);flex-shrink:0;margin-top:2px}
.pat .clt-item.cur .clt-dot{background:var(--info);box-shadow:0 0 0 4px var(--info-soft)}
.pat .clt-t{font-size:13.5px;font-weight:600}
.pat .clt-w{font-size:11.5px;color:var(--muted);margin-top:1px;font-variant-numeric:tabular-nums}
.pat #cli-modal .modal-acts{padding:12px 26px 22px}
.pat .chamada-ov{position:fixed;inset:0;background:rgba(8,11,17,.62);backdrop-filter:blur(7px);z-index:110;display:none;align-items:center;justify-content:center;padding:40px}
.pat .chamada-ov.open{display:flex;animation:pat-cfade .22s ease}
@keyframes pat-cfade{from{opacity:0}to{opacity:1}}
.pat .chamada-card{background:var(--panel);border:1px solid var(--line);border-radius:26px;box-shadow:0 40px 100px rgba(0,0,0,.55);padding:48px 60px 40px;text-align:center;max-width:760px;width:100%;animation:pat-cpop .3s cubic-bezier(.2,.9,.3,1.2)}
@keyframes pat-cpop{from{transform:scale(.9);opacity:.4}to{transform:scale(1);opacity:1}}
.pat .chamada-card .cring{display:inline-flex;align-items:center;gap:10px;font-size:14px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:var(--info)}
.pat .chamada-card .cring .pulse{width:12px;height:12px;border-radius:50%;background:var(--info);animation:pat-pulse 1.3s infinite}
@keyframes pat-pulse{50%{opacity:.35;box-shadow:0 0 0 8px var(--info-soft)}}
.pat .chamada-card .cnome{font-size:clamp(48px,7vw,80px);font-weight:800;line-height:1.02;margin-top:18px}
.pat .chamada-card .cimob{font-size:18px;color:var(--muted);margin-top:8px}
.pat .chamada-card .cdest{display:inline-flex;align-items:center;gap:10px;margin-top:26px;background:var(--info-soft);color:var(--info);border:2px solid var(--info);border-radius:40px;padding:14px 34px;font-size:26px;font-weight:800}
.pat .chamada-card .ctimer{font-size:14px;color:var(--muted);margin-top:16px;font-variant-numeric:tabular-nums}
.pat .chamada-card .cacts{display:flex;gap:12px;margin-top:30px}
.pat .chamada-card .cacts button{flex:1;border-radius:14px;padding:18px;font-size:16px;font-weight:800;cursor:pointer;border:1.5px solid var(--line-strong);background:var(--panel);color:var(--text2)}
.pat .cb-rechamar:hover{background:var(--subtle)}
.pat .cb-ausencia{background:var(--danger-soft)!important;color:var(--danger)!important;border-color:var(--danger)!important}
.pat .cb-ausencia:hover{background:var(--danger)!important;color:#fff!important}
.pat .cb-compareceu{background:var(--ok)!important;color:#fff!important;border-color:var(--ok)!important}
.pat .cb-compareceu:hover{filter:brightness(1.08)}
.pat #toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(20px);background:#232832;color:#fff;padding:14px 24px;border-radius:14px;font-size:15px;font-weight:700;display:flex;align-items:center;gap:12px;box-shadow:0 12px 40px rgba(0,0,0,.35);opacity:0;pointer-events:none;transition:all .3s;z-index:120}
.pat #toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.pat #toast .wpp{font-size:12px;font-weight:400;opacity:.8;border-left:1px solid rgba(255,255,255,.2);padding-left:12px}
.pat #toast .tw-ic{color:#25d366;display:inline-flex;align-items:center}
.pat .kpis{display:none;grid-template-columns:repeat(4,1fr);gap:14px;padding:16px 16px 0}
.pat.can-atender .kpis{display:grid}
.pat.em-atendimento:not(.pip-out) .kpis{display:none}
.pat .kpi{display:flex;align-items:center;gap:13px;background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:var(--shadow-sm);padding:15px 18px}
.pat .kpi-ic{width:40px;height:40px;border-radius:11px;background:var(--subtle);color:var(--text2);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.pat .kpi-ic svg{width:20px;height:20px}
.pat .kpi.ok .kpi-ic{background:var(--ok-soft);color:var(--ok)}
.pat .kpi.info .kpi-ic{background:var(--info-soft);color:var(--info)}
.pat .kpi.warn .kpi-ic{background:var(--warn-soft);color:var(--warn)}
.pat .kpi.danger .kpi-ic{background:var(--danger-soft);color:var(--danger)}
.pat .kpi-vl{font-size:24px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1}
.pat .kpi-lb{font-size:12px;color:var(--muted);margin-top:3px}
`;
