import { Module, Global } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_SESSION = 'REDIS_SESSION';
export const REDIS_CACHE   = 'REDIS_CACHE';
export const REDIS_GEO     = 'REDIS_GEO';
export const REDIS_QUEUE   = 'REDIS_QUEUE';
export const REDIS_PUBSUB  = 'REDIS_PUBSUB';

function makeRedis(url: string): Redis {
  const r = new Redis(url, {
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
    connectTimeout: 10000,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 3000),
  });
  r.on('error', err => console.error(`[redis] ${url} error:`, err.message));
  return r;
}

@Global()
@Module({
  providers: [
    { provide: REDIS_SESSION, useFactory: () => makeRedis(process.env.REDIS_SESSION_URL!) },
    { provide: REDIS_CACHE,   useFactory: () => makeRedis(process.env.REDIS_CACHE_URL!) },
    { provide: REDIS_GEO,     useFactory: () => makeRedis(process.env.REDIS_GEO_URL!) },
    { provide: REDIS_QUEUE,   useFactory: () => makeRedis(process.env.REDIS_QUEUE_URL!) },
    { provide: REDIS_PUBSUB,  useFactory: () => makeRedis(process.env.REDIS_PUBSUB_URL!) },
  ],
  exports: [REDIS_SESSION, REDIS_CACHE, REDIS_GEO, REDIS_QUEUE, REDIS_PUBSUB],
})
export class RedisModule {}
