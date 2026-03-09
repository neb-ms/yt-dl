const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { findPythonExecutable } = require("../electron/main/dependencyService");
const { validateDownloadInput } = require("../electron/main/validators");
const { createQueueService } = require("../electron/main/queueService");
const { createSettingsService } = require("../electron/main/settingsService");
const { validateApprovedPath } = require("../electron/main/pathSafety");

const appRoot = path.resolve(__dirname, "..");
const sampleVideoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForCondition(check, options = {}) {
  const timeoutMs = options.timeoutMs || 240000;
  const intervalMs = options.intervalMs || 250;
  const label = options.label || "condition";
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const value = await check();
    if (value) {
      return value;
    }
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

function findQueueItem(snapshot, itemId) {
  return snapshot.queue.find((item) => item.id === itemId) || null;
}

function getTagCaseInsensitive(tags, key) {
  if (!tags || typeof tags !== "object") {
    return null;
  }

  const expected = key.toLowerCase();
  const matchedEntry = Object.entries(tags).find(([entryKey]) => entryKey.toLowerCase() === expected);
  return matchedEntry ? matchedEntry[1] : null;
}

function probeMediaMetadata(filePath) {
  const probeRun = spawnSync(
    "ffprobe",
    ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath],
    {
      cwd: appRoot,
      encoding: "utf8"
    }
  );

  if (probeRun.status !== 0) {
    throw new Error(`ffprobe failed for ${filePath}: ${probeRun.stderr || probeRun.stdout}`);
  }

  return JSON.parse(probeRun.stdout);
}

function verifyMetadataFallback(python) {
  const inlineScript = `
import json
import os
import sys
sys.path.insert(0, os.path.join(${JSON.stringify(appRoot)}, "python"))
from metadata import build_metadata_overrides

partial = build_metadata_overrides({
    "uploader": "Fallback Channel",
    "upload_date": "20240102",
})
missing = build_metadata_overrides({})

print(json.dumps({
    "partial": partial,
    "missing": missing,
}))
`;

  const run = spawnSync(python.command, [...python.args, "-c", inlineScript], {
    cwd: appRoot,
    encoding: "utf8"
  });

  if (run.status !== 0) {
    throw new Error(run.stderr || run.stdout || "Python metadata fallback check failed.");
  }

  const parsed = JSON.parse(run.stdout);
  assert(parsed.partial.meta_artist === "Fallback Channel", "Expected uploader fallback to populate artist metadata.");
  assert(parsed.partial.meta_year === "2024", "Expected upload date fallback to derive year metadata.");
  assert(!parsed.partial.meta_title, "Expected missing title data to stay absent instead of fabricating a value.");
  assert(Object.keys(parsed.missing).length === 0, "Expected empty metadata input to produce no overrides.");
}

