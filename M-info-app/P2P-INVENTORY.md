# P2P System — what exists today (admin panel + backend)

This file is the single source of truth for what the P2P system **actually
contains right now**, before any mobile-app code is written. Everything
below was extracted from a line-by-line read of `admin-panel-main/src/pages/p2p/*`,
`admin-panel-main/src/store/operatorAccess.ts`, `migrations/*`, and
`backend/src/**`. Nothing here is assumed or imagined.

---

## 1. Backend reality (the part we can call from a phone today)

**P2P routes implemented:** none.
**P2P tables in migrations:** none.
**P2P services / middleware / workers:** none.

The only P2P trace anywhere on the server side is the enum line inside
`migrations/20260507100006_create_transactions.js`:

```
type IN (... 'p2p_deposit', 'p2p_withdrawal', ...)
```

That's it. There is no `p2p_devices` table, no `p2p_swaps`, no
`p2p_commands`, no SMS/USSD log table, no operator-access token table,
no per-tenant provider config — none of it has been built yet.

**Implication for the mobile app:** there is no live API for it to talk
to. We will either need to build the P2P backend alongside the mobile
app, or stub it during mobile development and wire it up later. This
choice must be confirmed before coding starts.

---

## 2. What the Admin Panel implies the P2P system does

These eleven pages live under `admin-panel-main/src/pages/p2p/` and
`admin-panel-main/src/pages/operator/`. None of them call a backend
today — every table and KPI is in-file mock data, except `OperatorAccess`
and `OperatorDashboard`, which read from the persisted zustand store
`store/operatorAccess.ts`.

### 2.1 P2P Dashboard
* **KPIs:** Total Deposits Today, Total Withdrawals Today, Active Wallets
  (e.g. 12 / 15), Failed Transactions, plus three secondary cards
  (Successful Deposits, Successful Withdrawals, Requires Manual Review).
* **Wallet Status table:** Wallet, Status (Online green / Offline red /
  Maintenance yellow), Balance, Daily Limit, Used Today.
* **Capacity table:** Wallet, Pre-Deposit, Commission, Total Capacity,
  Available Capacity (with progress bar — Healthy / 50%+ / Low buckets).
* **Live activity feed:** human-readable events tagged success / pending /
  error.

### 2.2 P2P Transactions
* **Tabs:** All, Deposits, Withdrawals, Failed.
* **Filters:** Date range, Wallet dropdown, Status (Success / Pending /
  Failed).
* **Columns:** Transaction ID, Time, User, Type (Deposit green /
  Withdrawal blue), Wallet, Amount, Reference, Status pills.

### 2.3 Deposit Queue
* SMS-detected deposits awaiting approval.
* **Columns:** ID, User, Amount, Phone, Wallet, Auto-Detected (Auto vs
  Manual), Status, Action.
* **Action:** Approve a row; opens an "SMS Preview" modal with Raw SMS,
  User, Amount, Phone, Wallet, 10-digit Reference.

### 2.4 Withdrawal Queue
* **KPI row:** Pending, Processing, Awaiting Approval (count), Success
  Today, Failed Today.
* **Manual-approval section:** large withdrawals → Approve / Reject; a
  **Set Threshold** modal (in ETB) defines what counts as "large".
* **USSD queue table:** ID, User, Amount, Wallet, Requested, Status,
  Actions (**Retry**, **Switch Wallet** — rules per status).
* **Status badges:** Pending, Processing (pulsing), Success, Failed,
  Awaiting Approval.

### 2.5 Wallet Devices
* Per-device cards showing: Online/Offline pill, enabled toggle, Balance,
  Commission Rate, Pre-Deposit, Total Capacity, Available Capacity bar,
  "Exhausted" badge, Today's Swap summary, Daily Usage bar, Device
  token + Copy, Linked Accounts list (each with enable toggle + remove).
* **Card actions:** Top Up Pre-Deposit, Withdrawal Swap, Add Account,
  PIN, Edit, Logs.
* **Top banner toggle:** Withdrawal Auto-Swap Active/Disabled.
* **Modals:**
  * Register Agent Wallet — Wallet Label, Telebirr Phone, Pre-Deposit,
    Commission Rate, computed Total Capacity, Daily Limit, USSD PIN.
  * Top Up Pre-Deposit — amount + quick amounts + checkboxes for
    "Added vs Pending" and "re-enable wallet".
  * Withdrawal Swap — amount + quick amounts + optional User + preview
    of new capacity.
  * Swap History — Date, Time, Source, Amount, Status, Operator;
    Confirm / Fail buttons for Pending rows.
  * Update USSD PIN — Device, Current PIN, New, Confirm.
  * Add Linked Account — Wallet Device (read-only), New Phone, optional
    Label.
* **Swap statuses:** Added / Pending / Failed; sources: Top-Up vs
  Withdrawal (auto-tagged).

### 2.6 Device Control Panel
* **Summary strip:** Online / Offline counts, Restart All Online,
  Broadcast Command.
* **Device cards:** Name, phone, Online/Offline badge, Last seen,
  Battery %, Signal /5, plus per-device Send / Restart / Disable.
* **Send Command modal:** Target Device, Command Type (Check Balance,
  Withdraw, Restart Device, Force Heartbeat); when "Withdraw" is picked,
  Recipient Phone + Amount (ETB) appear.

