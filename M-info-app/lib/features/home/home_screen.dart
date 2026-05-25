import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../core/storage/offline_queue.dart';
import '../../data/api_client.dart';
import '../../data/models.dart';
import '../../services/background_service.dart';
import '../../services/heartbeat_service.dart';
import '../../services/native_control.dart';
import '../../services/sms_service.dart';
import '../auth/auth_controller.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  Timer? _statusTimer;
  AgentStatus? _status;
  String? _statusError;
  bool _serviceActive = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _startServices();
      _refreshStatus();
      _statusTimer = Timer.periodic(
        const Duration(seconds: 30),
        (_) => _refreshStatus(),
      );
    });
  }

  @override
  void dispose() {
    _statusTimer?.cancel();
    super.dispose();
  }

  Future<void> _startServices() async {
    final sms = ref.read(smsServiceProvider);
    if (sms != null) await sms.start();
    final bg = ref.read(backgroundServiceProvider);
    await bg.ensureInitialised();
    await bg.start();
    await NativeControl.scheduleWatchdog();
    ref.read(heartbeatProvider.notifier).start();
    if (!mounted) return;
    setState(() => _serviceActive = sms?.isStarted ?? false);
  }

  Future<void> _stopServices() async {
    final sms = ref.read(smsServiceProvider);
    if (sms != null) await sms.stop();
    final bg = ref.read(backgroundServiceProvider);
    await bg.stop();
    await NativeControl.cancelWatchdog();
    ref.read(heartbeatProvider.notifier).stop();
    if (!mounted) return;
    setState(() => _serviceActive = false);
  }

  Future<void> _refreshStatus() async {
    final apiAsync = ref.read(agentApiProvider);
    final api = apiAsync.maybeWhen(data: (a) => a, orElse: () => null);
    if (api == null) return;
    try {
      final s = await api.status();
      if (!mounted) return;
      setState(() {
        _status = s;
        _statusError = null;
      });

      // Push notification text for the foreground service.
      final fmt = NumberFormat('#,##0.##');
      ref.read(backgroundServiceProvider).updateNotification(
            title: 'Telebirr Pay: Active',
            body:
                '${s.today.transactionCount} payments today | ETB ${fmt.format(num.tryParse(s.today.totalAmountCredited) ?? 0)}',
          );
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _statusError = err is ApiException ? err.message : err.toString();
      });
    }
  }

  Future<void> _toggleService() async {
    if (_serviceActive) {
      await _stopServices();
    } else {
      await _startServices();
    }
  }

  Future<int> _pendingQueueSize() async {
    return ref.read(offlineQueueProvider).pendingCount();
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authControllerProvider);
    if (auth is! AuthSignedIn) {
      // Router redirects, but defend against rendering before redirect.
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    final session = auth.session;
    final hb = ref.watch(heartbeatProvider);
    final s = _status;

    return Scaffold(
      appBar: AppBar(
        title: Text(session.agentName),
        actions: [
          IconButton(
            tooltip: 'Settings',
            onPressed: () => context.go('/settings'),
            icon: const Icon(Icons.settings),
          ),
          IconButton(
            tooltip: 'Transaction log',
            onPressed: () => context.go('/transactions'),
            icon: const Icon(Icons.receipt_long),
          ),
          IconButton(
            tooltip: 'Sign out',
            onPressed: () async {
              await ref.read(authControllerProvider.notifier).logout();
              await _stopServices();
              if (context.mounted) context.go('/login');
            },
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refreshStatus,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _ServiceCard(
              active: _serviceActive,
              reachability: hb.reachability,
              onToggle: _toggleService,
              telebirrNumber: session.telebirrNumber,
            ),
            const SizedBox(height: 16),
            _StatsGrid(status: s, error: _statusError),
            const SizedBox(height: 16),
            FutureBuilder<int>(
              future: _pendingQueueSize(),
              builder: (context, snap) {
                final size = snap.data ?? 0;
                if (size == 0) return const SizedBox.shrink();
                return Card(
                  color: Colors.amber.shade50,
                  child: ListTile(
                    leading: const Icon(Icons.cloud_off, color: Colors.orange),
                    title: Text('$size SMS waiting to upload'),
                    subtitle: const Text(
                      'Will retry automatically when network is restored.',
                    ),
                  ),
                );
              },
            ),
            const SizedBox(height: 16),
            const _RecentTxList(),
          ],
        ),
      ),
    );
  }
}

