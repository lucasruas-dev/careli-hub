import {
  buildChronosMinutesContext,
  formatChronosDate,
} from "@/lib/chronos/minutes";
import {
  chronosCaptureStatusLabels,
  type ChronosMeeting,
} from "@/lib/chronos/types";

export function buildChronosMinutesDraft(meeting: ChronosMeeting) {
  const context = buildChronosMinutesContext(meeting);
  const participants = context.participants
    .map((participant) => {
      const details = [
        participant.role,
        participant.email,
        participant.organization,
      ].filter(Boolean);

      return `- **${participant.displayName}:** ${
        details.length ? details.join(" / ") : "check-in registrado"
      }`;
    })
    .join("\n");
  const transcriptHighlights = meeting.transcript
    .slice(0, 12)
    .map(
      (segment) =>
        `- **${segment.speakerLabel ?? "Participante"}:** ${segment.content}`,
    )
    .join("\n");
  const timeline = meeting.timeline
    .slice(0, 8)
    .map((event) => `- **${formatChronosDate(event.eventAt)}:** ${event.title}`)
    .join("\n");
  const recordingEvidence = buildChronosRecordingEvidenceDraft(meeting);
  const chatMessages = (meeting.chatMessages ?? [])
    .slice(-10)
    .map((message) => `- **${message.senderName}:** ${message.content}`)
    .join("\n");
  const followUps = meeting.followUps
    .map(
      (followUp) =>
        `| ${followUp.title} | ${followUp.ownerName ?? "Nao informado"} | ${
          followUp.dueAt
            ? formatChronosDate(followUp.dueAt)
            : context.defaultActionDueLabel
        } | ${followUp.status} |`,
    )
    .join("\n");

  return [
    `**Ata ${meeting.protocol}**`,
    "",
    "**Identificacao da reuniao**",
    `- **Reuniao:** ${meeting.title}`,
    `- **Inicio programado:** ${context.scheduledStartLabel}`,
    `- **Fim real:** ${context.actualEndLabel}`,
    `- **Duracao:** ${context.durationLabel}`,
    `- **Sala:** ${meeting.room?.name ?? "Nao informado"}`,
    `- **Host:** ${meeting.hostName ?? "Nao informado"}`,
    "",
    "**Participantes com check-in**",
    participants || "- Nao informado",
    "",
    "**Resumo executivo**",
    meeting.executiveSummary
      ? `- ${meeting.executiveSummary}`
      : "- Ata executiva gerada a partir dos registros disponiveis no Chronos.",
    "- Documento em status de rascunho para revisao e formalizacao humana.",
    "",
    "**Pontos relevantes**",
    transcriptHighlights || "- Nao ha transcricao salva para extrair pontos relevantes.",
    "",
    "**Decisoes e alinhamentos**",
    "- Nao informado.",
    "",
    "**Plano de acao**",
    "| Atividade | Responsavel | Prazo | Status |",
    "| --- | --- | --- | --- |",
    followUps ||
      `| Sem atividade formal registrada | Nao informado | ${context.defaultActionDueLabel} | Aberto |`,
    "",
    "**Evidencias de gravacao/video**",
    recordingEvidence,
    "",
    "**Chat da reuniao**",
    chatMessages || "- Nao ha chat salvo.",
    "",
    "**Linha do tempo**",
    timeline || "-",
    "",
    "**Status**",
    "- Rascunho sujeito a revisao humana.",
  ].join("\n");
}

function buildChronosRecordingEvidenceDraft(meeting: ChronosMeeting) {
  if (meeting.recordings.length === 0) {
    return "- Nao ha gravacao vinculada.";
  }

  return meeting.recordings
    .map((recording) => {
      const source = recording.fileName ?? recording.storagePath ?? recording.id;
      const status = chronosCaptureStatusLabels[recording.status];
      const type = recording.mimeType?.includes("video")
        ? "video vinculado como evidencia"
        : "audio/anexo vinculado como evidencia";

      return `- **Arquivo:** ${source} | **Status:** ${status} | **Uso:** ${type}`;
    })
    .join("\n");
}
