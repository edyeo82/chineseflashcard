import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sourceUrl = new URL('./ocr-accuracy.mjs', import.meta.url);
let source = await fs.readFile(sourceUrl, 'utf8');

// The supplied phone photo's third pinyin row is around y=480 in the pinyin
// crop. Keep the generated worksheet aligned with that measured geometry.
source = source
  .replace("addPhrase(['TT', 'yong', 'pin'], 180, 560, 3);", "addPhrase(['TT', 'yong', 'pin'], 180, 480, 3);")
  .replace("addPhrase(['ting', 'ché', 'chang'], 980, 560, 3);", "addPhrase(['ting', 'ché', 'chang'], 980, 480, 3);");

// Keep the generated module beside the source tests so Node can resolve the
// repository's Playwright installation. A module copied to /tmp cannot resolve
// node_modules from the checked-out repository.
const temporaryUrl = new URL('./.generated-ocr-accuracy-layout.mjs', import.meta.url);
const temporaryTest = fileURLToPath(temporaryUrl);
await fs.writeFile(temporaryTest, source, 'utf8');

try {
  const child = spawn(process.execPath, [temporaryTest], {
    cwd: process.cwd(),
    stdio: 'inherit'
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
  process.exitCode = exitCode;
} finally {
  await fs.rm(temporaryTest, { force: true });
}
