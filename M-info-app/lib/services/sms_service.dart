import 'dart:async';
import 'dart:convert';

import 'package:another_telephony/telephony.dart';
import 'package:crypto/crypto.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/storage/offline_queue.dart';
import '../core/storage/secure_store.dart';
import '../core/config/app_config.dart';
import '../data/api_client.dart';

class SmsService {
  SmsService({
    required this.api,
    required this.queue,
    required this.secureStore,
  });

  final AgentApi api;
  final OfflineQueue queue;
  final SecureStore secureStore;

  static final Telephony _telephony = Telephony.instance;
  Timer? _drainTimer;
  bool _started = false;

  /// How far back the inbox scan looks. Telebirr payment SMS ("127")
  /// must be picked up even if the real-time listener missed them
  /// (app backgrounded, OEM SMS-broadcast quirks, race on startup).
  static const Duration _inboxLookback = Duration(hours: 24);

  bool get isStarted => _started;

  /// Stable dedup key so the SAME message enqueued by the live listener
  /// and by an inbox scan collapses to one row (the queue's UNIQUE index
  /// ignores the duplicate). Telebirr SMS carry a unique transaction ref
  /// in the body, so `body|sender` uniquely identifies a payment.
  String _dedupHash(String body, String sender) =>
      sha256.convert(utf8.encode('$body|$sender')).toString();

  Future<void> start() async {
    if (_started) return;
    _started = true;

    _telephony.listenIncomingSms(
      onNewMessage: (SmsMessage message) async {
        final body = message.body ?? '';
        final sender = message.address ?? '';
        if (body.isEmpty) return;
        final receivedAt = message.date != null
            ? DateTime.fromMillisecondsSinceEpoch(message.date!).toUtc()
            : DateTime.now().toUtc();

        await queue.enqueue(
          smsBody: body,
          senderNumber: sender,
          receivedAt: receivedAt,
          dedupHash: _dedupHash(body, sender),
        );

        await _drainQueue();
      },
      listenInBackground: false,
    );

    // Catch any payment SMS the live listener missed (arrived while the
    // app wasn't listening). Runs immediately, then on every tick.
    await _scanInbox();
    await _drainQueue();

    _drainTimer = Timer.periodic(const Duration(seconds: 30), (_) async {
      await _scanInbox();
      await _drainQueue();
    });
  }

  Future<void> stop() async {
    _drainTimer?.cancel();
    _drainTimer = null;
    _started = false;
  }

  /// Manually re-scan the inbox and flush the queue. Wired to a
  /// "Sync now" affordance so the agent can force a check right after a
  /// customer says they paid.
  Future<void> syncNow() async {
    await _scanInbox();
    await _drainQueue();
  }

  /// Read recent inbox SMS and enqueue any not already queued. Dedup is
  /// handled by the queue's UNIQUE(dedup_hash) constraint, so re-scanning
  /// the same messages is cheap and safe.
  Future<void> _scanInbox() async {
    try {
      final messages = await _telephony.getInboxSms(
        columns: const [SmsColumn.ADDRESS, SmsColumn.BODY, SmsColumn.DATE],
        sortOrder: [OrderBy(SmsColumn.DATE, sort: Sort.DESC)],
      );
      final cutoff = DateTime.now().toUtc().subtract(_inboxLookback);
      for (final m in messages) {
        final body = m.body ?? '';
        if (body.isEmpty) continue;
        final sender = m.address ?? '';
        final receivedAt = m.date != null
            ? DateTime.fromMillisecondsSinceEpoch(m.date!).toUtc()
            : DateTime.now().toUtc();
        // Inbox is sorted newest-first; once we pass the lookback window
        // everything older is out of scope.
        if (receivedAt.isBefore(cutoff)) break;
        await queue.enqueue(
          smsBody: body,
          senderNumber: sender,
          receivedAt: receivedAt,
          dedupHash: _dedupHash(body, sender),
        );
      }
    } catch (_) {
      // Best-effort; the live listener + next tick will retry.
    }
  }

  Future<void> _drainQueue() async {
    final pending = await queue.takeBatch(limit: 100);
    if (pending.isEmpty) return;

    final token = await secureStore.readToken();
    final cfg = await AppConfig.load();
    final baseUrl = cfg.backendUrl;
    if (token == null || baseUrl.isEmpty) return;

    final messagePayload = pending
        .map((row) {
          final receivedAt = row.receivedAt.toUtc().toIso8601String();
          final sender = row.senderNumber ?? '';
          final input = '${row.smsBody}|$receivedAt|$sender';
          final dedupHash = sha256.convert(utf8.encode(input)).toString();
          return <String, dynamic>{
            'body': row.smsBody,
            'sender': sender,
            'received_at': receivedAt,
            'dedup_hash': row.dedupHash.isEmpty ? dedupHash : row.dedupHash,
          };
        })
        .toList(growable: false);

    try {
      await api.reportSmsBatch(messagePayload);
      for (final row in pending) {
        await queue.markDelivered(row.id);
      }
    } catch (_) {
      for (final row in pending) {
        await queue.recordFailure(row.id, 'batch send failed');
      }
    }
  }
}

final smsServiceProvider = Provider<SmsService?>((ref) {
  final apiAsync = ref.watch(agentApiProvider);
  final queue = ref.watch(offlineQueueProvider);
  final store = ref.watch(secureStoreProvider);
  final api = apiAsync.maybeWhen(data: (a) => a, orElse: () => null);
  if (api == null) return null;
  final svc = SmsService(api: api, queue: queue, secureStore: store);
  ref.onDispose(svc.stop);
  return svc;
});
