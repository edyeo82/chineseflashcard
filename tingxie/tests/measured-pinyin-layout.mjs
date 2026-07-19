import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

const sourceUrl = new URL('./measured-pinyin-regression.mjs', import.meta.url);
let source = await fs.readFile(sourceUrl, 'utf8');

// Give the matcher the same numbered-row Chinese evidence that the phone photo
// produces. A single artificial line containing all ten answers is not how the
// worksheet OCR is structured and prevents the intended 组屋 evidence tie-break.
source = source.replace(
  "chineseTexts: ['浪费 组屋 所以 如果 车辆 一份 尽力 超市 日用品 停车场']",
  "chineseTexts: ['1. 浪费  2. 组屋  3. 所以  4. 如果\\n5. 车辆  6. 一份  7. 尽力  8. 超市\\n9. 日用品  10. 停车场']"
);

const temporaryTest = '/tmp/tingxie-measured-pinyin-layout.mjs';
await fs.writeFile(temporaryTest, source, 'utf8');
const child = spawn(process.execPath, [temporaryTest], { cwd: process.cwd(), stdio: 'inherit' });
const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', code => resolve(code ?? 1));
});
process.exitCode = exitCode;
