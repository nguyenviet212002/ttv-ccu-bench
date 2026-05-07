import { Module, Global } from '@nestjs/common';
import { Pool } from 'pg';

export const DATABASE_POOL = 'DATABASE_POOL';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      useFactory: () => {
        const pool = new Pool({
          connectionString: process.env.DATABASE_URL,
          max: 10,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
        });
        pool.on('error', (err) => console.error('[pg] pool error:', err.message));
        return pool;
      },
    },
  ],
  exports: [DATABASE_POOL],
})
export class DatabaseModule {}
