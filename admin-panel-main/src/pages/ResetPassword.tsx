import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Shield,
  Check,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
} from 'lucide-react';
import * as authApi from '../lib/api/auth';
import { ApiError } from '../lib/api/client';

/**
 * Spec mapping (Section 1 — Reset Password):
 *   - User enters new password + confirm password
 *   - Calls POST /api/auth/reset-password with token + new password
 *   - Backend validates the password_reset_tokens row is unused & not expired,
 *     bcrypt-hashes the new password, marks the token as used, revokes every
 *     active refresh token for that user, and writes the audit log entry.
 *   - Token must be present in the URL (?token=...) — produced by the
 *     forgot-password email/SMS flow.
 */
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = (params.get('token') ?? '').trim();
  const navigate = useNavigate();

  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setError('');
    if (!token) {
      setError('No reset token was provided in the URL.');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await authApi.resetPassword(token, newPassword);
      setDone(true);
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.status === 401
            ? 'This reset link is invalid or has expired. Please request a new one.'
            : err.message
          : err instanceof Error
            ? err.message
            : 'Unable to reset password. Please request a new link.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const showInvalid = !done && !token;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-2xl overflow-hidden">
        <div className="px-8 pt-8 pb-4 border-b border-gray-100 flex items-center space-x-3">
          <div className="p-2 bg-indigo-50 rounded-lg">
            <Shield className="h-6 w-6 text-indigo-600" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Reset Password</h1>
        </div>

        <div className="p-8 space-y-5">
          {showInvalid && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-2">
              <ShieldAlert className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <p className="font-semibold text-red-900">This link is not valid</p>
                <p className="text-red-800 mt-1">
                  No reset token was provided in the URL. Please request a new
                  reset link.
                </p>
              </div>
            </div>
          )}

          {!showInvalid && !done && (
            <>
              <div className="flex items-start p-4 bg-green-50 border border-green-200 rounded-lg">
                <ShieldCheck className="h-5 w-5 text-green-600 mr-2 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold text-green-900">Set a new password</p>
                  <p className="text-green-800 mt-0.5">
                    Choose a strong password of at least 8 characters.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  New password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Confirm new password
                </label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {error && (
                  <p className="text-xs text-red-600 mt-1 flex items-start">
                    <AlertTriangle size={12} className="mr-1 mt-0.5 flex-shrink-0" />
                    {error}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="w-full bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-60"
              >
                {submitting ? 'Updating…' : 'Update password'}
              </button>
            </>
          )}

          {done && (
            <div className="space-y-4 text-center py-4">
              <div className="mx-auto w-14 h-14 bg-green-100 rounded-full flex items-center justify-center">
                <Check className="h-8 w-8 text-green-600" />
              </div>
              <div>
                <p className="text-lg font-semibold text-gray-900">Password updated</p>
                <p className="text-sm text-gray-600 mt-1">
                  Your password has been changed. All previous sessions have
                  been signed out. You can now sign in with the new password.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/login')}
                className="w-full bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700 font-medium"
              >
                Back to login
              </button>
            </div>
          )}

          {showInvalid && (
            <button
              type="button"
              onClick={() => navigate('/forgot-password')}
              className="w-full border border-gray-300 bg-white py-2 px-4 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Request a new reset link
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
