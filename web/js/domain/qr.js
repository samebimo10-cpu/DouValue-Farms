// QR codes for zones — FR-FARM-03, UX-12 and FR-PROOF-03.
//
// Three requirements meet in this file. Every zone gets a printable QR code for
// its door (FR-FARM-03). Scanning it is the quickest way to choose a zone and
// is offered first (UX-12). And scanning it at the start of a task is what
// confirms somebody is actually standing in the house they are recording
// against (FR-PROOF-03).
//
// WHY THE ENCODER IS WRITTEN OUT HERE
//
// The app has no build step, no dependencies and has to work on a phone with no
// signal, so pulling in a QR library is not available. The specification is
// public and the subset needed here is small: byte mode, error correction level
// M, versions 1 to 6, which covers anything up to 106 characters — a zone code
// is about twenty-five.
//
// Level M is the choice worth explaining: it recovers from roughly 15% damage.
// These codes are printed on paper and taped to a greenhouse door in Port
// Harcourt, where they will be rained on, splashed with mud and touched by wet
// hands. L would be smaller and would stop scanning the first wet week.
//
// The reader is BarcodeDetector where the phone has it, and the zone list where
// it does not (see ui/scan.js). Nothing here depends on the camera: the same
// payload is produced for printing and parsed on the way back in, so the two
// ends cannot drift apart.

// --- The payload ----------------------------------------------------------

/**
 * What is actually in the code.
 *
 * Plain text, not a URL. A URL invites a phone's own camera app to open a
 * browser instead of handing the text to us, and it makes the code bigger for
 * no gain: nothing outside this app has any use for a zone id.
 */
export const ZONE_CODE_PREFIX = 'DOUVALUE:ZONE:';

export function zoneCode(zone) {
  if (!zone || !zone.id) return null;
  return `${ZONE_CODE_PREFIX}${zone.id}`;
}

/**
 * The zone id out of whatever the scanner handed us.
 *
 * Forgiving on the way in, because a reader may hand back the text with
 * whitespace, in a different case, or wrapped in a URL somebody made by hand.
 * Anything it cannot read comes back null rather than as a guess — confirming
 * the wrong zone is worse than not confirming one.
 */
export function parseZoneCode(text) {
  const raw = String(text == null ? '' : text).trim();
  if (!raw) return null;

  const direct = raw.match(/^douvalue:zone:(.+)$/i);
  if (direct) return direct[1].trim() || null;

  // A URL somebody built by hand, e.g. .../#/zones?zone=gh1
  const url = raw.match(/[?&#]zone=([^&#\s]+)/i);
  if (url) return decodeURIComponent(url[1]);

  return null;
}

/**
 * Which zone this code names — the check FR-PROOF-03 actually needs.
 *
 * `expectZoneId` is the zone the task is for. Scanning the door of a different
 * house is not a failure to be swallowed: it is the single most useful thing
 * this feature can catch, so it comes back as a named mismatch with both zones
 * in it.
 */
export function matchZone(state, text, { expectZoneId = null } = {}) {
  const zones = Object.values((state && state.plots) || {});
  const id = parseZoneCode(text);
  const zone = id
    ? zones.find((z) => z.id === id)
      // A code printed before a zone was renamed still has to work, so the name
      // is accepted as a fallback.
      || zones.find((z) => String(z.name).toLowerCase() === String(id).toLowerCase())
    : null;

  if (!zone) {
    return {
      ok: false,
      reason: 'unknown',
      why: 'That code is not one of this farm\'s zone codes.',
      fix: 'Choose the zone from the list instead, and tell the manager the door code is wrong.',
      zone: null,
    };
  }
  if (expectZoneId && zone.id !== expectZoneId) {
    const wanted = zones.find((z) => z.id === expectZoneId);
    return {
      ok: false,
      reason: 'wrong-zone',
      why: `That is ${zone.name}. This job is for ${wanted ? wanted.name : 'another zone'}.`,
      fix: 'Go to the right house, or pick the job for this one.',
      zone,
      expected: wanted || null,
    };
  }
  return { ok: true, zone };
}

// --- The encoder ----------------------------------------------------------
//
// Byte mode, error correction level M, versions 1-6. Everything below is the
// specification (ISO/IEC 18004) and nothing in it is a judgement call.

/** total codewords, EC codewords per block, number of blocks — level M. */
const VERSIONS = {
  1: { total: 26, ecPerBlock: 10, blocks: 1 },
  2: { total: 44, ecPerBlock: 16, blocks: 1 },
  3: { total: 70, ecPerBlock: 26, blocks: 1 },
  4: { total: 100, ecPerBlock: 18, blocks: 2 },
  5: { total: 134, ecPerBlock: 24, blocks: 2 },
  6: { total: 172, ecPerBlock: 16, blocks: 4 },
};

/** Data codewords available at a version, after the error correction is taken out. */
export function dataCodewords(version) {
  const v = VERSIONS[version];
  return v.total - v.ecPerBlock * v.blocks;
}

/** How many characters fit, once the 2-byte byte-mode header is paid for. */
export function byteCapacity(version) {
  return dataCodewords(version) - 2;
}

export const MAX_VERSION = 6;

/** The smallest version that holds this many bytes, or null if none does. */
export function versionFor(byteLength) {
  for (let v = 1; v <= MAX_VERSION; v++) if (byteLength <= byteCapacity(v)) return v;
  return null;
}

// GF(256), primitive polynomial x^8 + x^4 + x^3 + x^2 + 1.
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/**
 * The generator polynomial for n error-correction codewords: the product of
 * (x - a^i) for i below n, highest power first, so poly[0] is always 1.
 */
export function generatorPoly(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];                              // x * poly
      next[j + 1] ^= gfMul(poly[j], EXP[i]);           // a^i * poly
    }
    poly = next;
  }
  return poly;
}

