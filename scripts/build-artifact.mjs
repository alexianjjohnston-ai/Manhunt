// Packages dist/demo/demo.html (single-file demo build) as a claude.ai Artifact page:
// the host adds <html>/<head>/<body>, so emit the title, styles, root and script only.
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist/demo/demo.html', 'utf8');
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
const headParts = head
  .replace(/<meta charset[^>]*>/i, '')
  .replace(/<meta name="viewport"[^>]*>/i, '')
  .replace(/<title>[\s\S]*?<\/title>/i, '');
const out = `<title>Manhunt Playtest</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${headParts.trim()}\n${body.trim()}\n`;
writeFileSync('dist/demo/artifact.html', out);
console.log(`dist/demo/artifact.html ${(out.length / 1e6).toFixed(2)} MB`);
