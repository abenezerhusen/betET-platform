import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { Clock, KeyRound, ArrowLeft, AlertTriangle, RefreshCw } from 'lucide-react';
import { useSecuritySettings, isSuperAdminUsername } from '../store/securitySettings';
import { z } from 'zod';

const credentialsSchema = z.object({
  username: z.string().trim().min(3, 'Username is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

const otpSchema = z.string().regex(/^\d{6}$/, 'Enter the 6-digit code');

export function Login() {
  const reason =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('reason')
      : null;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  // --- Additive OTP step (only activates when the super admin has enabled
  // the corresponding setting for the given user type). If both toggles are
  // off, the login flow is byte-identical to the original.
  const adminsOtpRequired = useSecuritySettings((s) => s.adminsOtpRequired);
  const superAdminOtpRequired = useSecuritySettings((s) => s.superAdminOtpRequired);
  const fetchSecuritySettings = useSecuritySettings((s) => s.fetchSecuritySettings);
  const [step, setStep] = useState<'credentials' | 'otp'>('credentials');
  const [pendingOtp, setPendingOtp] = useState('');
  const [otpInput, setOtpInput] = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpExpiresAt, setOtpExpiresAt] = useState<number>(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void fetchSecuritySettings().catch(() => {});
  }, [fetchSecuritySettings]);

  useEffect(() => {
    if (step !== 'otp') return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [step]);

  const otpRemaining = useMemo(() => {
    if (!otpExpiresAt) return '';
    const ms = otpExpiresAt - now;
    if (ms <= 0) return 'Expired';
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}m ${s.toString().padStart(2, '0')}s`;
  }, [otpExpiresAt, now]);

  const login = useAuthStore((state) => state.login);
  const loginLogs = useAuthStore((state) => state.loginLogs);
  const navigate = useNavigate();

  const requiresOtpFor = (u: string) => {
    const sa = isSuperAdminUsername(u);
    return sa ? superAdminOtpRequired : adminsOtpRequired;
  };

  const finishLogin = async () => {
    setIsLoading(true);
    setLoginError('');
    try {
      await login(username, password);
      navigate('/dashboard');
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'Login failed. Please check your credentials.';
      setLoginError(message);
      console.error('Login failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const issueMockOtp = () => {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const code = String((buf[0] % 900000) + 100000);
    setPendingOtp(code);
    setOtpInput('');
    setOtpError('');
    setOtpExpiresAt(Date.now() + 5 * 60 * 1000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = credentialsSchema.safeParse({ username, password });
    if (!parsed.success) {
      setLoginError(parsed.error.issues[0]?.message ?? 'Invalid credentials input');
      return;
    }
    setUsername(parsed.data.username);
    setPassword(parsed.data.password);
    // If the super admin has NOT enabled OTP for this user type, behave
    // exactly as before: log in directly.
    if (!requiresOtpFor(parsed.data.username)) {
      await finishLogin();
      return;
    }
    // Otherwise start the additive OTP verification step.
    issueMockOtp();
    setStep('otp');
  };

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setOtpError('');
    if (Date.now() > otpExpiresAt) {
      setOtpError('This code has expired. Please resend a new one.');
      return;
    }
    const otpParsed = otpSchema.safeParse(otpInput.trim());
    if (!otpParsed.success) {
      setOtpError(otpParsed.error.issues[0]?.message ?? 'Invalid OTP');
      return;
    }
    if (otpParsed.data !== pendingOtp) {
      setOtpError('That code is incorrect.');
      return;
    }
    await finishLogin();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center p-4">
      <div className="max-w-4xl w-full flex rounded-xl shadow-2xl overflow-hidden">
        {/* Left side - Login form */}
        <div className="w-full md:w-1/2 bg-white p-8">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Admin Login</h1>
            <p className="text-gray-600">Welcome back! Please login to continue.</p>
          </div>

          {reason === 'session_expired' && (
            <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded p-3 text-yellow-800 text-sm">
              Your session expired. Please log in again.
            </div>
          )}
          
          {step === 'credentials' && (
          <form onSubmit={handleSubmit} className="space-y-6">
            {loginError && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {loginError}
              </div>
            )}
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
                Username
              </label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
            </div>
            
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                required
              />
              <div className="flex justify-end mt-2">
                <Link
                  to="/forgot-password"
                  className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                >
                  Forgot password?
                </Link>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50"
            >
              {isLoading ? 'Logging in...' : 'Login'}
            </button>
          </form>
          )}

          {step === 'otp' && (
            <form onSubmit={handleOtpSubmit} className="space-y-5">
              <button
                type="button"
                onClick={() => {
                  setStep('credentials');
                  setOtpInput('');
                  setOtpError('');
                }}
                className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900"
              >
                <ArrowLeft size={14} className="mr-1" /> Back
              </button>

              <div className="flex items-start p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <KeyRound className="h-5 w-5 text-blue-600 mr-2 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold text-blue-900">Two-step verification</p>
                  <p className="text-blue-800 mt-0.5">
                    A 6-digit code was sent to the email registered to
                    <strong> {username}</strong>.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Enter 6-digit code
                </label>
                <input
                  value={otpInput}
                  onChange={(e) =>
                    setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  inputMode="numeric"
                  placeholder="••••••"
                  autoFocus
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg text-center text-2xl font-mono tracking-[0.5em] focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {otpError && (
                  <p className="text-xs text-red-600 mt-1 flex items-start">
                    <AlertTriangle size={12} className="mr-1 mt-0.5 flex-shrink-0" />
                    {otpError}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-1 flex items-center">
                  <Clock size={12} className="mr-1" />
                  Expires in {otpRemaining}
                </p>
              </div>

              {pendingOtp && (
                <div className="border border-dashed border-indigo-300 rounded-lg p-3 bg-indigo-50/40 text-center">
                  <p className="text-[11px] font-semibold text-indigo-900 uppercase tracking-wider mb-1">
                    Preview code (sandbox only)
                  </p>
                  <code className="text-lg font-mono font-bold text-indigo-900 tracking-widest">
                    {pendingOtp}
                  </code>
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors disabled:opacity-50"
              >
                {isLoading ? 'Verifying...' : 'Verify & Login'}
              </button>

              <button
                type="button"
                onClick={issueMockOtp}
                className="w-full inline-flex items-center justify-center text-sm text-indigo-600 hover:text-indigo-800"
              >
                <RefreshCw size={14} className="mr-1" /> Resend code
              </button>
            </form>
          )}
        </div>

        {/* Right side - Activity Log */}
        <div className="hidden md:block w-1/2 bg-gray-50 p-8">
          <div className="mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Recent Login Activity</h2>
            <p className="text-sm text-gray-600">Track recent login attempts and activities</p>
          </div>

          <div className="space-y-4">
            {loginLogs.map((log, index) => (
              <div key={index} className="bg-white rounded-lg p-4 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-900">{log.username}</span>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    log.status === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {log.status}
                  </span>
                </div>
                <div className="flex items-center text-sm text-gray-500">
                  <Clock className="w-4 h-4 mr-1" />
                  {new Date(log.timestamp).toLocaleString()}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  IP: {log.ipAddress}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
