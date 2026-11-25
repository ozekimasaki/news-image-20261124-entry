// news-image-20261124 entry (Node 22+, standard library only).
//
// The poster for Tuesday 24 November 2026 lives next to this file as
// entry.png. This program validates that the PNG is complete and inside
// the bounty limits, then copies it to the output directory. Run it
// outside the grader with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_BYTES = 1048576; // 1 MiB
const MAX_SIDE = 1024;

// CRC-32 (IEEE 802.3) lookup table, built once from the polynomial.
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  chunks: number;
  idatBytes: number;
}

// Walk every chunk, checking its CRC, and collect the IHDR facts.
function validatePng(bytes: Buffer): PngHeader {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('entry.png does not start with the PNG signature');
  }
  let offset = 8;
  let header: PngHeader | null = null;
  let sawIdat = false;
  let chunks = 0;
  let idatBytes = 0;
  let lastType = '';
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const crcEnd = dataEnd + 4;
    if (crcEnd > bytes.length) {
      throw new Error(`chunk ${type} runs past the end of the file`);
    }
    const stored = bytes.readUInt32BE(dataEnd);
    const computed = crc32(
      Buffer.concat([bytes.subarray(offset + 4, offset + 8), bytes.subarray(dataStart, dataEnd)]),
    );
    if (stored !== computed) {
      throw new Error(`chunk ${type} has a bad CRC-32`);
    }
    chunks += 1;
    if (type === 'IHDR') {
      if (length !== 13) throw new Error('IHDR must be 13 bytes');
      header = {
        width: bytes.readUInt32BE(dataStart),
        height: bytes.readUInt32BE(dataStart + 4),
        bitDepth: bytes[dataStart + 8],
        colorType: bytes[dataStart + 9],
        chunks: 0,
        idatBytes: 0,
      };
    } else if (type === 'IDAT') {
      sawIdat = true;
      idatBytes += length;
    } else if (type === 'IEND') {
      if (crcEnd !== bytes.length) {
        throw new Error('bytes follow the IEND chunk');
      }
    }
    lastType = type;
    offset = crcEnd;
  }
  if (offset !== bytes.length) throw new Error('trailing bytes after the last chunk');
  if (lastType !== 'IEND') throw new Error('no IEND chunk at the end of the file');
  if (!header) throw new Error('no IHDR chunk found');
  if (!sawIdat) throw new Error('no IDAT chunk found');
  header.chunks = chunks;
  header.idatBytes = idatBytes;
  return header;
}

const sourceUrl = new URL('./entry.png', import.meta.url);
const png = readFileSync(sourceUrl);
if (png.length > MAX_BYTES) {
  throw new Error(`entry.png is ${png.length} bytes, over the 1 MiB limit`);
}
const header = validatePng(png);
if (header.width > MAX_SIDE || header.height > MAX_SIDE) {
  throw new Error(`entry.png is ${header.width}x${header.height}, over the 1024x1024 limit`);
}
if (header.bitDepth !== 8 || (header.colorType !== 2 && header.colorType !== 6)) {
  throw new Error(
    `unexpected PNG format: bit depth ${header.bitDepth}, color type ${header.colorType}`,
  );
}

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'entry.png');
copyFileSync(sourceUrl, outPath);

// Confirm the copy is byte-for-byte the validated PNG.
const digest = createHash('sha256').update(png).digest('hex');
const written = readFileSync(outPath);
if (createHash('sha256').update(written).digest('hex') !== digest) {
  throw new Error('written entry.png differs from the validated source');
}
console.log(`entry.png OK: ${header.width}x${header.height}, ${png.length} bytes, sha256=${digest}`);
console.log(`structure: ${header.chunks} chunks, ${header.idatBytes} IDAT bytes, all CRC-32 verified`);
console.log(`wrote ${outPath} (verified identical)`);
