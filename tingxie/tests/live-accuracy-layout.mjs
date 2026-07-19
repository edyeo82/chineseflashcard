import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

const sourceUrl = new URL('./live.mjs', import.meta.url);
let source = await fs.readFile(sourceUrl, 'utf8');
source = source
  .replace("addPhrase(['Tt', 'yong', 'pin'], 180, 560, 3);", "addPhrase(['Tt', 'yong', 'pin'], 180, 480, 3);")
  .replace("addPhrase(['TT', 'yong', 'pin'], 180, 560, 3);", "addPhrase(['TT', 'yong', 'pin'], 180, 480, 3);")
  .replace("addPhrase(['ting', 'ché', 'chang'], 980, 560, 3);", "addPhrase(['ting', 'ché', 'chang'], 980, 480, 3);");

const temporaryTest = '/tmp/tingxie-live-accuracy-layout.mjs';
await fs.writeFile(temporaryTest, source, 'utf8');
const child = spawn(process.execPath, [temporaryTest], { cwd: process.cwd(), stdio: 'inherit' });
const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => resolve(code ?? 1));
});
process.exitCode = exitCode;
