type ChronosRecordingParticipant = {
  stream?: MediaStream | null;
};

export function stopChronosMediaStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function getEnabledChronosAudioTracks(stream: MediaStream | null) {
  return stream?.getAudioTracks() ?? [];
}

export function formatChronosDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function getSupportedChronosRecordingMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }

  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

export function buildChronosRecordingStream<
  TParticipant extends ChronosRecordingParticipant,
>({
  localStream,
  remoteParticipants,
  screenTrack,
}: {
  localStream: MediaStream | null;
  remoteParticipants: Record<string, TParticipant>;
  screenTrack: MediaStreamTrack | null;
}) {
  const audioTracks = getChronosRecordingAudioTracks({
    localStream,
    remoteParticipants,
  });
  const videoTracks = screenTrack
    ? [screenTrack]
    : (localStream?.getVideoTracks() ?? []);
  const tracks = [...audioTracks, ...videoTracks];

  return tracks.length > 0 ? new MediaStream(tracks) : null;
}

export function addMissingChronosRecordingAudioTracks<
  TParticipant extends ChronosRecordingParticipant,
>(
  stream: MediaStream,
  input: {
    localStream: MediaStream | null;
    remoteParticipants: Record<string, TParticipant>;
  },
) {
  const currentTrackIds = new Set(stream.getAudioTracks().map((track) => track.id));

  for (const track of getChronosRecordingAudioTracks(input)) {
    if (!currentTrackIds.has(track.id)) {
      stream.addTrack(track);
      currentTrackIds.add(track.id);
    }
  }
}

function getChronosRecordingAudioTracks<
  TParticipant extends ChronosRecordingParticipant,
>({
  localStream,
  remoteParticipants,
}: {
  localStream: MediaStream | null;
  remoteParticipants: Record<string, TParticipant>;
}) {
  const tracksById = new Map<string, MediaStreamTrack>();

  for (const track of localStream?.getAudioTracks() ?? []) {
    if (track.readyState === "live") {
      tracksById.set(track.id, track);
    }
  }

  for (const participant of Object.values(remoteParticipants)) {
    for (const track of participant.stream?.getAudioTracks() ?? []) {
      if (track.readyState === "live") {
        tracksById.set(track.id, track);
      }
    }
  }

  return Array.from(tracksById.values());
}
