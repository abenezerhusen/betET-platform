import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownCircle, MessageSquare, CheckCircle, X } from 'lucide-react';
import { toast } from '../../lib/toast';
import { ApiError } from '../../lib/api/client';
import {
  approveDeposit,
  listDepositQueue,
  rejectDeposit,
  type DepositQueueRow,
} from '../../lib/api/p2p';

interface DepositRow {
  id: string;
  user: string;
  amount: string;
  phone: string;
  wallet: string;
  reference: string;
  autoDetected: boolean;
  status: string;
  smsPreview: string;
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

function mapApiRow(row: DepositQueueRow): DepositRow {
  // Backend p2p_deposits statuses are 'pending' | 'approved' | 'rejected'
  // ('matched'/'pending_review' are older aliases). Auto-matched deposits are
  // reconciled to 'approved' by the matcher, so they render as success with no
  // action buttons — only 'pending' (unmatched) deposits need approve/reject.
  const raw = String(row.status ?? '').toLowerCase();
  let status = 'Pending';
  if (raw === 'approved' || raw === 'matched') status = 'Approved';
  else if (raw === 'rejected') status = 'Rejected';
  else status = 'Pending';

  const amt = row.amount != null ? Number(row.amount) : NaN;
  const amount =
    Number.isFinite(amt) ? `ETB ${amt.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : String(row.amount ?? '—');

  const phone = String(row.sender_phone ?? '—');
  const reference = String(row.reference ?? '—');
  const wallet = String(row.wallet ?? '—');
  const user =
    String(row.user_email ?? row.user_phone ?? row.sender_name ?? row.user_id ?? '—').trim() || '—';
  const autoDetected = Boolean(row.user_id);

  const smsPreview = `Inbound deposit ${amount} from ${phone}. Ref: ${reference}. Wallet: ${wallet}.`;

  return {
    id: String(row.id),
    user,
    amount,
    phone,
    wallet,
    reference,
    autoDetected,
    status,
    smsPreview,
  };
}

export function DepositQueue() {
  const [rows, setRows] = useState<DepositRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DepositRow | null>(null);
  const [rejecting, setRejecting] = useState<DepositRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listDepositQueue({ page: 1, limit: 200 });
      setRows((res.items ?? []).map(mapApiRow));
    } catch (e) {
      toast(errMsg(e), 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pendingCount = useMemo(() => rows.filter((r) => r.status === 'Pending').length, [rows]);

  const headers = ['ID', 'User', 'Amount', 'Phone', 'Wallet', 'Auto-Detected', 'Status', 'Action'];

  const onApprove = async (row: DepositRow) => {
    try {
      await approveDeposit(row.id, {});
      toast('Deposit approved.');
      setSelected(null);
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const onRejectSubmit = async () => {
    if (!rejecting) return;
    const reason = rejectReason.trim();
    if (!reason) {
      toast('A reject reason is required.', 'error');
      return;
    }
    try {
      await rejectDeposit(rejecting.id, { reason });
      toast('Deposit rejected.');
      setRejecting(null);
      setRejectReason('');
      setSelected(null);
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <ArrowDownCircle className="h-8 w-8 text-green-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Deposit Queue</h1>
        </div>
        <div className="flex items-center space-x-3 text-sm text-gray-500">
          <span className="inline-flex items-center px-3 py-1 bg-yellow-50 border border-yellow-200 rounded-full">
            <span className="h-2 w-2 rounded-full bg-yellow-500 mr-2"></span>
            {loading ? '…' : `${pendingCount} Pending`}
          </span>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">SMS-Based Deposit Detection</h2>
          <p className="text-sm text-gray-500 mt-1">
            Auto-detected deposits are matched from incoming SMS on wallet devices. Manual approvals are required for partial matches.
          </p>
        </div>
        <div onClick={() => setSelected(null)} className="cursor-default">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {headers.map((h) => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading && (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-sm text-gray-500">
                    Loading deposits…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-8 text-center text-sm text-gray-500">
                    No deposit queue rows returned from the API.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((row) => (
                  <tr key={row.id} onClick={() => setSelected(row)} className="hover:bg-gray-50 cursor-pointer">
                    <td className="px-6 py-4 text-sm text-gray-500 font-mono">{row.id.slice(0, 8)}…</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{row.user}</td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{row.amount}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{row.phone}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{row.wallet}</td>
                    <td className="px-6 py-4 text-sm">
                      {row.autoDetected ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          Auto
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                          Manual
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          row.status === 'Approved'
                            ? 'bg-green-100 text-green-800'
                            : row.status === 'Pending'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex items-center space-x-2">
                        {row.status === 'Pending' && (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void onApprove(row);
                              }}
                              className="inline-flex items-center px-2.5 py-1 border border-transparent rounded text-xs font-medium text-white bg-green-600 hover:bg-green-700"
                            >
                              <CheckCircle size={12} className="mr-1" /> Approve
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setRejecting(row);
                                setRejectReason('');
                              }}
                              className="inline-flex items-center px-2.5 py-1 border border-gray-300 rounded text-xs font-medium text-gray-700 bg-white hover:bg-gray-50"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelected(row);
                          }}
                          className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                        >
                          View SMS
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center space-x-2">
                <MessageSquare className="h-5 w-5 text-blue-600" />
                <h3 className="text-lg font-medium text-gray-900">SMS Preview</h3>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <p className="text-xs text-gray-500 mb-1">Summary</p>
                <p className="text-sm text-gray-900 font-mono">{selected.smsPreview}</p>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">User</p>
                  <p className="font-medium text-gray-900">{selected.user}</p>
                </div>
                <div>
                  <p className="text-gray-500">Amount</p>
                  <p className="font-medium text-gray-900">{selected.amount}</p>
                </div>
                <div>
                  <p className="text-gray-500">Phone</p>
                  <p className="font-medium text-gray-900">{selected.phone}</p>
                </div>
                <div>
                  <p className="text-gray-500">Wallet</p>
                  <p className="font-medium text-gray-900">{selected.wallet}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-gray-500">Reference</p>
                  <p className="font-mono font-medium text-gray-900 tracking-wider">{selected.reference}</p>
                </div>
              </div>
            </div>
            <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Close
              </button>
              {selected.status === 'Pending' && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setRejecting(selected);
                      setRejectReason('');
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    Reject…
                  </button>
                  <button
                    type="button"
                    onClick={() => void onApprove(selected)}
                    className="inline-flex items-center px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle size={16} className="mr-2" />
                    Approve Deposit
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {rejecting && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-lg font-medium text-gray-900">Reject deposit</h3>
            <p className="text-sm text-gray-600">
              Provide a reason for rejecting this deposit. This is sent to the backend audit trail.
            </p>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              placeholder="Reason (required)"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setRejecting(null);
                  setRejectReason('');
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void onRejectSubmit()}
                className="px-4 py-2 rounded-md text-sm font-medium text-white bg-red-600 hover:bg-red-700"
              >
                Confirm reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
