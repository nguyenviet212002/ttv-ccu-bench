import { IsString, IsOptional, IsInt, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class TriggerSosDto {
  @IsString()
  @IsIn(['INJURY', 'THEFT', 'HARASSMENT', 'DISPUTE', 'OTHER'])
  category: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  job_id?: number;
}
