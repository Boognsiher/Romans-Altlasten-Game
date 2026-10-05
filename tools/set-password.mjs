// Setzt das Startpasswort in src/config.js: node tools/set-password.mjs <Passwort>   (ohne Argument: Passwort entfernen)
import { readFileSync, writeFileSync } from 'node:fs';
import { hashPassword } from '../src/ui/gate.js';
const pw = process.argv[2] ?? '';
const file = new URL('../src/config.js', import.meta.url);
const hash = pw ? hashPassword(pw) : '';
writeFileSync(file, readFileSync(file, 'utf8').replace(/passwordHash: '[0-9a-f]*'/, `passwordHash: '${hash}'`));
console.log(pw ? `Passwort gesetzt (Hash ${hash.slice(0, 8)}…)` : 'Passwort entfernt');
