import { useCallback, useState } from 'react';
import { deleteCookie, getCookie, setCookie } from '../lib/cookies';

const COOKIE_NAME = 'gh-dash-pinned-workflows';

function parseIds(raw: string | null): number[] {
  if (!raw) return [];
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const part of raw.split(',')) {
    const id = Number(part.trim());
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function readPinned(): number[] {
  return parseIds(getCookie(COOKIE_NAME));
}

function writePinned(ids: number[]): void {
  if (ids.length === 0) {
    deleteCookie(COOKIE_NAME);
    return;
  }
  setCookie(COOKIE_NAME, ids.join(','));
}

/** Persist selected workflow IDs in a browser cookie and expose pin/unpin helpers. */
export function usePinnedWorkflows() {
  const [pinnedIds, setPinnedIds] = useState<number[]>(() => readPinned());

  const isPinned = useCallback((workflowId: number) => pinnedIds.includes(workflowId), [pinnedIds]);

  const pin = useCallback((workflowId: number) => {
    if (!Number.isFinite(workflowId) || workflowId <= 0) return;
    setPinnedIds((prev) => {
      if (prev.includes(workflowId)) return prev;
      const next = [...prev, workflowId];
      writePinned(next);
      return next;
    });
  }, []);

  const unpin = useCallback((workflowId: number) => {
    setPinnedIds((prev) => {
      const next = prev.filter((id) => id !== workflowId);
      writePinned(next);
      return next;
    });
  }, []);

  const toggle = useCallback((workflowId: number) => {
    setPinnedIds((prev) => {
      const next = prev.includes(workflowId)
        ? prev.filter((id) => id !== workflowId)
        : [...prev, workflowId];
      writePinned(next);
      return next;
    });
  }, []);

  return { pinnedIds, isPinned, pin, unpin, toggle };
}
