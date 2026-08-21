import { ETIQUETA_PRINT_DOC_CSS } from "./etiqueta-css";
import { codigoDaCredencial } from "@/lib/prometeu/credencial";
import type { PrometeuCredenciado } from "@/lib/prometeu/types";

// IMPRESSÃO da etiqueta térmica num DOCUMENTO ISOLADO (iframe), não na página do hub.
//
// Por quê iframe: o mockup public/prometeu/etiqueta.html imprimia de dentro de um iframe e saía
// certo na Honeywell. Ao portar para React, a primeira versão chamava window.print() na página
// inteira do app — e a etiqueta saía PEQUENA num canto, porque o CSS global do hub e o preset de
// papel do driver competiam com o @page{size:100mm 50mm}. Escrevendo as etiquetas num iframe
// próprio, o único CSS que existe é o da etiqueta, o @page vale, e a folha sai como no mockup.

type DadosEtiqueta = {
  credenciado: PrometeuCredenciado;
  qrDataUrl: string;
};

// Escapa texto que vai para dentro do HTML: nome com "&" ou "<" quebraria a etiqueta.
function esc(valor: string | null | undefined): string {
  return (valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function documentoBR(doc: string | null): string {
  const d = (doc ?? "").replace(/\D/g, "");
  if (d.length !== 11) return doc ?? "";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function telefoneBR(tel: string | null | undefined): string {
  const d = (tel ?? "").replace(/\D/g, "");
  const s = d.startsWith("55") ? d.slice(2) : d;
  if (s.length === 11) return `(${s.slice(0, 2)}) ${s.slice(2, 7)}-${s.slice(7)}`;
  if (s.length === 10) return `(${s.slice(0, 2)}) ${s.slice(2, 6)}-${s.slice(6)}`;
  return tel?.trim() ?? "";
}

// O HTML de UMA etiqueta — mesma marcação do componente React e do mockup, para o CSS valer.
function etiquetaHTML(
  { credenciado, qrDataUrl }: DadosEtiqueta,
  contexto: { dataEvento: string; empreendimento: string; logoSrc: string },
): string {
  const pago = Boolean(credenciado.pagoEm);
  const dataLinha = contexto.dataEvento
    ? `CREDENCIAL · ${esc(contexto.dataEvento)}`
    : "CREDENCIAL";

  return `<div class="etq">
    <div class="etq-top">
      <div class="etq-top-l">
        <div class="etq-emp">${esc(contexto.empreendimento.toUpperCase())}</div>
        <div class="etq-data">${dataLinha}</div>
      </div>
      <div class="etq-top-r">
        ${pago ? `<span class="etq-pix" title="PIX de R$ 1.000 já pago">&#10003;</span>` : ""}
        <img class="etq-logo" src="${esc(contexto.logoSrc)}" alt="C2X">
      </div>
    </div>
    <div class="etq-body">
      <div class="etq-qrbox">
        <div class="etq-qr"><img src="${qrDataUrl}" alt=""></div>
        <div class="etq-cod">${esc(codigoDaCredencial(credenciado.id))}</div>
      </div>
      <div class="etq-dados">
        <div class="etq-nome">${esc(credenciado.nome)}</div>
        <div class="etq-imob">${esc(credenciado.imobiliaria ?? "")}</div>
        <div class="etq-cor">${
          credenciado.corretor ? `Corretor: ${esc(credenciado.corretor)}` : ""
        }</div>
      </div>
    </div>
    <div class="etq-foot">
      <span><i>CPF</i>${esc(documentoBR(credenciado.documento))}</span>
      <span><i>TEL</i>${esc(telefoneBR(credenciado.telefone))}</span>
    </div>
  </div>`;
}

// O CORRETOR não é um credenciado: ele não tem CAD, não faz check-in e não tem código de fila.
// Por isso é um tipo próprio, e não um `PrometeuCredenciado` meio preenchido — que obrigaria a
// inventar id e documento para satisfazer o formato.
export type CorretorParaEtiqueta = { imobiliaria: null | string; nome: string };

// A etiqueta do corretor: MESMA caixa, miolo diferente.
//
// ⚠️ SEM QR, de propósito (decisão do Lucas, 21/08). O QR do cliente carrega o id do credenciado e
// serve ao check-in; o corretor não passa por esse fluxo. Tirá-lo libera a largura inteira para o
// nome, que é o que faz o crachá ser lido de longe no salão.
function etiquetaCorretorHTML(
  corretor: CorretorParaEtiqueta,
  contexto: { dataEvento: string; empreendimento: string; logoSrc: string },
): string {
  const dataLinha = contexto.dataEvento
    ? `CORRETOR · ${esc(contexto.dataEvento)}`
    : "CORRETOR";

  return `<div class="etq etq-corretor">
    <div class="etq-top">
      <div class="etq-top-l">
        <div class="etq-emp">${esc(contexto.empreendimento.toUpperCase())}</div>
        <div class="etq-data">${dataLinha}</div>
      </div>
      <div class="etq-top-r">
        <img class="etq-logo" src="${esc(contexto.logoSrc)}" alt="C2X">
      </div>
    </div>
    <div class="etq-body">
      <div class="etq-dados">
        <div class="etq-nome">${esc(corretor.nome)}</div>
        <div class="etq-imob">${esc(corretor.imobiliaria ?? "")}</div>
        <div class="etq-selo">CORRETOR</div>
      </div>
    </div>
  </div>`;
}

// Espera todas as imagens do documento carregarem antes de mandar para a impressora: disparar o
// print com o logo ou o QR ainda carregando queima etiqueta física em branco. O QR é data URL
// (instantâneo), mas o logo vem da rede.
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

// O MOTOR DA IMPRESSÃO, separado do CONTEÚDO: monta o documento isolado, espera as imagens e
// dispara o print. Cliente e corretor imprimem pelo mesmo caminho — o que muda é só o HTML de cada
// etiqueta, e é por isso que o ajuste fino contra a Honeywell vale para os dois de uma vez.
async function imprimirDocumento(corpo: string, aoDisparar?: () => void): Promise<void> {
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
    `<!doctype html><html><head><meta charset="utf-8"><style>${ETIQUETA_PRINT_DOC_CSS}</style></head><body>${corpo}</body></html>`,
  );
  doc.close();

  await esperarImagens(doc);

  let finalizado = false;
  const limpar = () => {
    if (finalizado) return;
    finalizado = true;
    // Deixa o diálogo fechar antes de arrancar o iframe do DOM.
    window.setTimeout(() => iframe.remove(), 500);
  };

  win.addEventListener("afterprint", limpar, { once: true });
  // Rede de segurança: se o afterprint não vier (varia por navegador), remove assim mesmo.
  window.setTimeout(limpar, 60_000);

  win.focus();
  win.print();
  aoDisparar?.();
}

// O logo em URL absoluta: dentro do iframe about:blank, um caminho relativo não resolveria.
function logoAbsoluto(): string {
  return new URL("/prometeu/c2x-logo.png", window.location.origin).toString();
}

// AS ETIQUETAS DOS CORRETORES (Lucas, 21/08: *"fazer as etiquetas também dos corretores, seria
// muito bacana"*). Sem carimbo de "impressa": o corretor não tem linha na fila para carimbar.
export async function imprimirEtiquetasCorretor(
  corretores: CorretorParaEtiqueta[],
  contexto: { dataEvento: string; empreendimento: string },
): Promise<void> {
  if (corretores.length === 0) return;

  const logoSrc = logoAbsoluto();
  const corpo = corretores
    .map((c) => etiquetaCorretorHTML(c, { ...contexto, logoSrc }))
    .join("");

  await imprimirDocumento(corpo);
}

export async function imprimirEtiquetas(
  etiquetas: DadosEtiqueta[],
  contexto: {
    dataEvento: string;
    empreendimento: string;
    // Chamado quando a impressão foi disparada (para carimbar etiqueta_impressa_em).
    aoImprimir: (ids: string[]) => void;
  },
): Promise<void> {
  if (etiquetas.length === 0) return;

  const logoSrc = logoAbsoluto();
  const corpo = etiquetas
    .map((e) => etiquetaHTML(e, { ...contexto, logoSrc }))
    .join("");

  // O carimbo é otimista (o diálogo pode ser cancelado), mas é o comportamento certo aqui: o
  // operador imprime lotes grandes e reimprimir é barato; deixar "não impressa" quem saiu é que
  // faria o time reimprimir o lote inteiro por segurança.
  await imprimirDocumento(corpo, () =>
    contexto.aoImprimir(etiquetas.map((e) => e.credenciado.id)),
  );
}
