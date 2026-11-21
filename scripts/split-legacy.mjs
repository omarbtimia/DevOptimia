import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const sources = [
  ['legacy/Home.html', 'home'],
  ['legacy/Index.html', 'index'],
  ['legacy/Config.html', 'config'],
];

for (const [source, name] of sources) {
  const html = readFileSync(path.join(process.cwd(), source), 'utf8');
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] || '';
  const inline = [...body.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const markup = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');

  let script = inline.join('\n');
  const onLoad = `window.__optimiaOnLoad_${name}`;
  script = script.replace(/window\.onload\s*=\s*/g, `${onLoad} = `);
  script += `\nif (document.readyState === 'complete') { setTimeout(${onLoad}, 0); } else { window.addEventListener('load', ${onLoad}); }\n`;

  writeFileSync(path.join(process.cwd(), 'src/generated', `${name}.css`), styles.trim() + '\n');
  writeFileSync(path.join(process.cwd(), 'src/generated', `${name}.markup.js`), `export default ${JSON.stringify(markup)};\n`);
  writeFileSync(path.join(process.cwd(), 'src/generated', `${name}.client.js`), `export default ${JSON.stringify(script)};\n`);
  console.log(`${name}: ${styles.length} css, ${markup.length} markup, ${script.length} script`);
}
