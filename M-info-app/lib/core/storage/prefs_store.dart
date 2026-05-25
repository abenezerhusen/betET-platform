import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Convenience wrapper around SharedPreferences that exposes JSON
/// list/map helpers — these are what the SMS queue and the
/// transaction log are persisted as.
class PrefsStore {
  PrefsStore(this._prefs);

  final SharedPreferences _prefs;

  Future<List<Map<String, dynamic>>> readJsonList(String key) async {
    final raw = _prefs.getString(key);
    if (raw == null || raw.isEmpty) return <Map<String, dynamic>>[];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is List) {
        return decoded
            .whereType<Map>()
            .map((m) => Map<String, dynamic>.from(m))
            .toList();
      }
    } catch (_) {
      // Corrupt blob — return empty so the queue keeps draining new
      // entries while the corruption gets overwritten on the next save.
    }
    return <Map<String, dynamic>>[];
  }

  Future<void> writeJsonList(String key, List<Map<String, dynamic>> rows) {
    return _prefs.setString(key, jsonEncode(rows));
  }

  Future<bool> remove(String key) => _prefs.remove(key);

  bool getBool(String key, {bool fallback = false}) =>
      _prefs.getBool(key) ?? fallback;
  Future<bool> setBool(String key, bool value) => _prefs.setBool(key, value);

  String? getString(String key) => _prefs.getString(key);
  Future<bool> setString(String key, String value) =>
      _prefs.setString(key, value);
}

final prefsStoreProvider = FutureProvider<PrefsStore>((ref) async {
  final prefs = await SharedPreferences.getInstance();
  return PrefsStore(prefs);
});
