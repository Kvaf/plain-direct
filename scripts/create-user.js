#!/usr/bin/env node
// Usage: node scripts/create-user.js <email> <password> [admin|user]
// Example: node scripts/create-user.js admin@plain.direct MyPass123 admin

const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const [,, email, password, role = 'user'] = process.argv;

if (!email || !password) {
  console.error('\nUsage: node scripts/create-user.js <email> <password> [admin|user]');
  console.error('Example: node scripts/create-user.js admin@plain.direct MyPass123 admin\n');
  process.exit(1);
}

if (password.length < 6) {
  console.error('\n❌ Password must be at least 6 characters.\n');
  process.exit(1);
}

const USERS_FILE = process.env.USERS_FILE || path.join(__dirname, '..', 'data', 'users.json');
const dataDir = path.dirname(USERS_FILE);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let users = [];
try {
  if (fs.existsSync(USERS_FILE)) users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
} catch(e) { users = []; }

const cleanEmail = email.toLowerCase().trim();
if (users.find(u => u.email === cleanEmail)) {
  console.error(`\n❌ User "${cleanEmail}" already exists.\n`);
  process.exit(1);
}

const finalRole = role === 'admin' ? 'admin' : 'user';
const newUser = {
  id: Date.now(),
  email: cleanEmail,
  password_hash: bcrypt.hashSync(password, 12),
  name: '',
  role: finalRole,
  created_at: new Date().toISOString(),
  last_login: null
};

users.push(newUser);
fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

console.log('\n✅ User created!');
console.log(`   Email: ${cleanEmail}`);
console.log(`   Role:  ${finalRole}`);
console.log('\nNow push data/users.json to GitHub so Railway picks it up.\n');
