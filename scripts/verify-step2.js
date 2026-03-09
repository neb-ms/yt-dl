const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { parseTrimTimecode, validateDownloadInput } = require("../electron/main/validators");
const { findPythonExecutable } = require("../electron/main/dependencyService");

const appRoot = path.resolve(__dirname, "..");
const runnerPath = path.join(appRoot, "python", "runner.py");
const sampleUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function parseJsonLines(stream, onJson) {
  let buffer = "";
  stream.on("data", (chunk) => {
    buffer += chunk.toString();
    let idx = buffer.indexOf("\n");
    while (idx !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) {
        try {
          onJson(JSON.parse(line));
        } catch {
          // ignore non-json lines
        }
      }
      idx = buffer.indexOf("\n");
    }
  });
}

function newestFile(outputDir) {
  const files = fs.readdirSync(outputDir).map((name) => path.join(outputDir, name));
  const realFiles = files.filter((fullPath) => fs.statSync(fullPath).isFile());
  if (realFiles.length === 0) {
    return null;
  }
  realFiles.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return realFiles[0];
}

function validateTrimCases() {
  const mmss = parseTrimTimecode("01:05");
  assert(mmss.ok, "Expected MM:SS trim format to parse.");
  assert(mmss.seconds === 65, `Expected 65 seconds for MM:SS, got ${mmss.seconds}.`);

  const hhmmss = parseTrimTimecode("00:01:05");
  assert(hhmmss.ok, "Expected HH:MM:SS trim format to parse.");
  assert(hhmmss.seconds === 65, `Expected 65 seconds for HH:MM:SS, got ${hhmmss.seconds}.`);

  const validTrim = validateDownloadInput({
    url: sampleUrl,
    formatId: "video_mp4",
    quality: "480",
    trimStart: "01:05",
    trimEnd: "01:12"
  });
  assert(validTrim.ok, "Expected valid trim range to pass validation.");
  assert(validTrim.data.trim && validTrim.data.trim.durationSeconds === 7, "Expected trim duration to equal 7 seconds.");

  const invalidFormat = validateDownloadInput({
    url: sampleUrl,
    formatId: "video_mp4",
    quality: "480",
    trimStart: "1:99",
    trimEnd: "02:05"
  });
  assert(!invalidFormat.ok, "Expected invalid trim format to fail validation.");

  const invalidRange = validateDownloadInput({
    url: sampleUrl,
    formatId: "video_mp4",
    quality: "480",
    trimStart: "01:30",
    trimEnd: "01:05"
  });
  assert(!invalidRange.ok, "Expected end <= start to fail validation.");
  assert(
    invalidRange.errors.some((error) => error.includes("Trim end must be greater than trim start.")),
    "Expected end <= start validation message."
  );
}

function runRunnerCase(python, testCase, rootOutputDir, options = {}) {
  const expectFailure = options.expectFailure === true;

  return new Promise((resolve, reject) => {
    const outputDir = path.join(rootOutputDir, testCase.name);
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.mkdirSync(outputDir, { recursive: true });

    const args = [
      runnerPath,
      "--url",
      testCase.url,
      "--source-kind",
      "video",
      "--format-id",
      testCase.formatId,
      "--quality",
      testCase.quality,
      "--output-dir",
      outputDir,
      "--download-id",
      `verify_${testCase.name}`,
      "--trim-start-seconds",
      String(testCase.trimStartSeconds),
      "--trim-end-seconds",
      String(testCase.trimEndSeconds)
    ];

    const child = spawn(python.command, [...python.args, ...args], {
      cwd: appRoot,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1"
      },
      windowsHide: true
    });

    let stderr = "";
    let completePayload = null;
    let timeoutId = null;
    const jsonMessages = [];

    parseJsonLines(child.stdout, (jsonPayload) => {
      jsonMessages.push(jsonPayload);
      if (jsonPayload.event === "complete") {
        completePayload = jsonPayload;
      }
      if (jsonPayload.event === "error") {
        stderr += `${jsonPayload.message || "unknown runner error"}\n`;
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (expectFailure) {
        if (code === 0) {
          reject(new Error(`Runner case "${testCase.name}" succeeded unexpectedly.`));
          return;
        }

        resolve({
          name: testCase.name,
          code,
          jsonMessages,
          stderr
        });
        return;
      }

      if (code !== 0) {
        reject(
          new Error(
            `Runner case "${testCase.name}" failed with exit code ${code}.\n${stderr}`
          )
        );
        return;
      }

      const outputPath =
        completePayload && completePayload.outputPath && fs.existsSync(completePayload.outputPath)
          ? completePayload.outputPath
          : newestFile(outputDir);
      if (!outputPath || !fs.existsSync(outputPath)) {
        reject(new Error(`Runner case "${testCase.name}" completed but no output file was found.`));
        return;
      }

      if (testCase.expectedExtension) {
        const lowerPath = outputPath.toLowerCase();
        if (!lowerPath.endsWith(`.${testCase.expectedExtension.toLowerCase()}`)) {
          reject(
            new Error(
              `Runner case "${testCase.name}" produced unexpected extension: ${outputPath}`
            )
          );
          return;
        }
      }

      resolve({
        name: testCase.name,
        outputPath,
        jsonMessages
      });
    });

    timeoutId = setTimeout(() => {
      child.kill();
      reject(new Error(`Runner case "${testCase.name}" timed out after 5 minutes.`));
    }, 300000);
  });
}

