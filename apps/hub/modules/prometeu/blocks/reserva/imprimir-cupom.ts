import { codigoDoCupom } from "@/lib/prometeu/reservas-evento";

// O CUPOM DE RESERVA — térmica 80mm, estilo cupom fiscal (Lucas, 24/08).
//
// Sai na confirmação da reserva e é o elo físico do fluxo: o cliente o leva à área de
// impressão da PA, onde o QR (grupo_id da reserva) é bipado e as folhas de PA saem — uma por
// unidade. Mesmo desenho de impressão da etiqueta: DOCUMENTO ISOLADO em iframe, para o CSS do
// hub e o preset do driver não brigarem com o @page de 80mm (lição da Honeywell, 21/08).

type DadosDoCupom = {
  cliente: string;
  codigoEvento: string;
  dataHora: string;
  evento: string;
  grupoId: string;
  // Nomes + % dos DEMAIS proponentes (o titular é o `cliente`). Vazio = titular a 100%.
  outrosProponentes: { nome: string; percentual: number }[];
  qrDataUrl: string;
  unidades: { lote: string; quadra: string }[];
};

const CUPOM_CSS = `
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { width: 72mm; margin: 0 auto; font-family: "Courier New", monospace; color: #000; }
  .cup { padding: 4mm 1mm 6mm; text-align: center; }
  .cup-emp { font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  .cup-tit { font-size: 11px; margin-top: 1mm; letter-spacing: 0.18em; }
  .cup-sep { border-top: 1px dashed #000; margin: 2.5mm 0; }
  .cup-cli { font-size: 13px; font-weight: 700; text-transform: uppercase; word-wrap: break-word; }
  .cup-lotes { margin-top: 2mm; }
  .cup-lote { font-size: 15px; font-weight: 700; letter-spacing: 0.06em; padding: 0.8mm 0; }
  .cup-qr img { width: 30mm; height: 30mm; margin-top: 1mm; }
  .cup-cod { font-size: 13px; font-weight: 700; letter-spacing: 0.14em; margin-top: 1mm; }
  .cup-data { font-size: 10px; margin-top: 2mm; }
  .cup-aviso { font-size: 9px; margin-top: 2.5mm; line-height: 1.35; }
`;

function esc(valor: string | null | undefined): string {
  return (valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cupomHTML(dados: DadosDoCupom): string {
  const lotes = dados.unidades
    .map((u) => `<div class="cup-lote">QUADRA ${esc(u.quadra)} · LOTE ${esc(u.lote)}</div>`)
    .join("");

  const outros = dados.outrosProponentes
    .map(
      (p) =>
        `<div style="font-size:10px;margin-top:0.6mm">+ ${esc(p.nome)} · ${String(p.percentual).replace(".", ",")}%</div>`,
    )
    .join("");

  return `<div class="cup">
    <div class="cup-emp">${esc(dados.evento)}</div>
    <div class="cup-tit">COMPROVANTE DE RESERVA</div>
    <div class="cup-sep"></div>
    <div class="cup-cli">${esc(dados.cliente)}</div>
    ${outros}
    <div class="cup-lotes">${lotes}</div>
    <div class="cup-sep"></div>
    <div class="cup-qr"><img src="${dados.qrDataUrl}" alt=""></div>
    <div class="cup-cod">${esc(codigoDoCupom(dados.grupoId))}</div>
    <div class="cup-data">${esc(dados.dataHora)}</div>
    <div class="cup-aviso">Apresente este comprovante na área de impressão para retirar a proposta de aquisição.</div>
  </div>`;
}

function esperarImagens(doc: Document): Promise<void> {
  const imagens = Array.from(doc.images);
  return Promise.all(
    imagens.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolver) => {
            img.addEventListener("load", () => resolver(), { once: true });
            img.addEventListener("error", () => resolver(), { once: true });
          }),
    ),
  ).then(() => undefined);
}

/**
 * Imprime o cupom num documento isolado. Com o Chrome da posição em modo quiosque
 * (--kiosk-printing), o papel sai DIRETO na térmica padrão, sem diálogo — zero cliques.
 */
export async function imprimirCupomDaReserva(dados: DadosDoCupom): Promise<void> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    border: "0",
    bottom: "0",
    height: "0",
    position: "fixed",
    right: "0",
    width: "0",
  });
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><style>${CUPOM_CSS}</style></head><body>${cupomHTML(dados)}</body></html>`,
  );
  doc.close();

  await esperarImagens(doc);

  let finalizado = false;
  const limpar = () => {
    if (finalizado) return;
    finalizado = true;
    window.setTimeout(() => iframe.remove(), 500);
  };
  win.addEventListener("afterprint", limpar, { once: true });
  window.setTimeout(limpar, 60_000);

  win.focus();
  win.print();
}
