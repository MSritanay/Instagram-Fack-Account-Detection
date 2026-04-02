
import { migrate } from 'drizzle-orm/sqlite-proxy';
import { db } from './db';

async function main() {
  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Migrations finished.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});