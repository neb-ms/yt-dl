#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
venv_dir="$repo_root/.venv"
requirements_file="$repo_root/python/requirements.txt"

if command -v python3 >/dev/null 2>&1; then
  python_cmd="python3"
elif command -v python >/dev/null 2>&1; then
  python_cmd="python"
else
  echo "Python 3 not found on PATH. Install Python 3 and rerun this script."
  exit 1
fi

echo "Creating virtual environment at $venv_dir"
"$python_cmd" -m venv "$venv_dir"

venv_python="$venv_dir/bin/python"
if [[ ! -x "$venv_python" ]]; then
  echo "Virtual environment python executable not found: $venv_python"
  exit 1
fi

echo "Installing Python dependencies from $requirements_file"
"$venv_python" -m pip install --upgrade pip
"$venv_python" -m pip install -r "$requirements_file"

echo
echo "Python setup complete."
echo "Next: ensure ffmpeg is installed and available on PATH."
echo "macOS hint: brew install ffmpeg"
echo "Linux hint: install ffmpeg via your distro package manager"

