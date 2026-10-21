export type ByteRange = { start: number; end: number };

/**
 * Parse a single `Range: bytes=...` header for a file of `size` bytes.
 * Returns null when the header is not a satisfiable single range.
 */
export function parseRange(header: string, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    start >= size ||
    start > end
  ) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}
