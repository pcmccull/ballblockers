import { defineConfig } from 'vite';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Writes dist/sw.js listing every built file, versioned by their contents,
// so installing the app stores a complete offline copy of the game
function serviceWorker() {
  return {
    name: 'ballblockers-service-worker',
    apply: 'build',
    writeBundle(options) {
      const dir = options.dir;
      const walk = d => readdirSync(d, { withFileTypes: true }).flatMap(e =>
        e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]);
      const files = walk(dir)
        .map(f => relative(dir, f).split(sep).join('/'))
        .filter(f => f !== 'sw.js' && f !== 'icons.svg')
        .sort();
      const template = readFileSync('src/pwa/sw-template.js', 'utf8');
      const hash = createHash('sha256').update(template);
      for (const f of files) hash.update(f).update(readFileSync(join(dir, f)));
      const sw = template
        .replace('__VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__PRECACHE__', JSON.stringify(['./', ...files]));
      writeFileSync(join(dir, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [serviceWorker()],
});
