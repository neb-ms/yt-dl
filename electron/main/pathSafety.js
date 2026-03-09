const fs = require("fs");
const path = require("path");

function toComparablePath(inputPath) {
  const normalized = path.normalize(path.resolve(inputPath));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function normalizeDirectoryPath(inputPath) {
  if (typeof inputPath !== "string") {
    return null;
  }

  const trimmed = inputPath.trim();
  if (!trimmed || trimmed.includes("\0") || !path.isAbsolute(trimmed)) {
    return null;
  }

  return path.normalize(path.resolve(trimmed));
}

function validateDirectoryPath(inputPath, options = {}) {
  const requireExisting = options.requireExisting === true;
  const normalizedPath = normalizeDirectoryPath(inputPath);

  if (!normalizedPath) {
    return {
      ok: false,
      message: "Choose an absolute folder path."
    };
  }

  if (fs.existsSync(normalizedPath)) {
    let stat;
    try {
      stat = fs.statSync(normalizedPath);
    } catch (error) {
      return {
        ok: false,
        message: `Folder could not be inspected: ${error.message}`
      };
    }

    if (!stat.isDirectory()) {
      return {
        ok: false,
        message: "Selected path must point to a folder."
      };
    }
  } else if (requireExisting) {
    return {
      ok: false,
      message: "Selected folder does not exist."
    };
  }

  return {
    ok: true,
    path: normalizedPath
  };
}

function isSameOrChildPath(targetPath, approvedPath) {
  const targetComparable = toComparablePath(targetPath);
  const approvedComparable = toComparablePath(approvedPath);

  if (targetComparable === approvedComparable) {
    return true;
  }

  const approvedPrefix = approvedComparable.endsWith(path.sep)
    ? approvedComparable
    : `${approvedComparable}${path.sep}`;

  return targetComparable.startsWith(approvedPrefix);
}

function validateApprovedPath(targetPath, approvedDirectories) {
  const targetValidation = validateDirectoryPath(targetPath);
  if (!targetValidation.ok) {
    return targetValidation;
  }

  const approvedList = Array.isArray(approvedDirectories) ? approvedDirectories : [];
  const allowed = approvedList.some((approvedDirectory) => {
    const approvedValidation = validateDirectoryPath(approvedDirectory);
    return approvedValidation.ok && isSameOrChildPath(targetValidation.path, approvedValidation.path);
  });

  if (!allowed) {
    return {
      ok: false,
      message: "Path is outside the approved output folders."
    };
  }

  return {
    ok: true,
    path: targetValidation.path
  };
}

module.exports = {
  normalizeDirectoryPath,
  validateDirectoryPath,
  validateApprovedPath
};
