import React, { useState, useRef } from 'react';
import { Upload, X, AlertCircle, CheckCircle } from 'lucide-react';
import * as XLSX from 'xlsx';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (data: any[]) => void;
}

interface ValidationError {
  row: number;
  field: string;
  message: string;
}

export function ImportModal({ isOpen, onClose, onImport }: ImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any[]>([]);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const validateData = (data: any[]): ValidationError[] => {
    const errors: ValidationError[] = [];
    
    data.forEach((row, index) => {
      // Required fields
      const requiredFields = ['name', 'email', 'phone'];
      requiredFields.forEach(field => {
        if (!row[field]) {
          errors.push({
            row: index + 1,
            field,
            message: `${field} is required`
          });
        }
      });

      // Email format
      if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
        errors.push({
          row: index + 1,
          field: 'email',
          message: 'Invalid email format'
        });
      }

      // Phone format (basic check)
      if (row.phone && !/^\+?[\d\s-]{10,}$/.test(row.phone)) {
        errors.push({
          row: index + 1,
          field: 'phone',
          message: 'Invalid phone format'
        });
      }
    });

    return errors;
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setFile(file);
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'binary' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);
          
          setIsValidating(true);
          const validationErrors = validateData(jsonData);
          setErrors(validationErrors);
          setPreview(jsonData.slice(0, 5)); // Show first 5 rows
          setIsValidating(false);
        } catch (error) {
          console.error('Error reading file:', error);
          setErrors([{ row: 0, field: 'file', message: 'Invalid file format' }]);
        }
      };

      reader.readAsBinaryString(file);
    }
  };

  const handleImport = () => {
    if (file && errors.length === 0) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = e.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        onImport(jsonData);
        onClose();
      };
      reader.readAsBinaryString(file);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center">
      <div className="bg-white rounded-lg p-6 w-full max-w-[800px] mx-4 max-h-[80vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">Import Users</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* File Upload Section */}
        <div className="mb-6">
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".xlsx,.xls,.csv"
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <Upload className="h-4 w-4 mr-2" />
              Select File
            </button>
            <p className="mt-2 text-sm text-gray-600">
              Supported formats: .xlsx, .xls, .csv
            </p>
            {file && (
              <p className="mt-2 text-sm text-gray-900">
                Selected file: {file.name}
              </p>
            )}
          </div>
        </div>

        {/* Template Download */}
        <div className="mb-6 bg-blue-50 rounded-lg p-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <AlertCircle className="h-5 w-5 text-blue-400" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-blue-800">
                Download Template
              </h3>
              <div className="mt-2 text-sm text-blue-700">
                <p>Use our template to ensure your data is formatted correctly.</p>
                <button
                  type="button"
                  onClick={() => {
                    const headers = ['name', 'email', 'phone'];
                    const sample = [
                      ['Jane Doe', 'jane@example.com', '+251911111111'],
                      ['John Smith', 'john@example.com', '+251922222222'],
                    ];
                    const csv = [headers, ...sample]
                      .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
                      .join('\n');
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'users-import-template.csv';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  }}
                  className="mt-2 text-blue-800 underline hover:text-blue-900"
                >
                  Download Template
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Preview Section */}
        {preview.length > 0 && (
          <div className="mb-6">
            <h3 className="text-lg font-medium text-gray-900 mb-2">Preview</h3>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {Object.keys(preview[0]).map((header) => (
                      <th
                        key={header}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {preview.map((row, index) => (
                    <tr key={index}>
                      {Object.values(row).map((value: any, i) => (
                        <td
                          key={i}
                          className="px-6 py-4 whitespace-nowrap text-sm text-gray-500"
                        >
                          {value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Validation Results */}
        {errors.length > 0 && (
          <div className="mb-6 bg-red-50 rounded-lg p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <AlertCircle className="h-5 w-5 text-red-400" />
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">
                  Validation Errors
                </h3>
                <div className="mt-2 text-sm text-red-700">
                  <ul className="list-disc pl-5 space-y-1">
                    {errors.map((error, index) => (
                      <li key={index}>
                        Row {error.row}: {error.message} ({error.field})
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Success Message */}
        {file && errors.length === 0 && !isValidating && (
          <div className="mb-6 bg-green-50 rounded-lg p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <CheckCircle className="h-5 w-5 text-green-400" />
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-green-800">
                  File Validated Successfully
                </h3>
                <div className="mt-2 text-sm text-green-700">
                  <p>Your file is ready to be imported.</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!file || errors.length > 0 || isValidating}
            className={`px-4 py-2 rounded-md text-white ${
              !file || errors.length > 0 || isValidating
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            Import Users
          </button>
        </div>
      </div>
    </div>
  );
}
