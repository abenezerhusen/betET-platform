import 'package:logger/logger.dart';

/// Single shared Logger instance. Filter is chosen so
/// `flutter run` shows debug+ in dev and only warning+ in release —
/// avoids noisy logs in production while keeping rich context in dev.
class AppLogger {
  AppLogger._();

  static final Logger instance = Logger(
    filter: _ReleaseAwareFilter(),
    printer: PrettyPrinter(
      methodCount: 0,
      colors: true,
      printEmojis: false,
      dateTimeFormat: DateTimeFormat.onlyTime,
    ),
  );
}

class _ReleaseAwareFilter extends LogFilter {
  @override
  bool shouldLog(LogEvent event) {
    const isRelease = bool.fromEnvironment('dart.vm.product');
    if (isRelease) {
      return event.level.index >= Level.warning.index;
    }
    return event.level.index >= Level.debug.index;
  }
}
