import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  // Buscar en la caché local del proyecto (.cache/puppeteer)
  const localCache = path.join(__dirname, '..', '.cache', 'puppeteer', 'chrome');
  if (fs.existsSync(localCache)) {
    try {
      const dirs = fs.readdirSync(localCache);
      for (const d of dirs) {
        // En Linux (Render) el binario suele ser chrome-linux64/chrome
        const linuxBin = path.join(localCache, d, 'chrome-linux64', 'chrome');
        if (fs.existsSync(linuxBin)) return linuxBin;
        const rootBin = path.join(localCache, d, 'chrome');
        if (fs.existsSync(rootBin)) return rootBin;
      }
    } catch {}
  }

  // Rutas estándar de Chrome en sistemas Linux / Debian
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
