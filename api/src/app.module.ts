import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RedisModule } from './redis/redis.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { WorkersModule } from './modules/workers/workers.module';
import { SosModule } from './modules/sos/sos.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { HealthModule } from './modules/health/health.module';
import { EventsGateway } from './gateways/events.gateway';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { JwtAuthMiddleware } from './common/middleware/jwt-auth.middleware';
import { PrometheusInterceptor } from './common/interceptors/prometheus.interceptor';

@Module({
  imports: [
    RedisModule,
    DatabaseModule,
    AuthModule,
    JobsModule,
    WorkersModule,
    SosModule,
    PaymentsModule,
    HealthModule,
  ],
  providers: [
    EventsGateway,
    {
      provide: APP_INTERCEPTOR,
      useClass: PrometheusInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
    consumer
      .apply(JwtAuthMiddleware)
      .exclude(
        { path: '/api/v1/auth/(.*)', method: RequestMethod.ALL },
        { path: '/api/v1/health/(.*)', method: RequestMethod.ALL },
        { path: '/api/v1/jobs/calculate-price', method: RequestMethod.POST },
        { path: '/api/v1/payments/webhook', method: RequestMethod.POST },
        { path: '/api/v1/workers/nearby', method: RequestMethod.GET },
        { path: '/metrics', method: RequestMethod.GET },
      )
      .forRoutes('*');
  }
}
