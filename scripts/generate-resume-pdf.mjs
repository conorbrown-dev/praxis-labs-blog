// Generate a recruiter-downloadable PDF directly from the site's canonical résumé page.
// Uses local Astro build/preview, not an external URL or a manually maintained second résumé.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const PORT = '44321';
// Optional args: route and output file, e.g. `node scripts/generate-resume-pdf.mjs /resume-payments public/conor-brown-resume-payments.pdf`
const ROUTE = process.argv[2] ?? '/resume';
const URL = `http://127.0.0.1:${PORT}${ROUTE}`;
const outputPath = resolve(process.argv[3] ?? 'public/conor-brown-resume.pdf');
await mkdir(resolve('public'), { recursive: true });

const preview = spawn('npm', ['run', 'preview', '--', '--host', '127.0.0.1', '--port', PORT], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
  detached: true
});
preview.stdout.on('data', bytes => process.stdout.write(bytes));
preview.stderr.on('data', bytes => process.stderr.write(bytes));

let browser;
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    if (preview.exitCode !== null) throw new Error('Astro preview exited before becoming ready');
    try {
      const response = await fetch(URL);
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Astro résumé route did not become reachable');

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
  if (!await page.getByRole('heading', { name: 'Conor Brown', exact: true }).isVisible()) {
    throw new Error('Resume heading missing');
  }
  const text = await page.locator('main').innerText();
  for (const required of ['MIRATECH', 'IXOPAY', 'MissGroup', 'carllbrown87@gmail.com']) {
    if (!text.includes(required)) throw new Error(`Resume missing: ${required}`);
  }
  await page.pdf({ path: outputPath, format: 'Letter', printBackground: true, preferCSSPageSize: true });
  const file = await stat(outputPath);
  if (file.size < 10_000) throw new Error('Unexpectedly small résumé PDF');
  console.log(`Generated résumé: ${outputPath} (${file.size} bytes)`);
} finally {
  if (browser) await browser.close();
  try { process.kill(-preview.pid, 'SIGTERM'); } catch { preview.kill('SIGTERM'); }
  preview.stdout.destroy(); preview.stderr.destroy();
}
