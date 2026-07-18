import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/config/app_config.dart';
import '../core/storage/secure_store.dart';
import '../core/utils/app_logger.dart';
import 'models.dart';

/// Backend response shapes wrapped in lightweight value classes.
class AgentRefreshResult {
  AgentRefreshResult({required this.token, required this.tokenExpiresAt});
  final String token;
  final DateTime tokenExpiresAt;
}

class SmsReportAck {
  SmsReportAck({required this.received, required this.smsId});
  final bool received;
  final String smsId;
}

class SmsBatchAck {
  SmsBatchAck({
    required this.received,
    required this.inserted,
    required this.duplicates,
    required this.ids,
  });
  final bool received;
  final int inserted;
  final int duplicates;
  final List<String> ids;
}

/// Thin façade over Dio configured for the agent backend.
///
/// Responsibilities:
///   - inject the bearer token on every request,
///   - silent-refresh the token on 401 (single-flight) and replay the
///     original request,
///   - normalise the dynamic backend URL (read from AppConfig at
///     construction; updates require a reset/rebuild).
///
/// The offline queue is NOT wired in here: dispatch-vs-enqueue is a
/// concern of `SmsService`, which knows whether the message is fresh
/// or being re-tried. AgentApi only handles in-flight HTTP.
class AgentApi {
  AgentApi({
    required this.baseUrl,
    required this.secureStore,
  })  : _dio = Dio(BaseOptions(
          baseUrl: baseUrl,
          connectTimeout: const Duration(seconds: 10),
          sendTimeout: const Duration(seconds: 15),
          receiveTimeout: const Duration(seconds: 15),
          headers: <String, dynamic>{
            'content-type': 'application/json',
          },
          // We never throw on non-2xx — handle every status manually so
          // we can distinguish 401 from 5xx in the interceptor.
          validateStatus: (_) => true,
        )) {
    _dio.interceptors.add(_authInterceptor());
  }

  final String baseUrl;
  final SecureStore secureStore;
  final Dio _dio;

  Completer<String?>? _refreshInFlight;

  Interceptor _authInterceptor() {
    return InterceptorsWrapper(
      onRequest: (options, handler) async {
        final skipAuth = options.extra['skipAuth'] == true;
        if (!skipAuth) {
          final token = await secureStore.readToken();
          if (token != null) {
            options.headers['authorization'] = 'Bearer $token';
          }
        }
        return handler.next(options);
      },
      onResponse: (response, handler) async {
        if (response.statusCode != 401) return handler.next(response);
        if (response.requestOptions.extra['retried'] == true) {
          return handler.next(response);
        }
        if (response.requestOptions.extra['skipAuth'] == true) {
          return handler.next(response);
        }
        try {
          final newToken = await _silentRefresh();
          if (newToken == null) return handler.next(response);
          // Replay the original request with the fresh token.
          final replay = response.requestOptions
            ..headers['authorization'] = 'Bearer $newToken'
            ..extra['retried'] = true;
          final retried = await _dio.fetch<dynamic>(replay);
          return handler.resolve(retried);
        } catch (err, st) {
          AppLogger.instance.w(
            'silent refresh failed; returning 401',
            error: err,
            stackTrace: st,
          );
          return handler.next(response);
        }
      },
    );
  }

  /// Coalesced refresh: if a refresh is already in flight, await it
  /// instead of firing a second one (the backend's per-device login
  /// limiter will otherwise throttle us).
  Future<String?> _silentRefresh() async {
    final existing = _refreshInFlight;
    if (existing != null) return existing.future;

    final completer = Completer<String?>();
    _refreshInFlight = completer;

    try {
      final current = await secureStore.readToken();
      if (current == null) {
        completer.complete(null);
        return null;
      }
      final res = await _dio.post<Map<String, dynamic>>(
        '/api/agent/auth/refresh',
        data: <String, dynamic>{'token': current},
        options: Options(extra: <String, dynamic>{'skipAuth': true}),
      );
      if (res.statusCode == 200 && res.data != null) {
        final token = res.data!['token'] as String;
        await secureStore.writeToken(token);
        completer.complete(token);
        return token;
      }
      completer.complete(null);
      return null;
    } catch (err, st) {
      completer.completeError(err, st);
      return null;
    } finally {
      _refreshInFlight = null;
    }
  }

