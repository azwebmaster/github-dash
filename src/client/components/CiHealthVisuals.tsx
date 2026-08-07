import { Box, Tooltip } from '@mui/material';
import type { WorkflowConclusionKind } from '../../shared/types';

const CONCLUSION_COLOR: Record<WorkflowConclusionKind, string> = {
  success: '#0F7B4B',
  failure: '#C62828',
  cancelled: 'rgba(61, 85, 96, 0.45)',
  other: 'rgba(15, 76, 92, 0.35)',
};

/** Compact recent-conclusion dots (API is newest-first; we reverse for LTR). */
export function ConclusionStrip({
  conclusions,
  max = 12,
}: {
  conclusions: WorkflowConclusionKind[];
  max?: number;
}) {
  const items = conclusions.slice(0, max);
  if (items.length === 0) return null;

  const chronological = [...items].reverse();

  return (
    <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 0.4 }}>
      {chronological.map((kind, i) => (
        <Tooltip key={`${kind}-${i}`} title={kind} arrow>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: 0.5,
              bgcolor: CONCLUSION_COLOR[kind],
              flexShrink: 0,
            }}
          />
        </Tooltip>
      ))}
    </Box>
  );
}

/** Simple duration bar sparkline (oldest → newest). */
export function DurationSparkline({
  values,
  height = 28,
  width = 96,
}: {
  values: number[];
  height?: number;
  width?: number;
}) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const barW = Math.max(2, Math.floor((width - (values.length - 1)) / values.length));

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: '1px',
        height,
        width,
        minWidth: width,
      }}
      aria-hidden
    >
      {values.map((v, i) => {
        const h = Math.max(2, Math.round((v / max) * height));
        return (
          <Tooltip key={i} title={`${Math.round(v)}s`} arrow>
            <Box
              sx={{
                width: barW,
                height: h,
                bgcolor: 'primary.main',
                opacity: 0.55 + (0.45 * i) / Math.max(values.length - 1, 1),
                borderRadius: '1px 1px 0 0',
              }}
            />
          </Tooltip>
        );
      })}
    </Box>
  );
}
