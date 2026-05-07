import { IsString, Length } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  request_id: string;

  @IsString()
  @Length(6, 6)
  code: string;
}
