const { join } = require('path');

/**
 * Solo necesitamos 'chrome' normal para WhatsApp Web.
 * Omitimos 'chrome-headless-shell' y 'firefox' para evitar fallos de proveedores en Linux.
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
  chrome: {
    skipDownload: false,
  },
  'chrome-headless-shell': {
    skipDownload: true,
  },
  firefox: {
    skipDownload: true,
  },
};
