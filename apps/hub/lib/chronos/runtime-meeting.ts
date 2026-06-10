import type { ChronosMeeting } from "./types";

export function normalizeChronosMeetingRuntime(
  meeting: ChronosMeeting,
): ChronosMeeting {
  return {
    ...meeting,
    chatMessages: Array.isArray(meeting.chatMessages)
      ? meeting.chatMessages
      : [],
    followUps: Array.isArray(meeting.followUps) ? meeting.followUps : [],
    minutes: Array.isArray(meeting.minutes) ? meeting.minutes : [],
    participants: Array.isArray(meeting.participants)
      ? meeting.participants
      : [],
    recordings: Array.isArray(meeting.recordings) ? meeting.recordings : [],
    timeline: Array.isArray(meeting.timeline) ? meeting.timeline : [],
    transcript: Array.isArray(meeting.transcript) ? meeting.transcript : [],
  };
}
