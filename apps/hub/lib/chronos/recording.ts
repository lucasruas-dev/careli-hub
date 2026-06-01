type ChronosRecordingParticipant = {
  stream?: MediaStream | null;
};

type ChronosRecordingVideoSource = {
  id: string;
  label: string;
  video: HTMLVideoElement | null;
};

type ChronosRecordingMedia = {
  cleanup: () => void;
  stream: MediaStream;
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

export function buildChronosRecordingMedia<
  TParticipant extends ChronosRecordingParticipant,
>({
  backgroundDataUrl,
  getLocalStream,
  getParticipantVideos,
  getScreenTrack,
  localStream,
  remoteParticipants,
  screenTrack,
}: {
  getLocalStream?: () => MediaStream | null;
  getParticipantVideos?: () => ChronosRecordingVideoSource[];
  getScreenTrack?: () => MediaStreamTrack | null;
  backgroundDataUrl?: string;
  localStream: MediaStream | null;
  remoteParticipants: Record<string, TParticipant>;
  screenTrack: MediaStreamTrack | null;
}): ChronosRecordingMedia | null {
  if (canBuildChronosCompositeRecording()) {
    const composite = buildChronosCompositeRecordingStream({
      backgroundDataUrl,
      getLocalStream,
      getParticipantVideos,
      getScreenTrack,
      localStream,
      remoteParticipants,
      screenTrack,
    });

    if (composite) {
      return composite;
    }
  }

  const stream = buildChronosRecordingStream({
    localStream,
    remoteParticipants,
    screenTrack,
  });

  return stream ? { cleanup: () => undefined, stream } : null;
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

function canBuildChronosCompositeRecording() {
  return Boolean(
    typeof document !== "undefined" &&
      typeof requestAnimationFrame === "function" &&
      typeof cancelAnimationFrame === "function" &&
      typeof HTMLCanvasElement !== "undefined" &&
      HTMLCanvasElement.prototype.captureStream,
  );
}

function buildChronosCompositeRecordingStream<
  TParticipant extends ChronosRecordingParticipant,
>({
  backgroundDataUrl,
  getLocalStream,
  getParticipantVideos,
  getScreenTrack,
  localStream,
  remoteParticipants,
  screenTrack,
}: {
  backgroundDataUrl?: string;
  getLocalStream?: () => MediaStream | null;
  getParticipantVideos?: () => ChronosRecordingVideoSource[];
  getScreenTrack?: () => MediaStreamTrack | null;
  localStream: MediaStream | null;
  remoteParticipants: Record<string, TParticipant>;
  screenTrack: MediaStreamTrack | null;
}): ChronosRecordingMedia | null {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context || typeof canvas.captureStream !== "function") {
    return null;
  }

  canvas.width = 1280;
  canvas.height = 720;
  const canvasStream = canvas.captureStream(24);
  const audioTracks = getChronosRecordingAudioTracks({
    localStream,
    remoteParticipants,
  });
  const stream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...audioTracks,
  ]);
  let frameId = 0;
  let disposed = false;
  const backgroundImage = createChronosRecordingBackgroundImage(
    backgroundDataUrl,
  );
  const videoElementsByTrackId = new Map<string, HTMLVideoElement>();

  const getVideoForTrack = (track: MediaStreamTrack | null | undefined) => {
    if (!isLiveChronosVideoTrack(track)) {
      return null;
    }

    const existingVideo = videoElementsByTrackId.get(track.id);

    if (existingVideo) {
      return existingVideo;
    }

    const video = createChronosRecordingVideoElement(new MediaStream([track]));

    videoElementsByTrackId.set(track.id, video);

    return video;
  };

  const drawFrame = () => {
    if (disposed) {
      return;
    }

    drawChronosRecordingFrame({
      canvas,
      context,
      getLocalStream,
      getParticipantVideos,
      getScreenTrack,
      getVideoForTrack,
      localStream,
      backgroundImage,
      screenTrack,
      videoElementsByTrackId,
    });
    frameId = requestAnimationFrame(drawFrame);
  };

  drawFrame();

  return {
    cleanup: () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      stopChronosMediaStream(canvasStream);
      releaseChronosRecordingVideoElements(videoElementsByTrackId);
    },
    stream,
  };
}

function isLiveChronosVideoTrack(
  track: MediaStreamTrack | null | undefined,
): track is MediaStreamTrack {
  return Boolean(track && track.kind === "video" && track.readyState === "live");
}

function createChronosRecordingVideoElement(stream: MediaStream) {
  const video = document.createElement("video");

  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  void video.play().catch(() => undefined);

  return video;
}

function releaseChronosRecordingVideoElement(video: HTMLVideoElement | null) {
  if (!video) {
    return;
  }

  video.pause();
  video.srcObject = null;
}

function releaseChronosRecordingVideoElements(
  videoElementsByTrackId: Map<string, HTMLVideoElement>,
) {
  videoElementsByTrackId.forEach((video) => {
    releaseChronosRecordingVideoElement(video);
  });
  videoElementsByTrackId.clear();
}

function releaseUnusedChronosRecordingVideoElements(
  videoElementsByTrackId: Map<string, HTMLVideoElement>,
  liveTrackIds: Set<string>,
) {
  videoElementsByTrackId.forEach((video, trackId) => {
    if (liveTrackIds.has(trackId)) {
      return;
    }

    releaseChronosRecordingVideoElement(video);
    videoElementsByTrackId.delete(trackId);
  });
}

