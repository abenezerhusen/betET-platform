/**
 * Minimal CSV export helper used across the Reports section and any other
 * page that needs to download tabular data. Escapes quotes/newlines/commas
 * per RFC 4180 and triggers a browser download without any third-party deps.
 */

export interface CsvColumn<T> {
  header: string;
  accessor: keyof T | ((row: T) => unknown);
}

function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function rowsToCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const head = columns.map((c) => escapeCell(c.header)).join(',');
  const body = rows
    .map((row) =>
      columns
        .map((c) => {
          const v =
            typeof c.accessor === 'function'
              ? c.accessor(row)
              : (row as Record<string, unknown>)[c.accessor as string];
          return escapeCell(v);
        })
        .join(',')
    )
    .join('\n');
  return `${head}\n${body}`;
}

export function downloadCsv<T>(
  columns: CsvColumn<T>[],
  rows: T[],
  filename: string
) {
  const csv = rowsToCsv(columns, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function todayStamp() {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
