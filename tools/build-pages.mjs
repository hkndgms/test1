// web/app.html (Artifact biçimi, iskeletsiz) -> web/index.html (tam HTML belgesi).
// GitHub Pages ve yerel sunucu için: node tools/build-pages.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const body = fs.readFileSync(path.join(root, 'web/app.html'), 'utf8');
const html = `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
<!-- Bu dosya tools/build-pages.mjs ile web/app.html'den üretilir; doğrudan düzenlemeyin. -->
${body}
</body>
</html>
`;
fs.writeFileSync(path.join(root, 'web/index.html'), html);
console.log('web/index.html yazıldı');
