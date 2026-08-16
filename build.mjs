import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gzip = promisify(zlib.gzip);
const root = process.cwd();
const publicDir = path.join(root, 'public');
const distDir = path.join(root, 'dist');

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function copyFileChecked(from, to) {
  if (!(await exists(from))) throw new Error(`Fehlende Build-Datei: ${from}`);
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.copyFile(from, to);
}

async function downloadAndGzipLanguage(code) {
  const out = path.join(distDir, 'lang-data', `${code}.traineddata.gz`);
  const url = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/${code}.traineddata`;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`OCR-Sprachdatei ${code} konnte nicht geladen werden: HTTP ${response.status}`);
  const raw = Buffer.from(await response.arrayBuffer());
  const packed = await gzip(raw, { level: 9 });
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, packed);
  console.log(`OCR ${code}: ${(packed.length / 1024 / 1024).toFixed(1)} MB`);
}

await fs.rm(distDir, { recursive: true, force: true });
await fs.cp(publicDir, distDir, { recursive: true });

await copyFileChecked(
  path.join(root, 'node_modules', 'tesseract.js', 'dist', 'tesseract.min.js'),
  path.join(distDir, 'vendor', 'tesseract', 'tesseract.min.js')
);
await copyFileChecked(
  path.join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'),
  path.join(distDir, 'vendor', 'tesseract', 'worker.min.js')
);
await copyFileChecked(
  path.join(root, 'node_modules', 'pdf-lib', 'dist', 'pdf-lib.min.js'),
  path.join(distDir, 'vendor', 'pdf-lib', 'pdf-lib.min.js')
);

for (const file of [
  'tesseract-core.wasm.js',
  'tesseract-core-simd.wasm.js',
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js'
]) {
  await copyFileChecked(
    path.join(root, 'node_modules', 'tesseract.js-core', file),
    path.join(distDir, 'vendor', 'tesseract-core', file)
  );
}

await Promise.all([
  downloadAndGzipLanguage('deu'),
  downloadAndGzipLanguage('eng')
]);

console.log('DokuScan Cloudflare-Build fertig: dist/');
