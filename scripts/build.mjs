#!/usr/bin/env node
// Voegt src/ samen tot één zelfstandig HTML-bestand: dist/homey-dashboard.html.
//   node scripts/build.mjs                    -> dist/homey-dashboard.html
//   node scripts/build.mjs --fragment <pad>   -> ook een versie zonder <html>/<head>/<body>-omhulsel
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => join(root, 'src', f);

export async function buildHtml() {
  let html = await readFile(src('index.html'), 'utf8');
  const css = await readFile(src('styles.css'), 'utf8');
  html = html.replace('<!-- @inline-css styles.css -->', () => `<style>\n${css}</style>`);
  const scripts = [...html.matchAll(/<!-- @inline-js ([\w.-]+) -->/g)].map((m) => m[1]);
  for (const file of scripts) {
    const js = (await readFile(src(file), 'utf8')).replace(/<\/script/gi, '<\\/script');
    html = html.replace(`<!-- @inline-js ${file} -->`, () => `<script>\n${js}</script>`);
  }
  if (/@inline-(css|js)/.test(html)) throw new Error('Niet alle onderdelen zijn ingevoegd');
  return html;
}

// Zonder doctype, html, head en body: voor hosts die zelf het omhulsel leveren.
export function toFragment(html) {
  const head = html.match(/<head>([\s\S]*?)<\/head>/i)[1];
  const body = html.match(/<body>([\s\S]*?)<\/body>/i)[1];
  const keep = [
    head.match(/<title>[\s\S]*?<\/title>/i)[0],
    ...(head.match(/<link [^>]*>/gi) || []),
    head.match(/<style>[\s\S]*?<\/style>/i)[0],
  ];
  return `${keep.join('\n')}\n${body.trim()}\n`;
}

export function withConfig(html, config) {
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  return html.replace(/(<script type="application\/json" id="hd-config">)[\s\S]*?(<\/script>)/, (_, a, b) => a + json + b);
}

async function main() {
  const { values } = parseArgs({ options: { fragment: { type: 'string' }, out: { type: 'string', default: join(root, 'dist', 'homey-dashboard.html') } } });
  const html = await buildHtml();
  await mkdir(dirname(values.out), { recursive: true });
  await writeFile(values.out, html);
  console.log(`✓ ${values.out} (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)`);
  if (values.fragment) {
    await mkdir(dirname(resolve(values.fragment)), { recursive: true });
    await writeFile(values.fragment, toFragment(html));
    console.log(`✓ ${values.fragment} (fragment)`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
