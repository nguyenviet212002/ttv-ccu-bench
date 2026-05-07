import { Controller, Post, Get, Body, Query, Req, ParseFloatPipe } from '@nestjs/common';
import { Request } from 'express';
import { WorkersService } from './workers.service';
import { UpdateGpsDto } from './dto/update-gps.dto';

@Controller('workers')
export class WorkersController {
  constructor(private readonly workersService: WorkersService) {}

  @Post('me/gps')
  updateGps(@Body() dto: UpdateGpsDto, @Req() req: Request) {
    const user = (req as any).user;
    return this.workersService.updateGps(user?.sub || 1, dto);
  }

  @Get('nearby')
  getNearby(
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lon', ParseFloatPipe) lon: number,
  ) {
    return this.workersService.getNearby(lat, lon);
  }
}
