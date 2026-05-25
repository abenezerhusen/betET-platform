import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

import '../utils/app_logger.dart';

/// One pending SMS report stuck in the offline queue.
///
/// `attempts` is incremented on every failed dispatch; `lastAttempt`
/// is updated regardless of outcome so we can compute backoff. A row
/// disappears from the queue exactly once: either via [QueueOutcome.delivered]
/// (success) or [QueueOutcome.failed] (24h budget exhausted).
class QueuedSms {
  QueuedSms({
    required this.id,
    required this.smsBody,
    required this.senderNumber,
    required this.receivedAt,
    required this.dedupHash,
    required this.attempts,
    required this.lastAttempt,
    required this.firstSeenAt,
  });

  final int id;
  final String smsBody;
  final String? senderNumber;
  final DateTime receivedAt;
  final String dedupHash;
  final int attempts;
  final DateTime? lastAttempt;
  final DateTime firstSeenAt;

  Map<String, dynamic> toRow() => <String, dynamic>{
        'sms_body': smsBody,
        'sender_number': senderNumber,
        'received_at_ms': receivedAt.millisecondsSinceEpoch,
        'dedup_hash': dedupHash,
        'attempts': attempts,
        'last_attempt_ms': lastAttempt?.millisecondsSinceEpoch,
        'first_seen_ms': firstSeenAt.millisecondsSinceEpoch,
      };

  static QueuedSms fromRow(Map<String, Object?> row) => QueuedSms(
        id: row['id']! as int,
        smsBody: row['sms_body']! as String,
        senderNumber: row['sender_number'] as String?,
        receivedAt: DateTime.fromMillisecondsSinceEpoch(
          row['received_at_ms']! as int,
        ),
        dedupHash: row['dedup_hash']! as String,
        attempts: row['attempts']! as int,
        lastAttempt: row['last_attempt_ms'] == null
            ? null
            : DateTime.fromMillisecondsSinceEpoch(
                row['last_attempt_ms']! as int,
              ),
        firstSeenAt: DateTime.fromMillisecondsSinceEpoch(
          row['first_seen_ms']! as int,
        ),
      );
}

enum QueueOutcome { delivered, failed }

/// Maximum age of a pending entry before we give up. Spec: 24 h.
const _kMaxQueueAge = Duration(hours: 24);

/// Maximum retry attempts per row. Spec: 10. We still drop the row
/// when 24h has elapsed regardless of attempt count, whichever comes
/// first.
const _kMaxAttempts = 10;

/// Append-only FIFO of undelivered SMS reports.
///
/// Threading model: every method is `async` and the `Database` instance
/// is opened lazily once. The Sms listener and the retry worker run
/// on the same isolate (the Flutter main isolate), so we don't worry
/// about cross-isolate races; the SQLite serialised writes still give
/// us per-statement atomicity.
class OfflineQueue {
  OfflineQueue();

  Database? _db;
  final _initLock = Completer<void>();
  bool _initStarted = false;

  Future<Database> _openIfNeeded() async {
    if (_db != null) return _db!;
    if (!_initStarted) {
      _initStarted = true;
      try {
        final dir = await getApplicationDocumentsDirectory();
        final path = p.join(dir.path, 'agent_offline_queue.db');
        final db = await openDatabase(
          path,
          version: 2,
          onCreate: (db, _) async {
            await db.execute('''
              CREATE TABLE pending_sms (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                sms_body        TEXT    NOT NULL,
                sender_number   TEXT,
                received_at_ms  INTEGER NOT NULL,
                dedup_hash      TEXT    NOT NULL UNIQUE,
                attempts        INTEGER NOT NULL DEFAULT 0,
                last_attempt_ms INTEGER,
                first_seen_ms   INTEGER NOT NULL,
                delivered       INTEGER NOT NULL DEFAULT 0,
                failed_reason   TEXT
              )
            ''');
            await db.execute(
              'CREATE INDEX idx_pending_sms_state ON pending_sms (delivered, last_attempt_ms)',
            );
            await db.execute(
              'CREATE INDEX idx_pending_sms_dedup ON pending_sms (dedup_hash)',
            );
          },
          onUpgrade: (db, oldVersion, newVersion) async {
            if (oldVersion < 2) {
              await db.execute(
                'ALTER TABLE pending_sms ADD COLUMN dedup_hash TEXT',
              );
              await db.execute('''
                UPDATE pending_sms
                   SET dedup_hash = lower(hex(randomblob(16)))
                 WHERE dedup_hash IS NULL OR dedup_hash = ''
              ''');
              await db.execute(
                'CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_sms_dedup ON pending_sms (dedup_hash)',
              );
            }
          },
        );
        _db = db;
        _initLock.complete();
      } catch (err, st) {
        AppLogger.instance.e('OfflineQueue init failed', error: err, stackTrace: st);
        _initLock.completeError(err, st);
        rethrow;
      }
    }
    await _initLock.future;
    return _db!;
  }

