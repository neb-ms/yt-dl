const fs = require("fs");
const os = require("os");
const path = require("path");
const { validateDownloadInput } = require("../electron/main/validators");
const { probeDownloadInput } = require("../electron/main/probeService");
const { createQueueService } = require("../electron/main/queueService");

const appRoot = path.resolve(__dirname, "..");
const sampleVideoUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const samplePlaylistUrl = "https://www.youtube.com/playlist?list=PLrEnWoR732-BHrPp_Pm8_VleD68f9s14-";
const invalidVideoUrl = "https://www.youtube.com/watch?v=aaaaaaaaaaa";

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
  const timeoutMs = options.timeoutMs || 180000;
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

function createHistoryTracker(service) {
  const histories = new Map();
  let latestSnapshot = service.getSnapshot();

  const unsubscribe = service.onQueueUpdated((snapshot) => {
    latestSnapshot = snapshot;

    for (const item of snapshot.queue) {
      const history = histories.get(item.id) || [];
      const lastStatus = history.length > 0 ? history[history.length - 1] : null;
      if (lastStatus !== item.status) {
        history.push(item.status);
      }
      histories.set(item.id, history);
    }
  });

  return {
    histories,
    getLatestSnapshot: () => latestSnapshot,
    unsubscribe
  };
}

function buildService() {
  const downloadsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yt-dl-step3-"));
  return createQueueService({
    appRoot,
    downloadsRoot
  });
}

async function verifyPlaylistExpansion() {
  const validation = validateDownloadInput({
    url: samplePlaylistUrl,
    formatId: "audio_mp3",
    quality: "128"
  });

  assert(validation.ok, "Expected playlist URL to pass validation.");

  const probeResult = await probeDownloadInput({
    appRoot,
    input: validation.data
  });

  assert(probeResult.ok, "Expected playlist probe to succeed.");
  assert(probeResult.sourceKind === "playlist", "Expected probe result to identify a playlist.");
  assert(Array.isArray(probeResult.entries) && probeResult.entries.length >= 3, "Expected playlist probe to return multiple entries.");
  assert(
    probeResult.entries.every((entry) => typeof entry.url === "string" && entry.url.includes("youtube.com/watch")),
    "Expected playlist entries to contain direct YouTube watch URLs."
  );
}

async function verifyQueueStateTransitions() {
  const service = buildService();
  const tracker = createHistoryTracker(service);

  try {
    const validInput = validateDownloadInput({
      url: sampleVideoUrl,
      formatId: "audio_mp3",
      quality: "128"
    });
    const failingInput = validateDownloadInput({
      url: invalidVideoUrl,
      formatId: "audio_mp3",
      quality: "128"
    });

    assert(validInput.ok, "Expected valid queue item to pass validation.");
    assert(failingInput.ok, "Expected failure test URL to pass validation and fail at runtime.");

    const first = await service.enqueueInput(validInput.data);
    const second = await service.enqueueInput(failingInput.data);

    assert(first.ok && first.queueIds.length === 1, "Expected first queue enqueue to succeed.");
    assert(second.ok && second.queueIds.length === 1, "Expected second queue enqueue to succeed.");

    const successId = first.queueIds[0];
    const failureId = second.queueIds[0];

    await waitForCondition(() => {
      const snapshot = tracker.getLatestSnapshot();
      const successItem = snapshot.queue.find((item) => item.id === successId);
      const failureItem = snapshot.queue.find((item) => item.id === failureId);

      if (!successItem || !failureItem) {
        return false;
      }

      return successItem.status === "completed" && failureItem.status === "failed" && snapshot.counts.active === 0;
    }, { timeoutMs: 360000, label: "queue completion and failure states" });

    const successHistory = tracker.histories.get(successId) || [];
    const failureHistory = tracker.histories.get(failureId) || [];

    assert(successHistory.includes("active"), "Expected successful queue item to become active.");
    assert(successHistory.includes("completed"), "Expected successful queue item to complete.");
    assert(failureHistory.includes("pending"), "Expected failing queue item to be queued.");
    assert(failureHistory.includes("active"), "Expected failing queue item to become active.");
    assert(failureHistory.includes("failed"), "Expected failing queue item to fail.");
  } finally {
    tracker.unsubscribe();
    service.shutdown();
  }
}

