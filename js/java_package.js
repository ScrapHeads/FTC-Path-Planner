const JAVA_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
export const TEAMCODE_PACKAGE = 'org.firstinspires.ftc.teamcode';
const TEAMCODE_PACKAGE_PARTS = TEAMCODE_PACKAGE.split('.');

/**
 * Convert a folder beneath the FTC `teamcode` directory into its Java package.
 * Full filesystem paths, project-relative paths, and paths relative to the
 * teamcode folder are accepted.
 */
export function javaPackageFromFolderPath(folderPath) {
  const normalized = normalizeFolderPath(folderPath);
  if (!normalized) return null;

  const isDottedPackage = !normalized.includes('/') && normalized.includes('.');
  const parts = (isDottedPackage ? normalized.split('.') : normalized.split('/'))
    .filter(part => part && part !== '.');
  const teamcodeIndex = parts.lastIndexOf('teamcode');
  let relativeParts;

  if (teamcodeIndex >= 0) {
    relativeParts = parts.slice(teamcodeIndex + 1);
  } else {
    const isAbsolute = normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized);
    const containsJavaSourceRoot = parts.some((part, index) =>
      part === 'src' && parts[index + 2] === 'java'
    );
    if (isAbsolute || containsJavaSourceRoot) return null;
    relativeParts = parts;
  }

  if (!relativeParts.every(isJavaIdentifier)) return null;
  return [...TEAMCODE_PACKAGE_PARTS, ...relativeParts].join('.');
}

export function suggestJavaFolderPath(currentFolderPath, selectedFolderName) {
  const currentPackage = javaPackageFromFolderPath(currentFolderPath);
  const relativeParts = currentPackage
    ? currentPackage.split('.').slice(TEAMCODE_PACKAGE_PARTS.length)
    : [];
  const folderName = String(selectedFolderName || '').trim();
  if (isJavaIdentifier(folderName)) {
    if (relativeParts.length) relativeParts[relativeParts.length - 1] = folderName;
    else relativeParts.push(folderName);
  }
  return relativeParts.join('/');
}

/**
 * Infer a complete package from Java source files already stored in a selected
 * directory. Browsers normally hide the directory's parent path, but they do
 * allow reading files after the user grants access to the directory.
 */
export async function javaPackageFromDirectoryHandle(directoryHandle) {
  if (!directoryHandle?.values) return null;

  const packages = new Set();
  for await (const entry of directoryHandle.values()) {
    if (entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.java')) continue;
    const file = await entry.getFile();
    const source = await file.text();
    const match = source.match(/^\s*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/m);
    if (!match) continue;

    const packageName = javaPackageFromFolderPath(match[1]);
    if (packageName !== match[1]) continue;
    packages.add(packageName);
    if (packages.size > 1) return null;
  }

  return packages.values().next().value || null;
}

function normalizeFolderPath(value) {
  return String(value || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .replace(/\\/g, '/')
    .replace(/^file:\/\//i, '')
    .replace(/\/{2,}/g, '/')
    .replace(/\/$/, '');
}

function isJavaIdentifier(value) {
  return JAVA_IDENTIFIER.test(value);
}
