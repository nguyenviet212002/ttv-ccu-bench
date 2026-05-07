import { IsString, Matches } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @Matches(/^\+84\d{9}$/, { message: 'Invalid Vietnamese phone number' })
  phone: string;
}
