/// Domain models the app passes around. Kept in a single file because
/// they're all small and tightly coupled to the same backend module.
///
/// Conventions:
///   - dates are parsed eagerly from ISO strings so the UI can format
///     without re-parsing on every rebuild.
///   - decimal money is left as `String` (matches backend wire format
///     and avoids double-precision loss on display).
///   - `null` means "field absent in this response shape" — never
///     "value missing"; callers default visibly when they see null.

class AgentSession {
  AgentSession({
    required this.token,
    required this.tokenExpiresAt,
    required this.agentId,
    required this.agentName,
    required this.telebirrNumber,
    required this.tenantId,
    required this.tenantName,
    required this.currency,
  });

  final String token;
  final DateTime tokenExpiresAt;
  final String agentId;
  final String agentName;
  final String telebirrNumber;
  final String tenantId;
  final String? tenantName;
  final String currency;

  factory AgentSession.fromLoginJson(Map<String, dynamic> json) {
    final tenant = (json['tenant'] as Map?)?.cast<String, dynamic>();
    final config = (json['config'] as Map?)?.cast<String, dynamic>();
    return AgentSession(
      token: json['token'] as String,
      tokenExpiresAt: DateTime.parse(json['token_expires_at'] as String),
      agentId: json['agent_id'] as String,
      agentName: json['agent_name'] as String,
      telebirrNumber: json['telebirr_number'] as String,
      tenantId: (tenant?['id'] as String?) ??
          (json['tenant_id'] as String? ?? ''),
      tenantName: tenant?['name'] as String?,
      // Currency lives in `config.currency` per the backend contract;
      // we fall back to top-level for forward compatibility.
      currency: (config?['currency'] as String?) ??
          (json['currency'] as String?) ??
          'ETB',
    );
  }

  /// Convert to JSON for SecureStore.writeSession.
  Map<String, dynamic> toJson() => <String, dynamic>{
        'token_expires_at': tokenExpiresAt.toIso8601String(),
        'agent_id': agentId,
        'agent_name': agentName,
        'telebirr_number': telebirrNumber,
        'tenant_id': tenantId,
        'tenant_name': tenantName,
        'currency': currency,
      };

  /// Restore a session from the (token, sessionJson) pair persisted
  /// in SecureStore. Returns null when either piece is missing.
  static AgentSession? fromStored({
    required String? token,
    required Map<String, dynamic>? session,
  }) {
    if (token == null || session == null) return null;
    final exp = session['token_expires_at'];
    if (exp is! String) return null;
    return AgentSession(
      token: token,
      tokenExpiresAt: DateTime.parse(exp),
      agentId: session['agent_id'] as String? ?? '',
      agentName: session['agent_name'] as String? ?? '',
      telebirrNumber: session['telebirr_number'] as String? ?? '',
      tenantId: session['tenant_id'] as String? ?? '',
      tenantName: session['tenant_name'] as String?,
      currency: session['currency'] as String? ?? 'ETB',
    );
  }

  /// Token "soon to expire" check used by the proactive refresher.
  bool isExpiringWithin(Duration window) =>
      DateTime.now().add(window).isAfter(tokenExpiresAt);
}

class AgentTodayStats {
  AgentTodayStats({
    required this.transactionCount,
    required this.totalAmountCredited,
    required this.pendingCount,
    required this.unmatchedCount,
  });

  final int transactionCount;
  final String totalAmountCredited;
  final int pendingCount;
  final int unmatchedCount;

  factory AgentTodayStats.fromJson(Map<String, dynamic> json) =>
      AgentTodayStats(
        transactionCount: (json['transaction_count'] as num?)?.toInt() ?? 0,
        totalAmountCredited:
            json['total_amount_credited']?.toString() ?? '0',
        pendingCount: (json['pending_count'] as num?)?.toInt() ?? 0,
        unmatchedCount: (json['unmatched_count'] as num?)?.toInt() ?? 0,
      );

  static AgentTodayStats empty() => AgentTodayStats(
        transactionCount: 0,
        totalAmountCredited: '0',
        pendingCount: 0,
        unmatchedCount: 0,
      );
}

