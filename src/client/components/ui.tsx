import { Box, MenuItem, Paper, Skeleton, Stack, TextField, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import {
  AGE_LOOKBACK_OPTIONS,
  RUN_LIMIT_OPTIONS,
  type AgeLookbackDays,
  type RunLimit,
} from '../../shared/utils';

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <Paper sx={{ p: 2, height: '100%' }}>
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h4" sx={{ mt: 0.5, fontFamily: '"IBM Plex Mono", monospace' }}>
        {value}
      </Typography>
      {hint ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          {hint}
        </Typography>
      ) : null}
    </Paper>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      justifyContent="space-between"
      alignItems={{ xs: 'flex-start', sm: 'center' }}
      spacing={2}
      sx={{ mb: 3 }}
    >
      <Box>
        <Typography variant="h4" component="h1">
          {title}
        </Typography>
        {subtitle ? (
          <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
            {subtitle}
          </Typography>
        ) : null}
      </Box>
      {action}
    </Stack>
  );
}

export function LoadingBlock({ rows = 4 }: { rows?: number }) {
  return (
    <Stack spacing={1.5}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant="rounded" height={56} />
      ))}
    </Stack>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <Paper sx={{ p: 3, borderColor: 'error.light' }}>
      <Typography variant="h6" color="error" gutterBottom>
        Something went wrong
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ fontFamily: '"IBM Plex Mono", monospace' }}>
        {message}
      </Typography>
    </Paper>
  );
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function AgeFilter({
  value,
  onChange,
  sx,
}: {
  value: AgeLookbackDays;
  onChange: (days: AgeLookbackDays) => void;
  sx?: object;
}) {
  return (
    <TextField
      select
      size="small"
      label="Age"
      value={String(value)}
      onChange={(e) => onChange(Number(e.target.value) as AgeLookbackDays)}
      sx={{ minWidth: { md: 160 }, ...sx }}
    >
      {AGE_LOOKBACK_OPTIONS.map((opt) => (
        <MenuItem key={opt.value} value={String(opt.value)}>
          {opt.label}
        </MenuItem>
      ))}
    </TextField>
  );
}

export function RunLimitFilter({
  value,
  onChange,
  sx,
}: {
  value: RunLimit;
  onChange: (limit: RunLimit) => void;
  sx?: object;
}) {
  return (
    <TextField
      select
      size="small"
      label="Runs"
      value={String(value)}
      onChange={(e) => onChange(Number(e.target.value) as RunLimit)}
      sx={{ minWidth: { md: 160 }, ...sx }}
    >
      {RUN_LIMIT_OPTIONS.map((opt) => (
        <MenuItem key={opt.value} value={String(opt.value)}>
          {opt.label}
        </MenuItem>
      ))}
    </TextField>
  );
}
