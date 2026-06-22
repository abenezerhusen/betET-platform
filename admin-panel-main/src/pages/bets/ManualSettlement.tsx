/**
 * Manual Settlement Page — /bets/settlement
 *
 * Accessible only to Admin and Super Admin.
 * Shows unsettled tickets and tickets with settlement errors.
 * Provides full action set: Settle, Void, Force Win/Lose,
 * Refund, Reopen, Resettle, Manual Review, Extend Wait.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Eye,
  Zap,
  Ban,
  Undo,
  RotateCcw,
  Flag,
  Timer,
  Trophy,
  Skull,
  DollarSign,
  Search,
  Filter,
  Activity,
  FileText,
} from 'lucide-react';
import * as settlementApi from '../../lib/api/settlement';
import type {
  SettlementTicket,
  SettlementTicketDetail,
  SettlementLeg,
  AuditLogEntry,
} from '../../lib/api/settlement';
import { toast as showToast } from '../../lib/toast';
import { useAuthStore } from '../../store/auth';

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending:             { label: 'Pending',            color: 'text-yellow-400', bg: 'bg-yellow-900/30 border-yellow-600/40' },
  live:                { label: 'Live',               color: 'text-blue-400',   bg: 'bg-blue-900/30 border-blue-600/40' },
  won:                 { label: 'Won',                color: 'text-green-400',  bg: 'bg-green-900/30 border-green-600/40' },
  lost:                { label: 'Lost',               color: 'text-red-400',    bg: 'bg-red-900/30 border-red-600/40' },
  postponed:           { label: 'Postponed',          color: 'text-orange-400', bg: 'bg-orange-900/30 border-orange-600/40' },
  awaiting_settlement: { label: 'Awaiting',           color: 'text-purple-400', bg: 'bg-purple-900/30 border-purple-600/40' },
  partially_voided:    { label: 'Partially Voided',   color: 'text-amber-400',  bg: 'bg-amber-900/30 border-amber-600/40' },
  fully_voided:        { label: 'Fully Voided',       color: 'text-gray-400',   bg: 'bg-gray-800/60 border-gray-600/40' },
  refunded:            { label: 'Refunded',           color: 'text-cyan-400',   bg: 'bg-cyan-900/30 border-cyan-600/40' },
  cancelled:           { label: 'Cancelled',          color: 'text-gray-400',   bg: 'bg-gray-800/60 border-gray-600/40' },
  manual_review:       { label: 'Manual Review',      color: 'text-rose-400',   bg: 'bg-rose-900/30 border-rose-600/40' },
  settled:             { label: 'Settled',            color: 'text-green-400',  bg: 'bg-green-900/30 border-green-600/40' },
  error:               { label: 'Error',              color: 'text-red-400',    bg: 'bg-red-900/30 border-red-600/40' },
};

function StatusBadge({ status }: { status: string | null }) {
  const key = (status ?? 'pending').toLowerCase().replace(/ /g, '_');
  const cfg = STATUS_CONFIG[key] ?? { label: status ?? 'Unknown', color: 'text-gray-400', bg: 'bg-gray-800 border-gray-600/40' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${cfg.bg} ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function fmt(n: string | null | undefined, decimals = 2): string {
  if (!n) return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return n ?? '—';
  return num.toFixed(decimals);
}

function relTime(dateStr: string | null): string {
  if (!dateStr) return '—';
  const ms = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ------------------------------------------------------------------ */
/* Reason Modal                                                         */
/* ------------------------------------------------------------------ */

