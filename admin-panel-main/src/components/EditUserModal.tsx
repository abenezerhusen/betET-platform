import React, { useEffect, useState } from 'react';
import { X, Save } from 'lucide-react';
import { z } from 'zod';

export type EditUserMode = 'member' | 'admin';

interface EditUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => void;
  user: any;
  /**
   * Determines which fields are shown.
   *  - 'member' (default): full Online Users record (name + contact + member type + address)
   *  - 'admin': contact info only — used for Super Admin / Administrator edits
   */
  mode?: EditUserMode;
  title?: string;
}

const memberSchema = z.object({
  firstName: z.string().trim().min(2, 'First name is required'),
  lastName: z.string().trim().min(2, 'Last name is required'),
  email: z.string().trim().email('Valid email is required'),
  phone: z.string().trim().min(8, 'Valid phone is required'),
  memberType: z.enum(['Regular', 'VIP', 'Premium']),
  city: z.string().trim().min(2, 'City is required'),
  address: z.string().trim().min(3, 'Address is required'),
});

const adminSchema = z
  .object({
    firstName: z.string().trim().optional(),
    lastName: z.string().trim().optional(),
    email: z.string().trim().email('Valid email is required').optional().or(z.literal('')),
    phone: z.string().trim().min(8, 'Valid phone is required').optional().or(z.literal('')),
  })
  .refine((d) => Boolean((d.email ?? '').trim()) || Boolean((d.phone ?? '').trim()), {
    message: 'Email or phone is required',
    path: ['email'],
  });

export function EditUserModal({
  isOpen,
  onClose,
  onSubmit,
  user,
  mode = 'member',
  title,
}: EditUserModalProps) {
  const isAdmin = mode === 'admin';

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    memberType: 'Regular',
    city: '',
    address: '',
  });
  const [error, setError] = useState('');

  // Reseed the form whenever the user prop changes (modal reused for many rows).
  useEffect(() => {
    if (!user) return;
    setFormData({
      firstName: user.firstName ?? user.first_name ?? '',
      lastName: user.lastName ?? user.last_name ?? '',
      email: user.email ?? '',
      phone: user.phone ?? '',
      memberType: user.memberType ?? 'Regular',
      city: user.city ?? '',
      address: user.address ?? '',
    });
    setError('');
  }, [user]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = (isAdmin ? adminSchema : memberSchema).safeParse(formData);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid form');
      return;
    }
    setError('');
    onSubmit(parsed.data as Record<string, unknown>);
    onClose();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg p-6 w-full max-w-[600px] mx-4 max-w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center space-x-2">
            <Save className="h-5 w-5 text-blue-600" />
            <h2 className="text-lg font-semibold">
              {title ?? (isAdmin ? 'Edit User' : 'Edit Member')}
            </h2>
          </div>
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">First Name</label>
              <input
                type="text"
                name="firstName"
                value={formData.firstName}
                onChange={handleChange}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                required={!isAdmin}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Last Name</label>
              <input
                type="text"
                name="lastName"
                value={formData.lastName}
                onChange={handleChange}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                required={!isAdmin}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Email</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Phone Number</label>
            <input
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
            />
          </div>

          {!isAdmin && (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700">Member Type</label>
                <select
                  name="memberType"
                  value={formData.memberType}
                  onChange={handleChange}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="Regular">Regular</option>
                  <option value="VIP">VIP</option>
                  <option value="Premium">Premium</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">City</label>
                <input
                  type="text"
                  name="city"
                  value={formData.city}
                  onChange={handleChange}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Address</label>
                <input
                  type="text"
                  name="address"
                  value={formData.address}
                  onChange={handleChange}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  required
                />
              </div>
            </>
          )}

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
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
