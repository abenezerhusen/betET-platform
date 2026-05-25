import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/* Pagination                                                                  */
/* -------------------------------------------------------------------------- */

const paginationSchema = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
};

export const idParamSchema = z.object({ id: z.string().uuid() });

/* -------------------------------------------------------------------------- */
/* Wallet devices (extend telebirr_agents)                                     */
/* -------------------------------------------------------------------------- */

export const listWalletDevicesQuerySchema = z.object({
  status: z.enum(['active', 'inactive', 'suspended', 'online', 'offline']).optional(),
  search: z.string().trim().min(1).optional(),
  ...paginationSchema,
});
export type ListWalletDevicesQuery = z.infer<typeof listWalletDevicesQuerySchema>;

export const registerWalletDeviceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  telebirr_number: z.string().trim().min(7).max(32),
  pre_deposit: z.number().positive(),
  commission_rate: z.number().min(0).max(50).default(2.5),
  daily_limit: z.number().positive().default(100000),
  ussd_pin: z.string().trim().min(4).max(16).optional(),
  device_id: z.string().trim().optional(),
});
export type RegisterWalletDeviceInput = z.infer<typeof registerWalletDeviceSchema>;

export const updateWalletDeviceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateWalletDeviceInput = z.infer<typeof updateWalletDeviceSchema>;

export const topUpSchema = z.object({
  amount: z.number().positive(),
  note: z.string().trim().max(500).optional(),
  re_enable_wallet: z.boolean().optional(),
});
export type TopUpInput = z.infer<typeof topUpSchema>;

export const withdrawalSwapSchema = z.object({
  amount: z.number().positive(),
  ref_user_id: z.string().uuid().optional(),
  ref_withdrawal_id: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional(),
});
export type WithdrawalSwapInput = z.infer<typeof withdrawalSwapSchema>;

export const updateUssdPinSchema = z.object({
  current_pin: z.string().trim().min(4).max(16),
  new_pin: z.string().trim().min(4).max(16),
});
export type UpdateUssdPinInput = z.infer<typeof updateUssdPinSchema>;

/* -------------------------------------------------------------------------- */
/* Sub-accounts                                                                */
/* -------------------------------------------------------------------------- */

export const addSubAccountSchema = z.object({
  phone: z.string().trim().min(7).max(32),
  label: z.string().trim().max(120).optional(),
});
export type AddSubAccountInput = z.infer<typeof addSubAccountSchema>;

export const toggleSubAccountSchema = z.object({
  enabled: z.boolean(),
});
export type ToggleSubAccountInput = z.infer<typeof toggleSubAccountSchema>;

/* -------------------------------------------------------------------------- */
/* Swaps                                                                       */
/* -------------------------------------------------------------------------- */

export const listSwapsQuerySchema = z.object({
  agent_id: z.string().uuid().optional(),
  source: z.enum(['manual', 'withdrawal']).optional(),
  status: z.enum(['pending', 'added', 'failed']).optional(),
  ...paginationSchema,
});
export type ListSwapsQuery = z.infer<typeof listSwapsQuerySchema>;

export const updateSwapStatusSchema = z.object({
  status: z.enum(['added', 'failed']),
  note: z.string().trim().max(500).optional(),
});
export type UpdateSwapStatusInput = z.infer<typeof updateSwapStatusSchema>;

/* -------------------------------------------------------------------------- */
/* Deposit / Withdrawal queues — backed by existing telebirr tables            */
/* -------------------------------------------------------------------------- */

export const listDepositQueueQuerySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  agent_id: z.string().uuid().optional(),
  search: z.string().trim().min(1).optional(),
  ...paginationSchema,
});
export type ListDepositQueueQuery = z.infer<typeof listDepositQueueQuerySchema>;

export const approveDepositSchema = z.object({
  user_id: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional(),
});
export type ApproveDepositInput = z.infer<typeof approveDepositSchema>;

export const rejectDepositSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type RejectDepositInput = z.infer<typeof rejectDepositSchema>;

