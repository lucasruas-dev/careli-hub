import { buildChronosMinutesContext } from "@/lib/chronos/minutes";
import type { ChronosMeeting } from "@/lib/chronos/types";

export function openChronosMinutesPrintWindow({
  meeting,
  minutes,
}: {
  meeting: ChronosMeeting;
  minutes: string;
}) {
  const html = buildChronosMinutesPrintHtml({ meeting, minutes });
  const iframe = document.createElement("iframe");

  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("title", "Impressao da ata Chronos");
  iframe.style.border = "0";
  iframe.style.height = "0";
  iframe.style.opacity = "0";
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.top = "0";
  iframe.style.width = "0";

  let cleanupTimeout: number | undefined;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) {
      return;
    }

    cleaned = true;

    if (cleanupTimeout) {
      window.clearTimeout(cleanupTimeout);
    }

    iframe.remove();
  };

  iframe.addEventListener("load", () => {
    const frameWindow = iframe.contentWindow;

    if (!frameWindow) {
      cleanup();
      openChronosMinutesBlobWindow(html, meeting);
      return;
    }

    cleanupTimeout = window.setTimeout(cleanup, 60_000);
    frameWindow.addEventListener("afterprint", cleanup, { once: true });

    window.setTimeout(() => {
      try {
        frameWindow.focus();
        frameWindow.print();
      } catch {
        cleanup();
        openChronosMinutesBlobWindow(html, meeting);
      }
    }, 250);
  });

  document.body.append(iframe);
  iframe.srcdoc = html;
}

