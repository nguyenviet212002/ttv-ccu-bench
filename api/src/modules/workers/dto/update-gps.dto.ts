import { IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateGpsDto {
  @Type(() => Number)
  @IsNumber()
  @Min(20.0)
  @Max(22.0)
  lat: number;

  @Type(() => Number)
  @IsNumber()
  @Min(104.0)
  @Max(107.0)
  lon: number;
}
