import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sourceUrl = new URL('./live.mjs', import.meta.url);
let source = await fs.readFile(sourceUrl, 'utf8');
source = source
  .replace("addPhrase(['Tt', 'yong', 'pin'], 180, 560, 3);", "addPhrase(['Tt', 'yong', 'pin'], 180, 480, 3);")
  .replace("addPhrase(['TT', 'yong', 'pin'], 180, 560, 3);", "addPhrase(['TT', 'yong', 'pin'], 180, 480, 3);")
  .replace("addPhrase(['ting', 'ché', 'chang'], 980, 560, 3);", "addPhrase(['ting', 'ché', 'chang'], 980, 480, 3);");

const temporaryUrl = new URL('./.generated-live-accuracy-layout.mjs', import.meta.url);
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
