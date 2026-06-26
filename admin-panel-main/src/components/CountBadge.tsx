/**
 * Small inline stat chip used in admin list-page headers to show the
 * total number of rows in the table (and optionally per-status counts).
 *
 *   <CountBadge total={42} />
 *   <CountBadge total={42} breakdown={[{ label: 'Active', value: 30, tone: 'green' }, { label: 'Blocked', value: 12, tone: 'red' }]} />
 */
import React from 'react';

type Tone = 'gray' | 'green' | 'red' | 'yellow' | 'blue' | 'purple';

const TONES: Record<Tone, string> = {
  gray: 'bg-gray-100 text-gray-700',
  green: 'bg-green-100 text-green-700',
  red: 'bg-red-100 text-red-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  blue: 'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
};

export interface CountBreakdownItem {
  label: string;
  value: number;
  tone?: Tone;
}

export function CountBadge({
  total,
  breakdown,
  loading = false,
}: {
  total: number;
  breakdown?: CountBreakdownItem[];
  loading?: boolean;
}) {
  if (loading) {
    return (
      <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400">
        Loading…
      </span>
    );
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
        Total: {total}
      </span>
      {breakdown?.filter((b) => b.value > 0).map((b) => (
        <span
          key={b.label}
          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-medium ${TONES[b.tone ?? 'gray']}`}
        >
          {b.label}: {b.value}
        </span>
      ))}
    </div>
  );
}

export default CountBadge;
