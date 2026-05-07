import { Injectable, Inject, ConflictException } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../../database/database.module';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';

@Injectable()
export class PaymentsService {
  constructor(@Inject(DATABASE_POOL) private readonly db: Pool) {}

  async handleWebhook(dto: PaymentWebhookDto) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      // Idempotency: unique constraint on (gateway, transaction_id) prevents double processing
      const ipnResult = await client.query(
        `INSERT INTO payment_ipn_log (gateway, transaction_id, payload)
         VALUES ($1, $2, $3)
         ON CONFLICT (gateway, transaction_id) DO NOTHING
         RETURNING id`,
        [dto.gateway, dto.transaction_id, JSON.stringify(dto)],
      );

      // If nothing inserted, this is a duplicate — return cached result
      if (ipnResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return { status: 'duplicate', idempotent: true };
      }

      // Double-entry ledger: only for SUCCESS payments
      if (dto.status === 'SUCCESS') {
        await client.query(
          `INSERT INTO ledger_entries (job_id, entry_type, account, amount, payment_state)
           VALUES
             ($1, 'debit',  'customer_wallet', $2, 'SETTLED'),
             ($1, 'credit', 'worker_wallet',   $2, 'SETTLED')`,
          [dto.job_id, dto.amount],
        );

        await client.query(
          `UPDATE jobs SET state = 'PAID', updated_at = NOW() WHERE id = $1`,
          [dto.job_id],
        );
      }

      await client.query('COMMIT');
      return { status: 'processed', transaction_id: dto.transaction_id };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
