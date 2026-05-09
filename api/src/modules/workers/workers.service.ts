import { Injectable, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_GEO } from '../../redis/redis.module';
import { UpdateGpsDto } from './dto/update-gps.dto';

const GEO_KEY = 'workers:geo:active';
const GPS_TTL  = 45;

@Injectable()
export class WorkersService {
  constructor(@Inject(REDIS_GEO) private readonly redisGeo: Redis) {}

  async updateGps(workerId: number, dto: UpdateGpsDto): Promise<{ ok: boolean }> {
    // GEOADD + TTL sentinel — NO PostgreSQL write per spec
    const pipeline = this.redisGeo.pipeline();
    pipeline.geoadd(GEO_KEY, dto.lon, dto.lat, `worker:${workerId}`);
    pipeline.setex(`worker:gps:ttl:${workerId}`, GPS_TTL, '1');
    await pipeline.exec();
    return { ok: true };
  }

  /**
   * Cached nearby query — buffers TTL 2s for hot queries.
   * Fix: Convert Buffer[] → string[] to avoid serialization bug.
   */
  private nearbyCache = new Map<string, { data: string[]; ts: number }>();
  private readonly CACHE_TTL_MS = 2000; // 2 second cache

  async getNearby(lat: number, lon: number): Promise<string[]> {
    const cacheKey = `${lat.toFixed(4)}:${lon.toFixed(4)}`;

    // Check cache first
    const cached = this.nearbyCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this.CACHE_TTL_MS) {
      return cached.data;
    }

    // GEOSEARCH (Redis 7.x) — all args must be strings for ioredis
    const raw = await this.redisGeo.sendCommand(
      new (require('ioredis').Command)('GEOSEARCH', [
        GEO_KEY,
        'FROMLONLAT', String(lon), String(lat),
        'BYRADIUS', '5', 'km',
        'ASC', 'COUNT', '20',
      ])
    ) as any[];

    // FIX: Convert Buffer[] → string[] (k6 cannot parse Buffer objects)
    const results: string[] = raw.map(item =>
      Buffer.isBuffer(item) ? item.toString('utf8') : String(item)
    );

    // Store in cache
    this.nearbyCache.set(cacheKey, { data: results, ts: Date.now() });

    return results;
  }
}