export const listWithdrawalQueueQuerySchema = z.object({
  status: z.enum([
    'pending',
    'processing',
    'awaiting_approval',
    'success',
    'failed',
  ]).optional(),
  agent_id: z.string().uuid().optional(),
  ...paginationSchema,
});
export type ListWithdrawalQueueQuery = z.infer<typeof listWithdrawalQueueQuerySchema>;

export const setApprovalThresholdSchema = z.object({
  manual_approval_threshold: z.number().nonnegative(),
});
export type SetApprovalThresholdInput = z.infer<typeof setApprovalThresholdSchema>;

export const approveWithdrawalSchema = z.object({
  agent_id: z.string().uuid().optional(),
  note: z.string().trim().max(500).optional(),
});
export type ApproveWithdrawalInput = z.infer<typeof approveWithdrawalSchema>;

export const rejectWithdrawalSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export type RejectWithdrawalInput = z.infer<typeof rejectWithdrawalSchema>;

export const switchWithdrawalWalletSchema = z.object({
  agent_id: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});
export type SwitchWithdrawalWalletInput = z.infer<typeof switchWithdrawalWalletSchema>;

/* -------------------------------------------------------------------------- */
/* Commands                                                                    */
/* -------------------------------------------------------------------------- */

export const listCommandsQuerySchema = z.object({
  status: z
    .enum(['pending', 'sent', 'executing', 'success', 'failed', 'cancelled'])
    .optional(),
  agent_id: z.string().uuid().optional(),
  kind: z.string().optional(),
  ...paginationSchema,
});
export type ListCommandsQuery = z.infer<typeof listCommandsQuerySchema>;

export const issueCommandSchema = z.object({
  agent_id: z.string().uuid(),
  kind: z.enum(['check_balance', 'withdraw', 'restart', 'heartbeat']),
  payload: z.record(z.unknown()).default({}),
  reference: z.string().trim().max(120).optional(),
});
export type IssueCommandInput = z.infer<typeof issueCommandSchema>;

export const broadcastCommandSchema = z.object({
  kind: z.enum(['check_balance', 'restart', 'heartbeat']),
  payload: z.record(z.unknown()).default({}),
});
export type BroadcastCommandInput = z.infer<typeof broadcastCommandSchema>;

export const updateCommandStatusSchema = z.object({
  status: z.enum(['sent', 'executing', 'success', 'failed', 'cancelled']),
  result: z.record(z.unknown()).optional(),
  error_message: z.string().trim().max(2000).optional(),
});
export type UpdateCommandStatusInput = z.infer<typeof updateCommandStatusSchema>;

/* -------------------------------------------------------------------------- */
/* Operators                                                                   */
/* -------------------------------------------------------------------------- */

export const listOperatorsQuerySchema = z.object({
  role: z.enum(['admin', 'operator', 'client']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  search: z.string().trim().min(1).optional(),
  ...paginationSchema,
});
export type ListOperatorsQuery = z.infer<typeof listOperatorsQuerySchema>;

export const createOperatorSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().toLowerCase(),
  role: z.enum(['admin', 'operator', 'client']),
  status: z.enum(['active', 'suspended']).default('active'),
  permissions: z.array(z.string().min(1).max(120)).default([]),
  assigned_agent_ids: z.array(z.string().uuid()).default([]),
  user_id: z.string().uuid().optional(),
});
export type CreateOperatorInput = z.infer<typeof createOperatorSchema>;

export const updateOperatorSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().toLowerCase().optional(),
  role: z.enum(['admin', 'operator', 'client']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  permissions: z.array(z.string().min(1).max(120)).optional(),
});
export type UpdateOperatorInput = z.infer<typeof updateOperatorSchema>;

export const setOperatorAssignmentsSchema = z.object({
  assigned_agent_ids: z.array(z.string().uuid()),
});
export type SetOperatorAssignmentsInput = z.infer<typeof setOperatorAssignmentsSchema>;

