import bcrypt from 'bcryptjs';

const plaintext = process.argv[2];
if (!plaintext) {
  console.error('Usage: npm run hash-password -- <plaintext-password>');
  process.exit(1);
}

const hash = bcrypt.hashSync(plaintext, 10);
console.log(hash);
console.log('\nAdd this to DASHBOARD_USERS in .env, e.g.:');
console.log(`DASHBOARD_USERS=[{"username":"loay","passwordHash":"${hash}"}]`);
