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

function normalizeTextInput(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseTrimTimecode(rawValue) {
  const value = normalizeTextInput(rawValue);
  const invalidFormatMessage = "Use MM:SS or HH:MM:SS (for example 01:05 or 00:01:05).";

  if (!value) {
    return {
      ok: false,
      message: invalidFormatMessage
    };
  }

  const segments = value.split(":");
  const isNumeric = segments.every((segment) => /^\d+$/.test(segment));
  if (!isNumeric) {
    return {
      ok: false,
      message: invalidFormatMessage
    };
  }

  if (segments.length === 2) {
    const minutes = Number(segments[0]);
    const seconds = Number(segments[1]);
    if (seconds >= 60) {
      return {
        ok: false,
        message: "Seconds must be between 00 and 59."
      };
    }

    return {
      ok: true,
      seconds: minutes * 60 + seconds,
      normalized: `${minutes}:${String(seconds).padStart(2, "0")}`
    };
  }

  if (segments.length === 3) {
    const hours = Number(segments[0]);
    const minutes = Number(segments[1]);
    const seconds = Number(segments[2]);
    if (minutes >= 60 || seconds >= 60) {
      return {
        ok: false,
        message: "Hours format requires minutes and seconds between 00 and 59."
      };
    }

    return {
      ok: true,
      seconds: hours * 3600 + minutes * 60 + seconds,
      normalized: `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    };
  }

  return {
    ok: false,
    message: invalidFormatMessage
  };
}

function validateTrimInput(payload) {
  const trimStart = normalizeTextInput(payload.trimStart);
  const trimEnd = normalizeTextInput(payload.trimEnd);

  if (!trimStart && !trimEnd) {
    return {
      ok: true,
      data: null
    };
  }

  const errors = [];
  const fieldErrors = {};

  if (!trimStart || !trimEnd) {
    const message = "Enter both start and end times to trim the download.";
    errors.push(message);
    fieldErrors.trimStart = message;
    fieldErrors.trimEnd = message;
    return {
      ok: false,
      errors,
      fieldErrors
    };
  }

  const startResult = parseTrimTimecode(trimStart);
  if (!startResult.ok) {
    errors.push(startResult.message);
    fieldErrors.trimStart = startResult.message;
  }

  const endResult = parseTrimTimecode(trimEnd);
  if (!endResult.ok) {
    errors.push(endResult.message);
    fieldErrors.trimEnd = endResult.message;
  }

  if (startResult.ok && endResult.ok && endResult.seconds <= startResult.seconds) {
    const message = "Trim end must be greater than trim start.";
    errors.push(message);
    fieldErrors.trimEnd = message;
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
      startInput: trimStart,
      endInput: trimEnd,
      startSeconds: startResult.seconds,
      endSeconds: endResult.seconds,
      durationSeconds: endResult.seconds - startResult.seconds,
      normalizedStart: startResult.normalized,
      normalizedEnd: endResult.normalized
    }
  };
}

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

  const trimValidation = validateTrimInput(payload);
  if (!trimValidation.ok) {
    errors.push(...trimValidation.errors);
    Object.assign(fieldErrors, trimValidation.fieldErrors);
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
      formatType: formatConfig.type,
      trim: trimValidation.data
    }
  };
}

module.exports = {
  FORMAT_OPTIONS,
  parseTrimTimecode,
  parseYouTubeUrl,
  validateTrimInput,
  validateDownloadInput
};
