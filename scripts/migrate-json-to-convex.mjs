import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ConvexHttpClient } from 'convex/browser';

const require = createRequire(import.meta.url);
const shared = require('../shared.js');
const { api } = require('../convex/_generated/api.js');
const { buildConvexSnapshot } = require('./convex-migration-utils.cjs');

const convexUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL || process.env.VITE_CONVEX_URL;
if (!convexUrl) {
  throw new Error('Set CONVEX_URL to your Convex deployment URL before running this migration.');
}

const dbPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : shared.DB_PATH;

const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const snapshot = buildConvexSnapshot(raw, shared);
const client = new ConvexHttpClient(convexUrl);
const result = await client.mutation(api.data.importSnapshot, snapshot);

console.log(JSON.stringify({ dbPath, imported: result }, null, 2));
