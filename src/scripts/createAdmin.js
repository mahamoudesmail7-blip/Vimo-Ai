// Create the first admin, or promote an existing account:
//   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' ADMIN_NAME='Mahmoud' npm run admin:create
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';

const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD || '');
const name = String(process.env.ADMIN_NAME || 'Admin');

if (!email) {
  console.error('Set ADMIN_EMAIL (and ADMIN_PASSWORD for a new account).');
  process.exit(1);
}

const existing = await prisma.user.findUnique({ where: { email } });
if (existing) {
  await prisma.user.update({ where: { email }, data: { role: 'ADMIN', status: 'ACTIVE' } });
  console.log(`${email} is now an admin.`);
} else {
  if (password.length < 8) {
    console.error('ADMIN_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }
  await prisma.user.create({ data: { email, name, role: 'ADMIN', password_hash: await bcrypt.hash(password, 10) } });
  console.log(`Admin ${email} created.`);
}
await prisma.$disconnect();
