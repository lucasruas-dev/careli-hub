import { buildChronosMinutesContext } from "@/lib/chronos/minutes";
import type { ChronosMeeting } from "@/lib/chronos/types";

export function openChronosMinutesPrintWindow({
  meeting,
  minutes,
}: {
  meeting: ChronosMeeting;
  minutes: string;
}) {
  const printWindow = window.open("", "_blank", "width=920,height=1180");

  if (!printWindow) {
    return;
  }

  const context = buildChronosMinutesContext(meeting);
  const logoUrl = `${window.location.origin}/logoc.png`;
  const title = `Ata ${meeting.protocol} - ${meeting.title}`;

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>${escapeChronosHtml(title)}</title>
    <style>
      @page { size: A4; margin: 18mm 16mm 20mm; }
      * { box-sizing: border-box; }
      body {
        color: #101820;
        font-family: "Century Gothic", "Aptos", "Segoe UI", sans-serif;
        font-size: 9pt;
        line-height: 1.5;
        margin: 0;
        padding: 0;
      }
      body::before {
        background: url("${logoUrl}") center 42% / 46% auto no-repeat;
        content: "";
        inset: 0;
        opacity: 0.035;
        position: fixed;
        z-index: -1;
      }
      header {
        align-items: flex-start;
        border-bottom: 1px solid #eadfcb;
        display: flex;
        justify-content: space-between;
        margin-bottom: 18px;
        padding-bottom: 10px;
      }
      header img { height: 44px; object-fit: contain; width: 44px; }
      h1, h2, h3, p, ul { margin-bottom: 0; margin-top: 0; }
      h1 { font-size: 13pt; font-weight: 700; }
      h2 { font-size: 10pt; font-weight: 700; margin-top: 12px; }
      p { margin-top: 4px; }
      ul { padding-left: 18px; }
      li { margin-top: 2px; }
      strong { font-weight: 700; }
      table {
        border-collapse: collapse;
        margin-top: 8px;
        page-break-inside: avoid;
        width: 100%;
      }
      th, td {
        border: 1px solid #d9e0e7;
        padding: 5px 6px;
        text-align: left;
        vertical-align: top;
      }
      th { background: #f3f6fa; font-weight: 700; }
      .meta {
        color: #526078;
        font-size: 8pt;
        font-weight: 700;
        margin-top: 2px;
      }
      .eyebrow {
        color: #A07C3B;
        font-size: 8pt;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }
      .footer {
        border-top: 1px solid #eadfcb;
        color: #A07C3B;
        font-size: 7pt;
        font-weight: 700;
        margin-top: 24px;
        padding-top: 6px;
      }
    </style>
  </head>
  <body>
    <header>
      <div>
        <p class="eyebrow">Chronos</p>
        <h1>Ata de reuniao</h1>
        <p class="meta">${escapeChronosHtml(meeting.protocol)} | ${escapeChronosHtml(meeting.title)}</p>
        <p class="meta">Inicio: ${escapeChronosHtml(context.scheduledStartLabel)} | Fim real: ${escapeChronosHtml(context.actualEndLabel)} | Duracao: ${escapeChronosHtml(context.durationLabel)}</p>
      </div>
      <img alt="Careli" src="${logoUrl}" />
    </header>
    ${buildChronosMinutesBodyHtml(minutes)}
    <p class="footer">Careli | documento gerado para revisao e formalizacao humana</p>
    <script>
      window.addEventListener("load", () => setTimeout(() => window.print(), 250));
    </script>
  </body>
</html>`);
  printWindow.document.close();
}

export function buildChronosMinutesBodyHtml(minutes: string | null | undefined) {
  const safeMinutes = typeof minutes === "string" ? minutes : "";
  const lines = safeMinutes.replace(/\r/g, "").split("\n");
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

    if (/^[-*]\s+/.test(line)) {
      listItems.push(formatChronosMinutesInline(line.replace(/^[-*]\s+/, "")));
      continue;
    }

    if (/^\d+\.\s+/.test(line) || /^[A-Z0-9\sÃ‡ÃƒÃ•ÃÃ‰ÃÃ“ÃšÃ‚ÃŠÃ”Ã€:.-]{6,}$/.test(line)) {
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

function formatChronosMinutesInline(value: string) {
  return escapeChronosHtml(value).replace(
    /\*\*([^*]+)\*\*/g,
    "<strong>$1</strong>",
  );
}

function escapeChronosHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
