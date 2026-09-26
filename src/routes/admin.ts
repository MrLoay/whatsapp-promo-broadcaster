import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { requireAuth, requireAdmin } from '../auth';
import { getDb } from '../db';
import { getCreditBalance } from '../services/credits';

export const adminRouter = Router();
adminRouter.use(requireAuth);
adminRouter.use(requireAdmin);

adminRouter.get('/admin/users', (req, res) => {
  const db = getDb();
  const users = db.prepare('SELECT username, role, created_at FROM users').all() as any[];
  
  const usersWithCredits = users.map(u => ({
    ...u,
    credits: getCreditBalance(db, u.username)
  }));
  
  res.json(usersWithCredits);
});

adminRouter.post('/admin/users', (req, res) => {
  const { username, password, role } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  const assignedRole = role === 'admin' ? 'admin' : 'customer';
  const db = getDb();
  
  try {
    const hash = bcrypt.hashSync(password, 10);
    db.transaction(() => {
      db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, assignedRole);
      db.prepare('INSERT INTO user_credits (owner, balance) VALUES (?, 0)').run(username);
    })();
    res.status(201).json({ success: true, username, role: assignedRole });
  } catch (err) {
    res.status(400).json({ error: 'Username may already exist' });
  }
});

adminRouter.post('/admin/users/:username/credits', (req, res) => {
  const targetUsername = req.params.username;
  const { amount } = req.body ?? {};
  if (typeof amount !== 'number') {
    return res.status(400).json({ error: 'Amount must be a number' });
  }
  
  const db = getDb();
  try {
    // Add amount to existing balance
    const info = db.prepare('UPDATE user_credits SET balance = balance + ?, updated_at = datetime("now") WHERE owner = ?').run(amount, targetUsername);
    if (info.changes === 0) {
      return res.status(404).json({ error: 'User credits record not found' });
    }
    const newBalance = getCreditBalance(db, targetUsername);
    res.json({ success: true, newBalance });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

adminRouter.delete('/admin/users/:username', (req, res) => {
  const targetUsername = req.params.username;
  if (targetUsername === req.session.username) {
    return res.status(400).json({ error: 'Cannot delete yourself' });
  }
  
  const db = getDb();
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM users WHERE username = ?').run(targetUsername);
      db.prepare('DELETE FROM user_credits WHERE owner = ?').run(targetUsername);
    })();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
