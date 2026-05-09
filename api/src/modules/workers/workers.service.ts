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

  async getNearby(lat: number, lon: number): Promise<string[]> {
    // GEOSEARCH (Redis 7.x) — all args must be strings for ioredis
    const results = await this.redisGeo.sendCommand(
      new (require('ioredis').Command)('GEOSEARCH', [
        GEO_KEY,
        'FROMLONLAT', String(lon), String(lat),
        'BYRADIUS', '5', 'km',
        'ASC', 'COUNT', '20',
      ])
    ) as string[];
    return results;
  }
}
