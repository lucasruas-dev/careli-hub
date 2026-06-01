import { normalizeAttendanceProtocol } from "@/modules/guardian/attendance/attendance-routing";

export function resolveTicketTemplateProtocolPreview(
  linkedAttendanceProtocol?: string | null,
) {
  const attendanceProtocol = normalizeAttendanceProtocol(
    linkedAttendanceProtocol,
  );

  if (!attendanceProtocol) {
    return "CB gerado na abertura";
  }

  const match = /^AT-(\d+)$/i.exec(attendanceProtocol.trim());

  if (match?.[1]) {
    return `CB-${match[1]}`;
  }

  return attendanceProtocol;
}

export function formatInstallmentSummaryForTemplatePreview(labels: string[]) {
  if (!labels.length) {
    return "Sem parcela informada";
  }

  const preview = labels.slice(0, 3).join(" | ");

  return labels.length > 3
    ? `${preview} +${labels.length - 3} parcela(s)`
    : preview;
}

export function buildTicketTemplateMessagePreview({
  body,
  firstName,
  installmentsSummary,
  protocolReference,
}: {
  body: string | null;
  firstName: string;
  installmentsSummary: string;
  protocolReference: string;
}) {
  if (!body) {
    return "Template sem corpo configurado para preview.";
  }

  const parameters = [firstName, installmentsSummary, protocolReference];

  return body.replace(/{{\s*(\d+)\s*}}/g, (placeholder, rawIndex) => {
    const index = Number.parseInt(String(rawIndex), 10);

    if (Number.isNaN(index) || index <= 0) {
      return placeholder;
    }

    return parameters[index - 1] ?? placeholder;
  });
}
