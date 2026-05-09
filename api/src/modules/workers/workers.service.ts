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
    const pipeline = this.redisGeo.pipeline();
    pipeline.geoadd(GEO_KEY, dto.lon, dto.lat, `worker:${workerId}`);
    pipeline.setex(`worker:gps:ttl:${workerId}`, GPS_TTL, '1');
    await pipeline.exec();
    return { ok: true };
  }

  // In-memory cache: 2s TTL, keyed by truncated coords (4 decimal places ≈ 11m grid)
  private nearbyCache = new Map<string, { data: string[]; ts: number }>();
  private readonly CACHE_TTL_MS = 2000;

  async getNearby(lat: number, lon: number): Promise<string[]> {
    const cacheKey = `${lat.toFixed(4)}:${lon.toFixed(4)}`;

    const cached = this.nearbyCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < this.CACHE_TTL_MS) {
      return cached.data;
    }

    // ioredis v5: GEOSEARCH via dynamic command call (no require() in hot path)
    const raw = await (this.redisGeo as any).geosearch(
      GEO_KEY,
      'FROMLONLAT', String(lon), String(lat),
      'BYRADIUS', '5', 'km',
      'ASC', 'COUNT', '20',
    ) as any[];

    const results: string[] = (raw ?? []).map((item: any) =>
      Buffer.isBuffer(item) ? item.toString('utf8') : String(item)
    );

    this.nearbyCache.set(cacheKey, { data: results, ts: Date.now() });

    // Evict entries older than CACHE_TTL_MS to prevent unbounded growth
    if (this.nearbyCache.size > 5000) {
      const cutoff = Date.now() - this.CACHE_TTL_MS;
      for (const [k, v] of this.nearbyCache) {
        if (v.ts < cutoff) this.nearbyCache.delete(k);
      }
    }

    return results;
  }
}
