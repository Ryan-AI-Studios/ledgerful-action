/**
 * Size guards for GitHub API payload limits.
 *
 * Hard limits (GitHub):
 * - Issue comment body: 65,536 **characters**
 * - Checks API output.summary / output.text: 65,535 **bytes** (UTF-8)
 *
 * Margins below the hard caps leave room for the truncation marker, re-closed
 * wrappers (`<details>` + fence), and any API-side encoding after measurement.
 * Margin numbers: COMMENT 536 chars (65536 − 65000); CHECK_RUN 535 bytes (65535 − 65000).
 */

/** Comment body budget: 65,000 chars (margin 536 below 65,536). */
export const COMMENT_MAX_CHARS = 65_000;

/** Check-run summary/text budget: 65,000 UTF-8 bytes (margin 535 below 65,535). */
export const CHECK_RUN_MAX_BYTES = 65_000;

/** Visible marker appended when a PR comment body is truncated. */
export const COMMENT_TRUNCATION_MARKER =
  "\n\n*…truncated — see full report artifact.*";

/** Visible marker appended when check-run text/summary is truncated. */
export const CHECK_RUN_TRUNCATION_MARKER =
  "\n\n…truncated — see full report artifact.";

export function utf8ByteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

/**
 * Truncate to a maximum character count (JS string `.length` / UTF-16 code units).
 * Final string length is always `<= maxChars` including the marker.
 */
export function truncateToCharLimit(
  s: string,
  maxChars: number,
  marker: string,
): string {
  if (maxChars <= 0) {
    return "";
  }
  if (s.length <= maxChars) {
    return s;
  }
  if (marker.length >= maxChars) {
    return marker.slice(0, maxChars);
  }
  const budget = maxChars - marker.length;
  return s.slice(0, budget) + marker;
}

/**
 * Truncate to a maximum UTF-8 byte length without splitting multi-byte characters.
 * Final UTF-8 byte length is always `<= maxBytes` including the marker.
 * MUST NOT produce U+FFFD replacement characters at the cut.
 */
export function truncateToUtf8Bytes(
  s: string,
  maxBytes: number,
  marker: string,
): string {
  if (maxBytes <= 0) {
    return "";
  }
  if (utf8ByteLength(s) <= maxBytes) {
    return s;
  }

  const markerBytes = utf8ByteLength(marker);
  if (markerBytes >= maxBytes) {
    return sliceUtf8ToBudget(marker, maxBytes);
  }

  const budget = maxBytes - markerBytes;
  const head = sliceUtf8ToBudget(s, budget);
  return head + marker;
}

/**
 * Slice `s` so the UTF-8 encoding is at most `maxBytes`, never mid-character.
 * Does not append a marker.
 *
 * Algorithm: cut at maxBytes, back off over continuation bytes (`b & 0xC0 === 0x80`),
 * then drop an incomplete multi-byte lead if the full sequence would exceed maxBytes.
 */
export function sliceUtf8ToBudget(s: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return "";
  }
  const buf = Buffer.from(s, "utf8");
  if (buf.length <= maxBytes) {
    return s;
  }

  let end = maxBytes;
  // Step back while the trailing byte is a UTF-8 continuation (10xxxxxx).
  // Buffer.at returns number | undefined (safer than index access for lint).
  while (end > 0) {
    const trailing = buf.at(end - 1);
    if (trailing === undefined || (trailing & 0xc0) !== 0x80) {
      break;
    }
    end -= 1;
  }

  // end now points just after an ASCII byte or a multi-byte lead.
  // If it is a multi-byte lead, include the full sequence only when it fits.
  if (end > 0) {
    const leadIndex = end - 1;
    const b = buf.at(leadIndex);
    if (b !== undefined) {
      const need = utf8SequenceLength(b);
      if (leadIndex + need > maxBytes) {
        // Incomplete multi-byte sequence — drop the lead.
        end = leadIndex;
      } else {
        // Complete sequence fits within the original byte budget.
        end = leadIndex + need;
      }
    }
  }

  return buf.subarray(0, end).toString("utf8");
}

/** Expected total bytes for a UTF-8 sequence given its leading byte. */
function utf8SequenceLength(lead: number): number {
  if (lead < 0x80) return 1;
  if ((lead & 0xe0) === 0xc0) return 2;
  if ((lead & 0xf0) === 0xe0) return 3;
  if ((lead & 0xf8) === 0xf0) return 4;
  // Invalid lead — treat as single byte so we drop it rather than hang.
  return 1;
}
