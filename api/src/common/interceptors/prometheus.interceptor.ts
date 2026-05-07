import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import * as client from 'prom-client';

const register = client.register;
register.setDefaultLabels({ app: 'ttv-api' });
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_ms',
  help: 'HTTP request duration in ms',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [5, 10, 25, 50, 100, 200, 300, 500, 1000, 2000, 5000],
  registers: [register],
});

const httpRequestTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
});

export { register };

@Injectable()
export class PrometheusInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest();
    const res = ctx.getResponse();
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          const route = req.route?.path || req.path || 'unknown';
          const labels = { method: req.method, route, status_code: String(res.statusCode) };
          httpRequestDuration.observe(labels, duration);
          httpRequestTotal.inc(labels);
        },
        error: (err) => {
          const duration = Date.now() - start;
          const route = req.route?.path || req.path || 'unknown';
          const status = err.status || 500;
          const labels = { method: req.method, route, status_code: String(status) };
          httpRequestDuration.observe(labels, duration);
          httpRequestTotal.inc(labels);
        },
      }),
    );
  }
}
