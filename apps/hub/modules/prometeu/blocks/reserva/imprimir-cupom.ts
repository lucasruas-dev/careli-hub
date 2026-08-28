import { codigoDoCupom } from "@/lib/prometeu/cupom";

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
  // DE ONDE VEIO O CLIENTE — "IMOBILIÁRIA · Corretor", já montado por
  // origemDoClienteParaExibir. `null` quando não há nenhum dos dois: o cupom não desenha
  // rótulo órfão, mesma regra da tela.
  origem: null | string;
  // Só os NOMES dos demais proponentes (o titular é o `cliente`). Vazio = titular sozinho.
  //
  // ⚠️ SEM PERCENTUAL AQUI (Lucas, 28/08: "pode tirar os 50%, isso só vai na PA"). A
  // participação de cada um é cláusula da proposta de aquisição, não do comprovante — o cupom
  // existe para o cliente levar até a impressão da PA, e é lá que a divisão aparece.
  outrosProponentes: { nome: string }[];
  // URL ABSOLUTA da logo da C2X. Dentro do iframe about:blank um caminho relativo não resolve —
  // mesma lição da etiqueta (imprimir-etiquetas.ts).
  logoSrc: string;
  qrDataUrl: string;
  unidades: { lote: string; quadra: string }[];
};

// ⚠️ NA TÉRMICA, TUDO É NEGRITO — E NADA DESCE DE 11px.
//
// A prova saiu do primeiro cupom impresso de verdade (28/08/2026): o que estava em peso 700
// (empreendimento, nome, lotes, código) saiu perfeito, e o que estava em peso normal saiu
// apagado a ponto de "COMPROVANTE DE RESERVA" imprimir como "COMPROVANTE DE PESERVA" — o R
// simplesmente não marcou. A data e o aviso do rodapé, os menores da folha, saíram quase
// invisíveis.
//
// A causa não é a impressora, é o meio-tom: o Chrome rasteriza texto fino com antialiasing, ou
// seja, em CINZA. A térmica não tem cinza — ela queima o ponto ou não queima — então o driver
// aproxima o cinza por pontilhado e o traço de 1px vira uma fileira de furos. Fonte pequena,
// peso normal e letter-spacing largo (o subtítulo tinha 0.18em) somam para o mesmo lugar.
//
// Daí as três regras deste bloco, que valem para QUALQUER coisa nova que entrar no cupom:
//   1. font-weight 700 no body, sem exceção — não existe texto de peso normal em papel térmico;
//   2. nada abaixo de 11px;
//   3. -webkit-font-smoothing: none, para o Chrome parar de suavizar a borda das letras.
// O teste ao lado (imprimir-cupom.test.ts) trava as três.
export const CUPOM_CSS = `
  @page { size: 80mm auto; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: 72mm; margin: 0 auto;
    font-family: "Courier New", monospace;
    font-weight: 700;
    color: #000;
    -webkit-font-smoothing: none;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }
  .cup { padding: 0 0 6mm; text-align: center; }

  /* A FAIXA PRETA — o mesmo desenho da etiqueta da credencial, que já sai nítido na
     Honeywell há semanas: fundo sólido e a logo invertida por filtro. */
  .cup-topo {
    background: #000; color: #fff;
    display: flex; align-items: center; justify-content: space-between;
    gap: 3mm; padding: 2mm 3mm;
    print-color-adjust: exact; -webkit-print-color-adjust: exact;
  }
  .cup-logo { height: 6mm; width: auto; flex-shrink: 0; filter: brightness(0) invert(1); }
  .cup-selo { font-size: 13px; letter-spacing: 0.22em; }

  .cup-corpo { padding: 0 1mm; }

  .cup-emp { font-size: 14px; letter-spacing: 0.04em; text-transform: uppercase; margin-top: 3mm; }
  .cup-dataev { font-size: 12px; margin-top: 0.6mm; }

  /* Régua sólida separa BLOCO; a tracejada, item dentro do bloco. */
  .cup-regua { border-top: 2px solid #000; margin: 3mm 0 2.5mm; }
  .cup-rot { font-size: 11px; letter-spacing: 0.18em; }

  .cup-cli { font-size: 14px; margin-top: 1.2mm; text-transform: uppercase; word-wrap: break-word; }
  .cup-prop { font-size: 11px; margin-top: 0.8mm; }
  .cup-org { font-size: 11px; margin-top: 1.5mm; text-transform: uppercase; }

  .cup-lotes { margin-top: 1.5mm; }
  .cup-lote {
    border: 1px solid #000;
    font-size: 15px; letter-spacing: 0.04em;
    padding: 1.4mm 1mm; margin-top: 1.2mm;
  }

  .cup-qr img { width: 32mm; height: 32mm; margin-top: 1mm; }
  /* O código em bloco invertido: é o que a secretária confere de relance quando o bip falha. */
  .cup-cod {
    background: #000; color: #fff;
    font-size: 15px; letter-spacing: 0.2em;
    padding: 1.4mm 1mm; margin-top: 1.5mm;
    print-color-adjust: exact; -webkit-print-color-adjust: exact;
  }
  .cup-data { font-size: 12px; margin-top: 2mm; }
  .cup-aviso { font-size: 11px; margin-top: 2.5mm; line-height: 1.4; }
`;

