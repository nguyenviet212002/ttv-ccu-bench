import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import { Inject, Logger } from '@nestjs/common';
import { REDIS_PUBSUB, REDIS_GEO } from '../redis/redis.module';

@WebSocketGateway({
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  path: '/socket.io',
})
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private connectedCount = 0;

  constructor(
    @Inject(REDIS_PUBSUB) private readonly redisPub: Redis,
    @Inject(REDIS_GEO)    private readonly redisGeo: Redis,
  ) {}

  async afterInit(server: Server) {
    // Wait for pub connection to be ready before setting adapter
    await this.waitReady(this.redisPub);

    const subClient = this.redisPub.duplicate();
    await this.waitReady(subClient);

    server.adapter(createAdapter(this.redisPub, subClient));

    // Subscribe to SOS alerts and broadcast to admin room
    subClient.subscribe('channel:admin:sos', (err) => {
      if (err) this.logger.error('Failed to subscribe to SOS channel');
    });
    subClient.on('message', (channel: string, message: string) => {
      if (channel === 'channel:admin:sos') {
        server.to('admin:all').emit('sos:alert', JSON.parse(message));
      }
    });

    this.logger.log('WebSocket gateway initialized with Redis adapter');
  }

  private waitReady(client: Redis): Promise<void> {
    return new Promise((resolve) => {
      if (client.status === 'ready') return resolve();
      client.once('ready', resolve);
      // Timeout fallback — if Redis takes >10s, continue anyway
      setTimeout(resolve, 10000);
    });
  }

  handleConnection(client: Socket) {
    this.connectedCount++;
    const { workerId, jobId, role } = client.handshake.query as Record<string, string>;
    if (role === 'worker' && workerId) client.join(`worker:${workerId}`);
    else if (role === 'customer' && jobId) client.join(`job:${jobId}`);
    else if (role === 'admin') client.join('admin:all');
  }

  /**
   * Graceful disconnect handler:
   * - Close codes 1000 (normal) and 1001 (going away) are expected during test teardown
   * - Only log/error on truly abnormal disconnects (e.g., transport error, ping timeout)
   */
  handleDisconnect(client: Socket) {
    this.connectedCount--;
    const reason = client.handshake?.query?.disconnectReason || 'unknown';
    const closeCode = (client as any)._closeCode || 0;

    // Graceful close codes — no error logging
    if (closeCode === 1000 || closeCode === 1001 || reason === 'transport close') {
      return;
    }

    // Abnormal disconnect — log at debug level only (avoids flooding logs in benchmark)
    if (closeCode !== 1005 && closeCode !== 0) {
      this.logger.debug(`Abnormal disconnect: code=${closeCode}, reason=${reason}`);
    }
  }

  @SubscribeMessage('gps:update')
  async handleGpsUpdate(
    @MessageBody() data: { worker_id: number; lat: number; lon: number },
    @ConnectedSocket() client: Socket,
  ) {
    await this.redisGeo.geoadd('workers:geo:active', data.lon, data.lat, `worker:${data.worker_id}`);
    client.to(`tracking:worker:${data.worker_id}`).emit('worker:location', {
      worker_id: data.worker_id, lat: data.lat, lon: data.lon, ts: Date.now(),
    });
    return { ack: true, ts: Date.now() };
  }

  emitJobState(jobId: number, state: string, data: object = {}) {
    this.server.to(`job:${jobId}`).emit('job:state', { job_id: jobId, state, ...data });
  }

  pushJobToWorker(workerId: number, jobPayload: object) {
    this.server.to(`worker:${workerId}`).emit('job:push', jobPayload);
  }

  getConnectedCount() { return this.connectedCount; }
}