function buildChronosMinutesPrintHtml({
  meeting,
  minutes,
}: {
  meeting: ChronosMeeting;
  minutes: string;
}) {
  const context = buildChronosMinutesContext(meeting);
  const watermarkUrl = `${window.location.origin}/chronos-minutes-watermark.png`;
  const letterheadTopUrl = `${window.location.origin}/chronos-minutes-letterhead-top.png`;
  const letterheadFooterUrl = `${window.location.origin}/chronos-minutes-letterhead-footer.png`;
  const title = `Ata ${meeting.protocol} - ${meeting.title}`;

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>${escapeChronosHtml(title)}</title>
    <style>
      @page { size: A4; margin: 0; }
      * { box-sizing: border-box; }
      html { background: #f4f7fa; }
      body {
        background: #ffffff;
        color: #101820;
        font-family: "Century Gothic", "Aptos", "Segoe UI", sans-serif;
        font-size: 9pt;
        line-height: 1.5;
        margin: 0;
        padding: 0;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      /* Timbrado via TABELA: o navegador repete o thead (topo) e o tfoot (rodape)
         em CADA pagina e RESERVA o espaco deles automaticamente -> o texto nunca
         sobrepoe, igual ao cabecalho/rodape nativo do Word do modelo. */
      .page-frame {
        border-collapse: collapse;
        width: 100%;
      }
      /* Filho DIRETO (> tr > td) de proposito: zera so as celulas do esqueleto da
         pagina, sem atingir as celulas das tabelas de conteudo aninhadas (ex.: Plano
         de acao), que mantem o grid das regras th, td (border 1px). */
      .page-frame > thead > tr > td,
      .page-frame > tfoot > tr > td,
      .page-frame > tbody > tr > td {
        border: 0;
      }
      .page-frame > thead > tr > td,
      .page-frame > tfoot > tr > td {
        padding: 0;
      }
      .letterhead-top {
        height: 30mm;
        overflow: hidden;
      }
      .letterhead-top img {
        display: block;
        height: auto;
        width: 100%;
      }
      /* Rodape FIXO no fim de TODA pagina (segue a pagina, nao o texto). O espaco e
         reservado pelo margin-bottom do @page para o conteudo nao sobrepor. */
      .letterhead-footer {
        bottom: 0;
        height: 20mm;
        left: 0;
        overflow: hidden;
        pointer-events: none;
        position: fixed;
        right: 0;
        z-index: 0;
      }
      /* tfoot invisivel: reserva o espaco do rodape nas paginas cheias (conteudo nao
         sobrepoe). Na ultima pagina curta ele "flutua" mas e invisivel; o rodape
         VISIVEL e o .letterhead-footer fixo, sempre no fundo fisico da pagina. */
      .footer-spacer {
        height: 22mm;
      }
      .letterhead-footer img {
        bottom: 0;
        display: block;
        height: auto;
        position: absolute;
        width: 100%;
      }
      .watermark {
        background: url("${watermarkUrl}") center / contain no-repeat;
        inset: 0;
        opacity: 0.08;
        pointer-events: none;
        position: fixed;
        z-index: 0;
      }
      .content-cell {
        padding: 8mm 25.4mm;
      }
      .chronos-document {
        position: relative;
        z-index: 1;
      }
      header {
        align-items: flex-start;
        border-bottom: 1px solid #eadfcb;
        display: flex;
        justify-content: space-between;
        margin-bottom: 12px;
        padding-bottom: 8px;
      }
      h1, h2, h3, p, ul, ol { margin: 0; }
      h1 { font-size: 13pt; font-weight: 700; line-height: 1.5; }
      h2 { font-size: 10pt; font-weight: 700; line-height: 1.5; margin-top: 10px; }
      h3 { color: #344054; font-size: 9.5pt; font-weight: 700; line-height: 1.5; margin-top: 7px; }
      p { line-height: 1.5; text-align: justify; }
      ul, ol { padding-left: 16px; }
      li { line-height: 1.5; margin: 0; }
      strong { font-weight: 700; }
      table {
        border-collapse: collapse;
        font-size: 9pt;
        line-height: 1.5;
        margin-top: 4px;
        width: 100%;
      }
      /* Tabela de conteudo pode quebrar entre paginas (evita pagina em branco),
         mas cada LINHA fica inteira (evita celula rachada no meio da quebra). */
      .content-cell table tr {
        page-break-inside: avoid;
      }
      th, td {
        border: 1px solid #d9e0e7;
        font-size: 9pt;
        line-height: 1.5;
        padding: 4px 5px;
        text-align: left;
        vertical-align: top;
      }
      th { background: #f3f6fa; font-weight: 700; }
      .meta {
        color: #526078;
        font-size: 8pt;
        font-weight: 700;
      }
      .eyebrow {
        color: #A07C3B;
        font-size: 8pt;
        font-weight: 700;
        letter-spacing: 0;
        text-transform: uppercase;
      }
      .footer {
        border-top: 1px solid #eadfcb;
        color: #A07C3B;
        font-size: 7pt;
        font-weight: 700;
        margin-top: 16px;
        padding-top: 6px;
      }
      @media print {
        html,
        body {
          background: #ffffff;
        }
      }
    </style>
  </head>
  <body>
    <div aria-hidden="true" class="watermark"></div>
    <div aria-hidden="true" class="letterhead-footer"><img alt="" src="${letterheadFooterUrl}" /></div>
    <table class="page-frame">
      <thead><tr><td>
        <div aria-hidden="true" class="letterhead-top"><img alt="" src="${letterheadTopUrl}" /></div>
      </td></tr></thead>
      <tfoot><tr><td><div class="footer-spacer"></div></td></tr></tfoot>
      <tbody><tr><td class="content-cell">
        <main class="chronos-document">
      <header>
        <div>
          <p class="eyebrow">Chronos</p>
          <h1>Ata de reunião</h1>
          <p class="meta">${escapeChronosHtml(meeting.protocol)} | ${escapeChronosHtml(meeting.title)}</p>
          <p class="meta">Início: ${escapeChronosHtml(context.scheduledStartLabel)} | Fim real: ${escapeChronosHtml(context.actualEndLabel)} | Duração: ${escapeChronosHtml(context.durationLabel)}</p>
        </div>
      </header>
      ${buildChronosMinutesBodyHtml(minutes)}
      <p class="footer">Careli | documento gerado para revisão e formalização humana</p>
        </main>
      </td></tr></tbody>
    </table>
  </body>
</html>`;
}

function openChronosMinutesBlobWindow(
  html: string,
  meeting: ChronosMeeting,
) {
  const blobUrl = URL.createObjectURL(
    new Blob([html], { type: "text/html;charset=utf-8" }),
  );
  const printWindow = window.open(
    blobUrl,
    "_blank",
    "width=920,height=1180,noopener,noreferrer",
  );

  if (!printWindow) {
    const link = document.createElement("a");

    link.download = `${slugifyChronosMinutesFileName(
      `ata-${meeting.protocol}-${meeting.title}`,
    )}.html`;
    link.href = blobUrl;
    link.rel = "noreferrer";
    document.body.append(link);
    link.click();
    link.remove();
  }

  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

export function buildChronosMinutesBodyHtml(minutes: string) {
  const lines = minutes.replace(/\r/g, "").split("\n");
  const chunks: string[] = [];
  let listItems: string[] = [];
  let tableLines: string[] = [];

  function flushList() {
    if (listItems.length === 0) {
      return;
    }

    chunks.push(`<ul>${listItems.map((item) => `<li>${item}</li>`).join("")}</ul>`);
    listItems = [];
  }

  function flushTable() {
    if (tableLines.length === 0) {
      return;
    }

    chunks.push(buildChronosMinutesTableHtml(tableLines));
    tableLines = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushList();
      flushTable();
      continue;
    }

    if (isChronosMarkdownTableLine(line)) {
      flushList();
      tableLines.push(line);
      continue;
    }

    flushTable();

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);

    if (headingMatch) {
      flushList();

      const headingTag = (headingMatch[1] ?? "").length <= 2 ? "h2" : "h3";

      chunks.push(
        `<${headingTag}>${formatChronosMinutesInline(
          headingMatch[2] ?? "",
        )}</${headingTag}>`,
      );
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      listItems.push(formatChronosMinutesInline(line.replace(/^[-*]\s+/, "")));
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      listItems.push(formatChronosMinutesInline(line.replace(/^\d+\.\s+/, "")));
      continue;
    }

    if (isChronosMinutesSectionHeading(line)) {
      flushList();
      chunks.push(`<h2>${formatChronosMinutesInline(line)}</h2>`);
      continue;
    }

    chunks.push(`<p>${formatChronosMinutesInline(line)}</p>`);
  }

  flushList();
  flushTable();

  return chunks.join("");
}

function buildChronosMinutesTableHtml(lines: string[]) {
  const rows = lines
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    )
    .filter(
      (cells) =>
        cells.length > 1 &&
        !cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, ""))),
    );

  if (rows.length === 0) {
    return "";
  }

  const header = rows[0] ?? [];
  const bodyRows = rows.slice(1);

  return [
    "<table>",
    `<thead><tr>${header
      .map((cell) => `<th>${formatChronosMinutesInline(cell)}</th>`)
      .join("")}</tr></thead>`,
    `<tbody>${bodyRows
      .map(
        (row) =>
          `<tr>${row
            .map((cell) => `<td>${formatChronosMinutesInline(cell)}</td>`)
            .join("")}</tr>`,
      )
      .join("")}</tbody>`,
    "</table>",
  ].join("");
}

function isChronosMarkdownTableLine(line: string) {
  return line.includes("|") && line.split("|").filter(Boolean).length >= 2;
}

function isChronosMinutesSectionHeading(line: string) {
  const normalized = stripChronosHeadingMarkup(line)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/:$/, "")
    .trim()
    .toLowerCase();
  const knownHeadings = [
    "ata de reuniao",
    "identificacao da reuniao",
    "participantes com check-in",
    "resumo executivo",
    "pontos relevantes",
    "decisoes e alinhamentos",
    "proximos passos",
    "falas registradas",
    "trechos de transcricao para revisao",
    "evidencias de gravacao/video",
    "chat da reuniao",
    "linha do tempo",
    "follow-ups",
    "plano de acao",
    "observacao operacional",
    "status",
  ];

  return normalized.startsWith("ata ") || knownHeadings.includes(normalized);
}

function stripChronosHeadingMarkup(value: string) {
  return value.replace(/^\*\*(.+)\*\*$/, "$1");
}

function formatChronosMinutesInline(value: string) {
  const html = escapeChronosHtml(value).replace(
    /\*\*([^*]+)\*\*/g,
    "<strong>$1</strong>",
  );

  return boldChronosLeadLabel(html);
}

function boldChronosLeadLabel(value: string) {
  if (value.includes("<strong>")) {
    return value;
  }

  const colonIndex = value.indexOf(":");

  if (colonIndex < 2 || colonIndex > 44) {
    return value;
  }

  const label = value.slice(0, colonIndex + 1);
  const rest = value.slice(colonIndex + 1);
  const knownLabels = [
    "reuniao:",
    "perfil:",
    "inicio programado:",
    "fim real:",
    "duracao:",
    "sala:",
    "host:",
    "participantes:",
    "responsavel:",
    "prazo:",
    "status:",
    "risco:",
    "decisao:",
    "atividade:",
    "tema:",
    "protocolo:",
    "objetivo:",
  ];

  const normalizedLabel = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  if (!knownLabels.includes(normalizedLabel)) {
    return value;
  }

  return `<strong>${label}</strong>${rest}`;
}

function escapeChronosHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugifyChronosMinutesFileName(value: string) {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);

  return slug || "ata-chronos";
}
