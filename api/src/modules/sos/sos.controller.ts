import { Controller, Post, Body, Req } from '@nestjs/common';
import { Request } from 'express';
import { SosService } from './sos.service';
import { TriggerSosDto } from './dto/trigger-sos.dto';

@Controller('sos')
export class SosController {
  constructor(private readonly sosService: SosService) {}

  @Post('trigger')
  trigger(@Body() dto: TriggerSosDto, @Req() req: Request) {
    const user = (req as any).user;
    return this.sosService.trigger(user?.sub || 1, dto);
  }
}
