if (!process.env.JWT_SECRET) {
  throw new Error('FATAL: JWT_SECRET environment variable is not set. Server cannot start without it.');
}
export const JWT_SECRET: string = process.env.JWT_SECRET;

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
