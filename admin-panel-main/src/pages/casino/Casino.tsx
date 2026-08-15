import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import { Gamepad2, Plus, FileDown, RefreshCw, Eye, Power, PowerOff } from 'lucide-react';
import { GameModal } from './GameModal';
import { CategoryModal } from './CategoryModal';
import { TagModal } from './TagModal';
import { toast } from '../../lib/toast';
import * as casinoApi from '../../lib/api/casino';
import { startOfDayIso, endOfDayIso } from '../../lib/format';

/** Human label used everywhere for our own games. */
const INTERNAL_SOURCE_LABEL = 'Home / Internal';

function sourceBadge(value: string) {
  const isInternal = value === 'internal';
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
        isInternal ? 'bg-blue-100 text-blue-800' : 'bg-amber-100 text-amber-800'
      }`}
    >
      {isInternal ? 'Internal' : 'External'}
    </span>
  );
}

function money(value: string | number) {
  return Number(value ?? 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

interface GameData {
  id: string;
  order: number;
  name: string;
  label: string;
  status: string;
  /** Underlying boolean from the API — drives the toggle button state. */
  isActive: boolean;
  provider: string;
  categories: string[];
  tags: string[];
  description: string;
  weight: number;
  logo: string;
  slug: string;
  labelBackground: string;
}

interface CategoryData {
  id: string;
  order: number;
  name: string;
  description: string;
  isVisible: boolean;
  logo: string;
  slug: string;
  label: string;
  status: string;
  isActive: boolean;
}

interface ProviderData {
  id: string;
  name: string;
  image: string;
  order: number;
  status: string;
  isActive: boolean;
}

interface TagData {
  id: string;
  order: number;
  name: string;
  slug: string;
  status: string;
  showOnLobby: boolean;
  phoneTemplate: 'two-columns' | 'three-columns';
  image: string;
  games: string[];
}

const EMPTY_BLOCK: casinoApi.CasinoSummaryBlock = {
  bet_count: 0,
  payout_count: 0,
  total_stake: 0,
  total_payout: 0,
  ggr: 0,
  players: 0,
  rollback_count: 0,
  rollback_amount: 0,
};

const EMPTY_SUMMARY = {
  totals: EMPTY_BLOCK,
  internal: EMPTY_BLOCK,
  external: { ...EMPTY_BLOCK, provider_share_total: 0, our_share_total: 0 },
  providers: [] as casinoApi.CasinoProviderShareRow[],
};

export function Casino() {
  const [activeTab, setActiveTab] = useState('report');
  const [activeReportTab, setActiveReportTab] = useState('summary');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [phoneNumber, setPhoneNumber] = useState('');
  const [selectedGame, setSelectedGame] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isGameModalOpen, setIsGameModalOpen] = useState(false);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isTagModalOpen, setIsTagModalOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<
    GameData | CategoryData | TagData | null
  >(null);
  const [loading, setLoading] = useState(true);

  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [userReports, setUserReports] = useState<casinoApi.CasinoUsersReportRow[]>([]);
  const [gameReports, setGameReports] = useState<casinoApi.CasinoGamesReportRow[]>([]);
  const [userGameReports, setUserGameReports] = useState<casinoApi.CasinoUserGameReportRow[]>([]);
  const [userDetailReports, setUserDetailReports] = useState<casinoApi.CasinoUserDetailReportRow[]>([]);

  // Game Source filter — populated from the actual provider records, never
  // hard-coded. '' = All, INTERNAL_SOURCE_LABEL = Home, otherwise a provider name.
  const [sources, setSources] = useState<casinoApi.CasinoSourceOption[]>([]);
  const [sourceFilter, setSourceFilter] = useState('');
  const [debouncedPhone, setDebouncedPhone] = useState('');

  const [games, setGames] = useState<GameData[]>([]);
  const [categories, setCategories] = useState<CategoryData[]>([]);
  const [providers, setProviders] = useState<ProviderData[]>([]);
  const [tags, setTags] = useState<TagData[]>([]);

  const mainTabs = [
    { id: 'report', label: 'Report' },
    { id: 'games', label: 'Games' },
    { id: 'categories', label: 'Categories' },
    { id: 'providers', label: 'Providers' },
    { id: 'tags', label: 'Tags' },
  ];

  const reportTabs = [
    { id: 'summary', label: 'Summary Report' },
    { id: 'users', label: 'Users Report' },
    { id: 'games', label: 'Game Report' },
    { id: 'user-game', label: 'User-Game Report' },
    { id: 'user-detail', label: 'User Detail Report' },
  ];

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    try {
      const [gamesRes, categoriesRes, providersRes, tagsRes] = await Promise.all([
        casinoApi.listGames({ limit: 500 }),
        casinoApi.listCategories(),
        casinoApi.listProviders(),
        casinoApi.listTags(),
      ]);

      const providerMap = new Map<string, ProviderData>();
      (providersRes.items ?? []).forEach((p, idx) => {
        providerMap.set(p.id, {
          id: p.id,
          name: p.name,
          image:
            p.logo_url ??
            String((p.config?.logo as string | undefined) ?? ''),
          order: idx + 1,
          status: p.is_active ? 'Active' : 'Inactive',
          isActive: p.is_active,
        });
      });

      const categoryMap = new Map<string, CategoryData>();
      (categoriesRes.items ?? []).forEach((c) => {
        categoryMap.set(c.id, {
          id: c.id,
          order: c.display_order ?? 100,
          name: c.name,
          description: '',
          isVisible: c.is_active,
          logo: c.icon_url ?? '',
          slug: c.slug,
          label: c.name,
          status: c.is_active ? 'Active' : 'Inactive',
          isActive: c.is_active,
        });
      });

      const tagMap = new Map<string, string>();
      (tagsRes.items ?? []).forEach((t) => tagMap.set(t.id, t.name));

      const mappedProviders = Array.from(providerMap.values());
      const mappedCategories = Array.from(categoryMap.values());
      const mappedTags: TagData[] = (tagsRes.items ?? []).map((t, idx) => ({
        id: t.id,
        order: idx + 1,
        name: t.name,
        slug: t.slug,
        status: 'Active',
        showOnLobby: false,
        phoneTemplate: 'two-columns',
        image: '',
        games: [],
      }));

      const mappedGames: GameData[] = (gamesRes.items ?? []).map((g) => ({
        id: g.id,
        order: g.display_order ?? 100,
        name: g.name,
        label: g.is_featured ? 'Featured' : '',
        status: g.is_active ? 'Active' : 'Inactive',
        isActive: g.is_active,
        provider:
          (g.provider_name && String(g.provider_name)) ||
          (g.provider_id && providerMap.get(g.provider_id)?.name) ||
          'Unknown',
        categories: g.category_id
          ? [categoryMap.get(g.category_id)?.name ?? '']
              .filter(Boolean)
          : [],
        tags: (g.tag_ids ?? [])
          .map((tid) => tagMap.get(tid) ?? '')
          .filter(Boolean),
        description: '',
        weight: Number(g.rtp ?? 0),
        logo: g.image_url ?? '',
        slug: g.slug ?? '',
        labelBackground: '',
      }));

      setProviders(mappedProviders);
      setCategories(mappedCategories);
      setTags(mappedTags);
      setGames(mappedGames);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast(`Failed to load casino data: ${message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  // Game Source options come from the configured provider records.
  useEffect(() => {
    casinoApi
      .listReportSources()
      .then((res) => setSources(res.sources ?? []))
      .catch(() => setSources([]));
  }, []);

  // Debounce the phone filter so we don't refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedPhone(phoneNumber.trim()), 400);
    return () => clearTimeout(t);
  }, [phoneNumber]);

  // Server-side report fetch — filters are applied in the database query,
  // never by slicing a capped client-side list.
  const reportQuery = useMemo((): casinoApi.CasinoReportQuery => {
    const selected = sources.find((s) => s.label === sourceFilter);
    return {
      from: startOfDayIso(startDate),
      to: endOfDayIso(endDate),
      source: !sourceFilter
        ? 'all'
        : sourceFilter === INTERNAL_SOURCE_LABEL
          ? 'internal'
          : 'external',
      provider_id: selected?.provider_id,
      game: selectedGame.trim() || undefined,
      phone: debouncedPhone || undefined,
      limit: 200,
    };
  }, [sources, sourceFilter, startDate, endDate, selectedGame, debouncedPhone]);

  useEffect(() => {
    if (activeTab !== 'report') return;
    let cancelled = false;
    const load = async () => {
      try {
        if (activeReportTab === 'summary') {
          const res = await casinoApi.getReportSummary(reportQuery);
          if (!cancelled) setSummary(res);
        } else if (activeReportTab === 'users') {
          const res = await casinoApi.getUsersReport(reportQuery);
          if (!cancelled) setUserReports(res.items ?? []);
        } else if (activeReportTab === 'games') {
          const res = await casinoApi.getGamesReport(reportQuery);
          if (!cancelled) setGameReports(res.items ?? []);
        } else if (activeReportTab === 'user-game') {
          const res = await casinoApi.getUserGameReport(reportQuery);
          if (!cancelled) setUserGameReports(res.items ?? []);
        } else if (activeReportTab === 'user-detail') {
          const res = await casinoApi.getUserDetailReport(reportQuery);
          if (!cancelled) setUserDetailReports(res.items ?? []);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!cancelled) toast(`Failed to load report: ${message}`, 'error');
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [activeTab, activeReportTab, reportQuery]);

  const handleToggleGame = useCallback(
    async (gameId: string, nextActive: boolean) => {
      try {
        await casinoApi.toggleGameStatus(gameId, nextActive);
        toast(nextActive ? 'Game enabled.' : 'Game disabled.');
        await loadCatalog();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        toast(`Failed to update game: ${message}`, 'error');
      }
    },
    [loadCatalog]
  );

  // Game options: catalog names plus every game name observed in the loaded
  // report data (internal engine games and provider games are not part of
  // the lobby catalog, but they must still be filterable).
  const gameFilterOptions = useMemo(() => {
    const names = new Set<string>();
    games.forEach((g) => names.add(g.name));
    gameReports.forEach((r) => names.add(r.game_name));
    userGameReports.forEach((r) => names.add(r.game_name));
    userDetailReports.forEach((r) => names.add(r.game_name));
    return Array.from(names).sort();
  }, [games, gameReports, userGameReports, userDetailReports]);

  const commonFilters = [
    {
      label: 'Phone Number',
      options: [],
      value: phoneNumber,
      onChange: setPhoneNumber,
      type: 'text',
    },
    {
      label: 'Game',
      options: gameFilterOptions,
      value: selectedGame,
      onChange: setSelectedGame,
    },
    {
      // Home/Internal vs each configured external provider — sourced from
      // the actual provider records, never hard-coded.
      label: 'Game Source',
      options: [
        INTERNAL_SOURCE_LABEL,
        ...sources
          .filter((s) => s.provider_id)
          .map((s) => s.label),
      ],
      value: sourceFilter,
      onChange: setSourceFilter,
    },
  ];

  const filteredGames = useMemo(
    () =>
      games.filter((g) => {
        if (searchTerm && !g.name.toLowerCase().includes(searchTerm.toLowerCase()))
          return false;
        if (selectedProvider && g.provider !== selectedProvider) return false;
        if (selectedStatus && g.status !== selectedStatus) return false;
        return true;
      }),
    [games, searchTerm, selectedProvider, selectedStatus]
  );

  const gameColumns = [
    { header: 'Order', accessor: 'order' as const },
    { header: 'Name', accessor: 'name' as const },
    { header: 'Label', accessor: 'label' as const },
    {
      header: 'Status',
      accessor: 'status' as const,
      render: (value: string) => (
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            value === 'Active'
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          {value}
        </span>
      ),
    },
    { header: 'Provider', accessor: 'provider' as const },
    {
      header: 'Categories',
      accessor: 'categories' as const,
      render: (value: string[]) => value.join(', '),
    },
    {
      header: 'Tags',
      accessor: 'tags' as const,
      render: (value: string[]) => value.join(', '),
    },
    {
      header: 'Actions',
      accessor: 'id' as const,
      render: (value: string) => {
        const game = games.find((g) => g.id === value);
        if (!game) return null;
        return (
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                setSelectedItem(game);
                setIsGameModalOpen(true);
              }}
              className="text-blue-600 hover:text-blue-800"
              title="View game"
            >
              <Eye className="h-5 w-5" />
            </button>
            <button
              onClick={() => void handleToggleGame(game.id, !game.isActive)}
              className={
                game.isActive
                  ? 'text-red-600 hover:text-red-800'
                  : 'text-green-600 hover:text-green-800'
              }
              title={game.isActive ? 'Disable game' : 'Enable game'}
            >
              {game.isActive ? (
                <PowerOff className="h-5 w-5" />
              ) : (
                <Power className="h-5 w-5" />
              )}
            </button>
          </div>
        );
      },
    },
  ];

  const categoryColumns = [
    { header: 'Order', accessor: 'order' as const },
    { header: 'Name', accessor: 'name' as const },
    { header: 'Is Visible', accessor: 'isVisible' as const },
    { header: 'Status', accessor: 'status' as const },
    {
      header: 'Actions',
      accessor: 'id' as const,
      render: (value: string) => (
        <button
          onClick={() => {
            const category = categories.find((c) => c.id === value);
            if (category) {
              setSelectedItem(category);
              setIsCategoryModalOpen(true);
            }
          }}
          className="text-blue-600 hover:text-blue-800"
        >
          <Eye className="h-5 w-5" />
        </button>
      ),
    },
  ];

  const tagColumns = [
    { header: 'Order', accessor: 'order' as const },
    { header: 'Name', accessor: 'name' as const },
    { header: 'Status', accessor: 'status' as const },
    { header: 'Show on Lobby', accessor: 'showOnLobby' as const },
    { header: 'Phone Template', accessor: 'phoneTemplate' as const },
    {
      header: 'Actions',
      accessor: 'id' as const,
      render: (value: string) => (
        <button
          onClick={() => {
            const tag = tags.find((t) => t.id === value);
            if (tag) {
              setSelectedItem(tag);
              setIsTagModalOpen(true);
            }
          }}
          className="text-blue-600 hover:text-blue-800"
        >
          <Eye className="h-5 w-5" />
        </button>
      ),
    },
  ];

  const getReportColumns = () => {
    const sourceCol = {
      header: 'Source',
      accessor: 'source_type' as const,
      render: (value: string) => sourceBadge(value),
    };
    const providerCol = { header: 'Provider', accessor: 'provider_name' as const };
    const moneyCol = (header: string, accessor: string) => ({
      header,
      accessor: accessor as never,
      render: (value: string | number) => money(value),
    });
    switch (activeReportTab) {
      case 'users':
        return [
          { header: 'Date', accessor: 'date' as const },
          { header: 'User Name', accessor: 'user_name' as const },
          { header: 'Phone Number', accessor: 'phone' as const },
          { header: 'Bet Count', accessor: 'bet_count' as const },
          moneyCol('Bet Amount', 'bet_amount'),
          moneyCol('Payout Amount', 'payout_amount'),
          moneyCol('GGR', 'ggr'),
        ];
      case 'games':
        return [
          { header: 'Date', accessor: 'date' as const },
          { header: 'Game Name', accessor: 'game_name' as const },
          sourceCol,
          providerCol,
          { header: 'Bet Count', accessor: 'bet_count' as const },
          { header: 'Players', accessor: 'players' as const },
          moneyCol('Bet Amount', 'bet_amount'),
          moneyCol('Payout Amount', 'payout_amount'),
          moneyCol('GGR', 'ggr'),
        ];
      case 'user-game':
        return [
          { header: 'Date', accessor: 'date' as const },
          { header: 'User Name', accessor: 'user_name' as const },
          { header: 'Phone Number', accessor: 'phone' as const },
          { header: 'Game Name', accessor: 'game_name' as const },
          sourceCol,
          providerCol,
          { header: 'Bet Count', accessor: 'bet_count' as const },
          moneyCol('Bet Amount', 'bet_amount'),
          moneyCol('Payout Amount', 'payout_amount'),
          moneyCol('GGR', 'ggr'),
        ];
      case 'user-detail':
        return [
          {
            header: 'Date',
            accessor: 'placed_at' as const,
            render: (value: string) => new Date(value).toLocaleString(),
          },
          { header: 'Bet ID', accessor: 'bet_id' as const },
          { header: 'User Name', accessor: 'user_name' as const },
          { header: 'Phone Number', accessor: 'phone' as const },
          { header: 'Game Name', accessor: 'game_name' as const },
          sourceCol,
          providerCol,
          moneyCol('Bet Amount', 'bet_amount'),
          moneyCol('Paid Amount', 'paid_amount'),
          { header: 'Status', accessor: 'status' as const },
        ];
      default:
        return [];
    }
  };

  const getReportData = () => {
    switch (activeReportTab) {
      case 'users':
        return userReports;
      case 'games':
        return gameReports;
      case 'user-game':
        return userGameReports;
      case 'user-detail':
        return userDetailReports;
      default:
        return [];
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Gamepad2 className="h-8 w-8 text-purple-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Casino Management</h1>
        </div>
        <div className="space-x-4">
          <button
            onClick={() => toast('Casino report exported.')}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export Report
          </button>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh Data
          </button>
        </div>
      </div>

      <TabGroup tabs={mainTabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'report' && (
        <>
          <TabGroup
            tabs={reportTabs}
            activeTab={activeReportTab}
            onTabChange={setActiveReportTab}
          />

          <FilterBar
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            filters={commonFilters}
            onClear={() => {
              setSelectedGame('');
              setSelectedProvider('');
              setSelectedCategory('');
              setSelectedStatus('');
              setSourceFilter('');
              setPhoneNumber('');
              setStartDate(new Date());
              setEndDate(new Date());
            }}
          />

          {activeReportTab === 'summary' ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow-sm">
                  <h3 className="text-lg font-medium mb-4">Bets</h3>
                  <p className="text-sm text-gray-500">Count</p>
                  <p className="text-xl font-semibold">{summary.totals.bet_count.toLocaleString()}</p>
                  <p className="text-sm text-gray-500 mt-2">Total Stake</p>
                  <p className="text-xl font-semibold">${money(summary.totals.total_stake)}</p>
                </div>
                <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow-sm">
                  <h3 className="text-lg font-medium mb-4">Payouts</h3>
                  <p className="text-sm text-gray-500">Count</p>
                  <p className="text-xl font-semibold">{summary.totals.payout_count.toLocaleString()}</p>
                  <p className="text-sm text-gray-500 mt-2">Total Amount</p>
                  <p className="text-xl font-semibold">${money(summary.totals.total_payout)}</p>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <h3 className="text-lg font-medium mb-4">Rollbacks</h3>
                  <p className="text-sm text-gray-500">Count</p>
                  <p className="text-xl font-semibold">{summary.totals.rollback_count.toLocaleString()}</p>
                  <p className="text-sm text-gray-500 mt-2">Total Amount</p>
                  <p className="text-xl font-semibold">${money(summary.totals.rollback_amount)}</p>
                </div>
                <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow-sm">
                  <h3 className="text-lg font-medium mb-4">GGR</h3>
                  <p className="text-sm text-gray-500">Amount</p>
                  <p className="text-xl font-semibold">${money(summary.totals.ggr)}</p>
                  <p className="text-sm text-gray-500 mt-2">GGR % / RTP</p>
                  <p className="text-xl font-semibold">
                    {summary.totals.total_stake > 0
                      ? ((summary.totals.ggr / summary.totals.total_stake) * 100).toFixed(2)
                      : '0.00'}
                    % /{' '}
                    {summary.totals.total_stake > 0
                      ? ((summary.totals.total_payout / summary.totals.total_stake) * 100).toFixed(2)
                      : '0.00'}
                    %
                  </p>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <h3 className="text-lg font-medium mb-4">Players</h3>
                  <p className="text-sm text-gray-500">{INTERNAL_SOURCE_LABEL}</p>
                  <p className="text-xl font-semibold">{summary.internal.players.toLocaleString()}</p>
                  <p className="text-sm text-gray-500 mt-2">External Provider</p>
                  <p className="text-xl font-semibold">{summary.external.players.toLocaleString()}</p>
                </div>
              </div>

              {/* Source split — internal vs external are never financially mixed. */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <h3 className="text-lg font-medium">{INTERNAL_SOURCE_LABEL}</h3>
                    {sourceBadge('internal')}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-gray-500">Bets</p>
                      <p className="font-semibold">{summary.internal.bet_count.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Total Stake</p>
                      <p className="font-semibold">${money(summary.internal.total_stake)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Total Payout</p>
                      <p className="font-semibold">${money(summary.internal.total_payout)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">GGR (our revenue)</p>
                      <p className="font-semibold">${money(summary.internal.ggr)}</p>
                    </div>
                  </div>
                </div>
                <div className="bg-white p-6 rounded-lg shadow-sm">
                  <div className="flex items-center gap-2 mb-4">
                    <h3 className="text-lg font-medium">External Provider</h3>
                    {sourceBadge('external')}
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-gray-500">Bets</p>
                      <p className="font-semibold">{summary.external.bet_count.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Total Stake</p>
                      <p className="font-semibold">${money(summary.external.total_stake)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Total Payout</p>
                      <p className="font-semibold">${money(summary.external.total_payout)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">GGR</p>
                      <p className="font-semibold">${money(summary.external.ggr)}</p>
                    </div>
                    <div>
                      <p className="text-gray-500">Provider Payable</p>
                      <p className="font-semibold text-amber-700">
                        ${money(summary.external.provider_share_total)}
                      </p>
                    </div>
                    <div>
                      <p className="text-gray-500">Our Share</p>
                      <p className="font-semibold text-green-700">
                        ${money(summary.external.our_share_total)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Per-provider revenue share (uses each provider's configured %). */}
              {summary.providers.length > 0 && (
                <div className="bg-white rounded-lg shadow overflow-x-auto">
                  <h3 className="text-lg font-medium px-6 pt-6">Provider Revenue Share</h3>
                  <table className="min-w-full divide-y divide-gray-200 mt-4">
                    <thead className="bg-gray-50">
                      <tr>
                        {['Provider', 'Share %', 'Bets', 'Players', 'Total Stake', 'Total Payout', 'GGR', 'Provider Share', 'Our Share'].map((h) => (
                          <th
                            key={h}
                            className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {summary.providers.map((p) => (
                        <tr key={p.provider_id}>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{p.provider_name}</td>
                          <td className="px-4 py-3 text-sm">{p.revenue_share_percent.toFixed(2)}%</td>
                          <td className="px-4 py-3 text-sm">{p.bet_count.toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm">{p.players.toLocaleString()}</td>
                          <td className="px-4 py-3 text-sm">${money(p.total_stake)}</td>
                          <td className="px-4 py-3 text-sm">${money(p.total_payout)}</td>
                          <td className="px-4 py-3 text-sm">${money(p.ggr)}</td>
                          <td className="px-4 py-3 text-sm text-amber-700 font-medium">${money(p.provider_share)}</td>
                          <td className="px-4 py-3 text-sm text-green-700 font-medium">${money(p.our_share)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow overflow-x-auto">
              <DataTable columns={getReportColumns()} data={getReportData()} />
            </div>
          )}
        </>
      )}

      {activeTab === 'games' && (
        <>
          <FilterBar
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            filters={[
              {
                label: 'Search',
                options: [],
                value: searchTerm,
                onChange: setSearchTerm,
                type: 'text',
              },
              {
                label: 'Provider',
                options: providers.map((p) => p.name),
                value: selectedProvider,
                onChange: setSelectedProvider,
              },
              {
                label: 'Category',
                options: categories.map((c) => c.name),
                value: selectedCategory,
                onChange: setSelectedCategory,
              },
              {
                label: 'Status',
                options: ['Active', 'Inactive'],
                value: selectedStatus,
                onChange: setSelectedStatus,
              },
            ]}
          />
          <div className="bg-white rounded-lg shadow">
            <DataTable columns={gameColumns} data={filteredGames} />
          </div>
        </>
      )}

      {activeTab === 'categories' && (
        <>
          {/* Stacks on phones — the side-by-side row overflowed small screens
              and made the filters unusable there. Desktop (sm+) unchanged. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-between mb-4">
            <FilterBar
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={setStartDate}
              onEndDateChange={setEndDate}
              filters={[
                {
                  label: 'Status',
                  options: ['Active', 'Inactive'],
                  value: selectedStatus,
                  onChange: setSelectedStatus,
                },
              ]}
            />
            <button
              onClick={() => {
                setSelectedItem(null);
                setIsCategoryModalOpen(true);
              }}
              className="inline-flex items-center self-start px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 whitespace-nowrap"
            >
              <Plus className="h-4 w-4 mr-2" />
              Create Category
            </button>
          </div>
          <div className="bg-white rounded-lg shadow">
            <DataTable columns={categoryColumns} data={categories} />
          </div>
        </>
      )}

      {activeTab === 'providers' && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {providers.map((provider) => (
            <div key={provider.id} className="bg-white rounded-lg shadow-sm p-6">
              {provider.image ? (
                <img
                  src={provider.image}
                  alt={provider.name}
                  className="w-full h-32 object-cover rounded-lg mb-4"
                />
              ) : (
                <div className="w-full h-32 bg-gray-100 rounded-lg mb-4" />
              )}
              <div className="flex justify-between items-center">
                <h3 className="text-lg font-medium">{provider.name}</h3>
                <span
                  className={`px-2 py-1 rounded-full text-sm font-medium ${
                    provider.status === 'Active'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {provider.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'tags' && (
        <>
          <div className="flex justify-between mb-4">
            <button
              onClick={() => {
                setSelectedItem(null);
                setIsTagModalOpen(true);
              }}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Tag
            </button>
          </div>
          <div className="bg-white rounded-lg shadow">
            <DataTable columns={tagColumns} data={tags} />
          </div>
        </>
      )}

      <GameModal
        isOpen={isGameModalOpen}
        onClose={() => setIsGameModalOpen(false)}
        game={selectedItem}
        mode="view"
      />

      <CategoryModal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        category={selectedItem}
        mode={selectedItem ? 'edit' : 'add'}
        onSave={() => {
          toast('Category saved.');
          setIsCategoryModalOpen(false);
        }}
      />

      <TagModal
        isOpen={isTagModalOpen}
        onClose={() => setIsTagModalOpen(false)}
        tag={selectedItem}
        mode={selectedItem ? 'edit' : 'add'}
        onSave={() => {
          toast('Tag saved.');
          setIsTagModalOpen(false);
        }}
      />

      {loading && <div className="text-sm text-gray-500">Loading casino data…</div>}
    </div>
  );
}

export default Casino;
