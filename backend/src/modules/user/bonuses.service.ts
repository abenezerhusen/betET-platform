import type { Request } from 'express';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  NotFoundError,
} from '../../http/errors/http-error';
import { tryAudit } from '../audit/audit.service';
import { Events, emitToUser, emitWalletUpdated } from '../../realtime/socket';
import { getIp, getUa, getUserScope } from './user-shared';
import * as repo from './user.repository';
import type { ClaimBonusInput, ListBonusesQuery } from './user.dto';

interface BonusEligibility {
  eligible: boolean;
  reason?: string;
}

/**
 * Lightweight eligibility evaluation. The full bonus engine likely lives
 * elsewhere; here we only enforce the minimum invariants needed for a
 * self-service claim:
 *  - rule must be active and within validity window
 *  - user must not already hold an active assignment of the same rule
 *
 * Type-specific gating (e.g. deposit-match needs a recent deposit) can be
 * layered on without changing this contract.
 */
async function evaluateEligibility(
  client: import('pg').PoolClient,
  tenantId: string,
  userId: string,
  rule: repo.BonusRuleRow
): Promise<BonusEligibility> {
  if (!rule.is_active || rule.status !== 'active') {
    return { eligible: false, reason: 'rule_inactive' };
  }
  const now = new Date();
  if (rule.valid_from && now < new Date(rule.valid_from)) {
    return { eligible: false, reason: 'not_yet_valid' };
  }
  if (rule.valid_to && now >= new Date(rule.valid_to)) {
    return { eligible: false, reason: 'expired' };
  }
  const existing = await repo.findExistingAssignment(
    client,
    tenantId,
    rule.id,
    userId
  );
  if (existing) {
    return { eligible: false, reason: 'already_claimed' };
  }
  return { eligible: true };
}

interface RuleConfig {
  amount?: number;
  wagering_multiplier?: number;
  expires_in_days?: number;
}

function computeAward(rule: repo.BonusRuleRow): {
  awardedAmount: string;
  wageringRequired: string;
  expiresAt: Date | null;
} {
  const cfg = (rule.config ?? {}) as RuleConfig;
  const amount = typeof cfg.amount === 'number' ? cfg.amount : 0;
  const multiplier = typeof cfg.wagering_multiplier === 'number' ? cfg.wagering_multiplier : 0;
  const wagering = amount * multiplier;
  const expiresAt =
    typeof cfg.expires_in_days === 'number'
      ? new Date(Date.now() + cfg.expires_in_days * 24 * 60 * 60 * 1000)
      : null;
  return {
    awardedAmount: amount.toFixed(4),
    wageringRequired: wagering.toFixed(4),
    expiresAt,
  };
}

export async function listBonuses(req: Request, query: ListBonusesQuery) {
  const scope = getUserScope(req);

  const data = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      const rules = await repo.listAvailableBonusRules(client, scope.tenantId);
      const assignments = await repo.listUserBonusAssignments(
        client,
        scope.tenantId,
        scope.userId
      );
      const claimedRuleIds = new Set(
        assignments
          .filter((a) => a.status === 'active' || a.status === 'completed')
          .map((a) => a.bonus_rule_id)
      );

      const available = rules
        .filter((r) => !claimedRuleIds.has(r.id))
        .map((r) => ({
          ...r,
          eligible_to_claim: true,
        }));

      const active = assignments.filter((a) => a.status === 'active');

      return { rules, available, active, assignments };
    }
  );

  if (query.status === 'available') {
    return { items: data.available };
  }
  if (query.status === 'active') {
    return { items: data.active };
  }
  return {
    available: data.available,
    active: data.active,
    history: data.assignments.filter((a) => a.status !== 'active'),
  };
}

export async function claimBonus(
  req: Request,
  ruleId: string,
  body: ClaimBonusInput
) {
  const scope = getUserScope(req);

  const result = await withTenantClient(
    { tenantId: scope.tenantId },
    async (client) => {
      const rule = await repo.findBonusRuleById(client, scope.tenantId, ruleId);
      if (!rule) throw new NotFoundError('Bonus rule not found');

      const eligibility = await evaluateEligibility(
        client,
        scope.tenantId,
        scope.userId,
        rule
      );
      if (!eligibility.eligible) {
        throw new BadRequestError('You are not eligible to claim this bonus', {
          reason: eligibility.reason,
        });
      }

      const award = computeAward(rule);

      const assignment = await repo.insertBonusAssignment(client, {
        tenantId: scope.tenantId,
        bonusRuleId: rule.id,
        userId: scope.userId,
        awardedBy: null, // self-claim
        awardedAmount: award.awardedAmount,
        wageringRequired: award.wageringRequired,
        expiresAt: award.expiresAt,
        metadata: {
          claimed_via: 'user_panel',
          rule_type: rule.type,
          ...(body.metadata ?? {}),
        },
      });

      // For instant-credit bonus types, push the awarded amount into the
      // user's bonus_balance immediately and append a ledger entry. Other
      // types (e.g. cashback computed nightly) leave crediting to the
      // bonus engine worker.
      let walletAfter: repo.WalletRow | null = null;
      let tx: repo.TransactionRow | null = null;
      const INSTANT_CREDIT_TYPES = new Set(['signup', 'free_bet', 'loyalty']);
      const amountNum = Number(award.awardedAmount);
      if (INSTANT_CREDIT_TYPES.has(rule.type) && amountNum > 0) {
        const currency = await repo.getDefaultCurrency(client, scope.tenantId);
        const before = await repo.ensureWalletForUpdate(
          client,
          scope.tenantId,
          scope.userId,
          currency
        );
        walletAfter = await repo.creditBonusBalance(
          client,
          before.id,
          award.awardedAmount
        );
        tx = await repo.insertTransaction(client, {
          tenantId: scope.tenantId,
          walletId: before.id,
          userId: scope.userId,
          type: 'bonus_credit',
          amount: award.awardedAmount,
          beforeBalance: before.bonus_balance,
          afterBalance: walletAfter.bonus_balance,
          currency: before.currency,
          reference: `bonus:${assignment.id}`,
          status: 'completed',
          metadata: {
            bonus_rule_id: rule.id,
            bonus_assignment_id: assignment.id,
            wagering_required: award.wageringRequired,
          },
        });
      }

      return { rule, assignment, wallet: walletAfter, transaction: tx };
    }
  );

  await tryAudit({
    tenantId: scope.tenantId,
    actorId: scope.userId,
    actorType: 'user',
    action: 'user.bonus.claim',
    resource: 'bonus_assignment',
    resourceId: result.assignment.id,
    payload: {
      bonus_rule_id: result.rule.id,
      bonus_type: result.rule.type,
      awarded_amount: result.assignment.awarded_amount,
      wagering_required: result.assignment.wagering_required,
      expires_at: result.assignment.expires_at,
      transaction_id: result.transaction?.id ?? null,
    },
    ip: getIp(req),
    userAgent: getUa(req),
    status: 'success',
  });

  if (result.wallet) {
    emitWalletUpdated(scope.tenantId, scope.userId, {
      reason: 'bonus_claimed',
      wallet: result.wallet,
      bonus_assignment_id: result.assignment.id,
    });
  }
  emitToUser(scope.tenantId, scope.userId, Events.BONUS_CLAIMED, {
    assignment: result.assignment,
    rule_id: result.rule.id,
  });

  return {
    rule: {
      id: result.rule.id,
      name: result.rule.name,
      type: result.rule.type,
    },
    assignment: result.assignment,
    instantly_credited: Boolean(result.transaction),
    wallet: result.wallet,
  };
}
