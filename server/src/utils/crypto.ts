import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

let llmKeyWarningLogged = false;

function getKey(): Buffer {
  const raw = process.env.LLM_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!raw) {
    throw new Error('FATAL: Neither LLM_ENCRYPTION_KEY nor JWT_SECRET is set. Cannot encrypt/decrypt data.');
  }
  if (!process.env.LLM_ENCRYPTION_KEY && !llmKeyWarningLogged) {
    console.warn('WARNING: LLM_ENCRYPTION_KEY not set, falling back to JWT_SECRET. Set LLM_ENCRYPTION_KEY for production.');
    llmKeyWarningLogged = true;
  }
  return createHash('sha256').update(raw).digest();
}

export function encrypt(text: string): string {
  const key = getKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return iv.toString('hex') + ':' + authTag + ':' + encrypted;
}

export function decrypt(encoded: string): string {
  const parts = encoded.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted format');
  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}
