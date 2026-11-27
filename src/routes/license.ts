import { Router } from 'express';
import { getDb } from '../db';
import { requireAuth } from '../auth';
import { getLicenseStatus } from '../services/license';

export const licenseRouter = Router();
licenseRouter.use(requireAuth);

// Read-only on purpose. The license can only be changed on the server (npm run license),
// so customers cannot raise their own account limit or extend their own expiry.
licenseRouter.get('/license', (_req, res) => {
  res.json(getLicenseStatus(getDb()));
});