  /// Insert a new SMS report into the queue. Idempotent: SMS bodies
  /// are not deduped here (the backend's dedup_hash handles that on
  /// the BATCH endpoint). Local dedup would require a hash column the
  /// device can't generate without `agentId`, which we don't always
  /// have during offline ingest.
  Future<int> enqueue({
    required String smsBody,
    required String? senderNumber,
    required DateTime receivedAt,
    required String dedupHash,
  }) async {
    final db = await _openIfNeeded();
    final now = DateTime.now().millisecondsSinceEpoch;
    return db.insert(
      'pending_sms',
      <String, Object?>{
        'sms_body': smsBody,
        'sender_number': senderNumber,
        'received_at_ms': receivedAt.millisecondsSinceEpoch,
        'dedup_hash': dedupHash,
        'attempts': 0,
        'last_attempt_ms': null,
        'first_seen_ms': now,
        'delivered': 0,
        'failed_reason': null,
      },
      conflictAlgorithm: ConflictAlgorithm.ignore,
    );
  }

  /// Pull the next batch of UNDELIVERED rows ordered by `received_at`
  /// ascending so older messages drain first. We exclude rows that
  /// were retried less than [minBackoff] ago to avoid hammering the
  /// backend during transient outages.
  Future<List<QueuedSms>> takeBatch({
    int limit = 50,
    Duration minBackoff = Duration.zero,
  }) async {
    final db = await _openIfNeeded();
    final cutoff = DateTime.now()
        .subtract(minBackoff)
        .millisecondsSinceEpoch;
    final rows = await db.query(
      'pending_sms',
      where:
          'delivered = 0 AND (last_attempt_ms IS NULL OR last_attempt_ms <= ?)',
      whereArgs: <Object>[cutoff],
      orderBy: 'received_at_ms ASC',
      limit: limit,
    );
    return rows.map(QueuedSms.fromRow).toList(growable: false);
  }

  /// Count of rows still pending (not delivered, not given-up).
  Future<int> pendingCount() async {
    final db = await _openIfNeeded();
    final r = await db
        .rawQuery('SELECT COUNT(*) AS c FROM pending_sms WHERE delivered = 0');
    return Sqflite.firstIntValue(r) ?? 0;
  }

  /// Mark a row as delivered (success path). Row stays in the table
  /// for a short forensic window; [purgeDelivered] cleans it up.
  Future<void> markDelivered(int id) async {
    final db = await _openIfNeeded();
    await db.update(
      'pending_sms',
      <String, Object?>{
        'delivered': 1,
        'last_attempt_ms': DateTime.now().millisecondsSinceEpoch,
      },
      where: 'id = ?',
      whereArgs: <Object>[id],
    );
  }

  /// Bump attempts + lastAttempt. Returns the new attempts count so
  /// the caller can decide whether to give up.
  Future<int> recordFailure(int id, String reason) async {
    final db = await _openIfNeeded();
    final now = DateTime.now().millisecondsSinceEpoch;
    final updated = await db.rawUpdate(
      '''UPDATE pending_sms
            SET attempts = attempts + 1,
                last_attempt_ms = ?,
                failed_reason = ?
          WHERE id = ?''',
      <Object>[now, reason, id],
    );
    if (updated == 0) return 0;
    final r = await db.query(
      'pending_sms',
      columns: <String>['attempts', 'first_seen_ms'],
      where: 'id = ?',
      whereArgs: <Object>[id],
    );
    if (r.isEmpty) return 0;
    final attempts = r.first['attempts']! as int;
    final firstSeen = r.first['first_seen_ms']! as int;
    final age = DateTime.now().millisecondsSinceEpoch - firstSeen;
    if (attempts >= _kMaxAttempts || age >= _kMaxQueueAge.inMilliseconds) {
      // 24h budget exhausted OR retries exhausted: mark as failed so
      // it stops re-entering the worker. Surface it in the UI for
      // manual review.
      await db.update(
        'pending_sms',
        <String, Object?>{'delivered': 2}, // 2 = failed (terminal, non-success)
        where: 'id = ?',
        whereArgs: <Object>[id],
      );
    }
    return attempts;
  }

  /// Rows that are stuck in the failed state — the UI shows these so
  /// an operator can resolve them (resend manually, contact admin).
  Future<List<QueuedSms>> listFailed({int limit = 100}) async {
    final db = await _openIfNeeded();
    final rows = await db.query(
      'pending_sms',
      where: 'delivered = 2',
      orderBy: 'received_at_ms DESC',
      limit: limit,
    );
    return rows.map(QueuedSms.fromRow).toList(growable: false);
  }

  /// Wipe rows that successfully delivered more than [olderThan] ago.
  /// Called on app foreground to keep the table small.
  Future<int> purgeDelivered({
    Duration olderThan = const Duration(days: 7),
  }) async {
    final db = await _openIfNeeded();
    final cutoff = DateTime.now()
        .subtract(olderThan)
        .millisecondsSinceEpoch;
    return db.delete(
      'pending_sms',
      where: 'delivered = 1 AND last_attempt_ms < ?',
      whereArgs: <Object>[cutoff],
    );
  }

  Future<void> close() async {
    await _db?.close();
    _db = null;
  }
}

final offlineQueueProvider = Provider<OfflineQueue>((ref) {
  final q = OfflineQueue();
  ref.onDispose(q.close);
  return q;
});