async function verifyMetadataRoutingAndPathValidation() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yt-dl-step4-"));
  const userDataPath = path.join(tempRoot, "user-data");
  const downloadsRoot = path.join(tempRoot, "downloads");
  const customVideoDir = path.join(tempRoot, "video-output");
  const customAudioDir = path.join(tempRoot, "audio-output");

  const settingsService = createSettingsService({
    appRoot,
    userDataPath,
    downloadsRoot
  });

  const saveResult = settingsService.saveSettings({
    videoOutputDir: customVideoDir,
    audioOutputDir: customAudioDir
  });
  assert(saveResult.ok, "Expected custom output folders to save successfully.");

  const settings = settingsService.getSettings();
  const allowedPath = validateApprovedPath(customAudioDir, settings.approvedDirectories);
  const disallowedPath = validateApprovedPath(path.join(tempRoot, "rogue-output"), settings.approvedDirectories);
  assert(allowedPath.ok, "Expected configured custom folder to be approved.");
  assert(!disallowedPath.ok, "Expected unrelated folder to be rejected by path validation.");

  const service = createQueueService({
    appRoot,
    resolveOutputDirectory: (formatType) => settingsService.resolveOutputDirectory(formatType)
  });

  try {
    const audioInput = validateDownloadInput({
      url: sampleVideoUrl,
      formatId: "audio_mp3",
      quality: "best"
    });
    const videoInput = validateDownloadInput({
      url: sampleVideoUrl,
      formatId: "video_mp4",
      quality: "480"
    });

    assert(audioInput.ok, "Expected audio Step 4 verification input to pass validation.");
    assert(videoInput.ok, "Expected video Step 4 verification input to pass validation.");

    const audioQueueResult = await service.enqueueInput(audioInput.data);
    const videoQueueResult = await service.enqueueInput(videoInput.data);

    assert(audioQueueResult.ok && audioQueueResult.queueIds.length === 1, "Expected audio queue item to enqueue.");
    assert(videoQueueResult.ok && videoQueueResult.queueIds.length === 1, "Expected video queue item to enqueue.");

    const audioItemId = audioQueueResult.queueIds[0];
    const videoItemId = videoQueueResult.queueIds[0];

    await waitForCondition(() => {
      const snapshot = service.getSnapshot();
      const audioItem = findQueueItem(snapshot, audioItemId);
      const videoItem = findQueueItem(snapshot, videoItemId);

      return (
        audioItem &&
        videoItem &&
        audioItem.status === "completed" &&
        videoItem.status === "completed" &&
        snapshot.counts.active === 0
      );
    }, {
      timeoutMs: 420000,
      label: "Step 4 queue items to complete"
    });

    const snapshot = service.getSnapshot();
    const audioItem = findQueueItem(snapshot, audioItemId);
    const videoItem = findQueueItem(snapshot, videoItemId);

    assert(audioItem && fs.existsSync(audioItem.outputPath), "Expected audio output file to exist.");
    assert(videoItem && fs.existsSync(videoItem.outputPath), "Expected video output file to exist.");
    assert(
      path.normalize(path.dirname(audioItem.outputPath)) === path.normalize(customAudioDir),
      `Expected audio output to route to ${customAudioDir}.`
    );
    assert(
      path.normalize(path.dirname(videoItem.outputPath)) === path.normalize(customVideoDir),
      `Expected video output to route to ${customVideoDir}.`
    );

    const probeResult = probeMediaMetadata(audioItem.outputPath);
    const tags = probeResult.format?.tags || {};
    const title = getTagCaseInsensitive(tags, "title");
    const artist = getTagCaseInsensitive(tags, "artist");
    const date = getTagCaseInsensitive(tags, "date") || getTagCaseInsensitive(tags, "year");
    const hasAttachedCover = Array.isArray(probeResult.streams)
      ? probeResult.streams.some((stream) => Number(stream?.disposition?.attached_pic) === 1)
      : false;

    assert(title && /Never Gonna Give You Up/i.test(title), "Expected MP3 title metadata to be embedded.");
    assert(artist && /Rick Astley/i.test(artist), "Expected MP3 artist metadata to be embedded.");
    assert(date && String(date).includes("2009"), "Expected MP3 year/date metadata to include 2009.");
    assert(hasAttachedCover, "Expected MP3 output to include embedded cover art.");

    return {
      audioPath: audioItem.outputPath,
      videoPath: videoItem.outputPath
    };
  } finally {
    service.shutdown();
  }
}

async function main() {
  console.log("Running Step 4 verification...");

  const python = await findPythonExecutable(appRoot);
  assert(python, "Python executable was not found.");

  const outputs = await verifyMetadataRoutingAndPathValidation();
  console.log("1/3 metadata presence check: PASS");

  verifyMetadataFallback(python);
  console.log("2/3 missing metadata fallback test: PASS");

  console.log("3/3 output routing and path-validation tests: PASS");
  console.log(`audio_routed_metadata: ${outputs.audioPath}`);
  console.log(`video_routed_output: ${outputs.videoPath}`);
  console.log("Step 4 verification passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
