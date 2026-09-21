// Zone QR codes — FR-FARM-03, UX-12, FR-PROOF-03.
//
// The encoder in web/js/domain/qr.js is written out by hand, because the app
// has no build step and has to work with no signal. That is a reasonable thing
// to do only if it is tested like a piece of arithmetic rather than like a
// picture, so this file checks it three ways:
//
//   1. Against the specification's own worked example (ISO/IEC 18004 Annex I),
//      which fixes the Reed-Solomon stage to a published answer.
//   2. By reading the finished grid back with a decoder written separately,
//      below, which is what catches a placement, masking or interleaving
//      mistake — the failures that would produce a beautiful code no phone can
//      read.
//   3. Structurally: finder patterns, timing patterns, the quiet zone, and the
//      module that is always dark.
//
// The rest of the file is the part the farm actually touches: what goes in the
// code, what comes back out of a scanner, and what happens when somebody scans
// the wrong door.

import { test } from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../web/js/', import.meta.url);
const qr = await import(new URL('domain/qr.js', base).href);

// --- A reader, written separately from the writer --------------------------

const BLOCK_SPEC = { 1: 1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 4 };

/** Everything that is not data: finders, separators, timing, alignment, format. */
function functionModules(size, version) {
  const f = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (r, c) => { if (r >= 0 && c >= 0 && r < size && c < size) f[r][c] = true; };
  for (const [row, col] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) mark(row + r, col + c);
  }
  if (version >= 2) {
    const centre = 4 * version + 10;
    for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) mark(centre + r, centre + c);
  }
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
  for (let i = 0; i < 9; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) { mark(8, size - 1 - i); mark(size - 1 - i, 8); }
  return f;
}

function decode(matrix) {
  const size = matrix.length;
  const version = (size - 17) / 4;

  let format = 0;
  for (let i = 0; i < 15; i++) {
    const bit = i < 6 ? matrix[i][8] : i < 8 ? matrix[i + 1][8] : matrix[size - 15 + i][8];
    format |= bit << i;
  }
  const header = (format ^ 0b101010000010010) >> 10;
  const ecLevel = header >> 3;
  const mask = header & 7;

  const fn = functionModules(size, version);
  const codewords = [];
  let current = 0;
  let bits = 0;
  let row = size - 1;
  let inc = -1;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (;;) {
      for (let c = 0; c < 2; c++) {
        const at = col - c;
        if (fn[row][at]) continue;
        let value = matrix[row][at];
        if (qr.MASKS[mask](row, at)) value ^= 1;
        current = (current << 1) | value;
        bits++;
        if (bits === 8) { codewords.push(current); current = 0; bits = 0; }
      }
      row += inc;
      if (row < 0 || row >= size) { row -= inc; inc = -inc; break; }
    }
  }

  const blockCount = BLOCK_SPEC[version];
  const dataLength = qr.dataCodewords(version);
  const blocks = Array.from({ length: blockCount }, () => []);
  for (let i = 0; i < dataLength; i++) blocks[i % blockCount].push(codewords[i]);
  const data = [].concat(...blocks);

  let at = 0;
  const read = (count) => {
    let value = 0;
    for (let i = 0; i < count; i++) {
      value = (value << 1) | ((data[at >> 3] >> (7 - (at & 7))) & 1);
      at++;
    }
    return value;
  };
  const mode = read(4);
  const length = read(8);
  const bytes = [];
  for (let i = 0; i < length; i++) bytes.push(read(8));
  return { version, mask, ecLevel, mode, text: new TextDecoder().decode(Uint8Array.from(bytes)) };
}

// --- 1. The specification's own numbers ------------------------------------

