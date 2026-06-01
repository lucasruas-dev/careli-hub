import { getChronosCheckedInParticipants } from "@/lib/chronos/minutes";
import type {
  ChronosCaptureStatus,
  ChronosMeeting,
  ChronosRoom,
} from "@/lib/chronos/types";

export type LocalRecording = {
  blob?: Blob;
  downloadUrl?: string;
  durationSeconds: number;
  id: string;
  meetingId: string;
  mimeType?: string | null;
  name: string;
  sizeBytes?: number | null;
  startedAt?: string | null;
  status?: ChronosCaptureStatus;
  stoppedAt?: string | null;
  transcribedAt?: string;
  url: string;
};

export type ChronosDriveRecordingItem = LocalRecording & {
  meeting: ChronosMeeting;
  roomLabel: string;
  sectorLabel: string;
};

export type ChronosDriveRecordingFolder = {
  id: string;
  label: string;
  latestAt?: string | null;
  meetings: ChronosDriveRecordingMeeting[];
  roomLabels: string[];
  subtitle: string;
  totalRecordings: number;
  totalMeetings: number;
};

export type ChronosDriveRecordingMeeting = {
  availableRecordings: number;
  id: string;
  latestAt?: string | null;
  meeting: ChronosMeeting;
  participantText: string;
  primaryRecording: ChronosDriveRecordingItem | null;
  recordings: ChronosDriveRecordingItem[];
  roomLabel: string;
  sectorLabel: string;
  totalDurationSeconds: number;
};

export function buildChronosRecordingFolders({
  localRecordings,
  meetings,
  rooms,
}: {
  localRecordings: LocalRecording[];
  meetings: ChronosMeeting[];
  rooms: ChronosRoom[];
}) {
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  const foldersById = new Map<string, ChronosDriveRecordingFolder>();

  for (const meeting of meetings) {
    const room =
      meeting.room ??
      (meeting.roomId ? roomsById.get(meeting.roomId) ?? null : null);
    const descriptor = getChronosDriveFolderDescriptor(meeting, room);
    const recordings = getChronosMeetingRecordingItems({
      localRecordings,
      meeting,
      roomLabel: descriptor.roomLabel,
      sectorLabel: descriptor.label,
    });

    if (recordings.length === 0) {
      continue;
    }

    const currentFolder =
      foldersById.get(descriptor.id) ??
      {
        id: descriptor.id,
        label: descriptor.label,
        latestAt: null,
        meetings: [],
        roomLabels: [],
        subtitle: descriptor.subtitle,
        totalRecordings: 0,
        totalMeetings: 0,
      };
    const recordingMeeting = buildChronosDriveRecordingMeeting({
      meeting,
      recordings,
      roomLabel: descriptor.roomLabel,
      sectorLabel: descriptor.label,
    });

    currentFolder.meetings.push(recordingMeeting);
    currentFolder.totalRecordings += recordings.length;
    currentFolder.totalMeetings += 1;

    if (!currentFolder.roomLabels.includes(descriptor.roomLabel)) {
      currentFolder.roomLabels.push(descriptor.roomLabel);
    }

    const meetingDate =
      recordingMeeting.latestAt ?? meeting.startsAt ?? meeting.updatedAt;

    if (
      meetingDate &&
      (!currentFolder.latestAt ||
        Date.parse(meetingDate) > Date.parse(currentFolder.latestAt))
    ) {
      currentFolder.latestAt = meetingDate;
    }

    foldersById.set(descriptor.id, currentFolder);
  }

  return [...foldersById.values()]
    .map((folder) => ({
      ...folder,
      meetings: folder.meetings.sort((firstMeeting, secondMeeting) => {
        const firstDate = getChronosDriveMeetingSortDate(firstMeeting);
        const secondDate = getChronosDriveMeetingSortDate(secondMeeting);

        return secondDate - firstDate;
      }),
      roomLabels: folder.roomLabels.sort((firstLabel, secondLabel) =>
        firstLabel.localeCompare(secondLabel, "pt-BR"),
      ),
    }))
    .sort((firstFolder, secondFolder) => {
      const firstDate = firstFolder.latestAt
        ? Date.parse(firstFolder.latestAt)
        : 0;
      const secondDate = secondFolder.latestAt
        ? Date.parse(secondFolder.latestAt)
        : 0;

      return secondDate - firstDate;
    });
}

