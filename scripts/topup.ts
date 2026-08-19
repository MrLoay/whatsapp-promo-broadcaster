import { openDb } from '../src/db';
import { topupCredits } from '../src/services/credits';

const db = openDb();
topupCredits(db, 'ForgeCodes', 25000);
topupCredits(db, 'rose', 25000);
console.log('Topped up 25000 credits for ForgeCodes and rose.');
