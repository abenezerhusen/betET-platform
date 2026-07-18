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

class _HomeScreenState extends ConsumerState<HomeScreen>
    with WidgetsBindingObserver {
  Timer? _statusTimer;
  AgentStatus? _status;
  String? _statusError;
  bool _serviceActive = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _startServices();
      _refreshStatus();
      // Poll frequently so Balance / Pre-Deposit / Capacity reflect deposits
      // and withdrawals almost live while the operator is watching.
      _statusTimer = Timer.periodic(
        const Duration(seconds: 8),
        (_) => _refreshStatus(),
      );
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Refresh the moment the operator brings the app back to the foreground,
    // so the wallet card is never stale after being in the background.
    if (state == AppLifecycleState.resumed) {
      _refreshStatus();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
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
            _WalletCard(
              status: s,
              error: _statusError,
              currency: session.currency,
            ),
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

/// Wallet snapshot card. Shows the SAME figures as the Admin Panel
/// "Wallet Devices" card (Status / Balance / Commission Rate / Pre-Deposit /
/// Total Capacity / Available Capacity) so the agent and admin views match.
class _WalletCard extends StatelessWidget {
  const _WalletCard({
    required this.status,
    required this.error,
    required this.currency,
  });

  final AgentStatus? status;
  final String? error;
  final String currency;

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
    String money(String raw) =>
        '$currency ${fmt.format(num.tryParse(raw) ?? 0)}';

    // Fall back to the agent block for older backends without a wallet block.
    final w = s.wallet;
    final balance = w?.balance ?? s.balance;
    final commission = w?.commissionRate ?? '0';
    final preDeposit = w?.preDeposit ?? '0';
    final totalCapacity = w?.totalCapacity ?? '0';
    final availableCapacity = w?.availableCapacity ?? '0';

    final online = s.status == 'online' || s.status == 'active';
    final total = num.tryParse(totalCapacity) ?? 0;
    final available = num.tryParse(availableCapacity) ?? 0;
    final exhausted = total <= 0 ? true : (available / total) < 0.05;

    return Card(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Column(
          children: [
            _WalletRow(
              label: 'Status',
              trailing: _Badge(
                text: online ? 'Online' : 'Offline',
                color: online ? Colors.green : Colors.blueGrey,
              ),
            ),
            const Divider(height: 1),
            _WalletRow(label: 'Balance', value: money(balance)),
            const Divider(height: 1),
            _WalletRow(
              label: 'Commission Rate',
              value: '$commission%',
              valueColor: Colors.blue,
            ),
            const Divider(height: 1),
            _WalletRow(label: 'Pre-Deposit', value: money(preDeposit)),
            const Divider(height: 1),
            _WalletRow(label: 'Total Capacity', value: money(totalCapacity)),
            const Divider(height: 1),
            _WalletRow(
              label: 'Available Capacity',
              value: money(availableCapacity),
              labelTrailing: exhausted
                  ? const _Badge(text: 'Exhausted', color: Colors.red)
                  : null,
            ),
          ],
        ),
      ),
    );
  }
}

/// A single label/value row in the wallet card.
class _WalletRow extends StatelessWidget {
  const _WalletRow({
    required this.label,
    this.value,
    this.valueColor,
    this.trailing,
    this.labelTrailing,
  });

  final String label;
  final String? value;
  final Color? valueColor;

  /// Custom trailing widget (e.g. a badge) shown instead of [value].
  final Widget? trailing;

  /// Small widget shown right after the label (e.g. the "Exhausted" badge).
  final Widget? labelTrailing;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 14),
      child: Row(
        children: [
          Text(label, style: const TextStyle(color: Colors.black54)),
          if (labelTrailing != null) ...[
            const SizedBox(width: 8),
            labelTrailing!,
          ],
          const Spacer(),
          if (trailing != null)
            trailing!
          else
            Text(
              value ?? '',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: valueColor ?? Colors.black87,
              ),
            ),
        ],
      ),
    );
  }
}

/// Small pill badge used for Status and the Exhausted marker.
class _Badge extends StatelessWidget {
  const _Badge({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}
