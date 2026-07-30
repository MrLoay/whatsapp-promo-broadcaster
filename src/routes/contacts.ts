import { Router } from 'express';
import { getDb } from '../db';
import { importContactsFromCsv, listOptedInContacts, upsertContact, getContactByPhone, deleteContact } from '../services/contacts';
import { requireAuth } from '../auth';

export const contactsRouter = Router();
contactsRouter.use(requireAuth);

contactsRouter.get('/contacts', (_req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM contacts ORDER BY id').all());
});

contactsRouter.get('/contacts/opted-in', (_req, res) => {
  res.json(listOptedInContacts(getDb()));
});

contactsRouter.post('/contacts', (req, res) => {
  const { phone, name, opted_in } = req.body ?? {};
  if (!/^\+[1-9]\d{6,14}$/.test(phone ?? '')) {
    return res.status(400).json({ error: 'phone must be E.164 format, e.g. +15551234567' });
  }
  try {
    upsertContact(getDb(), phone, name, Boolean(opted_in), 'dashboard');
    res.status(201).json(getContactByPhone(getDb(), phone));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

contactsRouter.delete('/contacts/:id', (req, res) => {
  const deleted = deleteContact(getDb(), Number(req.params.id));
  if (!deleted) return res.sendStatus(404);
  res.json({ deleted: true });
});

// Body: raw CSV text, header row: phone,name,opted_in
contactsRouter.post('/contacts/import', (req, res) => {
  try {
    const result = importContactsFromCsv(getDb(), req.body as string, 'api_import');
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
