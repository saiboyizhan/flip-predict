import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

const ADMIN_ADDRESSES: string[] = process.env.ADMIN_ADDRESSES
  ? process.env.ADMIN_ADDRESSES.split(',').map(addr => addr.trim().toLowerCase())
  : [];

export function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const userAddress = req.userAddress;
  if (!userAddress) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (!ADMIN_ADDRESSES.includes(userAddress.toLowerCase())) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  next();
}
