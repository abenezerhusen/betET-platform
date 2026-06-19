/**
 * Loss-cashback rule editor — Section 25.
 *
 * Embedded inside the Bonus Engine "Settings" tab. The admin chooses
 * which rule set (Rule One or Rule Two) is currently active for the
 * tenant; both rule sets remain editable so they can be tuned without
 * losing their tier tables on a switchover.
 */
import { useMemo } from 'react';
import type {
  CashbackLossSlot,
  CashbackRuleConfig,
  CashbackTier,
  PerTicketCashbackConfig,
} from '../../lib/api/bonuses';

const DEFAULT_RULE_ONE: CashbackRuleConfig = {
  loss_one: {
    enabled: true,
    min_legs: 10,
    min_leg_odds: 1.25,
    min_stake: 0,
    max_cashback: 10000,
    tiers: [
      { min_odds: 40, max_odds: 60, pct: 100 },
      { min_odds: 61, max_odds: 90, pct: 200 },
      { min_odds: 91, max_odds: 150, pct: 350 },
      { min_odds: 151, max_odds: 200, pct: 600 },
      { min_odds: 201, max_odds: 450, pct: 800 },
      { min_odds: 451, max_odds: null, pct: 1000 },
    ],
  },
  loss_two: {
    enabled: true,
    min_legs: 15,
    min_leg_odds: 1.25,
    min_stake: 0,
    max_cashback: 10000,
    tiers: [
      { min_odds: 65, max_odds: 90, pct: 100 },
      { min_odds: 91, max_odds: 150, pct: 200 },
      { min_odds: 151, max_odds: 250, pct: 350 },
      { min_odds: 251, max_odds: 400, pct: 600 },
      { min_odds: 401, max_odds: 700, pct: 800 },
      { min_odds: 701, max_odds: null, pct: 1000 },
    ],
  },
};

const RULE_TWO_BASE_TIERS: CashbackTier[] = [
  { min_odds: 20, max_odds: 44, pct: 100 },
  { min_odds: 45, max_odds: 59, pct: 250 },
  { min_odds: 60, max_odds: 89, pct: 350 },
  { min_odds: 90, max_odds: 449, pct: 600 },
  { min_odds: 450, max_odds: 999, pct: 1200 },
  { min_odds: 1000, max_odds: 1799, pct: 2100 },
  { min_odds: 1800, max_odds: null, pct: 5000 },
];

const DEFAULT_RULE_TWO: CashbackRuleConfig = {
  loss_one: {
    enabled: true,
    min_legs: 5,
    min_leg_odds: 1.01,
    min_stake: 5,
    max_cashback: 100000,
    tiers: RULE_TWO_BASE_TIERS,
  },
  loss_two: {
    enabled: true,
    min_legs: 10,
    min_leg_odds: 1.01,
    min_stake: 5,
    max_cashback: 100000,
    tiers: RULE_TWO_BASE_TIERS,
  },
  loss_three: {
    enabled: true,
    min_legs: 10,
    min_leg_odds: 1.4,
    min_stake: 5,
    max_cashback: 100000,
    tiers: [
      { min_odds: 73, max_odds: 146, pct: 100 },
      { min_odds: 146, max_odds: 297, pct: 200 },
      { min_odds: 297, max_odds: 509, pct: 300 },
      { min_odds: 509, max_odds: 1153, pct: 400 },
      { min_odds: 1153, max_odds: 2411, pct: 500 },
      { min_odds: 2411, max_odds: null, pct: 1000 },
    ],
  },
};

export const DEFAULT_PER_TICKET_CASHBACK: PerTicketCashbackConfig = {
  enabled: true,
  active_rule: 'rule_one',
  payout_as: 'bonus',
  exclude_live: true,
  exclude_virtual: true,
  rule_one: DEFAULT_RULE_ONE,
  rule_two: DEFAULT_RULE_TWO,
};

type SlotKey = 'loss_one' | 'loss_two' | 'loss_three';

const SLOT_TITLES: Record<SlotKey, string> = {
  loss_one: 'Cashback for Losses on One Game',
  loss_two: 'Cashback for Losses on Two Games',
  loss_three: 'Cashback for Losses on Three Games',
};