class _ServiceCard extends StatelessWidget {
  const _ServiceCard({
    required this.active,
    required this.reachability,
    required this.onToggle,
    required this.telebirrNumber,
  });

  final bool active;
  final BackendReachability reachability;
  final VoidCallback onToggle;
  final String telebirrNumber;

  @override
  Widget build(BuildContext context) {
    final color = active && reachability == BackendReachability.ok
        ? Colors.green
        : reachability == BackendReachability.unreachable
            ? Colors.red
            : Colors.orange;
    final label = active
        ? (reachability == BackendReachability.ok
            ? 'Service Active'
            : reachability == BackendReachability.unreachable
                ? 'Backend Unreachable'
                : 'Service Active (intermittent)')
        : 'Service Stopped';

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Container(
                  width: 12,
                  height: 12,
                  decoration: BoxDecoration(
                    color: color,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        label,
                        style: const TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text(
                        'Paired to $telebirrNumber',
                        style: const TextStyle(color: Colors.black54),
                      ),
                    ],
                  ),
                ),
                FilledButton.tonal(
                  onPressed: onToggle,
                  child: Text(active ? 'Stop' : 'Start'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _StatsGrid extends StatelessWidget {
  const _StatsGrid({required this.status, required this.error});

  final AgentStatus? status;
  final String? error;

  @override
  Widget build(BuildContext context) {
    if (status == null) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: error == null
              ? const Center(child: CircularProgressIndicator())
              : Text(error!, style: const TextStyle(color: Colors.red)),
        ),
      );
    }
    final s = status!;
    final fmt = NumberFormat('#,##0.##');
    final total = num.tryParse(s.today.totalAmountCredited) ?? 0;

    return Row(
      children: [
        Expanded(
          child: _StatCard(
            label: 'SMS today',
            value: '${s.today.transactionCount}',
            icon: Icons.message_outlined,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _StatCard(
            label: 'Pending match',
            value: '${s.today.pendingCount}',
            icon: Icons.schedule,
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: _StatCard(
            label: 'ETB credited',
            value: fmt.format(total),
            icon: Icons.account_balance_wallet_outlined,
          ),
        ),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  const _StatCard({required this.label, required this.value, required this.icon});

  final String label;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, size: 18, color: Colors.deepPurple),
            const SizedBox(height: 8),
            Text(
              value,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            Text(label, style: const TextStyle(color: Colors.black54)),
          ],
        ),
      ),
    );
  }
}

class _RecentTxList extends ConsumerWidget {
  const _RecentTxList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final apiAsync = ref.watch(agentApiProvider);
    final api = apiAsync.maybeWhen(data: (a) => a, orElse: () => null);
    if (api == null) return const SizedBox.shrink();
    return FutureBuilder<List<TxLogEntry>>(
      future: api.recentTransactions(limit: 20),
      builder: (context, snap) {
        if (snap.connectionState == ConnectionState.waiting) {
          return const Card(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Center(child: CircularProgressIndicator()),
            ),
          );
        }
        final items = snap.data ?? const <TxLogEntry>[];
        if (items.isEmpty) {
          return const Card(
            child: ListTile(
              leading: Icon(Icons.inbox),
              title: Text('Recent activity'),
              subtitle: Text('No transactions yet'),
            ),
          );
        }
        return Card(
          child: ListView.separated(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: items.length,
            separatorBuilder: (_, __) => const Divider(height: 1),
            itemBuilder: (context, i) {
              final tx = items[i];
              return ListTile(
                leading: _StatusDot(status: tx.status),
                title: Text('ETB ${tx.amount}'),
                subtitle: Text(tx.senderPhone ?? tx.telebirrRef),
                trailing: Text(
                  DateFormat.Hm().format(tx.createdAt.toLocal()),
                  style: const TextStyle(color: Colors.black54),
                ),
              );
            },
          ),
        );
      },
    );
  }
}

class _StatusDot extends StatelessWidget {
  const _StatusDot({required this.status});

  final String status;

  Color _colorFor(String s) {
    switch (s) {
      case 'credited':
      case 'matched':
        return Colors.green;
      case 'pending':
        return Colors.orange;
      case 'unmatched':
      case 'disputed':
        return Colors.red;
      case 'duplicate':
        return Colors.grey;
      default:
        return Colors.blueGrey;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 10,
      height: 10,
      margin: const EdgeInsets.only(top: 4, right: 8),
      decoration: BoxDecoration(
        color: _colorFor(status),
        shape: BoxShape.circle,
      ),
    );
  }
}