function getMediaDurationSeconds(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath
      ],
      {
        cwd: appRoot,
        env: process.env,
        windowsHide: true
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(new Error(`ffprobe failed to start: ${error.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`ffprobe exited with code ${code}.\n${stderr}`));
        return;
      }

      const duration = Number.parseFloat(stdout.trim());
      if (!Number.isFinite(duration)) {
        reject(new Error(`ffprobe returned an invalid duration for ${filePath}.`));
        return;
      }

      resolve(duration);
    });
  });
}

async function assertDurationNear(filePath, expectedSeconds, toleranceSeconds) {
  const actualSeconds = await getMediaDurationSeconds(filePath);
  const delta = Math.abs(actualSeconds - expectedSeconds);
  assert(
    delta <= toleranceSeconds,
    `Expected ${path.basename(filePath)} to be about ${expectedSeconds}s, got ${actualSeconds.toFixed(2)}s.`
  );
  return actualSeconds;
}

async function main() {
  console.log("Running Step 2 verification...");

  validateTrimCases();
  console.log("1/3 trim parser validation checks: PASS");

  const python = await findPythonExecutable(appRoot);
  assert(python, "Python executable was not found.");

  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yt-dl-step2-"));
  const trimmedCases = [
    {
      name: "audio_trim_mmss",
      url: sampleUrl,
      formatId: "audio_mp3",
      quality: "192",
      trimStartSeconds: 60,
      trimEndSeconds: 66,
      expectedExtension: "mp3",
      expectedDurationSeconds: 6
    },
    {
      name: "video_trim_hhmmss",
      url: sampleUrl,
      formatId: "video_mp4",
      quality: "480",
      trimStartSeconds: 70,
      trimEndSeconds: 76,
      expectedExtension: "mp4",
      expectedDurationSeconds: 6
    }
  ];

  const trimmedResults = [];
  for (const testCase of trimmedCases) {
    const result = await runRunnerCase(python, testCase, outputRoot);
    const actualDuration = await assertDurationNear(result.outputPath, testCase.expectedDurationSeconds, 1.5);
    trimmedResults.push({
      name: result.name,
      outputPath: result.outputPath,
      actualDuration
    });
  }

  console.log("2/3 trimmed download checks: PASS");

  const invalidResult = await runRunnerCase(
    python,
    {
      name: "invalid_trim_end_past_media",
      url: sampleUrl,
      formatId: "video_mp4",
      quality: "480",
      trimStartSeconds: 210,
      trimEndSeconds: 240
    },
    outputRoot,
    { expectFailure: true }
  );

  const invalidMessages = invalidResult.jsonMessages
    .filter((message) => message.event === "error")
    .map((message) => message.message || "");
  assert(
    invalidMessages.some((message) => message.includes("Trim end") && message.includes("media duration")),
    "Expected runner to block trim end values past media duration."
  );

  console.log("3/3 invalid trim guard checks: PASS");
  for (const result of trimmedResults) {
    console.log(`${result.name}: ${result.outputPath} (${result.actualDuration.toFixed(2)}s)`);
  }
  console.log("invalid_trim_end_past_media: PASS");
  console.log("Step 2 verification passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
