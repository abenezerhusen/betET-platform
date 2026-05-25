import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/config/app_config.dart';
import '../../core/storage/secure_store.dart';
import '../../data/api_client.dart';
import '../../services/permissions_service.dart';
import '../auth/auth_controller.dart';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  final _backendUrlCtrl = TextEditingController();
  final _oldPasswordCtrl = TextEditingController();
  final _newPasswordCtrl = TextEditingController();
  final _confirmNewPasswordCtrl = TextEditingController();

  bool _savingUrl = false;
  bool _testing = false;
  bool _updatingPassword = false;
  String? _testMsg;
  String? _passwordMsg;

  @override
  void initState() {
    super.initState();
    final cfg = ref.read(appConfigProvider).valueOrNull;
    if (cfg != null) _backendUrlCtrl.text = cfg.backendUrl;
  }

  @override
  void dispose() {
    _backendUrlCtrl.dispose();
    _oldPasswordCtrl.dispose();
    _newPasswordCtrl.dispose();
    _confirmNewPasswordCtrl.dispose();
    super.dispose();
  }

  Future<void> _saveBackendUrl() async {
    setState(() => _savingUrl = true);
    try {
      await ref
          .read(appConfigProvider.notifier)
          .setBackendUrl(_backendUrlCtrl.text.trim());
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Backend URL saved')),
      );
    } finally {
      if (mounted) setState(() => _savingUrl = false);
    }
  }

  Future<void> _testConnection() async {
    setState(() {
      _testing = true;
      _testMsg = null;
    });
    try {
      final url = _backendUrlCtrl.text.trim();
      final api = AgentApi(
        baseUrl: url,
        secureStore: ref.read(secureStoreProvider),
      );
      await api.status();
      if (!mounted) return;
      setState(() => _testMsg = 'Connection successful');
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _testMsg = err is ApiException ? err.message : err.toString();
      });
    } finally {
      if (mounted) setState(() => _testing = false);
    }
  }

  Future<void> _changePassword() async {
    final oldPwd = _oldPasswordCtrl.text;
    final newPwd = _newPasswordCtrl.text;
    final confirm = _confirmNewPasswordCtrl.text;

    if (oldPwd.length < 6 || newPwd.length < 6) {
      setState(() => _passwordMsg = 'Passwords must be at least 6 characters.');
      return;
    }
    if (newPwd != confirm) {
      setState(() => _passwordMsg = 'New password confirmation does not match.');
      return;
    }

    setState(() {
      _updatingPassword = true;
      _passwordMsg = null;
    });
    try {
      final apiAsync = ref.read(agentApiProvider);
      final api = apiAsync.maybeWhen(data: (a) => a, orElse: () => null);
      if (api == null) {
        setState(() => _passwordMsg = 'API unavailable.');
        return;
      }
      // Backend endpoint is not implemented yet in /api/agent.
      // We keep this flow explicit for operator feedback.
      throw ApiException(statusCode: 501, endpoint: 'password.change', body: {
        'message': 'Agent password change endpoint is not available yet.'
      });
    } catch (err) {
      if (!mounted) return;
      setState(() {
        _passwordMsg = err is ApiException ? err.message : err.toString();
      });
    } finally {
      if (mounted) setState(() => _updatingPassword = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final configAsync = ref.watch(appConfigProvider);
    final cfg = configAsync.valueOrNull;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Backend Configuration',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _backendUrlCtrl,
                    keyboardType: TextInputType.url,
                    decoration: const InputDecoration(
                      labelText: 'Backend URL',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      FilledButton.tonal(
                        onPressed: _savingUrl ? null : _saveBackendUrl,
                        child: _savingUrl
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Text('Save URL'),
                      ),
                      const SizedBox(width: 8),
                      FilledButton.tonal(
                        onPressed: _testing ? null : _testConnection,
                        child: _testing
                            ? const SizedBox(
                                width: 14,
                                height: 14,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Text('Test Connection'),
                      ),
                    ],
                  ),
                  if (_testMsg != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      _testMsg!,
                      style: TextStyle(
                        color: _testMsg == 'Connection successful'
                            ? Colors.green
                            : Colors.red,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: SwitchListTile(
              value: cfg?.autostart ?? false,
              onChanged: (v) async {
                await ref.read(appConfigProvider.notifier).setAutostart(v);
                if (!mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                  SnackBar(
                    content: Text(v
                        ? 'Autostart enabled for device boot'
                        : 'Autostart disabled'),
                  ),
                );
              },
              title: const Text('Autostart on Boot'),
              subtitle: const Text('Starts monitoring service automatically after reboot'),
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Permissions',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 12),
                  FilledButton.tonal(
                    onPressed: () async {
                      final ok =
                          await ref.read(permissionsServiceProvider).requestEssential();
                      if (!mounted) return;
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(ok
                              ? 'Required permissions granted'
                              : 'Some permissions are still missing'),
                        ),
                      );
                    },
                    child: const Text('Request / Fix Permissions'),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Change Password',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _oldPasswordCtrl,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Current Password',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _newPasswordCtrl,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'New Password',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _confirmNewPasswordCtrl,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'Confirm New Password',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  FilledButton.tonal(
                    onPressed: _updatingPassword ? null : _changePassword,
                    child: _updatingPassword
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Update Password'),
                  ),
                  if (_passwordMsg != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      _passwordMsg!,
                      style: const TextStyle(color: Colors.red),
                    ),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 12),
          Card(
            child: ListTile(
              title: const Text('Logout'),
              subtitle: const Text('Clear secure session and return to login'),
              trailing: FilledButton(
                onPressed: () async {
                  await ref.read(authControllerProvider.notifier).logout();
                  if (!mounted) return;
                  context.go('/login');
                },
                child: const Text('Logout'),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
