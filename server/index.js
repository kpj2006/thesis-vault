import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import './db/database.js';
import { authenticate } from './middleware/auth.js';
import { errorHandler } from './errors.js';
import authRoutes from './routes/auth.js';
import thesisRoutes from './routes/theses.js';
import libraryRoutes from './routes/library.js';
import adminRoutes from './routes/admin.js';

export const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' https://fonts.googleapis.com 'unsafe-inline'; font-src https://fonts.gstatic.com; frame-src 'self'; object-src 'self'; base-uri 'self'; form-action 'self'");
  if (config.tlsCert) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(authenticate);

app.use('/api/auth', authRoutes);
app.use('/api', thesisRoutes, libraryRoutes, adminRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API endpoint.' } }));
app.use(errorHandler);

app.use(express.static(config.publicDir, { index: 'index.html', maxAge: '1h' }));
app.get('/{*splat}', (req, res) => res.sendFile(path.join(config.publicDir, 'index.html')));

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // NFR-004: serve over TLS when a certificate is configured (or terminate TLS at a reverse proxy).
  const server = config.tlsCert
    ? https.createServer({ key: fs.readFileSync(config.tlsKey), cert: fs.readFileSync(config.tlsCert) }, app)
    : http.createServer(app);
  server.listen(config.port, () => {
    console.log(`Thesis Vault running at ${config.tlsCert ? 'https' : 'http'}://localhost:${config.port}`);
  });
}
