import { Router } from 'express';
import { getDb } from '../db';
import { importContactsFromCsv, listOptedInContacts } from '../services/contacts';

export const contactsRouter = Router();

contactsRouter.get('/contacts', (_req, res) => {
  const db = getDb();
  res.json(db.prepare('SELECT * FROM contacts ORDER BY id').all());
});

contactsRouter.get('/contacts/opted-in', (_req, res) => {
  res.json(listOptedInContacts(getDb()));
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