function drawChronosRecordingFrame({
  backgroundImage,
  canvas,
  context,
  getLocalStream,
  getParticipantVideos,
  getScreenTrack,
  getVideoForTrack,
  localStream,
  screenTrack,
  videoElementsByTrackId,
}: {
  backgroundImage: HTMLImageElement | null;
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  getLocalStream?: () => MediaStream | null;
  getParticipantVideos?: () => ChronosRecordingVideoSource[];
  getScreenTrack?: () => MediaStreamTrack | null;
  getVideoForTrack: (
    track: MediaStreamTrack | null | undefined,
  ) => HTMLVideoElement | null;
  localStream: MediaStream | null;
  screenTrack: MediaStreamTrack | null;
  videoElementsByTrackId: Map<string, HTMLVideoElement>;
}) {
  const currentScreenTrack = getScreenTrack?.() ?? screenTrack;
  const currentLocalStream = getLocalStream?.() ?? localStream;
  const liveTrackIds = new Set<string>();
  const screenVideo = getVideoForTrack(currentScreenTrack);
  const localCameraTrack = (currentLocalStream?.getVideoTracks() ?? []).find(
    (track) =>
      isLiveChronosVideoTrack(track) && track.id !== currentScreenTrack?.id,
  );
  const localCameraVideo = getVideoForTrack(localCameraTrack);
  const remoteSources = getParticipantVideos?.() ?? [];
  const mainSource =
    screenVideo
      ? {
          id: "screen-share",
          label: "Tela compartilhada",
          video: screenVideo,
        }
      : localCameraVideo
        ? {
            id: "local-camera-main",
            label: "Camera",
            video: localCameraVideo,
          }
        : (remoteSources[0] ?? {
            id: "empty",
            label: "Sem video",
            video: null,
          });
  const participantSources = [
    screenVideo && localCameraVideo
      ? {
          id: "local-camera",
          label: "Camera",
          video: localCameraVideo,
        }
      : null,
    ...remoteSources.filter((source) => source.id !== mainSource.id),
  ].filter((source): source is ChronosRecordingVideoSource => Boolean(source));
  const hasRail = participantSources.length > 0;
  const railWidth = hasRail ? 260 : 0;
  const gutter = hasRail ? 16 : 0;
  const mainWidth = canvas.width - railWidth - gutter;

  if (isLiveChronosVideoTrack(currentScreenTrack)) {
    liveTrackIds.add(currentScreenTrack.id);
  }

  if (isLiveChronosVideoTrack(localCameraTrack)) {
    liveTrackIds.add(localCameraTrack.id);
  }

  releaseUnusedChronosRecordingVideoElements(videoElementsByTrackId, liveTrackIds);

  drawChronosRecordingBackground(context, canvas, backgroundImage);
  drawChronosVideoContain(context, mainSource.video, 0, 0, mainWidth, canvas.height);

  if (!hasRail) {
    return;
  }

  const railX = mainWidth + gutter;

  context.fillStyle = "rgba(16, 24, 32, 0.92)";
  context.fillRect(railX, 0, railWidth, canvas.height);

  const tileGap = 12;
  const tileHeight = Math.min(
    148,
    Math.max(96, (canvas.height - tileGap * (participantSources.length + 1)) / 4),
  );

  participantSources.slice(0, 4).forEach((source, index) => {
    const tileX = railX + 12;
    const tileY = 14 + index * (tileHeight + tileGap);
    const tileWidth = railWidth - 24;

    context.fillStyle = "#111820";
    context.fillRect(tileX, tileY, tileWidth, tileHeight);
    drawChronosVideoCover(context, source.video, tileX, tileY, tileWidth, tileHeight);
    context.fillStyle = "rgba(7, 16, 24, 0.72)";
    context.fillRect(tileX, tileY + tileHeight - 28, tileWidth, 28);
    context.fillStyle = "#ffffff";
    context.font = "600 14px Arial";
    context.fillText(source.label || "Participante", tileX + 10, tileY + tileHeight - 10);
  });
}

function createChronosRecordingBackgroundImage(value?: string) {
  const dataUrl = typeof value === "string" ? value.trim() : "";

  if (!/^data:image\//i.test(dataUrl)) {
    return null;
  }

  const image = new Image();

  image.src = dataUrl;

  return image;
}

function drawChronosRecordingBackground(
  context: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  image: HTMLImageElement | null,
) {
  if (image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0) {
    drawChronosImageCover(context, image, canvas.width, canvas.height);
    return;
  }

  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);

  gradient.addColorStop(0, "#071018");
  gradient.addColorStop(0.52, "#101820");
  gradient.addColorStop(1, "#1f2933");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function drawChronosImageCover(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
) {
  const coverScale = Math.max(
    width / image.naturalWidth,
    height / image.naturalHeight,
  );
  const coverWidth = image.naturalWidth * coverScale;
  const coverHeight = image.naturalHeight * coverScale;
  const coverX = (width - coverWidth) / 2;
  const coverY = (height - coverHeight) / 2;

  context.drawImage(image, coverX, coverY, coverWidth, coverHeight);
}

function drawChronosVideoContain(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement | null,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  drawChronosVideo(context, video, x, y, width, height, "contain");
}

function drawChronosVideoCover(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement | null,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  drawChronosVideo(context, video, x, y, width, height, "cover");
}

function drawChronosVideo(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement | null,
  x: number,
  y: number,
  width: number,
  height: number,
  mode: "contain" | "cover",
) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    context.fillStyle = "#101820";
    context.fillRect(x, y, width, height);
    return;
  }

  const scale =
    mode === "cover"
      ? Math.max(width / video.videoWidth, height / video.videoHeight)
      : Math.min(width / video.videoWidth, height / video.videoHeight);
  const drawWidth = video.videoWidth * scale;
  const drawHeight = video.videoHeight * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;

  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.drawImage(video, drawX, drawY, drawWidth, drawHeight);
  context.restore();
}
