const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { validateDownloadInput } = require("../electron/main/validators");
const { findPythonExecutable } = require("../electron/main/dependencyService");

const appRoot = path.resolve(__dirname, "..");
const runnerPath = path.join(appRoot, "python", "runner.py");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateCases() {
  const validCases = [
    { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", kind: "video" },
    { url: "https://youtu.be/dQw4w9WgXcQ", kind: "video" },
    { url: "https://music.youtube.com/watch?v=dQw4w9WgXcQ", kind: "video" },
    {
      url: "https://www.youtube.com/playlist?list=PLrEnWoR732-BHrPp_Pm8_VleD68f9s14-",
      kind: "playlist"
    }
  ];

  const invalidCases = [
    "not-a-url",
    "javascript:alert(1)",
    "https://vimeo.com/123456",
    "https://www.youtube.com/"
  ];

  for (const testCase of validCases) {
    const result = validateDownloadInput({
      url: testCase.url,
      formatId: "video_mp4",
      quality: "best"
    });
    assert(result.ok, `Expected valid URL but got invalid: ${testCase.url}`);
    const sourceKind = result.data.sourceKind;
    if (testCase.kind === "playlist") {
      assert(sourceKind === "playlist", `Expected playlist source kind for ${testCase.url}`);
    } else {
      assert(
        sourceKind === "video" || sourceKind === "video_with_playlist_context",
        `Expected video source kind for ${testCase.url}`
      );
    }
  }

  for (const testUrl of invalidCases) {
    const result = validateDownloadInput({
      url: testUrl,
      formatId: "video_mp4",
      quality: "best"
    });
    assert(!result.ok, `Expected invalid URL but got valid: ${testUrl}`);
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

function runDownloadCase(python, testCase, rootOutputDir) {
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
      `verify_${testCase.name}`
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

    parseJsonLines(child.stdout, (jsonPayload) => {
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

      if (code !== 0) {
        reject(
          new Error(
            `Download case "${testCase.name}" failed with exit code ${code}.\n${stderr}`
          )
        );
        return;
      }

      const outputPath =
        completePayload && completePayload.outputPath && fs.existsSync(completePayload.outputPath)
          ? completePayload.outputPath
          : newestFile(outputDir);
      if (!outputPath || !fs.existsSync(outputPath)) {
        reject(new Error(`Download case "${testCase.name}" completed but no output file was found.`));
        return;
      }

      if (testCase.expectedExtension) {
        const lowerPath = outputPath.toLowerCase();
        if (!lowerPath.endsWith(`.${testCase.expectedExtension.toLowerCase()}`)) {
          reject(
            new Error(
              `Download case "${testCase.name}" produced unexpected extension: ${outputPath}`
            )
          );
          return;
        }
      }

      resolve({
        name: testCase.name,
        outputPath
      });
    });

    timeoutId = setTimeout(() => {
      child.kill();
      reject(new Error(`Download case "${testCase.name}" timed out after 4 minutes.`));
    }, 240000);
  });
}

async function main() {
  console.log("Running Step 1 verification...");

  validateCases();
  console.log("1/2 URL validation checks: PASS");

  const python = await findPythonExecutable(appRoot);
  assert(python, "Python executable was not found.");

  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yt-dl-step1-"));
  const testCases = [
    {
      name: "video_mp4",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      formatId: "video_mp4",
      quality: "480",
      expectedExtension: "mp4"
    },
    {
      name: "audio_mp3",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      formatId: "audio_mp3",
      quality: "192",
      expectedExtension: "mp3"
    }
  ];

  const results = [];
  for (const testCase of testCases) {
    const result = await runDownloadCase(python, testCase, outputRoot);
    results.push(result);
  }

  console.log("2/2 end-to-end download checks: PASS");
  for (const result of results) {
    console.log(`${result.name}: ${result.outputPath}`);
  }
  console.log("Step 1 verification passed.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
