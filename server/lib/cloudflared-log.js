import { open, stat } from 'fs/promises';

const DEFAULT_MAX_LINES = 500;
const MAX_LINES_CAP = 5000;
const TAIL_READ_CHUNK = 64 * 1024;
const MAX_APPEND_BYTES = 512 * 1024;

function clampLines(n) {
  const v = parseInt(String(n), 10);
  if (Number.isNaN(v) || v < 1) return DEFAULT_MAX_LINES;
  return Math.min(v, MAX_LINES_CAP);
}

function splitLines(text) {
  const parts = text.split('\n');
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/**
 * Read the last `maxLines` lines from a file (reads from the end in chunks).
 */
async function readTailLines(filePath, maxLines) {
  const st = await stat(filePath);
  if (st.size === 0) {
    return { lines: [], size: 0, truncated: false };
  }

  const fd = await open(filePath, 'r');
  try {
    let position = st.size;
    let collected = '';
    let truncated = false;

    while (position > 0) {
      const readSize = Math.min(TAIL_READ_CHUNK, position);
      position -= readSize;
      const buf = Buffer.alloc(readSize);
      const { bytesRead } = await fd.read(buf, 0, readSize, position);
      collected = buf.subarray(0, bytesRead).toString('utf8') + collected;
      const lineCount = splitLines(collected).length;
      if (lineCount > maxLines + 1) {
        truncated = true;
        break;
      }
    }

    let lines = splitLines(collected);
    if (lines.length > maxLines) {
      lines = lines.slice(-maxLines);
      truncated = true;
    }
    return { lines, size: st.size, truncated };
  } finally {
    await fd.close();
  }
}

/**
 * Read new bytes from `offset` (for live tail). Resets if the file shrank (rotation).
 */
async function readSinceOffset(filePath, offset) {
  const st = await stat(filePath);
  let from = Number(offset);
  if (Number.isNaN(from) || from < 0) from = 0;
  if (from > st.size) from = 0;

  if (from >= st.size) {
    return { text: '', offset: st.size, size: st.size, rotated: from > 0 && st.size < from };
  }

  const toRead = Math.min(st.size - from, MAX_APPEND_BYTES);
  const fd = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(toRead);
    const { bytesRead } = await fd.read(buf, 0, toRead, from);
    const text = buf.subarray(0, bytesRead).toString('utf8');
    const newOffset = from + bytesRead;
    return {
      text,
      offset: newOffset,
      size: st.size,
      truncated: st.size - from > MAX_APPEND_BYTES,
      rotated: false
    };
  } finally {
    await fd.close();
  }
}

export async function getCloudflaredLogInfo(filePath) {
  try {
    const st = await stat(filePath);
    return {
      path: filePath,
      exists: true,
      size: st.size,
      modifiedAt: st.mtime.toISOString()
    };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { path: filePath, exists: false, size: 0, modifiedAt: null };
    }
    if (err.code === 'EACCES') {
      const e = new Error(`Cannot read log file: ${filePath}`);
      e.status = 403;
      throw e;
    }
    throw err;
  }
}

export async function readCloudflaredLog(filePath, options = {}) {
  const info = await getCloudflaredLogInfo(filePath);

  if (!info.exists) {
    return {
      ...info,
      lines: [],
      text: '',
      offset: 0,
      truncated: false,
      hint:
        'Log file not found. Add --logfile to cloudflared ExecStart, restart the tunnel, or set CLOUDFLARED_LOG_FILE.'
    };
  }

  const since = options.since;
  if (since !== undefined && since !== null && since !== '') {
    const append = await readSinceOffset(filePath, since);
    return {
      ...info,
      lines: splitLines(append.text),
      text: append.text,
      offset: append.offset,
      truncated: append.truncated,
      rotated: append.rotated
    };
  }

  const maxLines = clampLines(options.lines);
  const tail = await readTailLines(filePath, maxLines);
  return {
    ...info,
    lines: tail.lines,
    text: tail.lines.join('\n'),
    offset: tail.size,
    truncated: tail.truncated
  };
}
