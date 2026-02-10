import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ethers } from 'ethers';

const JWT_SECRET = process.env.JWT_SECRET || 'prediction-market-dev-secret';

export interface AuthRequest extends Request {
  userAddress?: string;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { address?: unknown };
    if (typeof decoded.address !== 'string' || !ethers.isAddress(decoded.address)) {
      res.status(401).json({ error: 'Invalid token payload' });
      return;
    }
    req.userAddress = decoded.address.toLowerCase();
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
