const { join } = require('path');

/**
 * Forzar la ruta de caché en .cache/puppeteer para que tanto en el build
 * como en runtime Puppeteer busque exactamente en la misma carpeta del proyecto.
 * @type {import("puppeteer").Configuration}
 */
module.exports = {
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};
