import { Controller, Post, Body, HttpCode } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('webhook')
  @HttpCode(200)
  handleWebhook(@Body() dto: PaymentWebhookDto) {
    return this.paymentsService.handleWebhook(dto);
  }
}
