import { Controller, Get, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { DATABASE_POOL } from '../../database/database.module';
import { REDIS_SESSION, REDIS_GEO } from '../../redis/redis.module';
import { register } from '../../common/interceptors/prometheus.interceptor';
import * as os from 'os';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DATABASE_POOL) private readonly db: Pool,
    @Inject(REDIS_SESSION) private readonly redisSession: Redis,
    @Inject(REDIS_GEO) private readonly redisGeo: Redis,
  ) {}

  @Get('snapshot')
  async snapshot() {
    const [dbPing, sessionPing, geoPing] = await Promise.all([
      this.pingDb(),
      this.redisSession.ping(),
      this.redisGeo.ping(),
    ]);

    const geoCount = await this.redisGeo.zcard('workers:geo:active');
    const memUsage = process.memoryUsage();
    const load = os.loadavg();

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      worker_pid: process.pid,
      uptime_s: Math.floor(process.uptime()),
      db_ping_ms: dbPing,
      redis_session: sessionPing === 'PONG' ? 'ok' : 'err',
      redis_geo: geoPing === 'PONG' ? 'ok' : 'err',
      geo_workers_loaded: geoCount,
      memory: {
        rss_mb: Math.round(memUsage.rss / 1024 / 1024),
        heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
        heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
      },
      cpu_load_1m: load[0],
    };
  }

  @Get('metrics')
  async metrics() {
    return register.metrics();
  }

  private async pingDb(): Promise<number> {
    const start = Date.now();
    try {
      await this.db.query('SELECT 1');
      return Date.now() - start;
    } catch {
      return -1;
    }
  }
}
