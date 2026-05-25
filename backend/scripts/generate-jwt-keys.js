/**
 * Generate an RS256 keypair for JWT signing/verification.
 *
 * Output:
 *   backend/keys/jwt-private.pem  (mode 600)
 *   backend/keys/jwt-public.pem
 *
 * Usage:
 *   cd backend && npm run keys:generate
 *
 * The keys directory is gitignored. For cloud deployments, base64-encode the
 * PEMs and pass them via JWT_PRIVATE_KEY / JWT_PUBLIC_KEY instead of files.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const outDir = path.resolve(__dirname, '..', 'keys');
fs.mkdirSync(outDir, { recursive: true });

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const privPath = path.join(outDir, 'jwt-private.pem');
const pubPath = path.join(outDir, 'jwt-public.pem');

fs.writeFileSync(privPath, privateKey, { mode: 0o600 });
fs.writeFileSync(pubPath, publicKey);

console.log('Generated RS256 keypair:');
console.log('  private:', privPath);
console.log('  public :', pubPath);
console.log('\nAdd these to backend/.env:');
console.log('  JWT_PRIVATE_KEY_PATH=' + path.relative(path.resolve(__dirname, '..'), privPath));
console.log('  JWT_PUBLIC_KEY_PATH=' + path.relative(path.resolve(__dirname, '..'), pubPath));
