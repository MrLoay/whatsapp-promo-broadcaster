import { Router, type Request, type Response, type NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { config } from './config';

interface DashboardUser {
  username: string;
  passwordHash: string;
}

declare module 'express-session' {
  interface SessionData {
    username?: string;
  }
}

function loadUsers(): DashboardUser[] {
  try {
    const parsed = JSON.parse(config.dashboard.users);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const authRouter = Router();

authRouter.post('/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  const user = loadUsers().find((u) => u.username === username);

  if (!user || !bcrypt.compareSync(password ?? '', user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  req.session.username = user.username;
  res.json({ username: user.username });
});

authRouter.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

authRouter.get('/auth/me', (req, res) => {
  if (!req.session.username) return res.sendStatus(401);
  res.json({ username: req.session.username });
});

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session?.username) return next();
  res.status(401).json({ error: 'Not logged in' });
}
