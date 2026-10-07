import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..'), dist = resolve(root, 'dist');
async function files(dir) {
  return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e =>
    e.isDirectory() ? files(resolve(dir, e.name)) : [resolve(dir, e.name)]))).flat();
}
for (const path of await files(dist)) {
  if (/\.(js|html|json|css)$/.test(path)) {
    const content = await readFile(path, 'utf8');
    if (content.includes('synthetic-fixture-record-')) throw new Error('Test fixture was bundled into the site: ' + path);
  }
}
for (const name of ['worker.min.js', 'tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js', 'chi_sim.traineddata.gz', 'eng.traineddata.gz',
  'TESSERACT-JS-LICENSE.txt', 'TESSERACT-CORE-LICENSE.txt']) await stat(resolve(dist, 'ocr', name));
console.log('Build resources complete; synthetic test fixtures are not bundled.');
