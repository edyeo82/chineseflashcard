import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

const sourceUrl = new URL('./ocr-accuracy.mjs', import.meta.url);
let source = await fs.readFile(sourceUrl, 'utf8');

// The original generated fixture used y=560 for its third pinyin row. The
// supplied phone photo's measured row is around y=480 in the pinyin crop, and a
// short generated sheet can legitimately crop before y=560. Keep the strict
// test aligned with the real geometry rather than testing an impossible row.
source = source
  .replace("addPhrase(['TT', 'yong', 'pin'], 180, 560, 3);", "addPhrase(['TT', 'yong', 'pin'], 180, 480, 3);")
  .replace("addPhrase(['ting', 'ché', 'chang'], 980, 560, 3);", "addPhrase(['ting', 'ché', 'chang'], 980, 480, 3);");

const temporaryTest = '/tmp/tingxie-ocr-accuracy-layout.mjs';
await fs.writeFile(temporaryTest, source, 'utf8');

const child = spawn(process.execPath, [temporaryTest], {
  cwd: process.cwd(),
  stdio: 'inherit'
});

const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => resolve(code ?? 1));
});
process.exitCode = exitCode;
