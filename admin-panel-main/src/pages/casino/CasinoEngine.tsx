import React, { useEffect, useMemo, useState } from 'react';
import { TabGroup } from '../../components/TabGroup';
import { Settings, Cpu, Activity, AlertTriangle } from 'lucide-react';
import { toast } from '../../lib/toast';
import * as casinoApi from '../../lib/api/casino';
import { useAuthStore } from '../../store/auth';

const tabs = [
  { id: 'general', label: 'General Settings' },
  { id: 'rtp', label: 'RTP Configuration' },
  { id: 'limits', label: 'Betting Limits' },
  { id: 'security', label: 'Security Rules' },
];

const MetricCard = ({
  icon: Icon,
  title,
  value,
  status,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  status: 'normal' | 'warning' | 'critical';
}) => (
  <div className="bg-white p-6 rounded-lg shadow-sm">
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <div
          className={`p-2 rounded-lg ${
            status === 'normal' ? 'bg-green-50' : status === 'warning' ? 'bg-yellow-50' : 'bg-red-50'
          }`}
        >
          <Icon
            className={`h-6 w-6 ${
              status === 'normal' ? 'text-green-600' : status === 'warning' ? 'text-yellow-600' : 'text-red-600'
            }`}
          />
        </div>
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-xl font-semibold">{value}</p>
        </div>
      </div>
    </div>
  </div>
);

export function CasinoEngine() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState('general');
  const [rawConfig, setRawConfig] = useState('{}');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const topLevelKeyCount = useMemo(() => {
    try {
      const o = JSON.parse(rawConfig || '{}') as unknown;
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        return String(Object.keys(o as Record<string, unknown>).length);
      }
      return '0';
    } catch {
      return 'invalid';
    }
  }, [rawConfig]);

  useEffect(() => {
    if (!isAuth) return;
    let cancelled = false;
    setLoading(true);
    casinoApi
      .getEngineConfig()
      .then((cfg) => {
        if (cancelled) return;
        setRawConfig(JSON.stringify(cfg ?? {}, null, 2));
      })
      .catch((err: Error) => {
        toast(`Failed to load engine config: ${err.message ?? err}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth]);

  const persist = async () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawConfig) as Record<string, unknown>;
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Root JSON must be an object.');
      }
    } catch (e) {
      toast(`Invalid JSON: ${(e as Error).message}`);
      return;
    }
    setSaving(true);
    try {
      await casinoApi.updateEngineConfig(parsed);
      toast('Casino engine configuration saved.');
    } catch (err) {
      toast(`Save failed: ${(err as Error)?.message ?? err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Settings className="h-8 w-8 text-indigo-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Casino Engine Configuration</h1>
        </div>
        <div className="space-x-4">
          <button
            type="button"
            onClick={() => {
              const blob = new Blob([rawConfig], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `casino-engine-config-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
              toast('Config downloaded.');
            }}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            Backup Config
          </button>
          <button
            type="button"
            disabled={saving || loading}
            onClick={() => void persist()}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save to database'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard icon={Cpu} title="Engine status" value={loading ? '—' : 'Live'} status="normal" />
        <MetricCard
          icon={Activity}
          title="Config keys (top-level)"
          value={loading ? '—' : topLevelKeyCount}
          status="normal"
        />
        <MetricCard icon={AlertTriangle} title="Validation" value="JSON object" status="normal" />
        <MetricCard icon={Settings} title="Storage" value="settings table" status="normal" />
      </div>

      <TabGroup tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <div className="bg-white rounded-lg shadow p-6 space-y-3">
        <p className="text-sm text-gray-600">
          Stored as JSON in PostgreSQL (<code className="text-xs">settings</code>, key{' '}
          <code className="text-xs">casino.engine.config</code>). Edit safely — invalid JSON cannot be saved.
        </p>
        {loading ? (
          <div className="py-12 text-center text-gray-500 text-sm">Loading configuration…</div>
        ) : (
          <textarea
            value={rawConfig}
            onChange={(e) => setRawConfig(e.target.value)}
            spellCheck={false}
            className="w-full min-h-[320px] font-mono text-sm border border-gray-300 rounded-md p-3 focus:ring-indigo-500 focus:border-indigo-500"
          />
        )}
      </div>
    </div>
  );
}
