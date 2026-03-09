const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const {
  normalizeSettingsPickerRequest,
  parseTrimTimecode,
  validateDownloadInput,
  validateQueueItemId
} = require("../electron/main/validators");
const { buildUpdateCommand, createUpdateService } = require("../electron/main/updateService");

const appRoot = path.resolve(__dirname, "..");
const sampleUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runSmokeStartup() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "smoke-startup.js")], {
      cwd: appRoot,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);

    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `Startup smoke check failed with exit code ${code}.\nstdout: ${stdout}\nstderr: ${stderr}`
          )
        );
      }
    });
  });
}

function verifySecuritySanitization() {
  const validPayload = validateDownloadInput({
    url: sampleUrl,
    formatId: "video_mp4",
    quality: "480",
    trimStart: "00:05",
    trimEnd: "00:11"
  });
  assert(validPayload.ok, "Expected known-good input to pass main-process validation.");

  const invalidUrlCases = [
    `${sampleUrl}\ncalc`,
    `${sampleUrl}\u0000`,
    `${sampleUrl}|calc`,
    "https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ",
    `https://www.youtube.com/watch?v=${"a".repeat(2100)}`
  ];

  for (const testUrl of invalidUrlCases) {
    const result = validateDownloadInput({
      url: testUrl,
      formatId: "video_mp4",
      quality: "480"
    });
    assert(!result.ok, `Expected unsafe URL to be rejected: ${JSON.stringify(testUrl)}`);
  }

  const invalidTrimCases = [
    "00:10;shutdown",
    "00:10\n00:20",
    "0:0",
    "00:99",
    "00:00:00:10"
  ];

  for (const timecode of invalidTrimCases) {
    const result = parseTrimTimecode(timecode);
    assert(!result.ok, `Expected unsafe timecode to be rejected: ${JSON.stringify(timecode)}`);
  }

  assert(validateQueueItemId("queue_1741538790000_abcd123").ok, "Expected valid queue item ID to pass.");
  assert(!validateQueueItemId("queue_1741538790000_abcd123;rm -rf").ok, "Expected unsafe queue item ID to fail.");
  assert(!validateQueueItemId("queue_1741538790000_abcd123\n").ok, "Expected control characters in queue item ID to fail.");

  const safePicker = normalizeSettingsPickerRequest({
    kind: "audio",
    currentPath: "C:\\Users\\miles\\Music"
  });
  assert(safePicker.kind === "audio", "Expected allowed settings picker kind to be preserved.");
  assert(safePicker.currentPath === "C:\\Users\\miles\\Music", "Expected clean picker path to be preserved.");

  const unsafePicker = normalizeSettingsPickerRequest({
    kind: "audio|rm -rf",
    currentPath: "C:\\Users\\miles\\Music\r\n"
  });
  assert(unsafePicker.kind === "video", "Expected invalid picker kind to fall back to video.");
  assert(unsafePicker.currentPath === "", "Expected unsafe picker path to be cleared.");
}

