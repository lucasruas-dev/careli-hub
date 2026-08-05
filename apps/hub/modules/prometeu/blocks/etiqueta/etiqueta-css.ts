// CSS da etiqueta térmica — VISUAL copiado LITERALMENTE de public/prometeu/etiqueta.html.
//
// NÃO reescrever em Tailwind, não "limpar", não converter mm para rem. Cada número aqui foi
// descoberto na tentativa e erro contra a impressora real (Honeywell PC42t, 203dpi, 100x50mm) e
// está documentado em [[reference-prometeu-etiqueta-termica]].
//
// Só o VISUAL das etiquetas. As regras de PÁGINA (@page, break-after, reset) ficam no
// ETIQUETA_PRINT_DOC_CSS abaixo, porque a impressão acontece num documento isolado (iframe).
const ETIQUETA_ESTILO_BASE = `
.etq{width:100mm;height:50mm;padding:1.4mm;background:#fff;color:#000;overflow:hidden;display:flex;flex-direction:column;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}
.etq *{box-sizing:border-box}
.etq-top{background:#000;color:#fff;padding:1.0mm 3mm;display:flex;align-items:center;justify-content:space-between;gap:3mm;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.etq-top-l{min-width:0}
.etq-emp{font-size:10.5pt;font-weight:800;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.etq-data{font-size:6.5pt;font-weight:700;letter-spacing:.04em;opacity:.9;margin-top:.4mm;white-space:nowrap}
.etq-logo{height:5.5mm;width:auto;flex-shrink:0;filter:brightness(0) invert(1)}
.etq-body{flex:1;display:flex;gap:5mm;padding:1.2mm 3mm;align-items:center;min-height:0}
.etq-qrbox{display:flex;flex-direction:column;align-items:center;gap:.8mm;flex-shrink:0}
.etq-qr{width:26mm;height:26mm}
.etq-qr img,.etq-qr svg{display:block;width:100%;height:100%}
.etq-cod{font-size:6.5pt;font-weight:800;color:#000;letter-spacing:.02em;font-family:Consolas,monospace;white-space:nowrap}
.etq-cod i{font-style:normal;font-weight:600;opacity:.55;margin-right:.5mm}
.etq-dados{flex:1;min-width:0}
.etq-nome{font-size:15pt;font-weight:800;line-height:1.06;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.etq-imob{font-size:9.5pt;font-weight:700;margin-top:1mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.etq-cor{font-size:8pt;margin-top:.6mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.etq-foot{background:#000;color:#fff;padding:1.0mm 3mm;display:flex;justify-content:space-between;gap:2mm;font-size:8pt;font-weight:800;font-family:Consolas,monospace;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.etq-foot span{white-space:nowrap}
.etq-foot i{font-style:normal;font-weight:600;opacity:.7;margin-right:.6mm}

/* PIX PAGO: marca sem texto, pro time interno saber na hora que há R$ 1.000 a abater.
   Círculo BRANCO SÓLIDO com o símbolo preto dentro, na barra preta do topo: é o maior contraste
   possível numa impressão monocromática de 203dpi, e sobrevive ao papel amassado. Nada de traço
   fino ou cinza — a cabeça térmica perde. */
.etq-pix{width:6.2mm;height:6.2mm;border-radius:50%;background:#fff;color:#000;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:8.5pt;font-weight:900;font-family:Arial,Helvetica,sans-serif;line-height:1;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.etq-top-r{display:flex;align-items:center;gap:2.2mm;flex-shrink:0}
`;

// Estilo do PREVIEW na tela do app: o visual + a etiqueta ampliada para o operador conferir.
export const ETIQUETA_TELA_CSS = `
${ETIQUETA_ESTILO_BASE}
.etq-preview .etq{transform:scale(1.9);box-shadow:0 16px 50px rgba(0,0,0,.25)}
`;

// CSS do DOCUMENTO DE IMPRESSÃO (o iframe isolado). É aqui que mora tudo que decide a página
// física. A impressão NÃO sai da página do hub, e sim de um documento próprio, escrito num
// iframe — do mesmo jeito que o mockup public/prometeu/etiqueta.html fazia e que já foi validado
// na Honeywell. Isso é o que garante que o @page{size:100mm 50mm} valha: sem o CSS global do hub
// nem um driver com preset de papel diferente competindo, a etiqueta ocupa a folha inteira, em
// vez de sair pequena num canto (o que acontecia ao imprimir a página do app direto).
export const ETIQUETA_PRINT_DOC_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100mm;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
${ETIQUETA_ESTILO_BASE}
/* Cada etiqueta = exatamente uma página de 100x50mm; não quebra no meio. */
.etq{break-inside:avoid;page-break-inside:avoid;break-after:page;page-break-after:always}
/* Sem quebra depois da última: evita a etiqueta em branco no fim do lote. */
.etq:last-child{break-after:auto;page-break-after:auto}
@page{size:100mm 50mm;margin:0}
`;
