import { Injectable, Inject, ConflictException } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { DATABASE_POOL } from '../../database/database.module';
import { REDIS_CACHE, REDIS_GEO, REDIS_QUEUE } from '../../redis/redis.module';
import { CalculatePriceDto } from './dto/calculate-price.dto';
import { CreateJobDto } from './dto/create-job.dto';

@Injectable()
export class JobsService {
  constructor(
    @Inject(DATABASE_POOL) private readonly db: Pool,
    @Inject(REDIS_CACHE) private readonly redisCache: Redis,
    @Inject(REDIS_GEO) private readonly redisGeo: Redis,
    @Inject(REDIS_QUEUE) private readonly redisQueue: Redis,
  ) {}

  calculatePrice(dto: CalculatePriceDto) {
    const base = 15_000;
    const weightCost = dto.weight_kg * 1_500;
    const floorCost = dto.floors * 10_000;
    const distanceCost = dto.carry_distance_m * 500;
    const total = base + weightCost + floorCost + distanceCost;

    return {
      breakdown: { base, weight: weightCost, floors: floorCost, distance: distanceCost },
      total_vnd: total,
      currency: 'VND',
    };
  }

  async createJob(customerId: number, dto: CreateJobDto) {
    const priceResult = this.calculatePrice(dto);

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `INSERT INTO jobs (customer_id, state, pickup_lat, pickup_lon, weight_kg, floors, carry_distance_m, price_breakdown)
         VALUES ($1, 'CREATED', $2, $3, $4, $5, $6, $7)
         RETURNING id, created_at`,
        [customerId, dto.pickup_lat, dto.pickup_lon, dto.weight_kg, dto.floors, dto.carry_distance_m, JSON.stringify(priceResult.breakdown)],
      );
      const job = rows[0];

      await client.query('COMMIT');

      // Publish matching request to queue (non-blocking, fire-and-forget)
      const matchPayload = JSON.stringify({
        job_id: job.id,
        lat: dto.pickup_lat,
        lon: dto.pickup_lon,
        weight_kg: dto.weight_kg,
        created_at: job.created_at,
      });
      await this.redisQueue.lpush('queue:matching', matchPayload);

      // Find nearby workers immediately for response (GEOSEARCH replaces deprecated GEORADIUS)
      const nearbyRaw = await (this.redisGeo as any).call(
        'GEOSEARCH',
        'workers:geo:active',
        'FROMLONLAT', dto.pickup_lon, dto.pickup_lat,
        'BYRADIUS', 5, 'km',
        'ASC', 'COUNT', 20,
      ) as string[];

      return {
        job_id: job.id,
        price: priceResult,
        matched_workers: nearbyRaw.slice(0, 10),
        state: 'CREATED',
      };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async acceptJob(jobId: number, workerId: number) {
    // Idempotency check via Redis
    const idempotencyKey = `job:accept:${jobId}`;
    const nx = await this.redisCache.set(idempotencyKey, workerId, 'EX', 300, 'NX');
    if (!nx) throw new ConflictException('Job already accepted');

    const { rows } = await this.db.query(
      `UPDATE jobs SET worker_id = $1, state = 'ACCEPTED', updated_at = NOW()
       WHERE id = $2 AND state = 'CREATED'
       RETURNING id, state`,
      [workerId, jobId],
    );
    if (rows.length === 0) {
      await this.redisCache.del(idempotencyKey);
      throw new ConflictException('Job not available');
    }

    await this.db.query(
      `INSERT INTO audit_log (actor_id, action, resource_type, resource_id)
       VALUES ($1, 'JOB_ACCEPTED', 'job', $2)`,
      [workerId, jobId],
    );

    return { job_id: jobId, state: 'ACCEPTED', worker_id: workerId };
  }
}