interface Props {
  value: PerTicketCashbackConfig;
  onChange: (next: PerTicketCashbackConfig) => void;
}

export function LossCashbackEditor({ value, onChange }: Props) {
  const cfg = useMemo<PerTicketCashbackConfig>(() => {
    return {
      ...DEFAULT_PER_TICKET_CASHBACK,
      ...value,
      rule_one: { ...DEFAULT_RULE_ONE, ...(value.rule_one ?? {}) },
      rule_two: { ...DEFAULT_RULE_TWO, ...(value.rule_two ?? {}) },
    };
  }, [value]);

  const updateRule = (
    ruleKey: 'rule_one' | 'rule_two',
    patch: Partial<CashbackRuleConfig>
  ) => {
    onChange({ ...cfg, [ruleKey]: { ...cfg[ruleKey], ...patch } });
  };

  const updateSlot = (
    ruleKey: 'rule_one' | 'rule_two',
    slotKey: SlotKey,
    patch: Partial<CashbackLossSlot>
  ) => {
    const rule = cfg[ruleKey];
    const existing = rule[slotKey];
    if (!existing) return;
    const nextRule = { ...rule, [slotKey]: { ...existing, ...patch } };
    onChange({
      ...cfg,
      [ruleKey]: nextRule,
      active_rule: patch.enabled === true ? ruleKey : cfg.active_rule,
    });
  };

  const updateTier = (
    ruleKey: 'rule_one' | 'rule_two',
    slotKey: SlotKey,
    tierIdx: number,
    patch: Partial<CashbackTier>
  ) => {
    const rule = cfg[ruleKey];
    const slot = rule[slotKey];
    if (!slot) return;
    const tiers = slot.tiers.map((t, i) => (i === tierIdx ? { ...t, ...patch } : t));
    updateSlot(ruleKey, slotKey, { tiers });
  };

  const addTier = (
    ruleKey: 'rule_one' | 'rule_two',
    slotKey: SlotKey
  ) => {
    const rule = cfg[ruleKey];
    const slot = rule[slotKey];
    if (!slot) return;
    updateSlot(ruleKey, slotKey, {
      tiers: [...slot.tiers, { min_odds: 0, max_odds: null, pct: 100 }],
    });
  };

  const removeTier = (
    ruleKey: 'rule_one' | 'rule_two',
    slotKey: SlotKey,
    tierIdx: number
  ) => {
    const rule = cfg[ruleKey];
    const slot = rule[slotKey];
    if (!slot) return;
    updateSlot(ruleKey, slotKey, {
      tiers: slot.tiers.filter((_, i) => i !== tierIdx),
    });
  };

  const setRuleEnabled = (ruleKey: 'rule_one' | 'rule_two', enabled: boolean) => {
    const rule = cfg[ruleKey];
    const patch: Partial<CashbackRuleConfig> = {};
    (['loss_one', 'loss_two', 'loss_three'] as const).forEach((slotKey) => {
      const slot = rule[slotKey];
      if (!slot) return;
      patch[slotKey] = { ...slot, enabled };
    });
    updateRule(ruleKey, patch);
    if (enabled) {
      onChange({ ...cfg, active_rule: ruleKey, [ruleKey]: { ...cfg[ruleKey], ...patch } });
    }
  };

  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50/30 p-5 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            Loss Cashback — Per-Ticket Rules
          </h3>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">
            Triggered whenever a sportsbook accumulator settles as lost. The
            engine looks up the slot matching the number of losing legs (1, 2
            or 3) under the active rule, validates eligibility, then awards a
            percentage of the user's stake based on the effective accumulator
            odds (voided / cancelled legs are excluded from the odds product).
          </p>
        </div>
        <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => onChange({ ...cfg, enabled: e.target.checked })}
          />
          Engine enabled
        </label>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600">Active rule</label>
          <select
            value={cfg.active_rule}
            onChange={(e) =>
              onChange({
                ...cfg,
                active_rule: e.target.value as 'rule_one' | 'rule_two',
              })
            }
            className="mt-1 w-full rounded-md border-gray-300 text-sm"
          >
            <option value="rule_one">Rule One</option>
            <option value="rule_two">Rule Two</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600">Payout type</label>
          <select
            value={cfg.payout_as}
            onChange={(e) =>
              onChange({
                ...cfg,
                payout_as: e.target.value as 'bonus' | 'cash',
              })
            }
            className="mt-1 w-full rounded-md border-gray-300 text-sm"
          >
            <option value="bonus">Bonus credit (wagerable)</option>
            <option value="cash">Real cash</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 mt-5">
          <input
            type="checkbox"
            checked={cfg.exclude_live}
            onChange={(e) => onChange({ ...cfg, exclude_live: e.target.checked })}
          />
          Exclude live bets
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 mt-5">
          <input
            type="checkbox"
            checked={cfg.exclude_virtual}
            onChange={(e) => onChange({ ...cfg, exclude_virtual: e.target.checked })}
          />
          Exclude virtual games
        </label>
      </div>

      <RuleSection
        title="Rule One"
        subtitle="Narrow, high-odds insurance — caps at 10,000 ETB."
        active={cfg.active_rule === 'rule_one'}
        rule={cfg.rule_one}
        slots={['loss_one', 'loss_two']}
        onRuleToggle={(enabled) => setRuleEnabled('rule_one', enabled)}
        onSlotChange={(slotKey, patch) => updateSlot('rule_one', slotKey, patch)}
        onTierChange={(slotKey, idx, patch) =>
          updateTier('rule_one', slotKey, idx, patch)
        }
        onTierAdd={(slotKey) => addTier('rule_one', slotKey)}
        onTierRemove={(slotKey, idx) => removeTier('rule_one', slotKey, idx)}
      />

      <RuleSection
        title="Rule Two"
        subtitle="Looser thresholds, deeper ladder — caps at 100,000 ETB."
        active={cfg.active_rule === 'rule_two'}
        rule={cfg.rule_two}
        slots={['loss_one', 'loss_two', 'loss_three']}
        onRuleToggle={(enabled) => setRuleEnabled('rule_two', enabled)}
        onSlotChange={(slotKey, patch) => updateSlot('rule_two', slotKey, patch)}
        onTierChange={(slotKey, idx, patch) =>
          updateTier('rule_two', slotKey, idx, patch)
        }
        onTierAdd={(slotKey) => addTier('rule_two', slotKey)}
        onTierRemove={(slotKey, idx) => removeTier('rule_two', slotKey, idx)}
      />
    </div>
  );
}

