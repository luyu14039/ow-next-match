import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const dest = resolve(root, 'public/ocr');
await mkdir(dest, { recursive: true });
await cp(resolve(root, 'node_modules/tesseract.js/dist/worker.min.js'), resolve(dest, 'worker.min.js'));
await cp(resolve(root,'node_modules/tesseract.js/LICENSE.md'),resolve(dest,'TESSERACT-JS-LICENSE.txt'));
await cp(resolve(root,'node_modules/tesseract.js-core/LICENSE'),resolve(dest,'TESSERACT-CORE-LICENSE.txt'));
const core = resolve(root, 'node_modules/tesseract.js-core');
for (const name of await readdir(core)) {
  if (/^tesseract-core(?:-(?:relaxedsimd|simd))?-lstm\.wasm\.js$/.test(name)) await cp(resolve(core, name), resolve(dest, name));
}
for (const lang of ['chi_sim','eng']) {
  await cp(resolve(root, `node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`), resolve(dest, `${lang}.traineddata.gz`));
  const metadata=JSON.parse(await readFile(resolve(root,`node_modules/@tesseract.js-data/${lang}/package.json`),'utf8'));
  await writeFile(resolve(dest,`${lang}-PACKAGE-NOTICE.json`),JSON.stringify({name:metadata.name,version:metadata.version,license:metadata.license,repository:metadata.repository},null,2));
}
console.log('Local OCR worker, core and languages prepared.');
