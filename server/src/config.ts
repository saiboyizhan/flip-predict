const IS_PRODUCTION = process.env.NODE_ENV === 'production';
if (!process.env.JWT_SECRET && IS_PRODUCTION) {
  throw new Error('JWT_SECRET must be set in production environment');
}
if (!process.env.JWT_SECRET) {
  console.warn('[WARN] JWT_SECRET not set, using insecure default. Set JWT_SECRET in .env for production.');
}
export const JWT_SECRET = process.env.JWT_SECRET || 'prediction-market-dev-secret';

// Admin addresses - centralized configuration
export const ADMIN_ADDRESSES = new Set(
  (process.env.ADMIN_ADDRESSES || '')
    .split(',')
    .map((addr) => addr.trim().toLowerCase())
    .filter(Boolean)
);

// JWT expiration time
export const JWT_EXPIRATION: string = process.env.JWT_EXPIRATION || '24h';

// CORS origin configuration
export const CORS_ORIGIN = process.env.CORS_ORIGIN || null;