interface RuleSectionProps {
  title: string;
  subtitle: string;
  active: boolean;
  rule: CashbackRuleConfig;
  slots: SlotKey[];
  onRuleToggle: (enabled: boolean) => void;
  onSlotChange: (slotKey: SlotKey, patch: Partial<CashbackLossSlot>) => void;
  onTierChange: (
    slotKey: SlotKey,
    idx: number,
    patch: Partial<CashbackTier>
  ) => void;
  onTierAdd: (slotKey: SlotKey) => void;
  onTierRemove: (slotKey: SlotKey, idx: number) => void;
}

function RuleSection({
  title,
  subtitle,
  active,
  rule,
  slots,
  onRuleToggle,
  onSlotChange,
  onTierChange,
  onTierAdd,
  onTierRemove,
}: RuleSectionProps) {
  const ruleEnabled = slots.some((slotKey) => Boolean(rule[slotKey]?.enabled));
  return (
    <section
      className={
        'rounded-lg border bg-white p-4 ' +
        (active ? 'border-purple-400 ring-1 ring-purple-300' : 'border-gray-200')
      }
    >
      <header className="flex items-center justify-between mb-3">
        <div>
          <h4 className="text-sm font-semibold text-gray-900">
            {title}
            {active && (
              <span className="ml-2 inline-flex items-center rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                Active
              </span>
            )}
          </h4>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-700">
          <input
            type="checkbox"
            checked={ruleEnabled}
            onChange={(e) => onRuleToggle(e.target.checked)}
          />
          Rule enabled
        </label>
      </header>

      <div className="space-y-4">
        {slots.map((slotKey) => {
          const slot = rule[slotKey];
          if (!slot) return null;
          return (
            <SlotBlock
              key={slotKey}
              slotKey={slotKey}
              slot={slot}
              onSlotChange={(patch) => onSlotChange(slotKey, patch)}
              onTierChange={(idx, patch) => onTierChange(slotKey, idx, patch)}
              onTierAdd={() => onTierAdd(slotKey)}
              onTierRemove={(idx) => onTierRemove(slotKey, idx)}
            />
          );
        })}
      </div>
    </section>
  );
}

