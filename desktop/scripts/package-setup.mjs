import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32') throw new Error('The EXE installer must be compiled on Windows with Inno Setup 6.');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!/^[0-9A-Za-z.\-]+$/.test(version)) throw new Error('Invalid package version');
const stage = path.join(root, 'release', 'stage');
for (const name of ['app.zip', 'install.ps1', 'uninstall.ps1', 'version.txt', 'SHA256SUMS.txt']) {
  if (!fs.existsSync(path.join(stage, name))) throw new Error(`Missing ${name}: run npm run package:win first`);
}
const iscc = process.env.INNO_SETUP_COMPILER || path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Inno Setup 6', 'ISCC.exe');
const out = path.join(root, 'release');
execFileSync(iscc, [`/DAppVersion=${version}`, `/DStageDir=${stage}`, `/DOutputPath=${out}`, path.join(root, 'installer', 'setup.iss')], { stdio: 'inherit' });
const filename = `Muse4AI-${version}-Setup-win-x64.exe`;
const hash = createHash('sha256').update(fs.readFileSync(path.join(out, filename))).digest('hex').toUpperCase();
fs.writeFileSync(path.join(out, `${filename}.sha256.txt`), `${hash}  ${filename}\r\n`);
console.log(`Created ${filename} and SHA-256 checksum.`);