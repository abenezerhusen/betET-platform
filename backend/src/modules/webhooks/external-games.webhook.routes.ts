/**
 * Section 15 — External game provider webhook receiver.
 *
 *   POST /hooks/:provider
 *
 * Authentication: HMAC-SHA256 signature in `X-Signature` (or `X-Hash`)
 * computed over the raw request body using the provider's stored secret.
 * The raw body is captured by app.ts's express.json verify callback so we
 * can reproduce the exact bytes the provider signed.
 *
 * Supported event types (the spec's standard casino webhook protocol):
 *   - balance   → return player's current balance + currency
 *   - debit     → player placed a bet; deduct from balance
 *   - credit    → player won;    add to balance + push socket notification
 *   - rollback  → undo a previous transaction (idempotent)
 */
import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { openSecret } from '../../infrastructure/crypto/secret-cipher';
import { logger } from '../../infrastructure/logger';
import { emitToUser } from '../../realtime/socket';
import { tryAudit } from '../audit/audit.service';

const router = Router();

function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function rawBody(req: Request): Buffer {
  return (req as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
}

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await fn(req, res);
      if (out !== undefined) res.json(out);
    } catch (err) {
      next(err);
    }
  };

router.post(
  '/:provider',
  wrap(async (req, res) => {
    const providerSlug = String(req.params.provider).toLowerCase();

    return withTenantClient({ tenantId: null, bypassRls: true }, async (client) => {
      const pq = await client.query<{
        id: string;
        tenant_id: string;
        name: string;
        slug: string;
        encrypted_secret: string | null;
        sandbox: boolean;
      }>(
        `SELECT id, tenant_id, name, slug, encrypted_secret, sandbox
           FROM external_game_providers
          WHERE LOWER(slug) = $1
             OR LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g')) = $1
          LIMIT 1`,
        [providerSlug]
      );
      const provider = pq.rows[0];
      if (!provider) {
        res.status(404).json({ message: 'Unknown provider' });
        return;
      }

      const secret = provider.encrypted_secret ? openSecret(provider.encrypted_secret) : '';
      const signature =
        (req.headers['x-signature'] as string | undefined) ||
        (req.headers['x-hash'] as string | undefined);

      if (!provider.sandbox || secret) {
        // In production OR whenever a secret is on file, signature is required.
        const expected = crypto
          .createHmac('sha256', secret)
          .update(rawBody(req))
          .digest('hex');
        if (!signature || !safeEqualHex(signature, expected)) {
          logger.warn(
            { provider: provider.slug, hasSignature: Boolean(signature) },
            'External webhook rejected: invalid signature'
          );
          res.status(401).json({ message: 'Invalid signature' });
          return;
        }
      }

      const tenantId = provider.tenant_id;
      const body = req.body as {
        type?: string;
        player_id?: string;
        amount?: number | string;
        transaction_id?: string;
        game_id?: string;
        session_token?: string;
      };

      const type = String(body.type ?? '').toLowerCase();
      const playerId = String(body.player_id ?? '');
      const amount = Number(body.amount ?? 0);
      const transactionId = String(body.transaction_id ?? `${provider.slug}-${Date.now()}`);
      const gameId = String(body.game_id ?? '');

      const player = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE id = $1`,
        [playerId]
      );
      if (!player.rows[0]) {
        res.status(404).json({ message: 'Player not found' });
        return;
      }

      switch (type) {
        case 'balance': {
          const w = await client.query<{ balance: string; currency: string }>(
            `SELECT balance::text, currency FROM wallets
              WHERE user_id = $1 AND currency = 'ETB' LIMIT 1`,
            [playerId]
          );
          const row = w.rows[0];
          return {
            balance: row ? Number(row.balance) : 0,
            currency: row?.currency ?? 'ETB',
          };
        }

        case 'debit': {
          if (!Number.isFinite(amount) || amount <= 0) {
            res.status(400).json({ message: 'Invalid amount' });
            return;
          }
          const w = await client.query<{ id: string; balance: string }>(
            `SELECT id, balance::text FROM wallets
              WHERE user_id = $1 AND currency = 'ETB' FOR UPDATE`,
            [playerId]
          );
          const wallet = w.rows[0];
          if (!wallet) {
            res.status(404).json({ message: 'Wallet not found' });
            return;
          }
          const before = Number(wallet.balance);
          if (before < amount) {
            res.status(400).json({ message: 'Insufficient balance' });
            return;
          }
          const after = before - amount;
          await client.query(
            `UPDATE wallets SET balance = $2::numeric, version = version + 1, updated_at = now() WHERE id = $1`,
            [wallet.id, after]
          );
          await client.query(
            `INSERT INTO transactions
               (tenant_id, wallet_id, user_id, type, amount, before_balance,
                after_balance, currency, reference, status, metadata)
             VALUES ($1,$2,$3,'external_game_bet',$4::numeric,$5::numeric,$6::numeric,'ETB',$7,'completed',$8::jsonb)
             ON CONFLICT DO NOTHING`,
            [
              tenantId,
              wallet.id,
              playerId,
              -amount,
              before,
              after,
              transactionId,
              JSON.stringify({ provider: provider.name, game_id: gameId }),
            ]
          );
          void tryAudit(
            {
              tenantId,
              actorId: playerId,
              actorType: 'system',
              action: 'external_game.debit',
              resource: 'transactions',
              resourceId: transactionId,
              payload: { provider: provider.name, game_id: gameId, amount },
              ip: req.ip ?? null,
              userAgent: req.header('user-agent') ?? null,
              status: 'success',
            },
            { bypassRls: true }
          );
          return { balance: after, currency: 'ETB', transaction_id: transactionId };
        }

        case 'credit': {
          if (!Number.isFinite(amount) || amount <= 0) {
            res.status(400).json({ message: 'Invalid amount' });
            return;
          }
          const w = await client.query<{ id: string; balance: string }>(
            `SELECT id, balance::text FROM wallets
              WHERE user_id = $1 AND currency = 'ETB' FOR UPDATE`,
            [playerId]
          );
          if (!w.rows[0]) {
            res.status(404).json({ message: 'Wallet not found' });
            return;
          }
          const before = Number(w.rows[0].balance);
          const after = before + amount;
          await client.query(
            `UPDATE wallets SET balance = $2::numeric, version = version + 1, updated_at = now() WHERE id = $1`,
            [w.rows[0].id, after]
          );
          await client.query(
            `INSERT INTO transactions
               (tenant_id, wallet_id, user_id, type, amount, before_balance,
                after_balance, currency, reference, status, metadata)
             VALUES ($1,$2,$3,'external_game_win',$4::numeric,$5::numeric,$6::numeric,'ETB',$7,'completed',$8::jsonb)
             ON CONFLICT DO NOTHING`,
            [
              tenantId,
              w.rows[0].id,
              playerId,
              amount,
              before,
              after,
              transactionId,
              JSON.stringify({ provider: provider.name, game_id: gameId }),
            ]
          );
          emitToUser(tenantId, playerId, 'notification', {
            type: 'game_win',
            title: 'You won!',
            message: `ETB ${amount.toFixed(2)} from ${provider.name} - ${gameId}`,
            balance: after,
          });
          void tryAudit(
            {
              tenantId,
              actorId: playerId,
              actorType: 'system',
              action: 'external_game.credit',
              resource: 'transactions',
              resourceId: transactionId,
              payload: { provider: provider.name, game_id: gameId, amount },
              ip: req.ip ?? null,
              userAgent: req.header('user-agent') ?? null,
              status: 'success',
            },
            { bypassRls: true }
          );
          return { balance: after, currency: 'ETB', transaction_id: transactionId };
        }

        case 'rollback': {
          const tx = await client.query<{
            id: string;
            wallet_id: string;
            user_id: string;
            type: string;
            amount: string;
            status: string;
          }>(
            `SELECT id, wallet_id, user_id, type, amount::text, status
               FROM transactions WHERE reference = $1 LIMIT 1`,
            [transactionId]
          );
          if (!tx.rows[0] || tx.rows[0].status === 'rolled_back') {
            return { ok: true, idempotent: true };
          }
          const originalAmount = Number(tx.rows[0].amount);
          const w = await client.query<{ id: string; balance: string }>(
            `SELECT id, balance::text FROM wallets WHERE id = $1 FOR UPDATE`,
            [tx.rows[0].wallet_id]
          );
          if (!w.rows[0]) {
            res.status(404).json({ message: 'Wallet not found' });
            return;
          }
          const before = Number(w.rows[0].balance);
          const reverse = -originalAmount;
          const after = before + reverse;
          await client.query(
            `UPDATE wallets SET balance = $2::numeric, version = version + 1, updated_at = now() WHERE id = $1`,
            [w.rows[0].id, after]
          );
          await client.query(
            `UPDATE transactions SET status = 'rolled_back', updated_at = now() WHERE id = $1`,
            [tx.rows[0].id]
          );
          void tryAudit(
            {
              tenantId,
              actorId: playerId,
              actorType: 'system',
              action: 'external_game.rollback',
              resource: 'transactions',
              resourceId: transactionId,
              payload: { provider: provider.name, original: originalAmount },
              ip: req.ip ?? null,
              userAgent: req.header('user-agent') ?? null,
              status: 'success',
            },
            { bypassRls: true }
          );
          return { balance: after, currency: 'ETB' };
        }

        default:
          res.status(400).json({ message: `Unknown event type: ${type}` });
          return;
      }
    });
  })
);

export default router;
