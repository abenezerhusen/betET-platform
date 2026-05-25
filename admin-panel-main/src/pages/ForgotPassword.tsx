import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Shield,
  Mail,
  MessageSquare,
  ArrowLeft,
  Check,
  AlertTriangle,
  Copy,
  Send,
} from 'lucide-react';
import * as authApi from '../lib/api/auth';
import { ApiError } from '../lib/api/client';

type Step = 'request' | 'sent';
type Channel = 'email' | 'sms';

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
const isPhoneLike = (s: string) =>
  /^[+()\-\s\d]+$/.test(s.trim()) && /\d{6,}/.test(s.replace(/\D/g, ''));

/**
 * Spec mapping (Section 1 — Forgot Password):
 *   - User enters their email (or phone for SMS delivery)
 *   - Calls POST /api/auth/forgot-password
 *   - Backend stores hashed reset token with 1h expiry, then notifications
 *     module delivers a reset link via email or SMS based on SmsConfig.
 *   - Frontend never reveals account existence; the backend always returns
 *     success regardless. We show a generic "check your inbox" confirmation.
 */
export function ForgotPassword() {
  const navigate = useNavigate();
  const [channel, setChannel] = useState<Channel>('email');
  const [identifier, setIdentifier] = useState('');
  const [identifierError, setIdentifierError] = useState('');
  const [step, setStep] = useState<Step>('request');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [devToken, setDevToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const validate = () => {
    setIdentifierError('');
    const value = identifier.trim();
    if (!value) {
      setIdentifierError(
        channel === 'email' ? 'Email is required.' : 'Phone number is required.'
      );
      return false;
    }
    if (channel === 'email' && !isEmail(value)) {
      setIdentifierError('Enter a valid email address.');
      return false;
    }
    if (channel === 'sms' && !isPhoneLike(value)) {
      setIdentifierError('Enter a valid phone number.');
      return false;
    }
    return true;
  };

  const submit = async () => {
    setSubmitError('');
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await authApi.forgotPassword(identifier.trim());
      setDevToken(res.dev_token ?? null);
      setStep('sent');
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not send the reset link. Please try again.';
      setSubmitError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const demoLink = devToken
    ? `${window.location.origin}/reset-password?token=${devToken}`
    : '';

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-2xl overflow-hidden">
        <div className="px-8 pt-8 pb-4 border-b border-gray-100">
          <div className="flex items-center space-x-3 mb-2">
            <div className="p-2 bg-indigo-50 rounded-lg">
              <Shield className="h-6 w-6 text-indigo-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">Forgot Password</h1>
          </div>
          <p className="text-sm text-gray-600">
            Reset your admin account password using a secure one-time link sent
            to your email or phone.
          </p>
        </div>

        <div className="p-8 space-y-6">
          {step === 'request' && (
            <>
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">
                  Delivery Method
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setChannel('email');
                      setIdentifierError('');
                    }}
                    className={`flex items-start p-3 border rounded-lg text-left transition ${
                      channel === 'email'
                        ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <Mail
                      size={18}
                      className={`mt-0.5 mr-2 ${
                        channel === 'email' ? 'text-indigo-600' : 'text-gray-400'
                      }`}
                    />
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Email</p>
                      <p className="text-[11px] text-gray-500">Reset link via email</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setChannel('sms');
                      setIdentifierError('');
                    }}
                    className={`flex items-start p-3 border rounded-lg text-left transition ${
                      channel === 'sms'
                        ? 'border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <MessageSquare
                      size={18}
                      className={`mt-0.5 mr-2 ${
                        channel === 'sms' ? 'text-indigo-600' : 'text-gray-400'
                      }`}
                    />
                    <div>
                      <p className="text-sm font-semibold text-gray-900">SMS</p>
                      <p className="text-[11px] text-gray-500">Reset link via SMS</p>
                    </div>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {channel === 'email' ? 'Account Email' : 'Account Phone'}
                </label>
                <input
                  type={channel === 'email' ? 'email' : 'tel'}
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={
                    channel === 'email' ? 'admin@example.com' : '+251 911 000 000'
                  }
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {identifierError && (
                  <p className="text-xs text-red-600 mt-1 flex items-start">
                    <AlertTriangle size={12} className="mr-1 mt-0.5 flex-shrink-0" />
                    {identifierError}
                  </p>
                )}
              </div>

              {submitError && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {submitError}
                </div>
              )}

              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className="w-full inline-flex items-center justify-center bg-indigo-600 text-white py-2 px-4 rounded-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 transition-colors font-medium disabled:opacity-60"
              >
                <Send size={16} className="mr-2" />
                {submitting ? 'Sending…' : 'Send Reset Link'}
              </button>

              <Link
                to="/login"
                className="flex items-center justify-center text-sm text-gray-600 hover:text-gray-900"
              >
                <ArrowLeft size={14} className="mr-1" />
                Back to login
              </Link>
            </>
          )}

          {step === 'sent' && (
            <div className="space-y-4">
              <div className="flex items-start p-4 bg-green-50 border border-green-200 rounded-lg">
                <Check className="h-5 w-5 text-green-600 mr-2 mt-0.5 flex-shrink-0" />
                <div className="text-sm">
                  <p className="font-semibold text-green-900">
                    Reset instructions sent
                  </p>
                  <p className="text-green-800 mt-0.5">
                    If an account matches{' '}
                    <strong>{identifier.trim()}</strong>, a one-time reset link
                    has been delivered via{' '}
                    {channel === 'email' ? 'email' : 'SMS'}. The link expires in
                    60 minutes.
                  </p>
                </div>
              </div>

              {demoLink && (
                <div className="border border-dashed border-indigo-300 rounded-lg p-3 bg-indigo-50/40">
                  <p className="text-[11px] font-semibold text-indigo-900 uppercase tracking-wider mb-1">
                    Preview link (development only)
                  </p>
                  <div className="flex items-center space-x-2">
                    <code className="flex-1 text-[11px] font-mono text-indigo-900 break-all">
                      {demoLink}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(demoLink);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                      className="p-1.5 rounded-md text-indigo-700 hover:bg-indigo-100"
                      title="Copy link"
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate(`/reset-password?token=${devToken}`)}
                    className="mt-2 w-full bg-indigo-600 text-white py-1.5 px-3 rounded-md text-xs font-semibold hover:bg-indigo-700"
                  >
                    Open reset page
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  setStep('request');
                  setDevToken(null);
                  setSubmitError('');
                }}
                className="w-full border border-gray-300 bg-white py-2 px-4 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Send to a different address
              </button>

              <Link
                to="/login"
                className="flex items-center justify-center text-sm text-gray-600 hover:text-gray-900"
              >
                <ArrowLeft size={14} className="mr-1" />
                Back to login
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
