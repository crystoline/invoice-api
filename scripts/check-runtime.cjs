#!/usr/bin/env node
/**
 * Guard against ERR_REQUIRE_ESM in the deployed runtime.
 *
 * The serverless target (Vercel) runs Node 20, which CANNOT `require()` an ESM
 * module — Node only gained that in 22.12. Running this check on Node 22+ is
 * therefore useless: `require(esm)` silently succeeds there and hides the bug.
 * We have been bitten by this three times (puppeteer, puppeteer-core, and
 * otplib -> @scure/base), so this loads every production dependency and every
 * compiled service the way the serverless runtime would.
 *
 *   nvm use 20 && npm run check:runtime
 *
 * Run it after adding any dependency.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const major = Number(process.versions.node.split('.')[0]);
const minor = Number(process.versions.node.split('.')[1]);
const canRequireEsm = major > 22 || (major === 22 && minor >= 12);

console.log(`node ${process.version}`);
if (canRequireEsm) {
  console.log(
    '\nWARNING: this Node can require() ESM, so ESM-only dependencies will NOT\n' +
      'be detected. Re-run under Node 20 to reproduce the serverless runtime.\n',
  );
}

let failed = 0;
const run = (label, fn) => {
  try {
    fn();
    console.log(`OK    ${label}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${label} -> ${e.code || e.name}: ${String(e.message).split('\n')[0]}`);
  }
};

console.log('\n--- production dependencies ---');
for (const dep of Object.keys(pkg.dependencies || {})) {
  // Types-only and CLI packages have no meaningful entry point.
  if (dep.startsWith('@types/')) continue;
  run(dep, () => require(dep));
}

console.log('\n--- compiled services ---');
const distSrc = path.join(root, 'dist');
if (!fs.existsSync(distSrc)) {
  console.log('dist/ missing - run `npm run build` first');
  process.exit(1);
}
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.isFile() && e.name.endsWith('.service.js') ? [full] : [];
  });
for (const file of walk(distSrc)) {
  run(path.relative(root, file), () => require(file));
}

console.log(
  failed === 0
    ? '\nALL MODULES LOAD - safe for the Node 20 serverless runtime'
    : `\n${failed} MODULE(S) FAILED - these will crash on deploy`,
);
process.exit(failed === 0 ? 0 : 1);
