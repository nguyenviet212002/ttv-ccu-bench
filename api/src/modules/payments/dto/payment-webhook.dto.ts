import { IsString, IsInt, IsIn, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class PaymentWebhookDto {
  @IsString()
  @IsIn(['vnpay', 'momo', 'zalopay'])
  gateway: string;

  @IsString()
  transaction_id: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  job_id: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  amount: number;

  @IsString()
  @IsIn(['SUCCESS', 'FAILED', 'PENDING'])
  status: string;
}
