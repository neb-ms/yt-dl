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

const MAX_URL_LENGTH = 2048;
const MAX_TIMECODE_LENGTH = 16;
const MAX_QUEUE_ITEM_ID_LENGTH = 80;
const SAFE_URL_PATTERN = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/;
const SAFE_TIMECODE_PATTERN = /^(?:\d{1,3}:\d{2}|\d{1,3}:\d{2}:\d{2})$/;
const SAFE_QUEUE_ITEM_ID_PATTERN = /^queue_[a-z0-9]+_[a-z0-9]+$/i;
const SETTINGS_KINDS = new Set(["video", "audio"]);

function normalizeTextInput(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isPlainObject(value) {
  return Boolean(value) && Object.prototype.toString.call(value) === "[object Object]";
}

function hasUnsafeControlCharacters(value) {
  return /[\u0000-\u001F\u007F]/.test(value);
}

function validateStringInput(rawValue, options = {}) {
  if (typeof rawValue !== "string") {
    return {
      ok: false,
      message: options.requiredMessage || `${options.label || "Value"} is required.`
    };
  }

  if (hasUnsafeControlCharacters(rawValue)) {
    return {
      ok: false,
      message: `${options.label || "Value"} contains unsupported characters.`
    };
  }

  const value = normalizeTextInput(rawValue);
  const label = options.label || "Value";

  if (!value) {
    return {
      ok: false,
      message: options.requiredMessage || `${label} is required.`
    };
  }

  if (typeof options.maxLength === "number" && value.length > options.maxLength) {
    return {
      ok: false,
      message: `${label} is too long.`
    };
  }

  if (hasUnsafeControlCharacters(value)) {
    return {
      ok: false,
      message: `${label} contains unsupported characters.`
    };
  }

  if (options.pattern && !options.pattern.test(value)) {
    return {
      ok: false,
      message: options.patternMessage || `${label} contains unsupported characters.`
    };
  }

  return {
    ok: true,
    value
  };
}

function parseTrimTimecode(rawValue) {
  const invalidFormatMessage = "Use MM:SS or HH:MM:SS (for example 01:05 or 00:01:05).";
  const stringValidation = validateStringInput(rawValue, {
    label: "Trim value",
    requiredMessage: invalidFormatMessage,
    maxLength: MAX_TIMECODE_LENGTH,
    pattern: SAFE_TIMECODE_PATTERN,
    patternMessage: invalidFormatMessage
  });

  if (!stringValidation.ok) {
    return stringValidation;
  }

  const value = stringValidation.value;
  const segments = value.split(":");

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
  const stringValidation = validateStringInput(rawUrl, {
    label: "URL",
    requiredMessage: "A YouTube URL is required.",
    maxLength: MAX_URL_LENGTH,
    pattern: SAFE_URL_PATTERN,
    patternMessage: "URL contains unsupported characters."
  });

  if (!stringValidation.ok) {
    return {
      valid: false,
      message: stringValidation.message
    };
  }

  const trimmed = stringValidation.value;

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

  if (parsed.username || parsed.password || parsed.port) {
    return {
      valid: false,
      message: "URL must not include credentials or a custom port."
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

function validateQueueItemId(itemId) {
  const validation = validateStringInput(itemId, {
    label: "Queue item ID",
    requiredMessage: "Queue item ID is required.",
    maxLength: MAX_QUEUE_ITEM_ID_LENGTH,
    pattern: SAFE_QUEUE_ITEM_ID_PATTERN,
    patternMessage: "Queue item ID is invalid."
  });

  if (!validation.ok) {
    return validation;
  }

  return {
    ok: true,
    itemId: validation.value
  };
}

function normalizeSettingsPickerRequest(payload) {
  const kind = typeof payload?.kind === "string" ? payload.kind.trim().toLowerCase() : "";
  const currentPathValidation =
    typeof payload?.currentPath === "string"
      ? validateStringInput(payload.currentPath, {
          label: "Folder path",
          maxLength: MAX_URL_LENGTH
        })
      : null;

  return {
    kind: SETTINGS_KINDS.has(kind) ? kind : "video",
    currentPath: currentPathValidation && currentPathValidation.ok ? currentPathValidation.value : ""
  };
}

function validateDownloadInput(payload) {
  const errors = [];
  const fieldErrors = {};

  if (!isPlainObject(payload)) {
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
  hasUnsafeControlCharacters,
  normalizeSettingsPickerRequest,
  parseTrimTimecode,
  parseYouTubeUrl,
  validateQueueItemId,
  validateTrimInput,
  validateDownloadInput
};
