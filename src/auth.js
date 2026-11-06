import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

export function verifyToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, config.jwtSecret);
  } catch {
    return null;
  }
}

export function loginHandler(req, res) {
  const { username, password } = req.body || {};
  const okUser = safeEqual(username, config.appUser);
  const okPass = safeEqual(password, config.appPassword);
  if (!okUser || !okPass) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  const token = jwt.sign({ sub: config.appUser }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
  res.json({ token, username: config.appUser });
}

/** Acepta el token por cabecera Authorization: Bearer xxx o por ?token=xxx (para <img>/<audio>). */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'No autorizado' });
  req.user = payload;
  next();
}