async function verifyUpdateFlow() {
  const python = { command: "python", args: ["-3"] };
  const builtCommand = buildUpdateCommand(python);
  assert(
    builtCommand.args.join(" ") === "-3 -m pip install --upgrade --disable-pip-version-check yt-dlp",
    "Expected yt-dlp update command to be built from a safe argument list."
  );

  let cancelRunCount = 0;
  const cancelledService = createUpdateService({
    appRoot,
    findPythonExecutableFn: async () => python,
    confirmFn: async () => false,
    runProcessFn: async () => {
      cancelRunCount += 1;
      return { exitCode: 0, stdout: "", stderr: "" };
    }
  });

  const cancelledResult = await cancelledService.updateYtdlp();
  assert(!cancelledResult.ok && cancelledResult.cancelled, "Expected update cancellation to be reported.");
  assert(cancelRunCount === 0, "Expected cancelled update not to execute the command.");

  let captured = null;
  const successService = createUpdateService({
    appRoot,
    findPythonExecutableFn: async () => python,
    confirmFn: async ({ commandPreview }) => {
      assert(commandPreview.includes("pip install --upgrade"), "Expected confirmation preview to show the pip upgrade command.");
      return true;
    },
    runProcessFn: async (command, args, options) => {
      captured = { command, args, options };
      return {
        exitCode: 0,
        stdout: "Requirement already satisfied: yt-dlp",
        stderr: ""
      };
    }
  });

  const successResult = await successService.updateYtdlp();
  assert(successResult.ok, "Expected confirmed update to succeed.");
  assert(captured.command === "python", "Expected update to use the discovered Python command.");
  assert(
    JSON.stringify(captured.args) === JSON.stringify(["-3", "-m", "pip", "install", "--upgrade", "--disable-pip-version-check", "yt-dlp"]),
    "Expected update to run with a safe list of arguments."
  );
  assert(captured.options.cwd === appRoot, "Expected update command to run from the repository root.");
  assert(captured.options.env.PYTHONUNBUFFERED === "1", "Expected update env to set PYTHONUNBUFFERED.");

  let confirmationAttempts = 0;
  const recoverableService = createUpdateService({
    appRoot,
    findPythonExecutableFn: async () => python,
    confirmFn: async () => {
      confirmationAttempts += 1;
      if (confirmationAttempts === 1) {
        throw new Error("Confirmation dialog failed.");
      }
      return true;
    },
    runProcessFn: async () => ({
      exitCode: 0,
      stdout: "ok",
      stderr: ""
    })
  });

  let confirmationError = null;
  try {
    await recoverableService.updateYtdlp();
  } catch (error) {
    confirmationError = error;
  }

  assert(
    confirmationError && /confirmation dialog failed/i.test(confirmationError.message),
    "Expected a confirmation failure to propagate its error."
  );
  const recoveredResult = await recoverableService.updateYtdlp();
  assert(recoveredResult.ok, "Expected update service to recover after a confirmation failure.");

  let releaseUpdate = null;
  let runStartedResolve = null;
  const runStarted = new Promise((resolve) => {
    runStartedResolve = resolve;
  });
  const lockedService = createUpdateService({
    appRoot,
    findPythonExecutableFn: async () => python,
    confirmFn: async () => true,
    runProcessFn: async () =>
      new Promise((resolve) => {
        runStartedResolve();
        releaseUpdate = () => resolve({ exitCode: 0, stdout: "ok", stderr: "" });
      })
  });

  const firstRun = lockedService.updateYtdlp();
  await runStarted;
  const secondRun = await lockedService.updateYtdlp();
  assert(!secondRun.ok && /already in progress/i.test(secondRun.message), "Expected duplicate update attempts to be blocked.");
  releaseUpdate();
  const firstResult = await firstRun;
  assert(firstResult.ok, "Expected the original in-progress update to finish successfully.");
}

async function verifyLayoutSmoke() {
  await runSmokeStartup();

  const htmlPath = path.join(appRoot, "electron", "renderer", "index.html");
  const cssPath = path.join(appRoot, "electron", "renderer", "styles.css");
  const html = fs.readFileSync(htmlPath, "utf8");
  const css = fs.readFileSync(cssPath, "utf8");

  const topStageIndex = html.indexOf('class="top-stage"');
  const queuePanelIndex = html.indexOf('class="panel queue-panel"');

  assert(topStageIndex !== -1, "Expected renderer layout to include the top-stage container.");
  assert(queuePanelIndex !== -1, "Expected renderer layout to include the queue panel.");
  assert(topStageIndex < queuePanelIndex, "Expected the queue panel to remain below the top control stage.");

  const htmlMarkers = [
    'class="brand-mark"',
    'class="top-primary"',
    'class="top-secondary"',
    'id="update-ytdlp-btn"',
    'id="queue-sections"'
  ];
  for (const marker of htmlMarkers) {
    assert(html.includes(marker), `Expected layout marker ${marker} to exist in index.html.`);
  }

  const cssMarkers = [".top-stage", ".brand-mark", ".button-accent", ".runtime-note", ".mini-progress-fill"];
  for (const marker of cssMarkers) {
    assert(css.includes(marker), `Expected style marker ${marker} to exist in styles.css.`);
  }
}

async function main() {
  console.log("Running Step 5 verification...");

  verifySecuritySanitization();
  console.log("1/3 security-focused input fuzz/sanitization checks: PASS");

  await verifyUpdateFlow();
  console.log("2/3 explicit-confirmation yt-dlp update flow check: PASS");

  await verifyLayoutSmoke();
  console.log("3/3 UI layout smoke test: PASS");

  console.log("Step 5 verification passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