function esc(valor: string | null | undefined): string {
  return (valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function cupomHTML(dados: DadosDoCupom): string {
  const lotes = dados.unidades
    .map(
      (u) =>
        `<div class="cup-lote">QUADRA ${esc(u.quadra)} · LOTE ${esc(u.lote)}</div>`,
    )
    .join("");

  const outros = dados.outrosProponentes
    .map((p) => `<div class="cup-prop">+ ${esc(p.nome)}</div>`)
    .join("");

  // A imobiliária fecha o bloco de gente. Some por inteiro quando não existe — nada de rótulo
  // órfão, mesma regra da tela.
  const origem = dados.origem
    ? `<div class="cup-org">${esc(dados.origem)}</div>`
    : "";

  // O rótulo do lançamento chega como "RESIDENCIAL VILLA PARIS · 22/08/2026". No papel os dois
  // pedem pesos diferentes, então quebram em duas linhas; sem o separador, o nome ocupa tudo.
  const [nomeDoEvento, ...restoDoEvento] = dados.evento.split(" · ");
  const dataDoEvento = restoDoEvento.join(" · ");

  const plural =
    dados.unidades.length === 1 ? "LOTE RESERVADO" : "LOTES RESERVADOS";

  return `<div class="cup">
    <div class="cup-topo">
      <img class="cup-logo" src="${esc(dados.logoSrc)}" alt="C2X">
      <div class="cup-selo">RESERVA</div>
    </div>
    <div class="cup-corpo">
      <div class="cup-emp">${esc(nomeDoEvento ?? dados.evento)}</div>
      ${dataDoEvento ? `<div class="cup-dataev">${esc(dataDoEvento)}</div>` : ""}
      <div class="cup-regua"></div>
      <div class="cup-rot">CLIENTE</div>
      <div class="cup-cli">${esc(dados.cliente)}</div>
      ${outros}
      ${origem}
      <div class="cup-regua"></div>
      <div class="cup-rot">${plural} · ${dados.unidades.length}</div>
      <div class="cup-lotes">${lotes}</div>
      <div class="cup-regua"></div>
      <div class="cup-qr"><img src="${dados.qrDataUrl}" alt=""></div>
      <div class="cup-cod">${esc(codigoDoCupom(dados.grupoId))}</div>
      <div class="cup-data">${esc(dados.dataHora)}</div>
      <div class="cup-aviso">Apresente este comprovante na área de impressão para retirar a proposta de aquisição.</div>
    </div>
  </div>`;
}

// A logo em URL ABSOLUTA: dentro do iframe about:blank um caminho relativo não resolveria.
// Mesma peça da etiqueta (imprimir-etiquetas.ts) e o mesmo arquivo — a marca do cupom e a da
// credencial não podem divergir.
export function logoDoCupom(): string {
  return new URL("/prometeu/c2x-logo.png", window.location.origin).toString();
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
export async function imprimirCupomDaReserva(
  dados: DadosDoCupom,
): Promise<void> {
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
