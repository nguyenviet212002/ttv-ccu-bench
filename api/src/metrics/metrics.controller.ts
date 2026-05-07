import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { register } from '../common/interceptors/prometheus.interceptor';

@Controller('metrics')
export class MetricsController {
  @Get()
  async metrics(@Res() res: Response) {
    res.set('Content-Type', register.contentType);
    res.send(await register.metrics());
  }
}