export const setOperatorPermissionsSchema = z.object({
  permissions: z.array(z.string().min(1).max(120)),
});
export type SetOperatorPermissionsInput = z.infer<typeof setOperatorPermissionsSchema>;

/* -------------------------------------------------------------------------- */
/* Operator access tokens                                                       */
/* -------------------------------------------------------------------------- */

export const issueAccessTokenSchema = z.object({
  delivered_to: z.string().trim().email().optional(),
  ttl_hours: z.number().int().positive().max(24 * 60).default(24),
});
export type IssueAccessTokenInput = z.infer<typeof issueAccessTokenSchema>;

/* -------------------------------------------------------------------------- */
/* Limits & rules                                                              */
/* -------------------------------------------------------------------------- */

export const updateP2pSettingsSchema = z.object({
  max_daily_per_wallet: z.number().nonnegative().optional(),
  max_per_transaction: z.number().nonnegative().optional(),
  auto_switch_enabled: z.boolean().optional(),
  auto_switch_threshold_pct: z.number().int().min(50).max(100).optional(),
  exhaustion_failover_enabled: z.boolean().optional(),
  exhaustion_threshold_pct: z.number().int().min(0).max(100).optional(),
  block_wallet_on_empty: z.boolean().optional(),
  notify_admin: z.boolean().optional(),
  notify_agent: z.boolean().optional(),
  notify_channel: z.enum(['sms', 'email', 'both']).optional(),
  manual_approval_threshold: z.number().nonnegative().optional(),
  default_deposit_commission_pct: z.number().min(0).max(50).optional(),
  default_withdrawal_commission_pct: z.number().min(0).max(50).optional(),
});
export type UpdateP2pSettingsInput = z.infer<typeof updateP2pSettingsSchema>;

export const setWalletPrioritySchema = z.object({
  items: z
    .array(
      z.object({
        agent_id: z.string().uuid(),
        priority: z.number().int().nonnegative(),
        enabled: z.boolean(),
      })
    )
    .min(1),
});
export type SetWalletPriorityInput = z.infer<typeof setWalletPrioritySchema>;

/* -------------------------------------------------------------------------- */
/* Commissions                                                                 */
/* -------------------------------------------------------------------------- */

export const upsertWalletCommissionSchema = z.object({
  agent_id: z.string().uuid(),
  deposit_pct: z.number().min(0).max(50),
  withdrawal_pct: z.number().min(0).max(50),
});
export type UpsertWalletCommissionInput = z.infer<typeof upsertWalletCommissionSchema>;

export const upsertClientCommissionSchema = z.object({
  user_id: z.string().uuid(),
  deposit_pct: z.number().min(0).max(50),
  withdrawal_pct: z.number().min(0).max(50),
});
export type UpsertClientCommissionInput = z.infer<typeof upsertClientCommissionSchema>;

/* -------------------------------------------------------------------------- */
/* Logs                                                                        */
/* -------------------------------------------------------------------------- */

export const listEventLogsQuerySchema = z.object({
  kind: z
    .enum(['sms_in', 'sms_out', 'ussd', 'error', 'wallet_switch', 'command'])
    .optional(),
  /** Spec uses tab=sms|ussd|errors|switches; map onto `kind` for back-compat */
  tab: z.enum(['sms', 'ussd', 'errors', 'switches']).optional(),
  level: z.enum(['info', 'warning', 'error']).optional(),
  agent_id: z.string().uuid().optional(),
  search: z.string().trim().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  ...paginationSchema,
});
export type ListEventLogsQuery = z.infer<typeof listEventLogsQuerySchema>;

/* -------------------------------------------------------------------------- */
/* Unified P2P transactions list                                              */
/* -------------------------------------------------------------------------- */

export const listTransactionsQuerySchema = z.object({
  tab: z.enum(['all', 'deposit', 'withdrawal', 'failed']).default('all'),
  status: z.enum(['success', 'pending', 'processing', 'failed']).optional(),
  agent_id: z.string().uuid().optional(),
  search: z.string().trim().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  ...paginationSchema,
});
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;
