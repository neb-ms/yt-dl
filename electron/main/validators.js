const ALLOWED_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be"
]);

const FORMAT_OPTIONS = {
  video_mp4: {
    id: "video_mp4",
    type: "video",
    label: "Video + Audio (MP4)",
    qualities: ["best", "2160", "1440", "1080", "720", "480"]
  },
  video_mkv: {
    id: "video_mkv",
    type: "video",
    label: "Video + Audio (MKV)",
    qualities: ["best", "2160", "1440", "1080", "720", "480"]
  },
  audio_mp3: {
    id: "audio_mp3",
    type: "audio",
    label: "Audio Only (MP3)",
    qualities: ["best", "320", "256", "192", "128"]
  },
  audio_wav: {
    id: "audio_wav",
    type: "audio",
    label: "Audio Only (WAV)",
    qualities: ["best", "320", "256", "192", "128"]
  },
  audio_m4a: {
    id: "audio_m4a",
    type: "audio",
    label: "Audio Only (M4A)",
    qualities: ["best", "320", "256", "192", "128"]
  }
};

function parseYouTubeUrl(rawUrl) {
  if (typeof rawUrl !== "string") {
    return {
      valid: false,
      message: "A YouTube URL is required."
    };
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return {
      valid: false,
      message: "A YouTube URL is required."
    };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      message: "Enter a valid URL, including https://."
    };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return {
      valid: false,
      message: "Only http/https URLs are allowed."
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(hostname)) {
    return {
      valid: false,
      message: "URL must be a YouTube or YouTube Music link."
    };
  }

  const pathname = parsed.pathname || "";
  const hasVideoParam = parsed.searchParams.has("v");
  const hasPlaylistParam = parsed.searchParams.has("list");
  let sourceKind = null;

  if (hostname.includes("youtu.be")) {
    const videoId = pathname.replace("/", "").trim();
    if (videoId) {
      sourceKind = hasPlaylistParam ? "video_with_playlist_context" : "video";
    }
  } else if (pathname === "/watch" && hasVideoParam) {
    sourceKind = hasPlaylistParam ? "video_with_playlist_context" : "video";
  } else if (pathname.startsWith("/shorts/") || pathname.startsWith("/live/")) {
    sourceKind = "video";
  } else if (pathname === "/playlist" && hasPlaylistParam) {
    sourceKind = "playlist";
  } else if (hasPlaylistParam && !hasVideoParam) {
    sourceKind = "playlist";
  }

  if (!sourceKind) {
    return {
      valid: false,
      message:
        "Unsupported YouTube URL. Use a video link, YouTube Music link, or playlist link."
    };
  }

  return {
    valid: true,
    sourceKind,
    normalizedUrl: parsed.toString()
  };
}

function validateDownloadInput(payload) {
  const errors = [];
  const fieldErrors = {};

  if (!payload || typeof payload !== "object") {
    return {
      ok: false,
      errors: ["Download input is missing."],
      fieldErrors: {
        url: "Enter a YouTube URL.",
        formatId: "Select a format.",
        quality: "Select a quality option."
      }
    };
  }

  const urlResult = parseYouTubeUrl(payload.url);
  if (!urlResult.valid) {
    errors.push(urlResult.message);
    fieldErrors.url = urlResult.message;
  }

  const formatId = typeof payload.formatId === "string" ? payload.formatId.trim() : "";
  const formatConfig = FORMAT_OPTIONS[formatId];
  if (!formatConfig) {
    const message = "Select a supported output format.";
    errors.push(message);
    fieldErrors.formatId = message;
  }

  const requestedQuality =
    typeof payload.quality === "string" && payload.quality.trim()
      ? payload.quality.trim()
      : "best";
  if (formatConfig && !formatConfig.qualities.includes(requestedQuality)) {
    const message = "Selected quality is not supported for that format.";
    errors.push(message);
    fieldErrors.quality = message;
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      fieldErrors
    };
  }

  return {
    ok: true,
    data: {
      url: urlResult.normalizedUrl,
      sourceKind: urlResult.sourceKind,
      formatId,
      quality: requestedQuality,
      formatType: formatConfig.type
    }
  };
}

module.exports = {
  FORMAT_OPTIONS,
  parseYouTubeUrl,
  validateDownloadInput
};

