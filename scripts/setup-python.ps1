$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$venvDir = Join-Path $repoRoot ".venv"
$requirementsFile = Join-Path $repoRoot "python\requirements.txt"

function Get-PythonCommand {
  $python = Get-Command python -ErrorAction SilentlyContinue
  if ($python) { return @{ command = $python.Path; args = @() } }

  $py = Get-Command py -ErrorAction SilentlyContinue
  if ($py) { return @{ command = $py.Path; args = @("-3") } }

  throw "Python 3 was not found on PATH. Install Python 3 and rerun this script."
}

$pythonCmd = Get-PythonCommand

Write-Host "Creating virtual environment at $venvDir"
& $pythonCmd.command @($pythonCmd.args + @("-m", "venv", $venvDir))

$venvPython = Join-Path $venvDir "Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
  throw "Virtual environment python executable was not created: $venvPython"
}

Write-Host "Installing Python dependencies from $requirementsFile"
& $venvPython -m pip install --upgrade pip
& $venvPython -m pip install -r $requirementsFile

Write-Host ""
Write-Host "Python setup complete."
Write-Host "Next: ensure ffmpeg is installed and available on PATH."
Write-Host "Windows hint: winget install Gyan.FFmpeg"

