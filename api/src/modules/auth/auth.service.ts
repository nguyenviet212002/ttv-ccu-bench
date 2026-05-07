import { Injectable, Inject, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import * as jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { DATABASE_POOL } from '../../database/database.module';
import { REDIS_SESSION, REDIS_CACHE } from '../../redis/redis.module';

@Injectable()
export class AuthService {
  constructor(
    @Inject(DATABASE_POOL) private readonly db: Pool,
    @Inject(REDIS_SESSION) private readonly redisSession: Redis,
    @Inject(REDIS_CACHE) private readonly redisCache: Redis,
  ) {}

  async requestOtp(phone: string): Promise<{ request_id: string }> {
    // Rate limit: 3 OTPs per phone per minute
    const rateLimitKey = `otp_rate:${phone}`;
    const count = await this.redisCache.incr(rateLimitKey);
    if (count === 1) await this.redisCache.expire(rateLimitKey, 60);
    if (count > 3) throw new BadRequestException('OTP rate limit exceeded');

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const requestId = uuidv4();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    await this.db.query(
      `INSERT INTO otp_codes (phone, code, expires_at) VALUES ($1, $2, $3)`,
      [phone, code, expiresAt],
    );

    // Store request_id → phone mapping in Redis for fast lookup
    await this.redisCache.setex(`otp:${requestId}`, 300, JSON.stringify({ phone, code }));

    return { request_id: requestId };
  }

  async verifyOtp(requestId: string, code: string): Promise<{ access_token: string }> {
    const cached = await this.redisCache.get(`otp:${requestId}`);
    if (!cached) throw new UnauthorizedException('OTP expired or not found');

    const { phone, code: storedCode } = JSON.parse(cached);
    if (code !== storedCode) throw new UnauthorizedException('Invalid OTP');

    // Consume the OTP
    await this.redisCache.del(`otp:${requestId}`);
    await this.db.query(
      `UPDATE otp_codes SET consumed = TRUE WHERE phone = $1 AND code = $2 AND consumed = FALSE`,
      [phone, code],
    );

    // Upsert user
    const { rows } = await this.db.query(
      `INSERT INTO users (phone, type) VALUES ($1, 'customer')
       ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone
       RETURNING id, type`,
      [phone],
    );
    const user = rows[0];

    const token = jwt.sign(
      { sub: user.id, phone, type: user.type },
      process.env.JWT_SECRET || 'ttv_jwt_secret_benchmark_2026',
      { expiresIn: '24h' },
    );

    // Store session in Redis
    await this.redisSession.setex(`session:${user.id}`, 86400, JSON.stringify({ userId: user.id, type: user.type }));

    return { access_token: token };
  }
}
