import { IsNumber, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateJobDto {
  @Type(() => Number)
  @IsNumber()
  pickup_lat: number;

  @Type(() => Number)
  @IsNumber()
  pickup_lon: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  weight_kg: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  floors: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10000)
  carry_distance_m: number;
}
