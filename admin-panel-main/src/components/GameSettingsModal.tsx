import React, { useMemo, useState } from 'react';
import { X, Settings, Loader2 } from 'lucide-react';
import * as rtpApi from '../lib/api/rtp';
import { toast } from '../lib/toast';

interface GameSettingsModalProps {
  game: rtpApi.InternalGameRtp;
  /** Called with the updated game after a successful save. */
  onSaved: (game: rtpApi.InternalGameRtp) => void;
  onClose: () => void;
}

/**
 * Game List → "Settings" action. Lets an admin manage a single internal game's
 * limits and RTP from one place:
 *   • RTP (%)            — long-run return the engine applies to every round
 *   • Minimum Bet (ETB)  — smallest stake a player may place
 *   • Maximum Bet (ETB)  — largest stake a player may place
 *   • Maximum Win (ETB)  — hard ceiling on a single-round payout
 *
 * RTP is persisted via PATCH /:id/rtp (global default) and the three limits via
 * PATCH /:id/limits, so existing status / override configuration is untouched.
 */
export function GameSettingsModal({ game, onSaved, onClose }: GameSettingsModalProps) {
  const [rtp, setRtp] = useState<string>(String(game.defaultRtp));
  const [minBet, setMinBet] = useState<string>(String(game.minBet));
  const [maxBet, setMaxBet] = useState<string>(String(game.maxBet));
  const [maxWin, setMaxWin] = useState<string>(String(game.maxWin));
  const [saving, setSaving] = useState(false);

  const parsed = useMemo(
    () => ({
      rtp: Number(rtp),
      minBet: Number(minBet),
      maxBet: Number(maxBet),
      maxWin: Number(maxWin),
    }),
    [rtp, minBet, maxBet, maxWin]
  );

  const error = useMemo(() => {
    if (!Number.isFinite(parsed.rtp) || parsed.rtp < game.minRtp || parsed.rtp > game.maxRtp) {
      return `RTP must be between ${game.minRtp}% and ${game.maxRtp}%.`;
    }
    if (!Number.isFinite(parsed.minBet) || parsed.minBet <= 0) {
      return 'Minimum bet must be greater than 0.';
    }
    if (!Number.isFinite(parsed.maxBet) || parsed.maxBet < parsed.minBet) {
      return 'Maximum bet must be greater than or equal to minimum bet.';
    }
    if (!Number.isFinite(parsed.maxWin) || parsed.maxWin < parsed.maxBet) {
      return 'Maximum win must be greater than or equal to maximum bet.';
    }
    return null;
  }, [parsed, game.minRtp, game.maxRtp]);

  const rtpChanged = parsed.rtp !== game.defaultRtp;

  const handleSave = async () => {
    if (error) {
      toast(error, 'error');
      return;
    }
    setSaving(true);
    try {
      // Limits first (always), then RTP only when it actually changed.
      const limitsRes = await rtpApi.updateGameLimits(game.id, {
        min_bet: parsed.minBet,
        max_bet: parsed.maxBet,
        max_win: parsed.maxWin,
      });
      let updated = limitsRes.game;
      if (rtpChanged) {
        const rtpRes = await rtpApi.updateGameRtp(game.id, {
          rtp: parsed.rtp,
          apply_global: true,
        });
        updated = rtpRes.game;
      }
      toast(`${game.name} settings saved.`);
      onSaved(updated);
      onClose();
    } catch (err) {
      toast(`Save failed: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const field = (
    label: string,
    value: string,
    setValue: (v: string) => void,
    hint: string,
    step = '1',
    suffix = 'ETB'
  ) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="relative">
        <input
          type="number"
          min="0"
          step={step}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-full pr-14 pl-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
          {suffix}
        </span>
      </div>
      <p className="text-xs text-gray-400 mt-1">{hint}</p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <Settings className="h-6 w-6 text-blue-600" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Game Settings</h2>
              <p className="text-sm text-gray-500">
                {game.name} <span className="text-gray-400">({game.id})</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <X size={22} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          {field(
            'RTP (Return to Player)',
            rtp,
            setRtp,
            `Long-run payout target. Allowed range: ${game.minRtp}%–${game.maxRtp}%.`,
            '0.01',
            '%'
          )}
          {field('Minimum Bet', minBet, setMinBet, 'Smallest stake a player can place.', '0.01')}
          {field('Maximum Bet', maxBet, setMaxBet, 'Largest stake a player can place.', '1')}
          {field(
            'Maximum Win',
            maxWin,
            setMaxWin,
            'Hard ceiling on a single-round payout.',
            '1'
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !!error}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {saving && <Loader2 size={16} className="animate-spin" />}
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
