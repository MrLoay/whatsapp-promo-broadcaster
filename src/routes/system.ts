import { Router } from 'express';
import os from 'os';
import fs from 'fs';
import { requireAuth } from '../auth';
import { getDb } from '../db';
import { config } from '../config';
import { listAccounts } from '../services/accounts';
import { getActiveSessionCount } from '../whatsapp/webjs-client';

export const systemRouter = Router();
systemRouter.use(requireAuth);

systemRouter.get('/system/health', (req, res) => {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memoryUsagePct = Number(((usedMem / totalMem) * 100).toFixed(2));
  const loadAvg = os.loadavg();

  const dbPath = config.db.path;
  let dbSizeBytes = 0;
  try {
    if (fs.existsSync(dbPath)) {
      const stats = fs.statSync(dbPath);
      dbSizeBytes = stats.size;
    }
  } catch {
    /* best-effort */
  }

  const activeChromiumCount = getActiveSessionCount();
  const accounts = listAccounts(getDb());
  const maxSessions = config.whatsapp.maxConcurrentSessions;

  const alerts: string[] = [];

  if (memoryUsagePct > 85) {
    alerts.push(`HIGH MEMORY WARNING: RAM usage is at ${memoryUsagePct}% (threshold 85%).`);
  }

  if (activeChromiumCount >= maxSessions) {
    alerts.push(`SESSION CAPACITY WARNING: Active Chromium sessions (${activeChromiumCount}) reached maximum threshold (${maxSessions}).`);
  }

  res.json({
    status: alerts.length > 0 ? 'WARNING' : 'OK',
    alerts,
    system: {
      loadAvg,
      cpuCores: os.cpus().length,
      memory: {
        totalBytes: totalMem,
        freeBytes: freeMem,
        usedBytes: usedMem,
        usagePct: memoryUsagePct,
      },
      processMemory: process.memoryUsage(),
    },
    whatsapp: {
      activeChromiumProcesses: activeChromiumCount,
      maxConcurrentSessions: maxSessions,
      registeredAccounts: accounts.length,
    },
    database: {
      path: dbPath,
      sizeBytes: dbSizeBytes,
      sizeMb: Number((dbSizeBytes / (1024 * 1024)).toFixed(2)),
    },
  });
});
