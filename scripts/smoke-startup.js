const { spawn } = require("child_process");
const path = require("path");
const electronBinary = require("electron");

const repoRoot = path.resolve(__dirname, "..");

function runSmokeStartup() {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, SMOKE_TEST: "1" };
    delete env.ELECTRON_RUN_AS_NODE;

    const child = spawn(electronBinary, ["."], {
      cwd: repoRoot,
      env,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    const timeoutHandle = setTimeout(() => {
      child.kill();
      reject(new Error("Smoke startup timed out after 20 seconds."));
    }, 20000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    });

    child.on("exit", (code) => {
      clearTimeout(timeoutHandle);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(
            `Smoke startup failed with exit code ${code}.\nstdout: ${stdout}\nstderr: ${stderr}`
          )
        );
      }
    });
  });
}

runSmokeStartup()
  .then(() => {
    console.log("Smoke startup passed.");
  })
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
