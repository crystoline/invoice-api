// Generate a Prisma migration from the drift between the LIVE database and
// schema.prisma — without a shadow database.
//
// Why this exists: `prisma migrate dev` needs CREATE DATABASE privilege to spin
// up a shadow DB, which shared cPanel MySQL denies. This computes the same diff
// with `migrate diff --from-schema-datasource` (introspects the live DB via the
// datasource block) and writes it as a normal migration you then apply with
// `prisma migrate deploy`.
//
// Usage:
//   npm run prisma:migrate:new -- add_tax_rates
//   node scripts/new-migration.mjs add_tax_rates
//
// It does NOT touch the database. Review the generated SQL, then run
// `npm run prisma:migrate:deploy` to apply it.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const raw = process.argv[2];
if (!raw) {
  console.error('Error: migration name required.');
  console.error('Usage: npm run prisma:migrate:new -- <name>   (e.g. add_tax_rates)');
  process.exit(1);
}

// Prisma migration folder names are <timestamp>_<snake_case_name>.
const name = raw
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');
if (!name) {
  console.error(`Error: "${raw}" has no usable alphanumeric characters.`);
  process.exit(1);
}

const now = new Date();
const ts =
  now.getUTCFullYear().toString() +
  String(now.getUTCMonth() + 1).padStart(2, '0') +
  String(now.getUTCDate()).padStart(2, '0') +
  String(now.getUTCHours()).padStart(2, '0') +
  String(now.getUTCMinutes()).padStart(2, '0') +
  String(now.getUTCSeconds()).padStart(2, '0');

// Compute live-DB → schema.prisma as raw SQL. execFileSync (not shell) so the
// long flag list can't be mangled by any shell quoting.
let sql;
try {
  sql = execFileSync(
    'npx',
    [
      'prisma',
      'migrate',
      'diff',
      '--from-schema-datasource',
      'prisma/schema.prisma',
      '--to-schema-datamodel',
      'prisma/schema.prisma',
      '--script',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  );
} catch (err) {
  console.error('\nprisma migrate diff failed — is DATABASE_URL reachable?');
  process.exit(err.status ?? 1);
}

if (!sql.trim()) {
  console.log('No drift detected — the live database already matches schema.prisma.');
  console.log('Nothing to generate.');
  process.exit(0);
}

const dir = join('prisma', 'migrations', `${ts}_${name}`);
mkdirSync(dir, { recursive: true });
const file = join(dir, 'migration.sql');
writeFileSync(file, sql.endsWith('\n') ? sql : sql + '\n');

// A DROP is destructive — surface it so it can't slip through unreviewed.
const destructive = /\b(DROP\s+(TABLE|COLUMN)|TRUNCATE)\b/i.test(sql);

console.log(`\nCreated ${file}`);
console.log(`  ${sql.split('\n').filter((l) => l.trim()).length} SQL lines`);
if (destructive) {
  console.log('\n  ⚠  This migration contains DROP/TRUNCATE — review it before applying.');
}
console.log('\nNext:');
console.log(`  1. Review ${file}`);
console.log('  2. npm run prisma:migrate:deploy   # applies it to the database');
console.log('  3. git add prisma/migrations && commit');