interface ReasonModalProps {
  title: string;
  placeholder?: string;
  requireReason?: boolean;
  extraField?: React.ReactNode;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

function ReasonModal({ title, placeholder, requireReason = true, extraField, onConfirm, onClose }: ReasonModalProps) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
        <h3 className="text-white font-semibold text-lg mb-4">{title}</h3>
        <textarea
          className="w-full bg-gray-800 border border-gray-600 rounded-lg p-3 text-white text-sm resize-none h-24 focus:outline-none focus:border-blue-500"
          placeholder={placeholder ?? 'Enter reason...'}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {extraField}
        <div className="flex gap-3 mt-4 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={requireReason && !reason.trim()}
            onClick={() => { if (!requireReason || reason.trim()) onConfirm(reason.trim()); }}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Force Win Modal                                                       */
/* ------------------------------------------------------------------ */

function ForceWinModal({ onConfirm, onClose }: { onConfirm: (payout: number, reason: string) => void; onClose: () => void }) {
  const [payout, setPayout] = useState('');
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-md shadow-2xl">
        <h3 className="text-white font-semibold text-lg mb-4 flex items-center gap-2">
          <Trophy size={18} className="text-yellow-400" /> Force Win
        </h3>
        <div className="mb-3">
          <label className="text-gray-400 text-xs mb-1 block">Payout Amount (ETB)</label>
          <input
            type="number"
            min="0"
            step="0.01"
            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-green-500"
            placeholder="0.00"
            value={payout}
            onChange={(e) => setPayout(e.target.value)}
          />
        </div>
        <div className="mb-4">
          <label className="text-gray-400 text-xs mb-1 block">Reason</label>
          <textarea
            className="w-full bg-gray-800 border border-gray-600 rounded-lg p-3 text-white text-sm resize-none h-20 focus:outline-none focus:border-green-500"
            placeholder="Reason for force win..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors">Cancel</button>
          <button
            disabled={!payout || Number(payout) <= 0 || !reason.trim()}
            onClick={() => onConfirm(Number(payout), reason.trim())}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Force Win
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Extend Wait Modal                                                     */
/* ------------------------------------------------------------------ */

function ExtendWaitModal({ onConfirm, onClose }: { onConfirm: (hours: number) => void; onClose: () => void }) {
  const [hours, setHours] = useState('48');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-sm shadow-2xl">
        <h3 className="text-white font-semibold text-lg mb-4 flex items-center gap-2">
          <Timer size={18} className="text-orange-400" /> Extend Waiting Period
        </h3>
        <div className="flex gap-3 mb-4">
          {[24, 48, 72, 96, 168].map((h) => (
            <button
              key={h}
              onClick={() => setHours(String(h))}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                hours === String(h)
                  ? 'bg-orange-600 border-orange-500 text-white'
                  : 'bg-gray-800 border-gray-600 text-gray-300 hover:border-gray-500'
              }`}
            >
              {h}h
            </button>
          ))}
        </div>
        <input
          type="number"
          min="1"
          max="168"
          className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm mb-4 focus:outline-none focus:border-orange-500"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        />
        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-colors">Cancel</button>
          <button
            disabled={!hours || Number(hours) < 1}
            onClick={() => onConfirm(Number(hours))}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Extend
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ticket Detail Drawer                                                  */
/* ------------------------------------------------------------------ */

function LegRow({ leg, betId, onVoid, canAct }: {
  leg: SettlementLeg;
  betId: string;
  onVoid: (legId: string) => void;
  canAct: boolean;
}) {
  const isVoided = leg.status === 'void' || leg.selection_status === 'voided';
  const isPostponed = leg.selection_status === 'postponed';
  return (
    <tr className={`border-b border-gray-700/50 text-sm ${isVoided ? 'opacity-50' : ''}`}>
      <td className="py-2 px-3 text-gray-200">
        <div className="font-medium">{leg.home_team} vs {leg.away_team}</div>
        <div className="text-xs text-gray-500">{leg.league} · {leg.market_label}</div>
      </td>
      <td className="py-2 px-3 text-gray-300">{leg.selection_label}</td>
      <td className="py-2 px-3 text-right">
        <div className="text-yellow-300 font-mono text-xs">{fmt(leg.odds_at_placement)}</div>
        {leg.settled_odds && leg.settled_odds !== leg.odds_at_placement && (
          <div className="text-gray-400 font-mono text-xs line-through">{fmt(leg.settled_odds)}</div>
        )}
      </td>
      <td className="py-2 px-3">
        <StatusBadge status={leg.selection_status ?? leg.status} />
        {leg.void_reason && <div className="text-xs text-gray-500 mt-0.5">{leg.void_reason}</div>}
      </td>
      <td className="py-2 px-3">
        <StatusBadge status={leg.event_status} />
      </td>
      <td className="py-2 px-3 text-right">
        {canAct && !isVoided && (
          <button
            onClick={() => onVoid(leg.id)}
            className="text-xs px-2 py-1 bg-red-900/40 hover:bg-red-800/60 border border-red-700/50 text-red-400 rounded transition-colors"
          >
            Void
          </button>
        )}
      </td>
    </tr>
  );
}

function TicketDetailDrawer({
  ticket,
  onClose,
  onAction,
}: {
  ticket: SettlementTicketDetail;
  onClose: () => void;
  onAction: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'legs' | 'audit'>('legs');
  const [modal, setModal] = useState<string | null>(null);
  const [voidLegId, setVoidLegId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      showToast(msg, 'success');
      onAction();
      setModal(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(message, 'error');
    } finally {
      setBusy(false);
    }
  }, [onAction]);

  const handleVoidLeg = (legId: string) => {
    setVoidLegId(legId);
    setModal('void_selection');
  };

  const canAct = !['won', 'lost', 'fully_voided', 'refunded', 'cancelled'].includes(
    ticket.settlement_status ?? ticket.status
  );

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-3xl bg-gray-900 border-l border-gray-700 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 bg-gray-900/80 backdrop-blur">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-white font-bold text-lg font-mono">{ticket.coupon_code}</span>
              <StatusBadge status={ticket.settlement_status ?? ticket.status} />
              {ticket.review_required && (
                <span className="text-xs px-2 py-0.5 bg-rose-900/50 border border-rose-700/50 text-rose-400 rounded">Review Required</span>
              )}
            </div>
            <div className="text-gray-400 text-xs mt-1">
              {ticket.user_email ?? ticket.user_phone ?? ticket.user_id} · {ticket.bet_type} ·  {ticket.channel}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <XCircle size={24} />
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 px-6 py-4 border-b border-gray-700/50">
          <div className="bg-gray-800/60 rounded-lg p-3">
            <div className="text-xs text-gray-400">Stake</div>
            <div className="text-white font-bold">{fmt(ticket.stake)} {ticket.currency}</div>
          </div>
          <div className="bg-gray-800/60 rounded-lg p-3">
            <div className="text-xs text-gray-400">Potential</div>
            <div className="text-green-400 font-bold">{fmt(ticket.potential_payout)}</div>
          </div>
          <div className="bg-gray-800/60 rounded-lg p-3">
            <div className="text-xs text-gray-400">Orig. Odds</div>
            <div className="text-yellow-300 font-mono font-bold">{fmt(ticket.original_odds ?? ticket.total_odds, 3)}</div>
          </div>
          <div className="bg-gray-800/60 rounded-lg p-3">
            <div className="text-xs text-gray-400">Recalc. Odds</div>
            <div className={`font-mono font-bold ${ticket.recalculated_odds ? 'text-orange-300' : 'text-gray-500'}`}>
              {fmt(ticket.recalculated_odds ?? ticket.total_odds, 3)}
            </div>
          </div>
        </div>

        {ticket.settlement_error && (
          <div className="mx-6 mt-3 px-4 py-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-400 text-sm">
            <span className="font-semibold">Error:</span> {ticket.settlement_error}
          </div>
        )}

        {/* Action buttons */}
        {canAct && (
          <div className="px-6 py-3 border-b border-gray-700/50 flex flex-wrap gap-2">
            <ActionBtn icon={<Zap size={14} />} label="Settle Now" color="blue" onClick={() => setModal('settle')} disabled={busy || Number(ticket.pending_legs) > 0} />
            <ActionBtn icon={<Ban size={14} />} label="Void Ticket" color="red" onClick={() => setModal('void_ticket')} disabled={busy} />
            <ActionBtn icon={<RefreshCw size={14} />} label="Recalculate" color="gray" onClick={() => run(() => settlementApi.recalculateTicket(ticket.id), 'Odds recalculated')} disabled={busy} />
            <ActionBtn icon={<Timer size={14} />} label="Extend Wait" color="orange" onClick={() => setModal('extend_wait')} disabled={busy || ticket.settlement_status !== 'postponed'} />
            <ActionBtn icon={<Trophy size={14} />} label="Force Win" color="green" onClick={() => setModal('force_win')} disabled={busy} />
            <ActionBtn icon={<Skull size={14} />} label="Force Lose" color="red" onClick={() => setModal('force_lose')} disabled={busy} />
            <ActionBtn icon={<DollarSign size={14} />} label="Refund Stake" color="cyan" onClick={() => setModal('refund')} disabled={busy} />
            <ActionBtn icon={<Undo size={14} />} label="Reopen" color="purple" onClick={() => setModal('reopen')} disabled={busy} />
            <ActionBtn icon={<RotateCcw size={14} />} label="Resettle" color="indigo" onClick={() => setModal('resettle')} disabled={busy} />
            <ActionBtn icon={<Flag size={14} />} label="Manual Review" color="rose" onClick={() => run(() => settlementApi.sendToManualReview(ticket.id, 'Flagged by admin'), 'Sent to manual review')} disabled={busy} />
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-gray-700 px-6">
          {(['legs', 'audit'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === t
                  ? 'border-blue-500 text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {t === 'legs' ? `Selections (${ticket.legs.length})` : 'Audit Log'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {activeTab === 'legs' ? (
            <table className="w-full">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-700">
                  <th className="pb-2 text-left px-3">Match</th>
                  <th className="pb-2 text-left px-3">Selection</th>
                  <th className="pb-2 text-right px-3">Odds</th>
                  <th className="pb-2 text-left px-3">Status</th>
                  <th className="pb-2 text-left px-3">Event</th>
                  <th className="pb-2 text-right px-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {ticket.legs.map((leg) => (
                  <LegRow
                    key={leg.id}
                    leg={leg}
                    betId={ticket.id}
                    onVoid={handleVoidLeg}
                    canAct={canAct}
                  />
                ))}
              </tbody>
            </table>
          ) : (
            <div className="space-y-2">
              {ticket.audit.length === 0 ? (
                <div className="text-center text-gray-500 py-8">No audit logs yet</div>
              ) : (
                ticket.audit.map((entry) => (
                  <AuditRow key={entry.id} entry={entry} />
                ))
              )}
            </div>
          )}
        </div>

        {/* Modals */}
        {modal === 'settle' && (
          <ReasonModal
            title="Settle Now"
            placeholder="Settlement reason..."
            requireReason={false}
            onConfirm={(r) => run(() => settlementApi.settleTicket(ticket.id, r || 'admin_manual_settle'), 'Ticket settled')}
            onClose={() => setModal(null)}
          />
        )}
        {modal === 'void_ticket' && (
          <ReasonModal
            title="Void Entire Ticket"
            placeholder="Reason for voiding..."
            onConfirm={(r) => run(() => settlementApi.voidTicket(ticket.id, r), 'Ticket voided')}
            onClose={() => setModal(null)}
          />
        )}
        {modal === 'void_selection' && voidLegId && (
          <ReasonModal
            title="Void Selection"
            placeholder="Reason for voiding this selection..."
            onConfirm={(r) => run(() => settlementApi.voidSelection(ticket.id, voidLegId, r), 'Selection voided')}
            onClose={() => { setModal(null); setVoidLegId(null); }}
          />
        )}
        {modal === 'extend_wait' && (
          <ExtendWaitModal
            onConfirm={(h) => run(() => settlementApi.extendWait(ticket.id, h), `Postponement extended to ${h}h`)}
            onClose={() => setModal(null)}
          />
        )}
        {modal === 'force_win' && (
          <ForceWinModal
            onConfirm={(p, r) => run(() => settlementApi.forceWin(ticket.id, p, r), `Force win: ${p} ${ticket.currency}`)}
            onClose={() => setModal(null)}
          />
        )}
        {modal === 'force_lose' && (
          <ReasonModal
            title="Force Lose"
            placeholder="Reason for force lose..."
            onConfirm={(r) => run(() => settlementApi.forceLose(ticket.id, r), 'Ticket forced to lose')}
            onClose={() => setModal(null)}
          />
        )}
        {modal === 'refund' && (
          <ReasonModal
            title="Refund Stake"
            placeholder="Reason for refund..."
            onConfirm={(r) => run(() => settlementApi.refundStake(ticket.id, r), 'Stake refunded')}
            onClose={() => setModal(null)}
          />
        )}
        {modal === 'reopen' && (
          <ReasonModal
            title="Reopen Ticket"
            placeholder="Reason for reopening..."
            requireReason={false}
            onConfirm={(r) => run(() => settlementApi.reopenTicket(ticket.id, r || 'admin_reopen'), 'Ticket reopened')}
            onClose={() => setModal(null)}
          />
        )}
        {modal === 'resettle' && (
          <ReasonModal
            title="Resettle Ticket"
            placeholder="Reason for resettlement..."
            requireReason={false}
            onConfirm={(r) => run(() => settlementApi.resettleTicket(ticket.id, r || 'admin_resettle'), 'Ticket resettled')}
            onClose={() => setModal(null)}
          />
        )}
      </div>
    </div>
  );
}

function ActionBtn({
  icon, label, color, onClick, disabled,
}: {
  icon: React.ReactNode;
  label: string;
  color: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  const colorMap: Record<string, string> = {
    blue:   'bg-blue-900/40 hover:bg-blue-800/60 border-blue-700/50 text-blue-400',
    red:    'bg-red-900/40 hover:bg-red-800/60 border-red-700/50 text-red-400',
    green:  'bg-green-900/40 hover:bg-green-800/60 border-green-700/50 text-green-400',
    orange: 'bg-orange-900/40 hover:bg-orange-800/60 border-orange-700/50 text-orange-400',
    gray:   'bg-gray-800 hover:bg-gray-700 border-gray-600/50 text-gray-300',
    cyan:   'bg-cyan-900/40 hover:bg-cyan-800/60 border-cyan-700/50 text-cyan-400',
    purple: 'bg-purple-900/40 hover:bg-purple-800/60 border-purple-700/50 text-purple-400',
    indigo: 'bg-indigo-900/40 hover:bg-indigo-800/60 border-indigo-700/50 text-indigo-400',
    rose:   'bg-rose-900/40 hover:bg-rose-800/60 border-rose-700/50 text-rose-400',
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${colorMap[color] ?? colorMap.gray}`}
    >
      {icon}
      {label}
    </button>
  );
}

function AuditRow({ entry }: { entry: AuditLogEntry }) {
  return (
    <div className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-3 text-sm">
      <div className="flex items-center justify-between mb-1">
        <span className="font-medium text-white capitalize">{entry.action.replace(/_/g, ' ')}</span>
        <span className="text-gray-500 text-xs">{relTime(entry.created_at)}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
        {entry.old_status && entry.new_status && (
          <span>{entry.old_status} → <span className="text-white">{entry.new_status}</span></span>
        )}
        {entry.void_reason && <span>Void: {entry.void_reason}</span>}
        {entry.settlement_reason && <span>Reason: {entry.settlement_reason}</span>}
        {entry.recalculated_payout && <span>Payout: {entry.recalculated_payout}</span>}
        {entry.actor_email && <span>By: {entry.actor_email}</span>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ticket Row                                                            */
/* ------------------------------------------------------------------ */

function TicketRow({ ticket, onSelect }: { ticket: SettlementTicket; onSelect: () => void }) {
  const postponedDeadline = ticket.postponed_at
    ? new Date(new Date(ticket.postponed_at).getTime() + ticket.postpone_wait_hours * 3600000)
    : null;
  const isExpired = postponedDeadline ? postponedDeadline < new Date() : false;

  return (
    <tr
      className="border-b border-gray-700/40 hover:bg-gray-800/40 transition-colors cursor-pointer"
      onClick={onSelect}
    >
      <td className="py-3 px-4">
        <div className="font-mono text-sm text-white">{ticket.coupon_code}</div>
        <div className="text-xs text-gray-500">{relTime(ticket.placed_at)}</div>
      </td>
      <td className="py-3 px-4">
        <div className="text-sm text-gray-300">{ticket.user_email ?? ticket.user_phone ?? '—'}</div>
        <div className="text-xs text-gray-500 capitalize">{ticket.channel} · {ticket.bet_type}</div>
      </td>
      <td className="py-3 px-4 text-right">
        <div className="text-white font-medium">{fmt(ticket.stake)}</div>
        <div className="text-xs text-green-400">{fmt(ticket.potential_payout)}</div>
      </td>
      <td className="py-3 px-4 text-right">
        <div className="text-yellow-300 font-mono text-sm">{fmt(ticket.original_odds ?? ticket.total_odds, 3)}</div>
        {ticket.recalculated_odds && (
          <div className="text-orange-300 font-mono text-xs">{fmt(ticket.recalculated_odds, 3)}</div>
        )}
      </td>
      <td className="py-3 px-4">
        <StatusBadge status={ticket.settlement_status ?? ticket.status} />
        {ticket.review_required && (
          <span className="ml-1 text-xs text-rose-400">⚠</span>
        )}
      </td>
      <td className="py-3 px-4">
        <div className="text-xs text-gray-400">
          {ticket.pending_legs}/{ticket.total_legs} pending
        </div>
        {ticket.void_legs !== '0' && (
          <div className="text-xs text-orange-400">{ticket.void_legs} voided</div>
        )}
      </td>
      <td className="py-3 px-4">
        {ticket.settlement_status === 'postponed' && ticket.postponed_at ? (
          <div className={`text-xs ${isExpired ? 'text-red-400' : 'text-orange-400'}`}>
            {isExpired ? '⚠ Expired' : `Exp ${postponedDeadline ? postponedDeadline.toLocaleTimeString() : '—'}`}
          </div>
        ) : ticket.settlement_error ? (
          <div className="text-xs text-red-400 max-w-[120px] truncate" title={ticket.settlement_error}>
            {ticket.settlement_error}
          </div>
        ) : (
          <div className="text-xs text-gray-500">—</div>
        )}
      </td>
      <td className="py-3 px-4 text-right">
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          className="text-blue-400 hover:text-blue-300 transition-colors"
        >
          <Eye size={16} />
        </button>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* Main Page                                                             */
/* ------------------------------------------------------------------ */

export default function ManualSettlement() {
  const { hasPermission } = useAuthStore();
  const [filter, setFilter] = useState<'unsettled' | 'errors' | 'all'>('unsettled');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [tickets, setTickets] = useState<SettlementTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<SettlementTicketDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  const LIMIT = 50;

  const loadTickets = useCallback(async () => {
    setLoading(true);
    try {
      const res = await settlementApi.listSettlementTickets({ filter, page, limit: LIMIT });
      setTickets(res.items);
      setTotal(res.total);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  const openTicket = async (id: string) => {
    setLoadingDetail(true);
    try {
      const detail = await settlementApi.getSettlementTicket(id);
      setSelected(detail);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg, 'error');
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleAutoSettle = async () => {
    setAutoRunning(true);
    try {
      const res = await settlementApi.runAutoSettle();
      showToast(`Auto-settle processed ${res.processed} tickets`, 'success');
      void loadTickets();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(msg, 'error');
    } finally {
      setAutoRunning(false);
    }
  };

  const onActionDone = async () => {
    await loadTickets();
    if (selected) {
      try {
        const refreshed = await settlementApi.getSettlementTicket(selected.id);
        setSelected(refreshed);
      } catch {
        setSelected(null);
      }
    }
  };

  const filtered = search.trim()
    ? tickets.filter(
        (t) =>
          t.coupon_code.toLowerCase().includes(search.toLowerCase()) ||
          (t.user_email ?? '').toLowerCase().includes(search.toLowerCase()) ||
          (t.user_phone ?? '').toLowerCase().includes(search.toLowerCase())
      )
    : tickets;

  const pages = Math.max(1, Math.ceil(total / LIMIT));

  const unsettledCount = filter === 'unsettled' ? total : '?';
  const errorCount = filter === 'errors' ? total : '?';

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Activity size={26} className="text-blue-400" />
            Manual Settlement
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Review and settle unsettled tickets · Apply void, refund, and force settlement rules
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => void loadTickets()}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-300 rounded-lg text-sm transition-colors"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
          <button
            onClick={handleAutoSettle}
            disabled={autoRunning}
            className="flex items-center gap-2 px-4 py-2 bg-blue-700 hover:bg-blue-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <Zap size={14} className={autoRunning ? 'animate-pulse' : ''} />
            Run Auto-Settle
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-800/60 rounded-xl w-fit border border-gray-700/50">
        {([
          { id: 'unsettled', label: 'Unsettled Tickets', icon: <Clock size={14} /> },
          { id: 'errors',    label: 'Settlement Errors', icon: <AlertTriangle size={14} /> },
          { id: 'all',       label: 'All Active',        icon: <FileText size={14} /> },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setFilter(tab.id); setPage(1); }}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filter === tab.id
                ? 'bg-blue-600 text-white shadow'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.icon}
            {tab.label}
            {tab.id === 'unsettled' && typeof unsettledCount === 'number' && (
              <span className={`ml-1 px-1.5 py-0.5 rounded text-xs font-bold ${filter === 'unsettled' ? 'bg-blue-500' : 'bg-gray-700'}`}>
                {unsettledCount}
              </span>
            )}
            {tab.id === 'errors' && typeof errorCount === 'number' && (
              <span className={`ml-1 px-1.5 py-0.5 rounded text-xs font-bold ${filter === 'errors' ? 'bg-red-500 text-white' : 'bg-red-900/50 text-red-400'}`}>
                {errorCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative w-72">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          className="w-full bg-gray-800 border border-gray-600 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          placeholder="Search coupon, email, phone..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-700 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-800/80 text-xs text-gray-400 uppercase tracking-wide">
              <th className="text-left py-3 px-4">Coupon / Time</th>
              <th className="text-left py-3 px-4">User</th>
              <th className="text-right py-3 px-4">Stake / Potential</th>
              <th className="text-right py-3 px-4">Odds</th>
              <th className="text-left py-3 px-4">Status</th>
              <th className="text-left py-3 px-4">Legs</th>
              <th className="text-left py-3 px-4">Notes</th>
              <th className="text-right py-3 px-4"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="py-16 text-center text-gray-500">
                  <RefreshCw size={24} className="animate-spin mx-auto mb-2" />
                  Loading tickets...
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-16 text-center">
                  <CheckCircle size={32} className="text-green-500 mx-auto mb-3" />
                  <div className="text-gray-400">
                    {filter === 'unsettled' ? 'All tickets are settled!' : 'No tickets found'}
                  </div>
                </td>
              </tr>
            ) : (
              filtered.map((t) => (
                <TicketRow
                  key={t.id}
                  ticket={t}
                  onSelect={() => void openTicket(t.id)}
                />
              ))
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700/50 bg-gray-800/30">
            <div className="text-xs text-gray-500">{total} total tickets</div>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-300 rounded text-xs disabled:opacity-40 transition-colors"
              >
                Prev
              </button>
              <span className="text-gray-400 text-xs">
                {page} / {pages}
              </span>
              <button
                disabled={page >= pages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 text-gray-300 rounded text-xs disabled:opacity-40 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Drawer */}
      {selected && (
        <TicketDetailDrawer
          ticket={selected}
          onClose={() => setSelected(null)}
          onAction={onActionDone}
        />
      )}

      {loadingDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <RefreshCw size={32} className="animate-spin text-blue-400" />
        </div>
      )}
    </div>
  );
}
