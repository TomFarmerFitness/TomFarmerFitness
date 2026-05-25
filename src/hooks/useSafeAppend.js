/**
 * useSafeAppend — wraps appendToSheet with automatic toast on network error.
 *
 * Usage (replaces direct appendToSheet calls):
 *   const safeAppend = useSafeAppend();
 *   await safeAppend('WorkoutLogs', rowData);   // shows toast on failure
 */
import { useCallback } from 'react';
import { appendToSheet } from '../utils/sheets';
import { useToast } from '../components/shared/Toast';

export function useSafeAppend() {
  const toast = useToast();
  return useCallback(async (tabName, rowData) => {
    try {
      return await appendToSheet(tabName, rowData);
    } catch (err) {
      toast.error('Could not save — check your connection and try again');
      throw err;
    }
  }, [toast]);
}

/**
 * useSafeRead — wraps a readSheet call with automatic stale-data toast.
 * Pass your setError state setter; it will be called with the error message
 * if the fetch fails AND there is no stale cache to fall back to.
 */
export function useSafeRead() {
  const toast = useToast();
  return useCallback(async (fetchFn) => {
    try {
      return await fetchFn();
    } catch (err) {
      toast.error('Could not load data — check your connection and try again');
      throw err;
    }
  }, [toast]);
}