/** Reed-Solomon remainder: the error-correction codewords for one block. */
export function ecCodewords(data, count) {
  const gen = generatorPoly(count);
  const out = new Array(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ out[0];
    out.shift();
    out.push(0);
    if (factor !== 0) {
      for (let i = 0; i < count; i++) out[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return out;
}

/** UTF-8 bytes, because a zone may one day be named in something other than ASCII. */
function utf8(text) {
  return [...new TextEncoder().encode(String(text))];
}

/** Mode indicator, length, payload, terminator, padding — in codewords. */
export function encodeData(text, version) {
  const bytes = utf8(text);
  const capacity = dataCodewords(version);
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >> i) & 1);
  };

  push(0b0100, 4);                      // byte mode
  push(bytes.length, 8);                // versions 1-9 use an 8-bit count
  for (const b of bytes) push(b, 8);

  // Terminator, up to four zero bits, then round up to a whole codeword.
  const room = capacity * 8;
  for (let i = 0; i < 4 && bits.length < room; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);

  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    out.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  // The two pad codewords the specification names, alternating.
  const PAD = [0xec, 0x11];
  while (out.length < capacity) out.push(PAD[(out.length - bits.length / 8) % 2]);
  return out;
}

/** Data blocks and EC blocks, interleaved the way the specification orders them. */
export function interleave(data, version) {
  const { ecPerBlock, blocks } = VERSIONS[version];
  const perBlock = data.length / blocks;
  const dataBlocks = [];
  const ecBlocks = [];

  for (let b = 0; b < blocks; b++) {
    const block = data.slice(b * perBlock, (b + 1) * perBlock);
    dataBlocks.push(block);
    ecBlocks.push(ecCodewords(block, ecPerBlock));
  }

  const out = [];
  for (let i = 0; i < perBlock; i++) for (const block of dataBlocks) out.push(block[i]);
  for (let i = 0; i < ecPerBlock; i++) for (const block of ecBlocks) out.push(block[i]);
  return out;
}

export const MASKS = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => ((i * j) % 2) + ((i * j) % 3) === 0,
  (i, j) => (((i * j) % 2) + ((i * j) % 3)) % 2 === 0,
  (i, j) => ((((i + j) % 2) + ((i * j) % 3)) % 2) === 0,
];

const G15 = 0b101_0011_0111;
const G15_MASK = 0b101_0100_0001_0010;

function bchDigit(value) {
  let digit = 0;
  let v = value;
  while (v !== 0) { digit++; v >>>= 1; }
  return digit;
}

/** The 15-bit format information for level M and a mask, BCH-coded and masked. */
export function formatBits(mask) {
  const data = (0b00 << 3) | mask;          // level M is 00
  let d = data << 10;
  while (bchDigit(d) - bchDigit(G15) >= 0) d ^= G15 << (bchDigit(d) - bchDigit(G15));
  return ((data << 10) | d) ^ G15_MASK;
}

const sizeOf = (version) => 17 + 4 * version;

function blank(size) {
  return Array.from({ length: size }, () => new Array(size).fill(null));
}

function placeFinder(m, row, col) {
  const size = m.length;
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const y = row + r;
      const x = col + c;
      if (y < 0 || x < 0 || y >= size || x >= size) continue;
      const ring = (r >= 0 && r <= 6 && (c === 0 || c === 6))
        || (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      m[y][x] = ring || core ? 1 : 0;      // the -1 ring is the separator: light
    }
  }
}

function placeAlignment(m, version) {
  if (version < 2) return;                 // version 1 has none
  const centre = 4 * version + 10;
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const edge = Math.max(Math.abs(r), Math.abs(c));
      m[centre + r][centre + c] = edge !== 1 ? 1 : 0;
    }
  }
}

function placeTiming(m) {
  const size = m.length;
  for (let i = 8; i < size - 8; i++) {
    const dark = i % 2 === 0 ? 1 : 0;
    if (m[6][i] == null) m[6][i] = dark;
    if (m[i][6] == null) m[i][6] = dark;
  }
}

