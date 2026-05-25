import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import * as p2pApi from '../lib/api/p2p';

export interface AccessToken {
  id: string;
  token?: string;
  operatorId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  lastUsedAt?: string | null;
  emailTo?: string | null;
}

export interface EmailLogEntry {
  id: string;
  operatorId: string;
  to: string;
  subject: string;
  sentAt: string;
  tokenId: string;
  from: string;
}

interface OperatorAccessState {
  tokens: AccessToken[];
  emailLog: EmailLogEntry[];
  loading: boolean;
  lastFetchedAt: string | null;
  fetch: () => Promise<void>;
  issueToken: (
    operatorId: string,
    opts?: { ttlHours?: number; emailTo?: string }
  ) => Promise<AccessToken>;
  rotateToken: (
    operatorId: string,
    opts?: { ttlHours?: number; emailTo?: string }
  ) => Promise<AccessToken>;
  revokeToken: (tokenOrId: string, operatorId?: string) => Promise<void>;
  logEmail: (entry: Omit<EmailLogEntry, 'id' | 'sentAt'>) => EmailLogEntry;
}

type OperatorWithTokens = p2pApi.OperatorRow & {
  tokens?: Array<{
    id: string;
    expires_at?: string;
    revoked_at?: string | null;
    last_used_at?: string | null;
    delivered_to?: string | null;
    created_at?: string;
  }>;
};

function mapOperatorTokens(rows: OperatorWithTokens[]): AccessToken[] {
  return rows
    .flatMap((row) =>
      (row.tokens ?? []).map((t) => ({
        id: t.id,
        operatorId: row.id,
        createdAt: t.created_at ?? new Date(0).toISOString(),
        expiresAt: t.expires_at ?? new Date(0).toISOString(),
        revokedAt: t.revoked_at ?? null,
        lastUsedAt: t.last_used_at ?? null,
        emailTo: t.delivered_to ?? null,
      }))
    )
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
}

async function fetchOperatorAccessTokens(): Promise<AccessToken[]> {
  const operatorsRes = await p2pApi.listOperators({
    page: 1,
    limit: 200,
    role: 'operator',
  });
  const operators = operatorsRes.items ?? [];
  const hydrated = await Promise.all(
    operators.map(async (op) => {
      try {
        return (await p2pApi.getOperator(op.id)) as OperatorWithTokens;
      } catch {
        return op as OperatorWithTokens;
      }
    })
  );
  return mapOperatorTokens(hydrated);
}

export const useOperatorAccessStore = create<OperatorAccessState>()(
  persist(
    (set, get) => ({
      tokens: [],
      emailLog: [],
      loading: false,
      lastFetchedAt: null,

      fetch: async () => {
        set({ loading: true });
        try {
          const tokens = await fetchOperatorAccessTokens();
          set({ tokens, lastFetchedAt: new Date().toISOString() });
        } finally {
          set({ loading: false });
        }
      },

      issueToken: async (operatorId, opts = {}) => {
        const out = await p2pApi.issueAccessToken(operatorId, {
          ttl_hours: opts.ttlHours,
          delivered_to: opts.emailTo,
        });
        await get().fetch();
        return {
          id: `tmp_${operatorId}_${Date.now()}`,
          token: out.token,
          operatorId,
          createdAt: new Date().toISOString(),
          expiresAt: out.expires_at,
          emailTo: opts.emailTo ?? null,
        };
      },

      rotateToken: async (operatorId, opts = {}) => {
        const out = await p2pApi.rotateAccessToken(operatorId, {
          ttl_hours: opts.ttlHours,
          delivered_to: opts.emailTo,
        });
        await get().fetch();
        return {
          id: `tmp_${operatorId}_${Date.now()}`,
          token: out.token,
          operatorId,
          createdAt: new Date().toISOString(),
          expiresAt: out.expires_at,
          emailTo: opts.emailTo ?? null,
        };
      },

      revokeToken: async (tokenOrId, operatorId) => {
        const byId = get().tokens.find((t) => t.id === tokenOrId);
        if (byId) {
          await p2pApi.revokeAccessToken(byId.id);
          await get().fetch();
          return;
        }

        if (operatorId) {
          const active = get()
            .tokens.filter((t) => t.operatorId === operatorId && !t.revokedAt)
            .sort(
              (a, b) =>
                new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            )[0];
          if (active) {
            await p2pApi.revokeAccessToken(active.id);
            await get().fetch();
            return;
          }
        }
      },

      logEmail: (entry) => {
        const rand = new Uint16Array(1);
        crypto.getRandomValues(rand);
        const full: EmailLogEntry = {
          ...entry,
          id: `mail_${Date.now()}_${rand[0] % 1000}`,
          sentAt: new Date().toISOString(),
        };
        set({ emailLog: [full, ...get().emailLog] });
        return full;
      },
    }),
    {
      name: 'operator-access-storage',
      partialize: (state) => ({
        tokens: state.tokens,
        emailLog: state.emailLog,
        lastFetchedAt: state.lastFetchedAt,
      }),
    }
  )
);
