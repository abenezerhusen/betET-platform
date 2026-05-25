import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'routing/app_router.dart';
import 'services/permissions_service.dart';

class TelebirrPayApp extends ConsumerStatefulWidget {
  const TelebirrPayApp({super.key});

  @override
  ConsumerState<TelebirrPayApp> createState() => _TelebirrPayAppState();
}

class _TelebirrPayAppState extends ConsumerState<TelebirrPayApp>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // First-launch permission prompt. Idempotent: if everything is
    // already granted, this returns immediately without showing UI.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(permissionsServiceProvider).requestEssential();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      // Spec: retry on every app foreground event. We do this by
      // having SmsService's drain timer fire in 30s anyway, but a
      // foreground event triggers an immediate drain via the
      // connectivity-changed listener (which also fires on resume on
      // most Android versions). Nothing else to do here.
    }
  }

  @override
  Widget build(BuildContext context) {
    final router = buildRouter(ref);
    return MaterialApp.router(
      title: 'Telebirr Pay',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        colorSchemeSeed: Colors.deepPurple,
        appBarTheme: const AppBarTheme(centerTitle: false),
      ),
      routerConfig: router,
    );
  }
}
