import { Router } from 'express';
import { getDb } from '../db';
import { importContactsFromCsv, listOptedInContacts, listContacts, upsertContact, getContactByPhone, deleteContact } from '../services/contacts';
import { requireAuth } from '../auth';

export const contactsRouter = Router();
contactsRouter.use(requireAuth);

contactsRouter.get('/contacts', (req, res) => {
  res.json(listContacts(getDb(), req.session.username!));
});

contactsRouter.get('/contacts/opted-in', (req, res) => {
  res.json(listOptedInContacts(getDb(), req.session.username!));
});

contactsRouter.post('/contacts', (req, res) => {
  const { phone, name } = req.body ?? {};
  if (!/^\+[1-9]\d{6,14}$/.test(phone ?? '')) {
    return res.status(400).json({ error: 'phone must be E.164 format, e.g. +15551234567' });
  }
  const owner = req.session.username!;
  try {
    upsertContact(getDb(), owner, phone, name, 'dashboard');
    res.status(201).json(getContactByPhone(getDb(), owner, phone));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

contactsRouter.delete('/contacts/:id', (req, res) => {
  const deleted = deleteContact(getDb(), req.session.username!, Number(req.params.id));
  if (!deleted) return res.sendStatus(404);
  res.json({ deleted: true });
});

// Body: raw CSV text, header row: phone,name
contactsRouter.post('/contacts/import', (req, res) => {
  try {
    const result = importContactsFromCsv(getDb(), req.session.username!, req.body as string, 'api_import');
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
