import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { DATABASE_POOL } from '../../database/database.module';
import { REDIS_QUEUE, REDIS_PUBSUB } from '../../redis/redis.module';
import { TriggerSosDto } from './dto/trigger-sos.dto';

@Injectable()
export class SosService {
  constructor(
    @Inject(DATABASE_POOL) private readonly db: Pool,
    @Inject(REDIS_QUEUE) private readonly redisQueue: Redis,
    @Inject(REDIS_PUBSUB) private readonly redisPubsub: Redis,
  ) {}

  async trigger(userId: number, dto: TriggerSosDto) {
    const triggeredAt = Date.now();

    const { rows } = await this.db.query(
      `INSERT INTO sos_incidents (triggered_by_user_id, job_id, category, state)
       VALUES ($1, $2, $3, 'OPEN')
       RETURNING id, triggered_at`,
      [userId, dto.job_id || null, dto.category],
    );
    const incident = rows[0];

    const payload = JSON.stringify({
      incident_id: incident.id,
      user_id: userId,
      job_id: dto.job_id,
      category: dto.category,
      triggered_at: incident.triggered_at,
      priority: 'P0',
    });

    // Push to P0 priority SOS queue (head of queue via rpush)
    await this.redisQueue.rpush('queue:sos:p0', payload);

    // Broadcast to admin namespace via pub/sub
    await this.redisPubsub.publish('channel:admin:sos', payload);

    const alertLatency = Date.now() - triggeredAt;
    await this.db.query(
      `UPDATE sos_incidents SET alert_latency_ms = $1 WHERE id = $2`,
      [alertLatency, incident.id],
    );

    return {
      incident_id: incident.id,
      state: 'OPEN',
      alert_latency_ms: alertLatency,
    };
  }
}
