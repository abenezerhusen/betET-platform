import React, { useState } from 'react';
import { X, Upload } from 'lucide-react';
import { z } from 'zod';

interface CreateAffiliateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: AffiliateFormData) => void;
}

interface AffiliateFormData {
  phoneNumber: string;
  name: string;
  referralCode: string;
  commission: {
    type: string;
    rate: number;
  };
  paymentDetails: {
    method: string;
    accountNumber?: string;
    bankName?: string;
    mobileNumber?: string;
  };
  documents?: File | null;
}

const affiliateSchema = z.object({
  phoneNumber: z.string().trim().min(8, 'Phone number is required'),
  name: z.string().trim().min(2, 'Name is required'),
  referralCode: z.string().trim().min(2, 'Referral code is required').max(20),
  commission: z.object({
    type: z.enum(['revenue_share', 'cpa', 'hybrid']),
    rate: z.number().min(0).max(100),
  }),
  paymentDetails: z.object({
    method: z.enum(['bank_transfer', 'mobile_money', 'wallet']),
    accountNumber: z.string().optional(),
    bankName: z.string().optional(),
    mobileNumber: z.string().optional(),
  }),
  documents: z.any().optional(),
});

export function CreateAffiliateModal({ isOpen, onClose, onSubmit }: CreateAffiliateModalProps) {
  const [formData, setFormData] = useState<AffiliateFormData>({
    phoneNumber: '',
    name: '',
    referralCode: '',
    commission: {
      type: 'revenue_share',
      rate: 30,
    },
    paymentDetails: {
      method: 'bank_transfer',
    },
  });
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = affiliateSchema.safeParse(formData);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid affiliate data');
      return;
    }
    setError('');
    onSubmit(formData);
    onClose();
  };

  const generateReferralCode = () => {
    const prefix = formData.name.slice(0, 2).toUpperCase();
    const buf = new Uint16Array(1);
    crypto.getRandomValues(buf);
    const randomNum = String(buf[0] % 10000).padStart(4, '0');
    setFormData({ ...formData, referralCode: `${prefix}${randomNum}` });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-2xl">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">Register New Affiliate</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
              <X className="h-5 w-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="p-2 text-sm rounded border border-red-200 bg-red-50 text-red-700">
                {error}
              </div>
            )}
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">Phone Number</label>
                <input
                  type="tel"
                  value={formData.phoneNumber}
                  onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  placeholder="+1234567890"
                  required
                />
                <p className="mt-1 text-sm text-gray-500">Must be a registered online user</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Name</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">Referral Code</label>
                <div className="mt-1 flex rounded-md shadow-sm">
                  <input
                    type="text"
                    value={formData.referralCode}
                    onChange={(e) => setFormData({ ...formData, referralCode: e.target.value })}
                    className="flex-1 rounded-l-md border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                    required
                  />
                  <button
                    type="button"
                    onClick={generateReferralCode}
                    className="inline-flex items-center px-3 py-2 border border-l-0 border-gray-300 rounded-r-md bg-gray-50 text-gray-500 text-sm"
                  >
                    Generate
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Commission Type</label>
                <select
                  value={formData.commission.type}
                  onChange={(e) => setFormData({
                    ...formData,
                    commission: { ...formData.commission, type: e.target.value }
                  })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="revenue_share">Revenue Share</option>
                  <option value="cpa">CPA</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Commission Rate (%)</label>
              <input
                type="number"
                value={formData.commission.rate}
                onChange={(e) => setFormData({
                  ...formData,
                  commission: { ...formData.commission, rate: Number(e.target.value) }
                })}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                min="0"
                max="100"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Payment Method</label>
              <select
                value={formData.paymentDetails.method}
                onChange={(e) => setFormData({
                  ...formData,
                  paymentDetails: { ...formData.paymentDetails, method: e.target.value }
                })}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              >
                <option value="bank_transfer">Bank Transfer</option>
                <option value="mobile_money">Mobile Money</option>
                <option value="wallet">Internal Wallet</option>
              </select>
            </div>

            {formData.paymentDetails.method === 'bank_transfer' && (
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Bank Name</label>
                  <input
                    type="text"
                    value={formData.paymentDetails.bankName || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      paymentDetails: { ...formData.paymentDetails, bankName: e.target.value }
                    })}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Account Number</label>
                  <input
                    type="text"
                    value={formData.paymentDetails.accountNumber || ''}
                    onChange={(e) => setFormData({
                      ...formData,
                      paymentDetails: { ...formData.paymentDetails, accountNumber: e.target.value }
                    })}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    required
                  />
                </div>
              </div>
            )}

            {formData.paymentDetails.method === 'mobile_money' && (
              <div>
                <label className="block text-sm font-medium text-gray-700">Mobile Money Number</label>
                <input
                  type="tel"
                  value={formData.paymentDetails.mobileNumber || ''}
                  onChange={(e) => setFormData({
                    ...formData,
                    paymentDetails: { ...formData.paymentDetails, mobileNumber: e.target.value }
                  })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  required
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700">Verification Documents</label>
              <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md">
                <div className="space-y-1 text-center">
                  <Upload className="mx-auto h-12 w-12 text-gray-400" />
                  <div className="flex text-sm text-gray-600">
                    <label className="relative cursor-pointer bg-white rounded-md font-medium text-blue-600 hover:text-blue-500">
                      <span>Upload files</span>
                      <input
                        type="file"
                        className="sr-only"
                        onChange={(e) => setFormData({ ...formData, documents: e.target.files?.[0] || null })}
                      />
                    </label>
                  </div>
                  <p className="text-xs text-gray-500">ID, proof of address, or business documents</p>
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
              >
                Register Affiliate
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}