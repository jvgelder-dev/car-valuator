// Bouwt de versleutelde demo: leest demo-src/, inlinet CSS + JS tot één
// document, versleutelt dat met AES-256-GCM (sleutel via PBKDF2 uit de code),
// en schrijft een statische schil naar docs/index.html.
//
// Zonder de juiste code is de pagina-inhoud niet aanwezig — alleen ciphertext.
//
// Gebruik:  DEMO_CODE=048511 node scripts/encrypt-demo.mjs
// (DEMO_CODE is optioneel; standaard 048511)

import crypto from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const code = process.env.DEMO_CODE || '048511';
const ITER = 250000;

// 1. Inline CSS en JS in het demo-document.
let html = readFileSync(join(root, 'demo-src/index.html'), 'utf8');
const css = readFileSync(join(root, 'demo-src/styles.css'), 'utf8');
let js = readFileSync(join(root, 'demo-src/demo.js'), 'utf8');
js = js.replace(/<\/script>/gi, '<\\/script>'); // veilig binnen een <script>-tag

html = html.replace(/<link rel="stylesheet" href="styles.css"\s*\/>/,
  `<style>\n${css}\n</style>`);
html = html.replace(/<script src="demo.js"><\/script>/,
  `<script>\n${js}\n</script>`);

// 2. Versleutel het volledige document.
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const key = crypto.pbkdf2Sync(code, salt, ITER, 32, 'sha256');
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const ct = Buffer.concat([cipher.update(html, 'utf8'), cipher.final()]);
const payload = Buffer.concat([ct, cipher.getAuthTag()]); // ct||tag (WebCrypto-formaat)

// 3. Controleer dat het terug te ontcijferen is.
const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
dec.setAuthTag(payload.subarray(payload.length - 16));
const check = Buffer.concat([dec.update(payload.subarray(0, payload.length - 16)), dec.final()]).toString('utf8');
if (check !== html) throw new Error('Verificatie van de versleuteling mislukte.');

const b64 = (b) => b.toString('base64');

// 4. Schrijf de schil.
const shell = `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Auto Taxatie</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #f1f5f9; color: #1f2937; }
    .gate { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,.1); max-width: 320px; width: 100%; text-align: center; }
    h1 { margin: 0 0 4px; font-size: 1.4rem; }
    p.sub { color: #6b7280; font-size: .85rem; margin: 0 0 16px; }
    input { width: 100%; box-sizing: border-box; text-align: center; font-size: 1.5rem; letter-spacing: .3em; padding: 10px; border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 12px; }
    button { width: 100%; padding: 10px; border: none; border-radius: 8px; background: #2563eb; color: #fff; font-size: 1rem; font-weight: 600; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    .err { color: #dc2626; font-size: .85rem; min-height: 1.2em; margin: 8px 0 0; }
  </style>
</head>
<body>
  <div class="gate" id="gate">
    <form class="card" id="form">
      <h1>Auto Taxatie</h1>
      <p class="sub">Voer de toegangscode in</p>
      <input type="password" id="code" inputmode="numeric" autocomplete="off" placeholder="••••••" aria-label="Toegangscode" autofocus />
      <button type="submit">Toegang</button>
      <p class="err" id="err"></p>
    </form>
  </div>
  <script>
    const SALT = Uint8Array.from(atob('${b64(salt)}'), c => c.charCodeAt(0));
    const IV = Uint8Array.from(atob('${b64(iv)}'), c => c.charCodeAt(0));
    const DATA = Uint8Array.from(atob('${b64(payload)}'), c => c.charCodeAt(0));
    const ITER = ${ITER};

    async function ontcijfer(code) {
      const enc = new TextEncoder();
      const km = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey']);
      const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: SALT, iterations: ITER, hash: 'SHA-256' },
        km, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: IV }, key, DATA);
      return new TextDecoder().decode(plain);
    }

    function toon(html) {
      document.open(); document.write(html); document.close();
    }

    async function probeer(code, viaOpslag) {
      try {
        const html = await ontcijfer(code);
        sessionStorage.setItem('demo_code', code);
        toon(html);
        return true;
      } catch {
        if (viaOpslag) sessionStorage.removeItem('demo_code');
        return false;
      }
    }

    const opgeslagen = sessionStorage.getItem('demo_code');
    if (opgeslagen) probeer(opgeslagen, true);

    document.getElementById('form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const ok = await probeer(document.getElementById('code').value.trim(), false);
      if (!ok) {
        document.getElementById('err').textContent = 'Onjuiste toegangscode';
        document.getElementById('code').value = '';
      }
    });
  </script>
</body>
</html>
`;

writeFileSync(join(root, 'docs/index.html'), shell);
console.log(`Versleutelde demo geschreven naar docs/index.html (code: ${code}, payload ${payload.length} bytes).`);
