import {
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  Grid2 as Grid,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAsyncData } from '../hooks/useAsyncData';
import { ErrorState, LoadingBlock, PageHeader, StatTile, formatDate } from '../components/ui';

export default function CommitDetailPage() {
  const { sha } = useParams();
  const { data, error, loading } = useAsyncData(() => api.commit(sha!), [sha]);

  if (loading) return <LoadingBlock />;
  if (error || !data) return <ErrorState message={error ?? 'Commit not found'} />;

  return (
    <Stack spacing={3}>
      <Button component={RouterLink} to="/commits" startIcon={<ArrowBackIcon />} sx={{ alignSelf: 'flex-start' }}>
        All commits
      </Button>

      <PageHeader
        title={data.message}
        subtitle={data.shortSha}
        action={
          <Button href={data.htmlUrl} target="_blank" rel="noreferrer" endIcon={<OpenInNewIcon />} variant="outlined">
            GitHub
          </Button>
        }
      />

      <Stack direction="row" spacing={1}>
        {data.verified ? <Chip label="verified" color="success" /> : <Chip label="unsigned" variant="outlined" />}
      </Stack>

      <Grid container spacing={2}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Author" value={data.authorLogin ?? data.authorName ?? '—'} hint={formatDate(data.authorDate)} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Additions" value={`+${data.stats.additions}`} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Deletions" value={`−${data.stats.deletions}`} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatTile label="Files" value={data.files.length} />
        </Grid>
      </Grid>

      {data.body ? (
        <Paper sx={{ p: 2.5 }}>
          <Typography variant="h6" gutterBottom>
            Body
          </Typography>
          <Typography component="pre" variant="body2" sx={{ whiteSpace: 'pre-wrap', m: 0 }}>
            {data.body}
          </Typography>
        </Paper>
      ) : null}

      <TableContainer component={Paper}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>File</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">+</TableCell>
              <TableCell align="right">−</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.files.map((f) => (
              <TableRow key={f.filename}>
                <TableCell sx={{ fontFamily: '"IBM Plex Mono", monospace', fontSize: 13 }}>{f.filename}</TableCell>
                <TableCell>{f.status}</TableCell>
                <TableCell align="right" sx={{ color: 'success.main' }}>
                  {f.additions}
                </TableCell>
                <TableCell align="right" sx={{ color: 'error.main' }}>
                  {f.deletions}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Stack>
  );
}
