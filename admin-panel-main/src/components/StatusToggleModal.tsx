import React, { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';

interface StatusToggleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  userType: string;
  currentStatus: string;
}

export function StatusToggleModal({
  isOpen,
  onClose,
  onConfirm,
  userType,
  currentStatus,
}: StatusToggleModalProps) {
  const [confirmText, setConfirmText] = useState('');
  const newStatus = currentStatus === 'Active' ? 'Inactive' : 'Active';

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (confirmText.toLowerCase() === 'confirm') {
      onConfirm();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-white rounded-lg p-6 w-[400px]">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            <h2 className="text-lg font-semibold">Confirm Status Change</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <p className="text-gray-700">
            Are you sure you want to change this {userType}'s status from{' '}
            <span className="font-semibold">{currentStatus}</span> to{' '}
            <span className="font-semibold">{newStatus}</span>?
          </p>

          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4">
            <div className="flex">
              <AlertTriangle className="h-5 w-5 text-yellow-400" />
              <div className="ml-3">
                <p className="text-sm text-yellow-700">
                  This action may affect user access and system functionality.
                  Type 'confirm' below to proceed.
                </p>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Type 'confirm' to proceed
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                placeholder="confirm"
              />
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
                disabled={confirmText.toLowerCase() !== 'confirm'}
                className="px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Change Status
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}