test('the Reed-Solomon stage matches the specification\'s worked example', () => {
  // ISO/IEC 18004 Annex I: "01234567" at version 1, level M. These sixteen data
  // codewords must produce exactly these ten error-correction codewords. If
  // this passes, the arithmetic underneath every code is right.
  const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80,
    0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
  assert.deepEqual(qr.ecCodewords(data, 10),
    [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
});

test('the generator polynomial matches the published table', () => {
  // g(x) for ten codewords, as powers of alpha: 0, 251, 67, 46, 61, 118, 70,
  // 64, 94, 32, 45.
  const asExponents = qr.generatorPoly(10).map((coefficient) => {
    let exponent = 0;
    let x = 1;
    while (x !== coefficient) { x <<= 1; if (x & 0x100) x ^= 0x11d; exponent++; }
    return exponent;
  });
  assert.deepEqual(asExponents, [0, 251, 67, 46, 61, 118, 70, 64, 94, 32, 45]);
});

test('the format information says level M and names its mask', () => {
  for (let mask = 0; mask < 8; mask++) {
    const header = (qr.formatBits(mask) ^ 0b101010000010010) >> 10;
    assert.equal(header >> 3, 0, 'error correction level M');
    assert.equal(header & 7, mask);
  }
});

// --- 2. Reading the finished code back -------------------------------------

test('a zone code survives the round trip, at every version it needs', () => {
  // One block (v1-v3), two blocks (v4-v5) and four blocks (v6) exercise the
  // interleaving separately: a code that only ever gets tested at one version
  // is a code whose interleaving has never been tested at all.
  for (const text of [
    'A',
    'DOUVALUE:ZONE:gh1',
    'DOUVALUE:ZONE:zone_k3f9a2x',
    `DOUVALUE:ZONE:${'z'.repeat(40)}`,
    `DOUVALUE:ZONE:${'z'.repeat(70)}`,
    `DOUVALUE:ZONE:${'z'.repeat(90)}`,
  ]) {
    const built = qr.qrMatrix(text);
    const read = decode(built.modules);
    assert.equal(read.text, text, `round trip failed at version ${built.version}`);
    assert.equal(read.mode, 0b0100, 'byte mode');
    assert.equal(read.ecLevel, 0, 'level M, which survives a rained-on door');
    assert.equal(read.mask, built.mask);
  }
});

test('every one of the eight masks produces a readable code', () => {
  // The chooser picks one; a bug in any of the others would sit undetected
  // until the day a zone name happened to select it.
  for (let mask = 0; mask < 8; mask++) {
    const built = qr.qrMatrix('DOUVALUE:ZONE:gh4', { mask });
    assert.equal(decode(built.modules).text, 'DOUVALUE:ZONE:gh4', `mask ${mask} is unreadable`);
  }
});

test('a non-ASCII zone name still encodes', () => {
  const text = 'DOUVALUE:ZONE:Ọ̀wẹ̀-01';
  assert.equal(decode(qr.qrMatrix(text).modules).text, text);
});

// --- 3. The shape of the thing ---------------------------------------------

test('the code carries the three finder patterns a scanner looks for', () => {
  const { modules, size } = qr.qrMatrix('DOUVALUE:ZONE:gh1');
  const finderAt = (row, col) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const ring = (r === 0 || r === 6 || c === 0 || c === 6);
        const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        if (modules[row + r][col + c] !== (ring || core ? 1 : 0)) return false;
      }
    }
    return true;
  };
  assert.ok(finderAt(0, 0), 'top left');
  assert.ok(finderAt(0, size - 7), 'top right');
  assert.ok(finderAt(size - 7, 0), 'bottom left');
});

test('the timing patterns alternate and the fixed dark module is dark', () => {
  const { modules, size } = qr.qrMatrix('DOUVALUE:ZONE:gh1');
  for (let i = 8; i < size - 8; i++) {
    assert.equal(modules[6][i], i % 2 === 0 ? 1 : 0, `row timing at ${i}`);
    assert.equal(modules[i][6], i % 2 === 0 ? 1 : 0, `column timing at ${i}`);
  }
  assert.equal(modules[size - 8][8], 1, 'the module that is always dark');
});

