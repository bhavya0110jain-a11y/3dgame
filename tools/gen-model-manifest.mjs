// Scans public/models/<category>/*.glb and writes public/models/manifest.json.
// Runs automatically before `npm run dev` and `npm run build`.
import { readdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
const root = 'public/models';
const out = [];
if (existsSync(root)) {
  for (const cat of readdirSync(root)) {
    const dir = join(root, cat);
    if (!statSync(dir).isDirectory()) continue;
    for (const f of readdirSync(dir)) if (f.endsWith('.glb')) out.push(`${cat}/${f.slice(0, -4)}`);
  }
}
out.sort();
writeFileSync(join(root, 'manifest.json'), JSON.stringify(out, null, 0) + '\n');
console.log(`model manifest: ${out.length} models`);