/// Wallet snapshot returned by `/api/agent/status`. Mirrors the Admin Panel
/// "Wallet Devices" card so the agent app and admin show identical figures.
/// Money values are decimal strings; [commissionRate] is a percentage.
class AgentWallet {
  AgentWallet({
    required this.balance,
    required this.commissionRate,
    required this.preDeposit,
    required this.totalCapacity,
    required this.availableCapacity,
  });

  final String balance;
  final String commissionRate;
  final String preDeposit;
  final String totalCapacity;
  final String availableCapacity;

  factory AgentWallet.fromJson(Map<String, dynamic> json) => AgentWallet(
        balance: json['balance']?.toString() ?? '0',
        commissionRate: json['commission_rate']?.toString() ?? '0',
        preDeposit: json['pre_deposit']?.toString() ?? '0',
        totalCapacity: json['total_capacity']?.toString() ?? '0',
        availableCapacity: json['available_capacity']?.toString() ?? '0',
      );
}

class AgentStatus {
  AgentStatus({
    required this.agentId,
    required this.agentName,
    required this.telebirrNumber,
    required this.status,
    required this.balance,
    required this.lastSeenAt,
    required this.deviceName,
    required this.appVersion,
    required this.wallet,
    required this.today,
    required this.pendingTotal,
    required this.serverTime,
  });

  final String agentId;
  final String agentName;
  final String telebirrNumber;
  final String status;
  final String balance;
  final DateTime? lastSeenAt;
  final String? deviceName;
  final String? appVersion;

  /// Null only for older backends that don't yet return a wallet block.
  final AgentWallet? wallet;
  final AgentTodayStats today;
  final int pendingTotal;
  final DateTime serverTime;

  factory AgentStatus.fromJson(Map<String, dynamic> json) {
    final agent = (json['agent'] as Map).cast<String, dynamic>();
    return AgentStatus(
      agentId: agent['id'] as String,
      agentName: agent['name'] as String,
      telebirrNumber: agent['telebirr_number'] as String,
      status: agent['status'] as String,
      balance: agent['balance']?.toString() ?? '0',
      lastSeenAt: (agent['last_seen_at'] as String?) == null
          ? null
          : DateTime.parse(agent['last_seen_at'] as String),
      deviceName: agent['device_name'] as String?,
      appVersion: agent['app_version'] as String?,
      wallet: (json['wallet'] as Map?) == null
          ? null
          : AgentWallet.fromJson((json['wallet'] as Map).cast<String, dynamic>()),
      today: AgentTodayStats.fromJson(
        ((json['today'] as Map?) ?? <String, dynamic>{})
            .cast<String, dynamic>(),
      ),
      pendingTotal: (json['pending_total'] as num?)?.toInt() ?? 0,
      serverTime: DateTime.parse(json['server_time'] as String),
    );
  }
}

/// Minimal projection of a Telebirr transaction shown in the
/// Transaction Log screen.
class TxLogEntry {
  TxLogEntry({
    required this.id,
    required this.telebirrRef,
    required this.amount,
    required this.currency,
    required this.senderPhone,
    required this.senderName,
    required this.status,
    required this.createdAt,
  });

  final String id;
  final String telebirrRef;
  final String amount;
  final String currency;
  final String? senderPhone;
  final String? senderName;
  final String status; // pending|matched|credited|duplicate|unmatched|disputed
  final DateTime createdAt;

  factory TxLogEntry.fromJson(Map<String, dynamic> json) => TxLogEntry(
        id: json['id'] as String,
        telebirrRef: json['telebirr_ref'] as String? ?? '',
        amount: json['amount']?.toString() ?? '0',
        currency: json['currency'] as String? ?? 'ETB',
        senderPhone: json['sender_phone'] as String?,
        senderName: json['sender_name'] as String?,
        status: json['status'] as String? ?? 'pending',
        createdAt: DateTime.parse(json['created_at'] as String),
      );
}

class HeartbeatResult {
  HeartbeatResult({
    required this.serverTime,
    required this.pendingRequests,
  });

  final DateTime serverTime;
  final int pendingRequests;

  factory HeartbeatResult.fromJson(Map<String, dynamic> json) =>
      HeartbeatResult(
        serverTime: DateTime.parse(json['serverTime'] as String),
        pendingRequests:
            (json['pendingRequests'] as num?)?.toInt() ?? 0,
      );
}
