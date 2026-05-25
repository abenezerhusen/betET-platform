/**
 * Section 22 — friendly "no access" page shown when an admin lacks
 * the permission required to render a route.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';

export function Unauthorized() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-white border border-gray-200 rounded-lg shadow-sm p-8 text-center">
        <div className="mx-auto w-14 h-14 rounded-full bg-amber-100 flex items-center justify-center mb-4">
          <ShieldAlert className="w-7 h-7 text-amber-600" />
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">
          Access Denied
        </h1>
        <p className="text-sm text-gray-600 mb-6">
          You don&apos;t have permission to view this page. If you believe
          this is a mistake, contact a Super Admin to update your role.
        </p>
        <div className="flex items-center justify-center gap-2">
          <Link
            to="/dashboard"
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
          >
            Back to Dashboard
          </Link>
          <Link
            to="/login"
            className="px-4 py-2 border border-gray-300 text-gray-700 text-sm rounded hover:bg-gray-50"
          >
            Sign in as another user
          </Link>
        </div>
      </div>
    </div>
  );
}