async function verifyPauseResumeCancel() {
  const service = buildService();
  const tracker = createHistoryTracker(service);

  try {
    const slowInput = validateDownloadInput({
      url: sampleVideoUrl,
      formatId: "video_mp4",
      quality: "480"
    });
    const followUpInput = validateDownloadInput({
      url: sampleVideoUrl,
      formatId: "audio_mp3",
      quality: "128"
    });

    assert(slowInput.ok, "Expected pause/resume test input to pass validation.");
    assert(followUpInput.ok, "Expected follow-up queue item to pass validation.");

    const first = await service.enqueueInput(slowInput.data, {
      runnerOptions: {
        rateLimitBps: 30000
      }
    });
    const second = await service.enqueueInput(followUpInput.data);

    assert(first.ok && first.queueIds.length === 1, "Expected slow queue item to enqueue.");
    assert(second.ok && second.queueIds.length === 1, "Expected follow-up queue item to enqueue.");

    const slowId = first.queueIds[0];
    const followUpId = second.queueIds[0];

    await waitForCondition(() => {
      const snapshot = tracker.getLatestSnapshot();
      const item = snapshot.queue.find((entry) => entry.id === slowId);
      if (!item) {
        return false;
      }

      return (
        item.status === "active" &&
        ((typeof item.progress.downloadedBytes === "number" && item.progress.downloadedBytes > 0) ||
          (typeof item.progress.percent === "number" && item.progress.percent > 0))
      );
    }, { timeoutMs: 180000, label: "slow queue item progress" });

    const pauseResult = service.pauseDownload(slowId);
    assert(pauseResult.ok, "Expected active queue item to pause.");

    await waitForCondition(() => {
      const snapshot = tracker.getLatestSnapshot();
      const item = snapshot.queue.find((entry) => entry.id === slowId);
      return item && item.status === "paused";
    }, { timeoutMs: 30000, label: "paused queue item" });

    const resumeResult = service.resumeDownload(slowId);
    assert(resumeResult.ok, "Expected paused queue item to resume.");

    await waitForCondition(() => {
      const snapshot = tracker.getLatestSnapshot();
      const item = snapshot.queue.find((entry) => entry.id === slowId);
      return item && item.status === "active" && item.attemptCount >= 2;
    }, { timeoutMs: 120000, label: "resumed queue item" });

    const cancelResult = service.cancelDownload(slowId);
    assert(cancelResult.ok, "Expected active queue item to cancel.");

    await waitForCondition(() => {
      const snapshot = tracker.getLatestSnapshot();
      const cancelledItem = snapshot.queue.find((entry) => entry.id === slowId);
      const followUpItem = snapshot.queue.find((entry) => entry.id === followUpId);

      if (!cancelledItem || !followUpItem) {
        return false;
      }

      return cancelledItem.status === "cancelled" && followUpItem.status === "completed";
    }, { timeoutMs: 360000, label: "cancelled item and follow-up completion" });

    const slowHistory = tracker.histories.get(slowId) || [];
    assert(slowHistory.includes("paused"), "Expected slow queue item to enter paused state.");
    assert(slowHistory.filter((status) => status === "active").length >= 2, "Expected slow queue item to become active twice.");
    assert(slowHistory.includes("cancelled"), "Expected slow queue item to be cancelled.");
  } finally {
    tracker.unsubscribe();
    service.shutdown();
  }
}

async function main() {
  console.log("Running Step 3 verification...");

  await verifyPlaylistExpansion();
  console.log("1/3 playlist expansion smoke test: PASS");

  await verifyQueueStateTransitions();
  console.log("2/3 queue state transition test: PASS");

  await verifyPauseResumeCancel();
  console.log("3/3 pause/resume/cancel behavior test: PASS");

  console.log("Step 3 verification passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
