/**
 * Standardized RPC Error Formatter
 * Formats PostgreSQL / Supabase RPC error codes into clear, user-friendly error messages.
 * Preserves the original error code and technical details internally for diagnostics.
 * Reference: FIND-006.15-F02
 */

export interface FormattedRpcError {
  code: string | null;
  message: string;
  originalError: any;
}

export function formatRpcError(error: any): string {
  if (!error) return 'An unknown error occurred.';

  const code: string = error?.code || '';
  const messageStr: string = error?.message || (typeof error === 'string' ? error : '');

  // 40901: DUPLICATE_ASSIGNMENT
  if (code === '40901' || messageStr.includes('40901') || messageStr.includes('DUPLICATE_ASSIGNMENT')) {
    return 'This official is already actively assigned to this court.';
  }

  // 40902: CONCURRENCY_VIOLATION
  if (code === '40902' || messageStr.includes('40902') || messageStr.includes('CONCURRENCY_VIOLATION')) {
    return 'Cannot start match: This court already has another match in LIVE status. Please finalize or cancel the active match first.';
  }

  // 40100: UNAUTHORIZED
  if (code === '40100' || messageStr.includes('40100') || messageStr.includes('UNAUTHORIZED')) {
    return 'Authentication required: Please sign in with an active account to perform this operation.';
  }

  // 40300: FORBIDDEN
  if (code === '40300' || messageStr.includes('40300') || messageStr.includes('FORBIDDEN')) {
    return 'You do not have authorization to perform this operation on this court or event.';
  }

  // General fallback - clean up Postgres error prefix if present
  return messageStr || 'An unexpected error occurred during court operations.';
}
