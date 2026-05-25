import React, { useState } from 'react';
import { X, Plus, Minus } from 'lucide-react';
import { z } from 'zod';

interface CommissionConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (config: CommissionConfig) => void;
}

interface CommissionConfig {
  type: string;
  tiers: {
    level: number;
    condition: string;
    rate: number;
  }[];
  products: {
    name: string;
    rate: number;
  }[];
  minimumThreshold: number;
  holdPeriod: number;
}

const tierSchema = z.object({
  level: z.number().int().positive(),
  condition: z.string().trim().min(2, 'Tier condition is required'),
  rate: z.number().min(0).max(100),
});

const productSchema = z.object({
  name: z.string().trim().min(2, 'Product name is required'),
  rate: z.number().min(0).max(100),
});

const commissionConfigSchema = z.object({
  type: z.enum(['revenue_share', 'cpa', 'hybrid']),
  tiers: z.array(tierSchema).min(1, 'At least one tier is required'),
  products: z.array(productSchema).min(1, 'At least one product is required'),
  minimumThreshold: z.number().min(0),
  holdPeriod: z.number().int().min(0),
});

export function CommissionConfigModal({ isOpen, onClose, onSave }: CommissionConfigModalProps) {
  const [config, setConfig] = useState<CommissionConfig>({
    type: 'revenue_share',
    tiers: [
      { level: 1, condition: '0-100 active users', rate: 30 },
      { level: 2, condition: '101-500 active users', rate: 35 },
      { level: 3, condition: '500+ active users', rate: 40 },
    ],
    products: [
      { name: 'Sportsbook', rate: 30 },
      { name: 'Casino', rate: 25 },
      { name: 'Virtual Games', rate: 20 },
    ],
    minimumThreshold: 100,
    holdPeriod: 30,
  });
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = commissionConfigSchema.safeParse(config);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Invalid commission configuration');
      return;
    }
    setError('');
    onSave(parsed.data);
    onClose();
  };

  const addTier = () => {
    setConfig({
      ...config,
      tiers: [
        ...config.tiers,
        { level: config.tiers.length + 1, condition: '', rate: 0 },
      ],
    });
  };

  const removeTier = (index: number) => {
    setConfig({
      ...config,
      tiers: config.tiers.filter((_, i) => i !== index),
    });
  };

  const addProduct = () => {
    setConfig({
      ...config,
      products: [
        ...config.products,
        { name: '', rate: 0 },
      ],
    });
  };

  const removeProduct = (index: number) => {
    setConfig({
      ...config,
      products: config.products.filter((_, i) => i !== index),
    });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">Commission Configuration</h2>
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
            <div>
              <label className="block text-sm font-medium text-gray-700">Commission Type</label>
              <select
                value={config.type}
                onChange={(e) => setConfig({ ...config, type: e.target.value })}
                className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
              >
                <option value="revenue_share">Revenue Share</option>
                <option value="cpa">CPA (Cost Per Acquisition)</option>
                <option value="hybrid">Hybrid (CPA + Revenue Share)</option>
              </select>
            </div>

            <div>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900">Tiered Commission Levels</h3>
                <button
                  type="button"
                  onClick={addTier}
                  className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded-md text-blue-700 bg-blue-100 hover:bg-blue-200"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Tier
                </button>
              </div>
              <div className="space-y-4">
                {config.tiers.map((tier, index) => (
                  <div key={index} className="flex items-end space-x-4 bg-gray-50 p-4 rounded-lg">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700">Level</label>
                      <input
                        type="number"
                        value={tier.level}
                        onChange={(e) => {
                          const newTiers = [...config.tiers];
                          newTiers[index].level = Number(e.target.value);
                          setConfig({ ...config, tiers: newTiers });
                        }}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700">Condition</label>
                      <input
                        type="text"
                        value={tier.condition}
                        onChange={(e) => {
                          const newTiers = [...config.tiers];
                          newTiers[index].condition = e.target.value;
                          setConfig({ ...config, tiers: newTiers });
                        }}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                        placeholder="e.g., 0-100 active users"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700">Rate (%)</label>
                      <input
                        type="number"
                        value={tier.rate}
                        onChange={(e) => {
                          const newTiers = [...config.tiers];
                          newTiers[index].rate = Number(e.target.value);
                          setConfig({ ...config, tiers: newTiers });
                        }}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeTier(index)}
                      className="text-red-600 hover:text-red-800 p-2"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-medium text-gray-900">Product-Specific Commission</h3>
                <button
                  type="button"
                  onClick={addProduct}
                  className="inline-flex items-center px-3 py-1 border border-transparent text-sm font-medium rounded-md text-blue-700 bg-blue-100 hover:bg-blue-200"
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add Product
                </button>
              </div>
              <div className="space-y-4">
                {config.products.map((product, index) => (
                  <div key={index} className="flex items-end space-x-4 bg-gray-50 p-4 rounded-lg">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700">Product</label>
                      <input
                        type="text"
                        value={product.name}
                        onChange={(e) => {
                          const newProducts = [...config.products];
                          newProducts[index].name = e.target.value;
                          setConfig({ ...config, products: newProducts });
                        }}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-700">Rate (%)</label>
                      <input
                        type="number"
                        value={product.rate}
                        onChange={(e) => {
                          const newProducts = [...config.products];
                          newProducts[index].rate = Number(e.target.value);
                          setConfig({ ...config, products: newProducts });
                        }}
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeProduct(index)}
                      className="text-red-600 hover:text-red-800 p-2"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">Minimum Threshold ($)</label>
                <input
                  type="number"
                  value={config.minimumThreshold}
                  onChange={(e) => setConfig({ ...config, minimumThreshold: Number(e.target.value) })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Hold Period (days)</label>
                <input
                  type="number"
                  value={config.holdPeriod}
                  onChange={(e) => setConfig({ ...config, holdPeriod: Number(e.target.value) })}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
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
                Save Configuration
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}