  /* ----------------------------------------------------------------------- */
  /* Auth                                                                    */
  /* ----------------------------------------------------------------------- */

  Future<AgentSession> login({
    required String telebirrNumber,
    required String password,
    required String deviceId,
    String? deviceName,
    String? appVersion,
  }) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/api/agent/auth/login',
      data: <String, dynamic>{
        'telebirrNumber': telebirrNumber,
        'password': password,
        'deviceId': deviceId,
        if (deviceName != null) 'deviceName': deviceName,
        if (appVersion != null) 'appVersion': appVersion,
      },
      options: Options(extra: <String, dynamic>{'skipAuth': true}),
    );
    _ensureOk(res, 'login');
    return AgentSession.fromLoginJson(res.data!);
  }

  Future<AgentRefreshResult> refresh(String token) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/api/agent/auth/refresh',
      data: <String, dynamic>{'token': token},
      options: Options(extra: <String, dynamic>{'skipAuth': true}),
    );
    _ensureOk(res, 'refresh');
    return AgentRefreshResult(
      token: res.data!['token'] as String,
      tokenExpiresAt:
          DateTime.parse(res.data!['token_expires_at'] as String),
    );
  }

  Future<HeartbeatResult> heartbeat({String? appVersion}) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/api/agent/auth/heartbeat',
      data: <String, dynamic>{
        if (appVersion != null) 'appVersion': appVersion,
      },
    );
    _ensureOk(res, 'heartbeat');
    return HeartbeatResult.fromJson(res.data!);
  }

  /* ----------------------------------------------------------------------- */
  /* SMS reporting                                                           */
  /* ----------------------------------------------------------------------- */

  Future<SmsReportAck> reportSms({
    required String smsBody,
    String? senderNumber,
    DateTime? receivedAt,
  }) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/api/agent/sms/report',
      data: <String, dynamic>{
        'smsBody': smsBody,
        if (senderNumber != null) 'senderNumber': senderNumber,
        if (receivedAt != null) 'receivedAt': receivedAt.toUtc().toIso8601String(),
        'deviceTimestamp': DateTime.now().toUtc().toIso8601String(),
      },
    );
    _ensureOk(res, 'sms.report');
    return SmsReportAck(
      received: res.data!['received'] as bool? ?? true,
      smsId: res.data!['smsId'] as String,
    );
  }

  Future<SmsBatchAck> reportSmsBatch(
    List<Map<String, dynamic>> messages,
  ) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/api/agent/sms/batch',
      data: <String, dynamic>{'messages': messages},
    );
    _ensureOk(res, 'sms.batch');
    return SmsBatchAck(
      received: res.data!['received'] as bool? ?? true,
      inserted: (res.data!['inserted'] as num?)?.toInt() ?? 0,
      duplicates: (res.data!['duplicates'] as num?)?.toInt() ?? 0,
      ids: (res.data!['ids'] as List<dynamic>? ?? <dynamic>[])
          .map((e) => e.toString())
          .toList(growable: false),
    );
  }

  /* ----------------------------------------------------------------------- */
  /* Status / transactions                                                   */
  /* ----------------------------------------------------------------------- */

  Future<AgentStatus> status() async {
    final res =
        await _dio.get<Map<String, dynamic>>('/api/agent/status');
    _ensureOk(res, 'status');
    return AgentStatus.fromJson(res.data!);
  }

  /// The agent backend exposes status; transaction listing currently
  /// lives on the cashier/admin endpoints. To support the Transaction
  /// Log screen we layer on a light proxy: the same `/api/agent/status`
  /// includes `pending_total` and aggregates, and we reuse it. When
  /// the backend grows a dedicated `/api/agent/transactions`, the
  /// caller swaps to it without touching the screen.
  Future<List<TxLogEntry>> recentTransactions({int limit = 50}) async {
    final res = await _dio.get<Map<String, dynamic>>(
      '/api/agent/transactions',
      queryParameters: <String, dynamic>{
        'limit': limit,
        'offset': 0,
      },
    );
    _ensureOk(res, 'transactions');
    final items = (res.data?['items'] as List<dynamic>? ?? <dynamic>[])
        .whereType<Map>()
        .map((e) => TxLogEntry.fromJson(Map<String, dynamic>.from(e)))
        .toList(growable: false);
    return items;
  }

  /// Report the outcome of a command back to the backend. For a
  /// `withdraw` command a `success` status triggers the server-side
  /// auto-complete + capacity swap.
  Future<void> updateCommandResult({
    required String id,
    required String status, // 'success' | 'failed'
    Map<String, dynamic>? result,
  }) async {
    final res = await _dio.patch<Map<String, dynamic>>(
      '/api/agent/commands/$id',
      data: <String, dynamic>{
        'status': status,
        if (result != null) 'result': result,
      },
    );
    _ensureOk(res, 'commands.update');
  }

  Future<void> manualConfirm({
    required String telebirrRef,
    required String userId,
  }) async {
    final res = await _dio.post<Map<String, dynamic>>(
      '/api/agent/transaction/$telebirrRef/confirm',
      data: <String, dynamic>{'userId': userId},
    );
    _ensureOk(res, 'manualConfirm');
  }

  /* ----------------------------------------------------------------------- */
  /* Helpers                                                                 */
  /* ----------------------------------------------------------------------- */

  void _ensureOk(Response<dynamic> res, String label) {
    if (res.statusCode == null || res.statusCode! < 200 || res.statusCode! >= 300) {
      throw ApiException(
        statusCode: res.statusCode ?? 0,
        endpoint: label,
        body: res.data,
      );
    }
  }

  /// True for "the request never reached a server" failures. SmsService
  /// uses this to decide whether to enqueue (network) vs surface
  /// (4xx/5xx; backend explicitly rejected).
  static bool isNetworkError(Object e) {
    if (e is SocketException) return true;
    if (e is DioException) {
      switch (e.type) {
        case DioExceptionType.connectionError:
        case DioExceptionType.connectionTimeout:
        case DioExceptionType.sendTimeout:
        case DioExceptionType.receiveTimeout:
          return true;
        case DioExceptionType.unknown:
          return e.error is SocketException;
        default:
          return false;
      }
    }
    return false;
  }
}

