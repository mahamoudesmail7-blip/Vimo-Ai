// Vimo AI — one Express app serves the API and the static site (public/).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import bcrypt from 'bcryptjs';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env, publicConfig } from './config.js';
import { errorHandler } from './errors.js';
import authRoutes from './routes/auth.js';
import videoRoutes from './routes/videos.js';
import walletRoutes from './routes/wallet.js';
import adminRoutes from './routes/admin.js';
import showcaseRoutes from './routes/showcase.js';
import { startWorker } from './services/videoJob.js';
import { prisma } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cookieParser());
  app.use(express.json({ limit: '15mb' })); // product photos arrive as base64 data URLs

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.get('/api/config', (req, res) => res.json(publicConfig()));
  app.use('/api/auth', authRoutes);
  app.use('/api/videos', videoRoutes);
  app.use('/api/wallet', walletRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/showcase', showcaseRoutes);
  app.use('/api', (req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'المسار مش موجود.' }));

  app.use(express.static(path.join(here, '..', 'public'), { extensions: ['html'] }));
  app.use((req, res) => res.status(404).sendFile(path.join(here, '..', 'public', 'index.html')));
  app.use(errorHandler);
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!env.jwtSecret()) {
    console.error('JWT_SECRET is required in production.');
    process.exit(1);
  }
  if (env.adminEmails().length) {
    const { count } = await prisma.user.updateMany({ where: { email: { in: env.adminEmails() }, role: { not: 'ADMIN' } }, data: { role: 'ADMIN' } });
    if (count) console.log(`Promoted ${count} account(s) from ADMIN_EMAILS to admin.`);
  }
  // Forgotten owner password: set ADMIN_RESET_PASSWORD on the host, redeploy, log in, then remove it.
  const resetPassword = String(process.env.ADMIN_RESET_PASSWORD || '');
  if (resetPassword && env.adminEmails().length) {
    if (resetPassword.length < 8) console.error('ADMIN_RESET_PASSWORD must be at least 8 characters; ignored.');
    else {
      const { count } = await prisma.user.updateMany({ where: { email: { in: env.adminEmails() } }, data: { password_hash: await bcrypt.hash(resetPassword, 10), status: 'ACTIVE' } });
      console.log(`Reset the password of ${count} ADMIN_EMAILS account(s). Remove ADMIN_RESET_PASSWORD now.`);
    }
  }
  createApp().listen(env.port(), () => console.log(`Vimo AI listening on http://localhost:${env.port()}`));
  startWorker();
}
