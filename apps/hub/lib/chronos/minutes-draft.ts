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
    .map((participant) => participant.displayName)
    .join(", ");
  const timeline = meeting.timeline
    .slice(0, 8)
    .map((event) => `- ${event.title}`)
    .join("\n");
  const recordingEvidence = buildChronosRecordingEvidenceDraft(meeting);
  const chatMessages = (meeting.chatMessages ?? [])
    .slice(-10)
    .map((message) => `- ${message.senderName}: ${message.content}`)
    .join("\n");
  const followUps = meeting.followUps
    .map((followUp) => `- ${followUp.title} / ${followUp.ownerName ?? "-"}`)
    .join("\n");

  return [
    `Ata ${meeting.protocol}`,
    "",
    `Reuniao: ${meeting.title}`,
    `Inicio programado: ${context.scheduledStartLabel}`,
    `Fim real: ${context.actualEndLabel}`,
    `Duracao: ${context.durationLabel}`,
    `Participantes: ${participants || "-"}`,
    "",
    "Resumo executivo:",
    meeting.executiveSummary || "-",
    "",
    "Evidencias de gravacao/video:",
    recordingEvidence,
    "",
    "Chat da reuniao:",
    chatMessages || "- Nao ha chat salvo.",
    "",
    "Linha do tempo:",
    timeline || "-",
    "",
    "Follow-ups:",
    followUps || "-",
    "",
    "Plano de acao:",
    "| Atividade | Responsavel | Prazo | Status |",
    "| --- | --- | --- | --- |",
    `| Sem atividade formal registrada | Nao informado | ${formatChronosDate(
      context.defaultActionDueAt,
    )} | Aberto |`,
    "",
    "Status: rascunho sujeito a revisao humana.",
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

      return `- ${source} / ${status} / ${type}`;
    })
    .join("\n");
}
