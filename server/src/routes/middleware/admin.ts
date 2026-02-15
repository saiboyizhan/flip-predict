import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { ADMIN_ADDRESSES } from '../../config';

export function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const userAddress = req.userAddress;
  if (!userAddress) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  if (!ADMIN_ADDRESSES.has(userAddress.toLowerCase())) {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }

  next();
}
