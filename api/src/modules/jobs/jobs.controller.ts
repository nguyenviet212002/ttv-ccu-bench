import { Controller, Post, Body, Param, ParseIntPipe, Req, HttpCode } from '@nestjs/common';
import { Request } from 'express';
import { JobsService } from './jobs.service';
import { CalculatePriceDto } from './dto/calculate-price.dto';
import { CreateJobDto } from './dto/create-job.dto';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post('calculate-price')
  @HttpCode(200)
  calculatePrice(@Body() dto: CalculatePriceDto) {
    return this.jobsService.calculatePrice(dto);
  }

  @Post()
  createJob(@Body() dto: CreateJobDto, @Req() req: Request) {
    const user = (req as any).user;
    return this.jobsService.createJob(user?.sub || 1, dto);
  }

  @Post(':id/accept')
  @HttpCode(200)
  acceptJob(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    const user = (req as any).user;
    return this.jobsService.acceptJob(id, user?.sub || 1);
  }
}
