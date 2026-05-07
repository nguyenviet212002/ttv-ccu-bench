import { Module } from '@nestjs/common';
import { SosController } from './sos.controller';
import { SosService } from './sos.service';

@Module({
  controllers: [SosController],
  providers: [SosService],
})
export class SosModule {}
