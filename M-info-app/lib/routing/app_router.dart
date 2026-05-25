import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../features/auth/auth_controller.dart';
import '../features/auth/login_screen.dart';
import '../features/home/home_screen.dart';
import '../features/settings/settings_screen.dart';
import '../features/transactions/transaction_log_screen.dart';

/// ChangeNotifier wired up via `ref.listen` from a Provider so it can
/// legally subscribe to AuthController. go_router uses it to refresh
/// route guards on every auth-state change.
class _AuthRouterNotifier extends ChangeNotifier {
  void bump() => notifyListeners();
}

final _authRouterNotifierProvider = Provider<_AuthRouterNotifier>((ref) {
  final notifier = _AuthRouterNotifier();
  ref.listen<AuthState>(
    authControllerProvider,
    (_, __) => notifier.bump(),
  );
  ref.onDispose(notifier.dispose);
  return notifier;
});

/// `go_router` instance with an auth-aware redirect:
///   - while AuthLoading: show splash (root '/')
///   - signed-in: '/home', '/transactions'
///   - signed-out: '/login'
GoRouter buildRouter(WidgetRef ref) {
  final refreshNotifier = ref.read(_authRouterNotifierProvider);
  return GoRouter(
    initialLocation: '/',
    refreshListenable: refreshNotifier,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final loc = state.matchedLocation;
      if (auth is AuthLoading) return loc == '/' ? null : '/';
      final signedIn = auth is AuthSignedIn;
      if (!signedIn && loc != '/login') return '/login';
      if (signedIn && (loc == '/' || loc == '/login')) return '/home';
      return null;
    },
    routes: [
      GoRoute(
        path: '/',
        builder: (_, __) => const _SplashScreen(),
      ),
      GoRoute(
        path: '/login',
        builder: (_, __) => const LoginScreen(),
      ),
      GoRoute(
        path: '/home',
        builder: (_, __) => const HomeScreen(),
      ),
      GoRoute(
        path: '/transactions',
        builder: (_, __) => const TransactionLogScreen(),
      ),
      GoRoute(
        path: '/settings',
        builder: (_, __) => const SettingsScreen(),
      ),
    ],
  );
}

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: CircularProgressIndicator()),
    );
  }
}