### 2.7 Commands Queue
* **Tabs:** All, Pending, In Progress, Success, Failed.
* **Columns:** ID, Device, Command, Reference, Progress (step pipeline),
  Status badge with icon, Timestamp.
* **Lifecycle visualised on the page:**
  `Pending → Sent → Executing → Success` (or `Failed`).

### 2.8 Operators
* **Stat row:** Admin / Operator / Client counts.
* **Filter:** All roles / Admin / Operator / Client.
* **Columns:** Name, Email, Role badge, Assigned Wallets chips, Status
  (Active / Suspended), Last Login.
* **Add modal:** Full Name, Email, Temporary Password, Role (segmented),
  Assigned Wallets toggles when Role = Operator, Status.

### 2.9 Operator Access
* The whole page is backed by `useOperatorAccessStore` (zustand).
* **Per-row actions:** Send Link, Copy link, Rotate, Revoke, Set
  Permissions (the dashboard cards on the operator self-dashboard).
* **Send Link modal:** Deliver-to email + TTL (24h–30d).
* **Email log modal:** Sent, To, From, Subject.
* **Per-token state:** active / no active link / revoked / expired,
  with Last Used timestamp.

### 2.10 Limits & Rules
* **Transaction Limits:** max daily, max per tx, auto-switch toggle +
  threshold slider.
* **Pre-Deposit Exhaustion Failover:** toggles, exhaustion threshold
  slider, block wallet, notify admin/agent, channel SMS / Email / Both.
* **Wallet Priority Order:** ordered list with move up/down + active
  flag.

### 2.11 Commissions
* Default Deposit % and default Withdrawal % rates.
* Per-wallet table with editable rate, processed today, earnings today.
* Per-client overrides table (Client + Deposit % + Withdraw %), add /
  remove rows.

### 2.12 Logs / Monitoring
* **Tabs:** SMS Logs (direction IN/OUT badges + raw text), USSD
  Execution (command, result, duration), Errors (code, source,
  message), Wallet Switches (from → to + reason).
* **Action:** tab-specific CSV export.

### 2.13 Operator Dashboard (`/operator/dashboard?token=...`)
* Public route, gated by a token in the URL, validated client-side via
  `getValidOperatorFromToken`.
* **Permission-gated cards:** Status (Online/Offline), Balance,
  Commission (rate + earned today), Pre-Deposit, Total Capacity,
  Available Capacity, Used Today / Daily Limit, Revenue today / 7d /
  30d.
* **Swap Activity table:** Date, Time, Source, Amount, Status (Added /
  Pending / Failed badges).
* **Footer:** truncated token tail + Sign out (revokes token client-side).

---

## 3. Confirmed permission catalog (from `lib/permissions.ts`)

These are the IDs already enumerated for P2P. Any backend or mobile
authorization code we write should match these strings exactly:

```
p2p.dashboard
p2p.transactions
p2p.deposit_queue.view / .approve
p2p.withdrawal_queue.view / .approve
p2p.wallet_devices.view / .manage / .swap
p2p.wallet_devices.accounts.add / .remove
p2p.device_control
p2p.commands_queue
p2p.operators.view / .manage
p2p.operators.access.view / .send_link / .rotate / .revoke / .set_permissions
p2p.limits.view / .manage
p2p.commissions.view / .manage
p2p.logs

agent.p2p.dashboard
agent.p2p.transactions
agent.p2p.deposit_queue.view / .approve
agent.p2p.withdrawal_queue.view / .approve
agent.p2p.wallet_devices.view / .swap
agent.p2p.commissions.view
agent.p2p.logs

operator.dashboard.view
operator.dashboard.status.view
operator.dashboard.balance.view
operator.dashboard.commission.view
operator.dashboard.pre_deposit.view
operator.dashboard.total_capacity.view
operator.dashboard.available_capacity.view
operator.dashboard.swap_activity.view
operator.dashboard.revenue.view
```

---

## 4. Open questions that block mobile-app construction

1. **Framework.** React Native (Expo / bare) or Flutter?
2. **Who is the user of the mobile app?** Operator (SIM-card owner), agent,
   admin on the go, or multiple roles in one app?
3. **Is the phone the actual P2P "wallet device"** that holds the Telebirr
   SIM and executes USSD, or is the mobile app a **dashboard only**
   that views activity and approves things remotely?
4. **SMS handling.** Should the mobile app read inbound SMS on the device
   and forward to the backend, or does the backend receive SMS via a
   third-party gateway?
5. **USSD execution.** Programmatic on the device via Android telephony
   APIs, or operator copies a code and dials manually?
6. **Authentication model.** Login with phone+password (backed by
   `/api/auth/login` with role `operator`)? One-shot pairing via QR code
   / device token issued by an admin? Magic email link like the current
   `/operator/dashboard?token=...`?
7. **Tenant resolution.** Hardcoded per-build, configured in app
   settings, derived from operator account, or selected at login?
8. **Real-time channel.** Socket.io (the backend already has it), Firebase
   Cloud Messaging push, or polling?
9. **Backend strategy.** Build the P2P backend (tables + routes) ahead
   of, alongside, or after the mobile app? My current recommendation is
   tables → routes → mobile, because no shortcut beats a contract that
   actually exists.
10. **Online vs offline operation.** Should the mobile app be usable
    offline (queue commands locally and sync when online) or strictly
    online?

Each of these has irreversible architectural consequences. Nothing will
be assumed.
