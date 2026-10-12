// Password rules (functions/_shared/password.ts), bundled with esbuild and run in Node.
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), 'pw-')), 'pw.mjs');
await build({ entryPoints: [join(here, '..', '..', 'functions', '_shared', 'password.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const { passwordProblem, tempPassword } = await import(pathToFileURL(out).href);

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) { passed++; console.log('  ✓', m); } else { failed++; console.log('  ✗', m); } };

console.log('\nPASSWORD RULES');
for (const [pw, why] of [['123456', 'old 6-digit PIN'], ['abcdefghij', 'letters only'], ['1234567890', 'numbers only'], ['short1a', 'too short'],
  ['Password123', 'common pattern'], ['aaaaaaaaaa', 'repeated'], ['x'.repeat(73) + '1', 'too long']]) {
  ok(passwordProblem(pw) !== null, `rejects ${why} (${pw.slice(0, 14)})`);
}
ok(passwordProblem('brian2026secure', 'brian') !== null, 'rejects a password containing the username');
ok(passwordProblem('Galle-Road-48') === null, 'accepts a good password');

console.log('\nTEMPORARY PASSWORDS');
const many = Array.from({ length: 2000 }, () => tempPassword());
ok(many.every((p) => p.length === 12 && /[a-zA-Z]/.test(p) && /\d/.test(p)), '12 characters, always letters + numbers');
ok(many.every((p) => !/[0O1lI]/.test(p)), 'no look-alike characters (0 O 1 l I)');
ok(many.every((p) => passwordProblem(p) === null), 'always pass the password rules');
ok(new Set(many).size === many.length, '2,000 generated, no repeats');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
