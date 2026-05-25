import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app.dart';
import 'core/utils/app_logger.dart';
import 'services/background_service.dart';

/// Entry point.
///
/// We perform only synchronous setup here — async work (auth bootstrap,
/// SMS listener, foreground service start) is kicked off lazily by
/// the screens that depend on them. This keeps cold-start time small
/// and avoids racing the splash screen.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  AppLogger.instance.i('Telebirr Pay agent starting…');

  // Wire up the background-service Kotlin <-> Dart channel before any
  // UI shows. ensureInitialised is cheap when already configured.
  final container = ProviderContainer();
  await container.read(backgroundServiceProvider).ensureInitialised();

  runApp(
    UncontrolledProviderScope(
      container: container,
      child: const TelebirrPayApp(),
    ),
  );
}