function reserveFormat(m) {
  const size = m.length;
  for (let i = 0; i < 9; i++) {
    if (m[8][i] == null) m[8][i] = 0;
    if (m[i][8] == null) m[i][8] = 0;
  }
  for (let i = 0; i < 8; i++) {
    if (m[8][size - 1 - i] == null) m[8][size - 1 - i] = 0;
    if (m[size - 1 - i][8] == null) m[size - 1 - i][8] = 0;
  }
  m[size - 8][8] = 1;                      // the module that is always dark
}

function writeFormat(m, mask) {
  const size = m.length;
  const bits = formatBits(mask);
  for (let i = 0; i < 15; i++) {
    const bit = (bits >> i) & 1;
    if (i < 6) m[i][8] = bit;
    else if (i < 8) m[i + 1][8] = bit;
    else m[size - 15 + i][8] = bit;

    if (i < 8) m[8][size - 1 - i] = bit;
    else m[8][15 - i - 1] = bit;
  }
  m[size - 8][8] = 1;
}

function placeData(m, codewords, mask) {
  const size = m.length;
  let bitIndex = 7;
  let byteIndex = 0;
  let row = size - 1;
  let inc = -1;

  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;               // the vertical timing column is skipped
    for (;;) {
      for (let c = 0; c < 2; c++) {
        if (m[row][col - c] != null) continue;
        let dark = 0;
        if (byteIndex < codewords.length) {
          dark = (codewords[byteIndex] >>> bitIndex) & 1;
        }
        if (MASKS[mask](row, col - c)) dark ^= 1;
        m[row][col - c] = dark;
        bitIndex--;
        if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
      }
      row += inc;
      if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
    }
  }
}

/** The specification's four penalty rules; the lowest total wins. */
export function penalty(m) {
  const size = m.length;
  let score = 0;

  // Rule 1: runs of five or more of the same colour, in rows and in columns.
  for (const byRow of [true, false]) {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        const here = byRow ? m[a][b] : m[b][a];
        const before = byRow ? m[a][b - 1] : m[b - 1][a];
        if (here === before) { run++; if (run === 5) score += 3; else if (run > 5) score += 1; }
        else run = 1;
      }
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
    }
  }

  // Rule 3: the finder-like 1:1:3:1:1 pattern with four light modules beside it.
  const patterns = [[1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0], [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1]];
  for (const byRow of [true, false]) {
    for (let a = 0; a < size; a++) {
      for (let b = 0; b <= size - 11; b++) {
        for (const pattern of patterns) {
          let hit = true;
          for (let k = 0; k < 11; k++) {
            const v = byRow ? m[a][b + k] : m[b + k][a];
            if (v !== pattern[k]) { hit = false; break; }
          }
          if (hit) score += 40;
        }
      }
    }
  }

  // Rule 4: how far the whole code is from half dark.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += m[r][c];
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
}

/**
 * The finished grid: `modules[row][col]`, 1 dark, 0 light.
 *
 * `mask` may be forced for a test; left alone, all eight are tried and the one
 * the specification scores lowest is used, which is what keeps a code readable
 * rather than merely correct.
 */
export function qrMatrix(text, { mask = null } = {}) {
  const bytes = utf8(text);
  const version = versionFor(bytes.length);
  if (!version) {
    throw new Error(`${bytes.length} bytes is more than a version ${MAX_VERSION} code holds`);
  }

  const codewords = interleave(encodeData(text, version), version);
  const size = sizeOf(version);

  const build = (maskPattern) => {
    const m = blank(size);
    placeFinder(m, 0, 0);
    placeFinder(m, 0, size - 7);
    placeFinder(m, size - 7, 0);
    placeAlignment(m, version);
    placeTiming(m);
    reserveFormat(m);
    // The reserved format cells are filled with the real bits after the data,
    // so they are never masked as if they were data.
    const reserved = m.map((r) => r.map((v) => v != null));
    placeData(m, codewords, maskPattern);
    writeFormat(m, maskPattern);
    return { m, reserved };
  };

  if (mask != null) return { version, size, modules: build(mask).m, mask };

  let best = null;
  for (let candidate = 0; candidate < 8; candidate++) {
    const { m } = build(candidate);
    const score = penalty(m);
    if (!best || score < best.score) best = { score, m, mask: candidate };
  }
  return { version, size, modules: best.m, mask: best.mask };
}

/**
 * The code as an SVG, ready to print.
 *
 * One path rather than several hundred rects: it prints identically and keeps
 * the page small enough to hold nine of them. The quiet zone is four modules
 * on every side, which the specification requires and which scanners genuinely
 * need — a code printed hard against a border is a code that will not read.
 */
export function qrSvg(text, { moduleSize = 4, quiet = 4, label = null } = {}) {
  const { modules, size } = qrMatrix(text);
  const full = size + quiet * 2;
  let path = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    }
  }
  return `<svg class="qr" viewBox="0 0 ${full} ${full}" width="${full * moduleSize}" `
    + `height="${full * moduleSize}" role="img" shape-rendering="crispEdges" `
    + `aria-label="${escapeAttr(label || text)}">`
    + `<rect width="${full}" height="${full}" fill="#fff"></rect>`
    + `<path d="${path}" fill="#000"></path>`
    + '</svg>';
}

function escapeAttr(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
}