export function filterChronosDriveRecordingMeetings(
  recordingMeetings: ChronosDriveRecordingMeeting[],
  filters: {
    dateFrom: string;
    dateTo: string;
    people: string;
    subject: string;
  },
) {
  const subjectQuery = normalizeChronosSearchText(filters.subject);
  const peopleQuery = normalizeChronosSearchText(filters.people);
  const fromTime = filters.dateFrom
    ? Date.parse(`${filters.dateFrom}T00:00:00`)
    : null;
  const toTime = filters.dateTo
    ? Date.parse(`${filters.dateTo}T23:59:59`)
    : null;

  return recordingMeetings.filter((recordingMeeting) => {
    const meetingDate = getChronosDriveMeetingSortDate(recordingMeeting);

    if (fromTime !== null && meetingDate < fromTime) {
      return false;
    }

    if (toTime !== null && meetingDate > toTime) {
      return false;
    }

    if (subjectQuery) {
      const subjectText = normalizeChronosSearchText(
        [
          recordingMeeting.meeting.title,
          recordingMeeting.meeting.protocol,
          recordingMeeting.meeting.objective,
          recordingMeeting.roomLabel,
          recordingMeeting.sectorLabel,
          ...recordingMeeting.recordings.map((recording) => recording.name),
        ].join(" "),
      );

      if (!subjectText.includes(subjectQuery)) {
        return false;
      }
    }

    if (peopleQuery) {
      const peopleText = normalizeChronosSearchText(
        recordingMeeting.participantText,
      );

      if (!peopleText.includes(peopleQuery)) {
        return false;
      }
    }

    return true;
  });
}

export function getChronosDriveMeetingDisplayTitle(
  meeting: ChronosMeeting,
  roomLabel: string,
) {
  const title = (meeting.title || meeting.objective || meeting.protocol).trim();
  const normalizedTitle = title.toLocaleLowerCase("pt-BR");
  const normalizedRoomPrefix = `${roomLabel} - `.toLocaleLowerCase("pt-BR");

  if (normalizedTitle.startsWith(normalizedRoomPrefix)) {
    return title.slice(roomLabel.length + 3).trim() || title;
  }

  return title;
}

function buildChronosDriveRecordingMeeting({
  meeting,
  recordings,
  roomLabel,
  sectorLabel,
}: {
  meeting: ChronosMeeting;
  recordings: ChronosDriveRecordingItem[];
  roomLabel: string;
  sectorLabel: string;
}): ChronosDriveRecordingMeeting {
  const primaryRecording = selectChronosPrimaryRecording(recordings);
  const latestAt =
    recordings
      .map((recording) => recording.stoppedAt ?? recording.startedAt)
      .filter((value): value is string => Boolean(value))
      .sort(
        (firstValue, secondValue) =>
          Date.parse(secondValue) - Date.parse(firstValue),
      )[0] ??
    getChronosMeetingDriveEnd(meeting) ??
    getChronosMeetingDriveStart(meeting) ??
    meeting.updatedAt;
  const checkedInParticipants = getChronosCheckedInParticipants(meeting);
  const participantText = checkedInParticipants
    .map((participant) =>
      [participant.displayName, participant.email, participant.organization]
        .filter(Boolean)
        .join(" / "),
    )
    .filter(Boolean)
    .join(", ");

  return {
    availableRecordings: recordings.filter(
      (recording) => recording.status === "available" && recording.url !== "#",
    ).length,
    id: meeting.id,
    latestAt,
    meeting,
    participantText,
    primaryRecording,
    recordings,
    roomLabel,
    sectorLabel,
    totalDurationSeconds: recordings.reduce(
      (total, recording) => total + recording.durationSeconds,
      0,
    ),
  };
}

function selectChronosPrimaryRecording(recordings: ChronosDriveRecordingItem[]) {
  return (
    [...recordings].sort((firstRecording, secondRecording) => {
      const firstPlayable =
        firstRecording.url && firstRecording.url !== "#" ? 1 : 0;
      const secondPlayable =
        secondRecording.url && secondRecording.url !== "#" ? 1 : 0;

      if (firstPlayable !== secondPlayable) {
        return secondPlayable - firstPlayable;
      }

      const firstAvailable = firstRecording.status === "available" ? 1 : 0;
      const secondAvailable = secondRecording.status === "available" ? 1 : 0;

      if (firstAvailable !== secondAvailable) {
        return secondAvailable - firstAvailable;
      }

      return (
        getChronosRecordingSortDate(secondRecording) -
        getChronosRecordingSortDate(firstRecording)
      );
    })[0] ?? null
  );
}

