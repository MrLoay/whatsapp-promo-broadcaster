import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { config } from './config';

import { getDb } from './db';
import { getCreditBalance } from './services/credits';

declare module 'express-session' {
  interface SessionData {
    username?: string;
    role?: string;
  }
}

export const authRouter = Router();

authRouter.post('/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) return res.status(401).json({ error: 'Missing credentials' });

  const db = getDb();
  const user = db.prepare('SELECT password_hash, role FROM users WHERE username = ?').get(username) as { password_hash: string, role: string } | undefined;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  req.session.username = username;
  req.session.role = user.role;
  res.json({ username, role: user.role });
});

authRouter.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

authRouter.get('/auth/me', (req, res) => {
  if (!req.session.username) return res.sendStatus(401);
  
  const balance = getCreditBalance(getDb(), req.session.username);
  res.json({ 
    username: req.session.username,
    role: req.session.role,
    credits: balance
  });
});

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.username) return next();
  res.status(401).json({ error: 'Not logged in' });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.username && req.session?.role === 'admin') return next();
  res.status(403).json({ error: 'Forbidden: Admins only' });
}
