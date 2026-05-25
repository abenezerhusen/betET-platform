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

  bool get isStarted => _started;

  Future<void> start() async {
    if (_started) return;
    _started = true;

    _telephony.listenIncomingSms(
      onNewMessage: (SmsMessage message) async {
        final body = message.body ?? '';
        final sender = message.address ?? '';
        final now = DateTime.now().toUtc();
        final input = '$body|${now.toIso8601String()}|$sender';
        final dedupHash = sha256.convert(utf8.encode(input)).toString();

        await queue.enqueue(
          smsBody: body,
          senderNumber: sender,
          receivedAt: now,
          dedupHash: dedupHash,
        );

        await _drainQueue();
      },
      listenInBackground: false,
    );

    _drainTimer = Timer.periodic(const Duration(seconds: 30), (_) {
      unawaited(_drainQueue());
    });
  }

  Future<void> stop() async {
    _drainTimer?.cancel();
    _drainTimer = null;
    _started = false;
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