function getChronosDriveMeetingSortDate(
  recordingMeeting: ChronosDriveRecordingMeeting,
) {
  return (
    parseChronosDateValue(recordingMeeting.latestAt) ??
    parseChronosDateValue(getChronosMeetingDriveEnd(recordingMeeting.meeting)) ??
    parseChronosDateValue(
      getChronosMeetingDriveStart(recordingMeeting.meeting),
    ) ??
    parseChronosDateValue(recordingMeeting.meeting.updatedAt) ??
    0
  );
}

function getChronosRecordingSortDate(recording: ChronosDriveRecordingItem) {
  return (
    parseChronosDateValue(recording.stoppedAt) ??
    parseChronosDateValue(recording.startedAt) ??
    parseChronosDateValue(recording.meeting.startsAt) ??
    parseChronosDateValue(recording.meeting.updatedAt) ??
    0
  );
}

function getChronosMeetingRecordingItems({
  localRecordings,
  meeting,
  roomLabel,
  sectorLabel,
}: {
  localRecordings: LocalRecording[];
  meeting: ChronosMeeting;
  roomLabel: string;
  sectorLabel: string;
}) {
  const meetingLocalRecordings = localRecordings.filter(
    (recording) => recording.meetingId === meeting.id,
  );
  const meetingRecordings = Array.isArray(meeting.recordings)
    ? meeting.recordings
    : [];

  return [
    ...meetingLocalRecordings.map((recording) => ({
      ...recording,
      meeting,
      roomLabel,
      sectorLabel,
      status: (recording.status ?? "available") as ChronosCaptureStatus,
    })),
    ...meetingRecordings.map((recording) => ({
      ...mapPersistedRecording(recording, meeting.id),
      meeting,
      roomLabel,
      sectorLabel,
    })),
  ];
}

function getChronosDriveFolderDescriptor(
  meeting: ChronosMeeting,
  room: ChronosRoom | null,
) {
  const metadata = room?.metadata ?? {};
  const sectorId = readChronosMetadataText(metadata, [
    "sectorId",
    "sector_id",
    "departmentId",
    "department_id",
  ]);
  const sectorLabel = readChronosMetadataText(metadata, [
    "sectorName",
    "sectorLabel",
    "sector",
    "setor",
    "departmentName",
    "departmentLabel",
    "department",
  ]);
  const roomLabel = room?.name ?? meeting.room?.name ?? "Sala pendente";

  return {
    id: sectorId
      ? `sector:${sectorId}`
      : room?.id
        ? `room:${room.id}`
        : `room:${meeting.roomId ?? "sem-sala"}`,
    label: sectorLabel || roomLabel,
    roomLabel,
    subtitle: sectorLabel ? roomLabel : "Sala Chronos",
  };
}

function readChronosMetadataText(
  metadata: Record<string, unknown>,
  keys: string[],
) {
  for (const key of keys) {
    const value = metadata[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const label = record.label ?? record.name ?? record.title;

      if (typeof label === "string" && label.trim()) {
        return label.trim();
      }
    }
  }

  return "";
}

export function getChronosMeetingDriveStart(meeting: ChronosMeeting) {
  return (
    readChronosMetadataText(meeting.metadata, [
      "actualStartedAt",
      "startedAt",
      "openedAt",
    ]) ||
    meeting.startsAt ||
    meeting.createdAt
  );
}

export function getChronosMeetingDriveEnd(meeting: ChronosMeeting) {
  return (
    readChronosMetadataText(meeting.metadata, [
      "actualEndedAt",
      "closedAt",
      "endedAt",
    ]) ||
    meeting.endsAt ||
    null
  );
}

function parseChronosDateValue(value?: string | null) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeChronosSearchText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function mapPersistedRecording(
  recording: ChronosMeeting["recordings"][number],
  meetingId: string,
): LocalRecording {
  return {
    downloadUrl: recording.downloadUrl ?? recording.playbackUrl ?? "#",
    durationSeconds: recording.durationSeconds ?? 0,
    id: recording.id,
    meetingId,
    mimeType: recording.mimeType,
    name: recording.fileName ?? recording.storagePath ?? recording.status,
    sizeBytes: recording.sizeBytes,
    startedAt: recording.startedAt,
    status: recording.status,
    stoppedAt: recording.stoppedAt,
    url: recording.playbackUrl ?? recording.downloadUrl ?? "#",
  };
}
