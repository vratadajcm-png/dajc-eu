#!/usr/bin/env node
// Reads a password on stdin and prints its PostgreSQL SCRAM-SHA-256 verifier
// (the format psql's \password sends). ALTER ROLE ... PASSWORD '<verifier>'
// then stores the verifier without the password ever reaching the server, its
// statement log or the process list. RFC 5802 / RFC 7677, as PostgreSQL's
// scram_build_secret() (4096 iterations, 16-byte salt).
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

// Printable ASCII only: PostgreSQL applies SASLprep to the password, which is
// the identity for printable ASCII, so the verifier matches without it.
export function scramVerifier(password, { salt = randomBytes(16), iterations = 4096 } = {}) {
  if (!/^[\x21-\x7e]+$/.test(password)) throw new Error('password must be printable ASCII');
  const salted = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  if (password.length < 24) {
    console.error('scram-verifier: password must be at least 24 characters');
    process.exit(2);
  }
  process.stdout.write(`${scramVerifier(password)}\n`);
}
