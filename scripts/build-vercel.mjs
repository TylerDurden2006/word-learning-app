import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { loadEnvFile } = require('../env.js');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const outputDir = path.join(root, 'dist');

loadEnvFile(path.join(root, '.env'));
loadEnvFile(path.join(root, '.env.local'));

const apiBaseUrl = String(
  process.env.CONVEX_HTTP_URL
  || process.env.WORDFORGE_CONVEX_URL
  || ''
).trim().replace(/\/+$/, '');

if (!apiBaseUrl) {
  throw new Error('Set CONVEX_HTTP_URL before building for Vercel.');
}

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'design-previews') continue;
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

fs.rmSync(outputDir, { recursive: true, force: true });
copyDirectory(publicDir, outputDir);

const indexPath = path.join(outputDir, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8').replace(
  /<meta name="wordforge-api-base" content="[^"]*" \/>/,
  `<meta name="wordforge-api-base" content="${apiBaseUrl}" />`
);
fs.writeFileSync(indexPath, html);

console.log(`Built Vercel static output in ${outputDir}`);
console.log(`Convex HTTP API: ${apiBaseUrl}`);