interface SlotBlockProps {
  slotKey: SlotKey;
  slot: CashbackLossSlot;
  onSlotChange: (patch: Partial<CashbackLossSlot>) => void;
  onTierChange: (idx: number, patch: Partial<CashbackTier>) => void;
  onTierAdd: () => void;
  onTierRemove: (idx: number) => void;
}

function SlotBlock({
  slotKey,
  slot,
  onSlotChange,
  onTierChange,
  onTierAdd,
  onTierRemove,
}: SlotBlockProps) {
  return (
    <div className="rounded-md border border-gray-200 p-3 bg-gray-50/50">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={slot.enabled}
            onChange={(e) => onSlotChange({ enabled: e.target.checked })}
          />
          <span className="text-sm font-medium text-gray-800">
            {SLOT_TITLES[slotKey]}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        <NumField
          label="Min selections"
          value={slot.min_legs}
          step={1}
          onChange={(n) => onSlotChange({ min_legs: Math.max(0, Math.round(n)) })}
        />
        <NumField
          label="Min odds / leg"
          value={slot.min_leg_odds}
          step={0.01}
          onChange={(n) => onSlotChange({ min_leg_odds: n })}
        />
        <NumField
          label="Min stake (ETB)"
          value={slot.min_stake}
          step={1}
          onChange={(n) => onSlotChange({ min_stake: Math.max(0, n) })}
        />
        <NumField
          label="Max cashback (ETB)"
          value={slot.max_cashback}
          step={100}
          onChange={(n) => onSlotChange({ max_cashback: Math.max(0, n) })}
        />
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-1 pr-2 font-medium">Min total odds</th>
              <th className="py-1 pr-2 font-medium">Max total odds</th>
              <th className="py-1 pr-2 font-medium">Cashback %</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {slot.tiers.map((tier, idx) => (
              <tr key={idx} className="border-t border-gray-100">
                <td className="py-1 pr-2">
                  <input
                    type="number"
                    step={0.01}
                    value={tier.min_odds}
                    onChange={(e) =>
                      onTierChange(idx, { min_odds: Number(e.target.value) })
                    }
                    className="w-24 rounded border-gray-300 text-xs"
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    type="number"
                    step={0.01}
                    value={tier.max_odds ?? ''}
                    placeholder="∞"
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      onTierChange(idx, {
                        max_odds: v === '' ? null : Number(v),
                      });
                    }}
                    className="w-24 rounded border-gray-300 text-xs"
                  />
                </td>
                <td className="py-1 pr-2">
                  <input
                    type="number"
                    step={1}
                    value={tier.pct}
                    onChange={(e) =>
                      onTierChange(idx, { pct: Number(e.target.value) })
                    }
                    className="w-24 rounded border-gray-300 text-xs"
                  />
                </td>
                <td className="py-1">
                  <button
                    type="button"
                    onClick={() => onTierRemove(idx)}
                    className="text-xs text-red-600 hover:text-red-700"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-2">
        <button
          type="button"
          onClick={onTierAdd}
          className="text-xs text-purple-700 hover:text-purple-800"
        >
          + Add tier
        </button>
      </div>
    </div>
  );
}

interface NumFieldProps {
  label: string;
  value: number;
  step?: number;
  onChange: (n: number) => void;
}

function NumField({ label, value, step = 1, onChange }: NumFieldProps) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600">{label}</label>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-md border-gray-300 text-sm"
      />
    </div>
  );
}
