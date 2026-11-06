const { join } = require('path');

/**
 * En Render la caché por defecto de Puppeteer (~/.cache/puppeteer) no se conserva entre
 * el build y la ejecución, así que Chrome se instala dentro del proyecto.
 * En local se usa la caché normal del usuario.
 * @type {import("puppeteer").Configuration}
 */
module.exports = process.env.RENDER
  ? { cacheDirectory: join(__dirname, '.cache', 'puppeteer') }
  : {};
