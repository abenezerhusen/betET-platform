import React from 'react';
import { Search, Filter } from 'lucide-react';
import { DateRangePicker } from './DateRangePicker';
import { toast } from '../lib/toast';

interface FilterOption {
  label: string;
  options: string[];
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'number' | 'select';
}

interface FilterBarProps {
  startDate: Date;
  endDate: Date;
  onStartDateChange: (date: Date) => void;
  onEndDateChange: (date: Date) => void;
  filters?: FilterOption[];
}

export function FilterBar({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  filters,
}: FilterBarProps) {
  return (
    <div className="bg-white p-4 rounded-lg shadow space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex-1">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={onStartDateChange}
            onEndDateChange={onEndDateChange}
          />
        </div>
        {filters?.map((filter) => (
          <div key={filter.label} className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {filter.label}
            </label>
            {filter.type === 'text' || filter.type === 'number' ? (
              <input
                type={filter.type}
                value={filter.value}
                onChange={(e) => filter.onChange(e.target.value)}
                className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                placeholder={`Enter ${filter.label.toLowerCase()}`}
              />
            ) : (
              <select
                value={filter.value}
                onChange={(e) => filter.onChange(e.target.value)}
                className="w-full border border-gray-300 rounded-md shadow-sm py-2 pl-3 pr-10 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">All</option>
                {filter.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => toast('Additional filters coming soon.', 'info')}
          className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
        >
          <Filter size={16} className="mr-2" />
          More Filters
        </button>
        <button
          type="button"
          onClick={() => {
            const active = filters?.filter((f) => f.value).length ?? 0;
            toast(
              active > 0
                ? `Filters applied (${active} active).`
                : 'Showing all results.',
            );
          }}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
        >
          <Search size={16} className="mr-2" />
          Search
        </button>
      </div>
    </div>
  );
}
