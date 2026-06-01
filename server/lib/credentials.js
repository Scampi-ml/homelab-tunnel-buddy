import { readdir, access } from 'fs/promises';
import { join } from 'path';
import { constants } from 'fs';
import { CLOUDFLARED_DIR, CREDENTIALS_DIRS } from './env.js';

export async function listCredentialFiles() {
  const seen = new Set();
  const files = [];

  for (const dir of CREDENTIALS_DIRS) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const fullPath = join(dir, entry.name);
      if (seen.has(fullPath)) continue;
      seen.add(fullPath);
      files.push({ name: entry.name, path: fullPath, directory: dir });
    }
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function pathExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function validateCredentialsPath(credentialsFile) {
  if (!credentialsFile || typeof credentialsFile !== 'string') {
    return { valid: false, error: 'credentials-file path is required' };
  }
  const exists = await pathExists(credentialsFile);
  if (!exists) {
    return {
      valid: false,
      error: `Credentials file not found: ${credentialsFile}`
    };
  }
  if (!credentialsFile.endsWith('.json')) {
    return { valid: false, error: 'credentials-file must be a .json file' };
  }
  return { valid: true };
}
