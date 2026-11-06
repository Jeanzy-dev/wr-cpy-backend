import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  // 1. Preguntar directamente a Puppeteer cuál es su executablePath configurado
  try {
    const pPath = puppeteer.executablePath();
    if (pPath && fs.existsSync(pPath)) {
      return pPath;
    }
  } catch {}

  // 2. Buscar en la caché local del proyecto (.cache/puppeteer)
  const localCache = path.join(__dirname, '..', '.cache', 'puppeteer', 'chrome');
  if (fs.existsSync(localCache)) {
    try {
      const dirs = fs.readdirSync(localCache);
      for (const d of dirs) {
        const linuxBin = path.join(localCache, d, 'chrome-linux64', 'chrome');
        if (fs.existsSync(linuxBin)) return linuxBin;
        const rootBin = path.join(localCache, d, 'chrome');
        if (fs.existsSync(rootBin)) return rootBin;
      }
    } catch {}
  }

  // 3. Buscar en la raíz /opt/render de Render si existe
  const renderCache = '/opt/render/project/src/.cache/puppeteer/chrome';
  if (fs.existsSync(renderCache)) {
    try {
      const dirs = fs.readdirSync(renderCache);
      for (const d of dirs) {
        const bin = path.join(renderCache, d, 'chrome-linux64', 'chrome');
        if (fs.existsSync(bin)) return bin;
      }
    } catch {}
  }

  // 4. Rutas estándar de Chrome en sistemas Linux / Debian
  const systemPaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const sp of systemPaths) {
    if (fs.existsSync(sp)) return sp;
  }

  return undefined;
}

export { resolveChromePath };
