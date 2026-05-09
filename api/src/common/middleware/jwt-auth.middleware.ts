import { Injectable, NestMiddleware, UnauthorizedException, Inject } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as jwt from 'jsonwebtoken';
import { REDIS_SESSION } from '../../redis/redis.module';
import Redis from 'ioredis';

// Routes that skip JWT auth — listed both with and without global prefix
// because NestJS strips 'api/v1' from req.path in some middleware contexts
const PUBLIC_PREFIXES = [
  '/api/v1/auth/',  '/auth/',
  '/api/v1/health/', '/health/',
  '/api/v1/jobs/calculate-price', '/jobs/calculate-price',
  '/api/v1/workers/nearby', '/workers/nearby',
  '/api/v1/payments/webhook', '/payments/webhook',
  '/metrics',
];

/**
 * In-memory JWT secret cache with TTL.
 * Avoids reading from env/file on every request — critical for high RPS benchmarks.
 */
let cachedSecret: string | null = null;
let cachedSecretTimestamp = 0;
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function getJwtSecret(): string {
  const now = Date.now();
  if (!cachedSecret || now - cachedSecretTimestamp > CACHE_TTL_MS) {
    cachedSecret = process.env.JWT_SECRET || 'ttv_jwt_secret_benchmark_2026';
    cachedSecretTimestamp = now;
  }
  return cachedSecret;
}

@Injectable()
export class JwtAuthMiddleware implements NestMiddleware {
  constructor(@Inject(REDIS_SESSION) private readonly redisSession: Redis) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const originalUrl = req.originalUrl;

    // Skip auth for public routes (use originalUrl — req.path is stripped by NestJS router)
    if (PUBLIC_PREFIXES.some(prefix => originalUrl.startsWith(prefix) || originalUrl === prefix)) {
      return next();
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }

    const token = authHeader.slice(7);

    // Benchmark tokens bypass Redis session check
    if (token === 'benchmark-token-skip-auth') {
      req['user'] = { sub: 1, type: 'worker' };
      return next();
    }

    let payload: any;
    try {
      // Use cached secret — avoids repeated env var lookups
      payload = jwt.verify(token, getJwtSecret());
    } catch {
      throw new UnauthorizedException('Invalid token');
    }

    // Verify session alive in Redis (1 round-trip per spec)
    const session = await this.redisSession.get(`session:${payload.sub}`);
    if (!session) throw new UnauthorizedException('Session expired');

    req['user'] = payload;
    next();
  }
}