class ApiException implements Exception {
  ApiException({
    required this.statusCode,
    required this.endpoint,
    required this.body,
  });
  final int statusCode;
  final String endpoint;
  final dynamic body;

  bool get isUnauthorized => statusCode == 401;
  bool get isRateLimited => statusCode == 429;
  bool get isClientError => statusCode >= 400 && statusCode < 500;
  bool get isServerError => statusCode >= 500;

  String get message {
    final body = this.body;
    if (body is Map) {
      final msg = body['message'] ?? body['error'];
      if (msg is String) return msg;
    }
    return 'Request failed: $endpoint ($statusCode)';
  }

  @override
  String toString() => 'ApiException($statusCode @ $endpoint): $message';
}

/// Provider that builds an [AgentApi] from current AppConfig +
/// SecureStore. Re-creates whenever AppConfig (i.e. backend URL)
/// changes — this is fine because every Service rebinds against
/// `ref.watch(agentApiProvider)`.
final agentApiProvider = Provider<AsyncValue<AgentApi>>((ref) {
  final config = ref.watch(appConfigProvider);
  final secureStore = ref.watch(secureStoreProvider);
  return config.when(
    data: (cfg) => AsyncData(
      AgentApi(baseUrl: cfg.backendUrl, secureStore: secureStore),
    ),
    loading: () => const AsyncLoading(),
    error: (e, st) => AsyncError(e, st),
  );
});