test('a version is chosen by what has to fit, and too much is refused', () => {
  assert.equal(qr.versionFor(14), 1);
  assert.equal(qr.versionFor(15), 2);
  assert.equal(qr.versionFor(106), 6);
  assert.equal(qr.versionFor(107), null);
  assert.throws(() => qr.qrMatrix('x'.repeat(200)), /more than a version 6 code holds/);
});

test('the printed code has its quiet zone, or no scanner will see it', () => {
  const svg = qr.qrSvg('DOUVALUE:ZONE:gh1', { moduleSize: 4 });
  const { size } = qr.qrMatrix('DOUVALUE:ZONE:gh1');
  // Four light modules on every side, which the specification requires and a
  // code taped tight against a border does not have.
  assert.match(svg, new RegExp(`viewBox="0 0 ${size + 8} ${size + 8}"`));
  assert.match(svg, /<rect width="\d+" height="\d+" fill="#fff"/, 'a white field behind it');
  assert.match(svg, /shape-rendering="crispEdges"/, 'no anti-aliased module edges');
});

test('the code as printed escapes whatever it is labelled with', () => {
  const svg = qr.qrSvg('DOUVALUE:ZONE:gh1', { label: '"><script>alert(1)</script>' });
  assert.ok(!svg.includes('<script'));
  assert.match(svg, /&quot;&gt;&lt;script&gt;/);
});

// --- What the farm actually touches ---------------------------------------

test('a zone code names the zone and nothing else', () => {
  const zone = { id: 'gh1', name: 'GH-01' };
  assert.equal(qr.zoneCode(zone), 'DOUVALUE:ZONE:gh1');
  // Not a URL: a URL sends the phone's own camera app to a browser instead of
  // handing the text to this app.
  assert.ok(!qr.zoneCode(zone).startsWith('http'));
});

test('a scanned code is read back, whitespace, case and all', () => {
  assert.equal(qr.parseZoneCode('DOUVALUE:ZONE:gh1'), 'gh1');
  assert.equal(qr.parseZoneCode('  douvalue:zone:gh1  '), 'gh1');
  assert.equal(qr.parseZoneCode('https://example.com/farm/#/zones?zone=gh1'), 'gh1');
  assert.equal(qr.parseZoneCode('a shopping receipt'), null);
  assert.equal(qr.parseZoneCode(''), null);
  assert.equal(qr.parseZoneCode(null), null);
});

const farm = {
  plots: {
    gh1: { id: 'gh1', name: 'GH-01', type: 'greenhouse' },
    gh2: { id: 'gh2', name: 'GH-02', type: 'greenhouse' },
  },
};

test('scanning the right door confirms the zone', () => {
  const hit = qr.matchZone(farm, 'DOUVALUE:ZONE:gh1', { expectZoneId: 'gh1' });
  assert.equal(hit.ok, true);
  assert.equal(hit.zone.name, 'GH-01');
});

test('scanning the wrong door says which house you are actually in', () => {
  // The most useful thing this feature can catch: a round recorded against
  // GH-01 while standing in GH-02.
  const miss = qr.matchZone(farm, 'DOUVALUE:ZONE:gh2', { expectZoneId: 'gh1' });
  assert.equal(miss.ok, false);
  assert.equal(miss.reason, 'wrong-zone');
  assert.match(miss.why, /GH-02/);
  assert.match(miss.why, /GH-01/);
  assert.equal(miss.zone.id, 'gh2');
  assert.equal(miss.expected.id, 'gh1');
});

test('a code from another farm is refused rather than guessed at', () => {
  const miss = qr.matchZone(farm, 'DOUVALUE:ZONE:somewhere_else');
  assert.equal(miss.ok, false);
  assert.equal(miss.reason, 'unknown');
  assert.match(miss.fix, /list/);
});

test('a code printed before the zone was renamed still works', () => {
  assert.equal(qr.matchZone(farm, 'DOUVALUE:ZONE:GH-02').zone.id, 'gh2');
});
