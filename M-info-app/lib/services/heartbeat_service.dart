import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/env.dart';
import '../core/utils/app_logger.dart';
import '../data/api_client.dart';
import '../data/models.dart';
import 'native_control.dart';

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

  /// Command ids currently being executed or already done this session,
  /// so a command that is still `pending` on the next heartbeat isn't
  /// dialed twice.
  final Set<String> _handledCommands = <String>{};

  /// USSD is serial on one phone: only one session may run at a time. Extra
  /// withdraw commands are skipped and retried on the next heartbeat.
  bool _ussdBusy = false;

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
      // Act on any queued commands (currently only `withdraw`).
      for (final cmd in res.commands) {
        unawaited(_handleCommand(api, cmd));
      }
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

  /// Execute a single command. Only `withdraw` is actioned: dial the
  /// pre-built USSD, then report success/failure back to the backend
  /// (which auto-completes the withdrawal + books the capacity swap).
  Future<void> _handleCommand(AgentApi api, AgentCommand cmd) async {
    if (cmd.commandType != 'withdraw') return;
    if (_handledCommands.contains(cmd.id)) return;
    // Only one USSD session at a time. Leave the command unhandled so the next
    // heartbeat retries it once the current one finishes.
    if (_ussdBusy) return;
    _handledCommands.add(cmd.id);
    _ussdBusy = true;

    final steps = cmd.ussdSteps;
    final initial = cmd.ussdInitial;
    final legacyUssd = cmd.ussd;

    // Prefer the interactive multi-step menu flow; fall back to the legacy
    // one-shot USSD string only when no step flow was supplied.
    final hasFlow = initial != null && initial.isNotEmpty && steps.isNotEmpty;
    if (!hasFlow && (legacyUssd == null || legacyUssd.isEmpty)) {
      AppLogger.instance.w('withdraw command ${cmd.id} has no USSD flow');
      try {
        await api.updateCommandResult(
          id: cmd.id,
          status: 'failed',
          result: <String, dynamic>{'error': 'missing_ussd'},
        );
      } catch (_) {
        _handledCommands.remove(cmd.id); // allow retry next heartbeat
      }
      _ussdBusy = false;
      return;
    }

    try {
      final String response;
      if (hasFlow) {
        AppLogger.instance
            .i('running interactive USSD menu for command ${cmd.id}');
        response = await NativeControl.runUssdSession(
          id: cmd.id,
          initial: initial,
          steps: steps,
        );
      } else {
        AppLogger.instance.i('dialing one-shot USSD for command ${cmd.id}');
        response = await NativeControl.sendUssd(legacyUssd!);
      }
      await api.updateCommandResult(
        id: cmd.id,
        status: 'success',
        result: <String, dynamic>{
          'ussd_response': response,
          'amount': cmd.amount,
          'recipient': cmd.recipientPhone,
        },
      );
      AppLogger.instance.i('withdraw command ${cmd.id} completed');
    } catch (err) {
      AppLogger.instance.w('withdraw command ${cmd.id} failed: $err');
      try {
        await api.updateCommandResult(
          id: cmd.id,
          status: 'failed',
          result: <String, dynamic>{'error': err.toString()},
        );
      } catch (_) {
        // Couldn't even report; drop from handled so we retry later.
        _handledCommands.remove(cmd.id);
      }
    } finally {
      _ussdBusy = false;
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
