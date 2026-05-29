import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const ICONSET = path.join(BUILD, 'icon.iconset');

/**
 * Reads width and height from a PNG buffer.
 * In a standard PNG file:
 * - Bytes 0-7: Signature
 * - Bytes 8-11: Chunk length (usually 13 for IHDR)
 * - Bytes 12-15: Chunk type ("IHDR")
 * - Bytes 16-19: Width (4-byte unsigned big-endian)
 * - Bytes 20-23: Height (4-byte unsigned big-endian)
 * @param {Buffer} buffer
 * @returns {{width: number, height: number}}
 */
function readPngDimensions(buffer) {
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

/**
 * Compiles an ICO file from an array of PNG file paths.
 * Useful references:
 * - ICO (file format): https://en.wikipedia.org/wiki/ICO_(file_format)
 * @param {string[]} pngPaths
 * @param {string} outputPath
 */
function createIco(pngPaths, outputPath) {
  const images = pngPaths
    .filter(filePath => fs.existsSync(filePath))
    .map(filePath => {
      const data = fs.readFileSync(filePath);
      const { width, height } = readPngDimensions(data);
      return { width, height, data };
    });

  if (images.length === 0) {
    throw new Error('No valid PNG images found to compile ICO.');
  }

  const count = images.length;

  // Header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved (must be 0)
  header.writeUInt16LE(1, 2); // Image type (1 for icon)
  header.writeUInt16LE(count, 4); // Number of images

  // Directory entries: 16 bytes per image
  const entriesSize = count * 16;
  const entries = Buffer.alloc(entriesSize);

  let currentOffset = 6 + entriesSize;
  const dataBuffers = [];

  for (let i = 0; i < count; i++) {
    const img = images[i];
    const offset = i * 16;

    const w = img.width >= 256 ? 0 : img.width;
    const h = img.height >= 256 ? 0 : img.height;

    entries.writeUInt8(w, offset + 0); // Width
    entries.writeUInt8(h, offset + 1); // Height
    entries.writeUInt8(0, offset + 2); // Color palette size (0 if no palette)
    entries.writeUInt8(0, offset + 3); // Reserved (must be 0)
    entries.writeUInt16LE(1, offset + 4); // Color planes (1)
    entries.writeUInt16LE(32, offset + 6); // Bits per pixel (32)
    entries.writeUInt32LE(img.data.length, offset + 8); // Size of image data
    entries.writeUInt32LE(currentOffset, offset + 12); // Offset to image data

    currentOffset += img.data.length;
    dataBuffers.push(img.data);
  }

  const finalIcoBuffer = Buffer.concat([header, entries, ...dataBuffers]);
  fs.writeFileSync(outputPath, finalIcoBuffer);
  console.log(`[Success] Compiled ICO file: ${outputPath} (size: ${finalIcoBuffer.length} bytes, images: ${count})`);
}

/**
 * Compiles an ICNS file from an array of PNG mappings.
 * @param {{type: string, filePath: string}[]} mappings
 * @param {string} outputPath
 */
function createIcns(mappings, outputPath) {
  const chunks = [];
  let totalLength = 8; // Start with the ICNS 8-byte header

  for (const { type, filePath } of mappings) {
    if (!fs.existsSync(filePath)) {
      console.warn(`Warning: file not found for ICNS compiler: ${filePath}`);
      continue;
    }
    const data = fs.readFileSync(filePath);

    // Chunk header (8 bytes):
    // - 4 bytes ASCII type
    // - 4 bytes big endian length (including 8-byte header)
    const chunkHeader = Buffer.alloc(8);
    chunkHeader.write(type, 0, 4, 'ascii');
    chunkHeader.writeUInt32BE(data.length + 8, 4);

    chunks.push(chunkHeader);
    chunks.push(data);
    totalLength += data.length + 8;
  }

  // File header (8 bytes)
  // - 4 bytes MAGIC 'icns'
  // - 4 bytes big endian total length
  const fileHeader = Buffer.alloc(8);
  fileHeader.write('icns', 0, 4, 'ascii');
  fileHeader.writeUInt32BE(totalLength, 4);

  const finalIcnsBuffer = Buffer.concat([fileHeader, ...chunks]);
  fs.writeFileSync(outputPath, finalIcnsBuffer);
  console.log(`[Success] Compiled ICNS file: ${outputPath} (size: ${finalIcnsBuffer.length} bytes)`);
}

function main() {
  console.log('=== Pure Node.js Icon Compiler ===');

  if (!fs.existsSync(ICONSET)) {
    console.error(`Error: iconset folder not found: ${ICONSET}`);
    process.exit(1);
  }

  // 1. Compile build/icon.png (copy of 1024x1024 png)
  const sourcePng1024 = path.join(ICONSET, 'icon_512x512@2x.png');
  const targetPng = path.join(BUILD, 'icon.png');
  if (fs.existsSync(sourcePng1024)) {
    fs.copyFileSync(sourcePng1024, targetPng);
    console.log(`[Success] Copied master PNG: ${targetPng}`);
  } else {
    console.warn(`Warning: 1024x1024 source png not found: ${sourcePng1024}`);
  }

  // 2. Compile build/icon.ico (for Windows)
  const icoFiles = [
    path.join(ICONSET, 'icon_16x16.png'),
    path.join(ICONSET, 'icon_32x32.png'),
    path.join(ICONSET, 'icon_32x32@2x.png'), // 64x64
    path.join(ICONSET, 'icon_128x128.png'),
    path.join(ICONSET, 'icon_256x256.png'),
  ];
  createIco(icoFiles, path.join(BUILD, 'icon.ico'));

  // 3. Compile build/icon.icns (for macOS)
  const icnsMappings = [
    { type: 'ic04', filePath: path.join(ICONSET, 'icon_16x16.png') },
    { type: 'ic11', filePath: path.join(ICONSET, 'icon_16x16@2x.png') }, // 32x32
    { type: 'ic05', filePath: path.join(ICONSET, 'icon_32x32.png') },
    { type: 'ic12', filePath: path.join(ICONSET, 'icon_32x32@2x.png') }, // 64x64
    { type: 'ic07', filePath: path.join(ICONSET, 'icon_128x128.png') },
    { type: 'ic13', filePath: path.join(ICONSET, 'icon_128x128@2x.png') }, // 256x256
    { type: 'ic08', filePath: path.join(ICONSET, 'icon_256x256.png') },
    { type: 'ic14', filePath: path.join(ICONSET, 'icon_256x256@2x.png') }, // 512x512
    { type: 'ic09', filePath: path.join(ICONSET, 'icon_512x512.png') },
    { type: 'ic10', filePath: path.join(ICONSET, 'icon_512x512@2x.png') }, // 1024x1024
  ];
  createIcns(icnsMappings, path.join(BUILD, 'icon.icns'));
}

main();