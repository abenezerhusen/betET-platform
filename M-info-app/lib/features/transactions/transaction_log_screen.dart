import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/storage/offline_queue.dart';
import '../../data/api_client.dart';
import '../../data/models.dart';

class TransactionLogScreen extends ConsumerStatefulWidget {
  const TransactionLogScreen({super.key});

  @override
  ConsumerState<TransactionLogScreen> createState() =>
      _TransactionLogScreenState();
}

class _TransactionLogScreenState extends ConsumerState<TransactionLogScreen> {
  late Future<List<TxLogEntry>> _future;
  late Future<List<QueuedSms>> _failedFuture;

  @override
  void initState() {
    super.initState();
    _future = _load();
    _failedFuture = _loadFailed();
  }

  Future<List<TxLogEntry>> _load() async {
    final apiAsync = ref.read(agentApiProvider);
    final api = apiAsync.maybeWhen(data: (a) => a, orElse: () => null);
    if (api == null) return const <TxLogEntry>[];
    try {
      return await api.recentTransactions(limit: 100);
    } catch (_) {
      return const <TxLogEntry>[];
    }
  }

  Future<List<QueuedSms>> _loadFailed() async {
    return ref.read(offlineQueueProvider).listFailed(limit: 50);
  }

  Future<void> _refresh() async {
    setState(() {
      _future = _load();
      _failedFuture = _loadFailed();
    });
    await Future.wait<dynamic>([_future, _failedFuture]);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.go('/home'),
        ),
        title: const Text('Transaction Log'),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder<List<TxLogEntry>>(
          future: _future,
          builder: (context, txSnap) {
            return FutureBuilder<List<QueuedSms>>(
              future: _failedFuture,
              builder: (context, failedSnap) {
                final tx = txSnap.data ?? const <TxLogEntry>[];
                final failed = failedSnap.data ?? const <QueuedSms>[];
                if (txSnap.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (tx.isEmpty && failed.isEmpty) {
                  return ListView(
                    children: const [
                      SizedBox(height: 80),
                      Center(
                        child: Padding(
                          padding: EdgeInsets.all(32),
                          child: Text(
                            'No transactions yet.\nIncoming Telebirr SMS will appear here.',
                            textAlign: TextAlign.center,
                            style: TextStyle(color: Colors.black54),
                          ),
                        ),
                      ),
                    ],
                  );
                }
                return ListView(
                  padding: const EdgeInsets.symmetric(vertical: 8),
                  children: [
                    if (failed.isNotEmpty) ...[
                      const Padding(
                        padding: EdgeInsets.fromLTRB(16, 8, 16, 4),
                        child: Text(
                          'Needs manual review',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            color: Colors.red,
                          ),
                        ),
                      ),
                      ...failed.map(
                        (q) => ListTile(
                          leading: const Icon(Icons.error_outline,
                              color: Colors.red),
                          title: Text(
                            q.smsBody,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          subtitle: Text(
                            'Sender ${q.senderNumber ?? 'unknown'} · '
                            'Failed after ${q.attempts} attempts',
                          ),
                          trailing: Text(
                            DateFormat('MMM d HH:mm').format(
                              q.receivedAt.toLocal(),
                            ),
                          ),
                        ),
                      ),
                      const Divider(),
                    ],
                    if (tx.isNotEmpty) ...[
                      const Padding(
                        padding: EdgeInsets.fromLTRB(16, 8, 16, 4),
                        child: Text(
                          'Processed',
                          style: TextStyle(fontWeight: FontWeight.w700),
                        ),
                      ),
                      ...tx.map(
                        (t) => ListTile(
                          leading: _StatusBadge(status: t.status),
                          title: Text('ETB ${t.amount}'),
                          subtitle: Text(
                            t.senderPhone ?? t.telebirrRef,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          trailing: Text(
                            DateFormat('MMM d HH:mm').format(
                              t.createdAt.toLocal(),
                            ),
                            style: const TextStyle(fontSize: 12),
                          ),
                        ),
                      ),
                    ],
                  ],
                );
              },
            );
          },
        ),
      ),
    );
  }
}

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final c = switch (status) {
      'credited' || 'matched' => Colors.green,
      'pending' => Colors.orange,
      'unmatched' || 'disputed' => Colors.red,
      'duplicate' => Colors.grey,
      _ => Colors.blueGrey,
    };
    return Container(
      width: 10,
      height: 10,
      decoration: BoxDecoration(color: c, shape: BoxShape.circle),
    );
  }
}
