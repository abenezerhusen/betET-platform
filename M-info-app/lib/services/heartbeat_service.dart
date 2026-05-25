import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/env.dart';
import '../core/utils/app_logger.dart';
import '../data/api_client.dart';

/// Connection-state coalesced from heartbeat outcomes.
///
///   ok          — last heartbeat succeeded.
///   degraded    — at least one recent failure but fewer than 3 in a row.
///   unreachable — 3+ consecutive failures; UI shows the persistent
///                 notification warning per spec.
enum BackendReachability { ok, degraded, unreachable }

class HeartbeatSnapshot {
  HeartbeatSnapshot({
    required this.reachability,
    required this.lastSuccess,
    required this.consecutiveFailures,
    required this.pendingRequests,
    required this.lastError,
  });

  final BackendReachability reachability;
  final DateTime? lastSuccess;
  final int consecutiveFailures;
  final int pendingRequests;
  final String? lastError;

  static HeartbeatSnapshot initial() => HeartbeatSnapshot(
        reachability: BackendReachability.degraded,
        lastSuccess: null,
        consecutiveFailures: 0,
        pendingRequests: 0,
        lastError: null,
      );

  HeartbeatSnapshot copyWith({
    BackendReachability? reachability,
    DateTime? lastSuccess,
    int? consecutiveFailures,
    int? pendingRequests,
    String? lastError,
  }) =>
      HeartbeatSnapshot(
        reachability: reachability ?? this.reachability,
        lastSuccess: lastSuccess ?? this.lastSuccess,
        consecutiveFailures: consecutiveFailures ?? this.consecutiveFailures,
        pendingRequests: pendingRequests ?? this.pendingRequests,
        lastError: lastError,
      );
}

class HeartbeatNotifier extends StateNotifier<HeartbeatSnapshot> {
  HeartbeatNotifier(this._api) : super(HeartbeatSnapshot.initial());

  final AgentApi? _api;
  Timer? _timer;
  bool _running = false;

  void start() {
    if (_api == null) return; // Pre-config; UI will rebuild and try again.
    if (_running) return;
    _running = true;
    // Fire immediately so the dashboard reflects reachability without
    // a 60s delay on first launch.
    unawaited(_tick());
    _timer = Timer.periodic(Env.heartbeatInterval, (_) => unawaited(_tick()));
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
    _running = false;
  }

  Future<void> _tick() async {
    final api = _api;
    if (api == null) return;
    try {
      final res = await api.heartbeat();
      state = state.copyWith(
        reachability: BackendReachability.ok,
        lastSuccess: res.serverTime,
        consecutiveFailures: 0,
        pendingRequests: res.pendingRequests,
        lastError: null,
      );
    } catch (err) {
      final next = state.consecutiveFailures + 1;
      final reachability = next >= 3
          ? BackendReachability.unreachable
          : BackendReachability.degraded;
      state = state.copyWith(
        reachability: reachability,
        consecutiveFailures: next,
        lastError: err.toString(),
      );
      AppLogger.instance.w('heartbeat failed ($next consecutive): $err');
    }
  }

  @override
  void dispose() {
    stop();
    super.dispose();
  }
}

final heartbeatProvider =
    StateNotifierProvider<HeartbeatNotifier, HeartbeatSnapshot>((ref) {
  final apiAsync = ref.watch(agentApiProvider);
  final api = apiAsync.maybeWhen(data: (a) => a, orElse: () => null);
  final notifier = HeartbeatNotifier(api);
  ref.onDispose(notifier.stop);
  return notifier;
});
