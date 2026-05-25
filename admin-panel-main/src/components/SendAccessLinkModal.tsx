import React, { useMemo, useState } from 'react';
import { X, Mail, Shield, Clock, Link as LinkIcon, Copy, Check, Send, AlertTriangle } from 'lucide-react';
import { useOperatorAccessStore } from '../store/operatorAccess';
import type { OperatorRow } from '../lib/api/p2p';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  operator: OperatorRow | null;
  /** from address used for the no-reply mailer */
  fromAddress?: string;
  /** Origin used to build the full dashboard URL. Defaults to window.location.origin. */
  origin?: string;
}

const TTL_OPTIONS: Array<{ label: string; hours: number }> = [
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
];

export function SendAccessLinkModal({
  isOpen,
  onClose,
  operator,
  fromAddress = 'no-reply@betops.et',
  origin,
}: Props) {
  const issueToken = useOperatorAccessStore((s) => s.issueToken);
  const logEmail = useOperatorAccessStore((s) => s.logEmail);

  const [ttlHours, setTtlHours] = useState(24);
  const [emailTo, setEmailTo] = useState(operator?.ownerEmail || '');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [sentAt, setSentAt] = useState<string | null>(null);

  // keep email field in sync when operator changes
  React.useEffect(() => {
    if (operator) {
      setEmailTo(operator.email);
      setIssuedToken(null);
      setSentAt(null);
      setTtlHours(24);
    }
  }, [operator?.id]);

  const resolvedOrigin = origin || (typeof window !== 'undefined' ? window.location.origin : '');
  const dashboardUrl = useMemo(() => {
    if (!issuedToken) return '';
    return `${resolvedOrigin}/operator/dashboard?token=${issuedToken}`;
  }, [resolvedOrigin, issuedToken]);

  if (!isOpen || !operator) return null;

  const handleIssueAndSend = async () => {
    const tok = await issueToken(operator.id, { ttlHours, emailTo });
    setIssuedToken(tok.token);
    const mail = logEmail({
      operatorId: operator.id,
      to: emailTo,
      from: fromAddress,
      subject: `Your secure dashboard access — ${operator.name}`,
      tokenId: tok.token,
    });
    setSentAt(mail.sentAt);
  };

  const handleCopy = async () => {
    if (!dashboardUrl) return;
    try {
      await navigator.clipboard.writeText(dashboardUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const expiryLabel = TTL_OPTIONS.find((o) => o.hours === ttlHours)?.label || `${ttlHours}h`;

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[92vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center space-x-2">
            <Mail className="h-5 w-5 text-blue-600" />
            <div>
              <h3 className="text-lg font-medium text-gray-900">
                Send Secure Access Link
              </h3>
              <p className="text-xs text-gray-500">
                {operator.name}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto scrollbar-thin p-6 space-y-5">
          {!issuedToken && (
            <>
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-start space-x-2">
                <Shield className="h-4 w-4 text-blue-700 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-blue-900 leading-relaxed">
                  A one-time cryptographically random token will be generated and embedded in the
                  link. Opening the link signs the operator into a read-only dashboard limited to
                  their SIM account only. You can revoke it at any time.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Deliver to (email)
                  </label>
                  <input
                    type="email"
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Link expires in
                  </label>
                  <select
                    value={ttlHours}
                    onChange={(e) => setTtlHours(parseInt(e.target.value, 10))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    {TTL_OPTIONS.map((o) => (
                      <option key={o.hours} value={o.hours}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 overflow-hidden">
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 text-[11px] font-medium text-gray-600 uppercase tracking-wider">
                  Email preview
                </div>
                <div className="p-4 space-y-2 text-sm">
                  <div className="grid grid-cols-[72px_1fr] gap-1 text-xs">
                    <span className="text-gray-500">From:</span>
                    <span className="text-gray-900 font-mono">{fromAddress}</span>
                    <span className="text-gray-500">To:</span>
                    <span className="text-gray-900 font-mono">{emailTo || '—'}</span>
                    <span className="text-gray-500">Subject:</span>
                    <span className="text-gray-900">
                      Your secure dashboard access — {operator.name}
                    </span>
                  </div>
                  <hr className="my-2" />
                  <div className="text-sm text-gray-800 space-y-3">
                    <p>Hello {operator.name},</p>
                    <p>
                      An administrator has granted you secure access to your operator dashboard
                      for <strong>{operator.name}</strong>. Click the button below to sign
                      in. No password is required — the link itself authenticates you.
                    </p>
                    <div className="bg-blue-600 text-white text-center rounded-md py-2 px-4 text-sm font-semibold">
                      Open my operator dashboard
                    </div>
                    <p className="text-xs text-gray-600">
                      For security reasons this link expires in{' '}
                      <strong>{expiryLabel}</strong>. If you did not request access, please
                      ignore this email and notify your administrator.
                    </p>
                    <p className="text-[11px] text-gray-500 italic">
                      This is an automated message from {fromAddress}. Please do not reply.
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {issuedToken && (
            <>
              <div className="bg-green-50 border border-green-100 rounded-lg p-3 flex items-start space-x-2">
                <Check className="h-4 w-4 text-green-700 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-green-900 leading-relaxed">
                  <p className="font-semibold">Email sent.</p>
                  <p>
                    An email with the secure access link was delivered to{' '}
                    <span className="font-mono">{emailTo}</span> from{' '}
                    <span className="font-mono">{fromAddress}</span>
                    {sentAt ? ` at ${new Date(sentAt).toLocaleString()}` : ''}. You can also share
                    the link below manually if needed.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Secure dashboard link
                </label>
                <div className="flex items-center space-x-2">
                  <div className="flex-1 flex items-center border border-gray-300 rounded-md overflow-hidden bg-gray-50">
                    <div className="px-2 py-2 text-gray-400">
                      <LinkIcon size={14} />
                    </div>
                    <code className="flex-1 px-1 py-2 text-[11px] text-gray-900 font-mono truncate">
                      {dashboardUrl}
                    </code>
                  </div>
                  <button
                    onClick={handleCopy}
                    className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 bg-white hover:bg-gray-50"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    <span className="ml-1">{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              <div className="bg-yellow-50 border border-yellow-100 rounded-lg p-3 flex items-start space-x-2">
                <Clock className="h-4 w-4 text-yellow-700 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-yellow-900">
                  The link expires in <strong>{expiryLabel}</strong>. Any previously active link
                  for this operator has been automatically revoked to keep only one session live.
                </p>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-start space-x-2">
                <AlertTriangle className="h-4 w-4 text-gray-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-gray-700">
                  In production the token verification, rate limiting, and email delivery run
                  server-side via the configured no-reply mailer. Do not share this link over
                  insecure channels.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
          {!issuedToken ? (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleIssueAndSend()}
                disabled={!emailTo.trim()}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                <Send size={14} className="mr-1.5" />
                Send Secure Link
              </button>
            </>
          ) : (
            <button
              onClick={onClose}
              className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
