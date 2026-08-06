import { useEffect, useState } from 'react';
import { Link as RouterLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  AppBar,
  Box,
  Container,
  Link,
  Stack,
  Tab,
  Tabs,
  Toolbar,
  Typography,
} from '@mui/material';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import CommitIcon from '@mui/icons-material/Commit';
import NewReleasesIcon from '@mui/icons-material/NewReleases';
import DashboardIcon from '@mui/icons-material/Dashboard';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import { api } from './api/client';
import OverviewPage from './pages/OverviewPage';
import PrsPage from './pages/PrsPage';
import PrDetailPage from './pages/PrDetailPage';
import CommitsPage from './pages/CommitsPage';
import CommitDetailPage from './pages/CommitDetailPage';
import ReleasesPage from './pages/ReleasesPage';
import ReleaseDetailPage from './pages/ReleaseDetailPage';
import WorkflowsPage from './pages/WorkflowsPage';
import WorkflowDetailPage from './pages/WorkflowDetailPage';

const nav = [
  { to: '/', label: 'Overview', icon: <DashboardIcon fontSize="small" />, match: (p: string) => p === '/' },
  { to: '/prs', label: 'Pull Requests', icon: <CallSplitIcon fontSize="small" />, match: (p: string) => p.startsWith('/prs') },
  { to: '/commits', label: 'Commits', icon: <CommitIcon fontSize="small" />, match: (p: string) => p.startsWith('/commits') },
  { to: '/releases', label: 'Releases', icon: <NewReleasesIcon fontSize="small" />, match: (p: string) => p.startsWith('/releases') },
  { to: '/workflows', label: 'Workflows', icon: <AccountTreeIcon fontSize="small" />, match: (p: string) => p.startsWith('/workflows') },
];

export default function App() {
  const location = useLocation();
  const [repo, setRepo] = useState<string>('…');

  useEffect(() => {
    api.meta().then((m) => setRepo(`${m.owner}/${m.repo}`)).catch(() => setRepo('unknown'));
  }, []);

  const tabIndex = Math.max(
    0,
    nav.findIndex((n) => n.match(location.pathname)),
  );

  return (
    <Box sx={{ minHeight: '100vh', pb: 6 }}>
      <AppBar position="sticky">
        <Toolbar sx={{ gap: 2, flexWrap: 'wrap', py: 1 }}>
          <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mr: 2 }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: 1.5,
                bgcolor: 'primary.main',
                color: 'common.white',
                display: 'grid',
                placeItems: 'center',
                fontFamily: '"IBM Plex Mono", monospace',
                fontWeight: 700,
                fontSize: 14,
              }}
            >
              gd
            </Box>
            <Box>
              <Typography variant="subtitle1" fontWeight={700} lineHeight={1.2}>
                GitHub Dash
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ fontFamily: '"IBM Plex Mono", monospace' }}
              >
                {repo}
              </Typography>
            </Box>
          </Stack>
          <Tabs
            value={tabIndex}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              minHeight: 40,
              flex: 1,
              '& .MuiTab-root': { minHeight: 40, py: 0 },
            }}
          >
            {nav.map((item) => (
              <Tab
                key={item.to}
                component={RouterLink}
                to={item.to}
                icon={item.icon}
                iconPosition="start"
                label={item.label}
              />
            ))}
          </Tabs>
          <Link
            href={`https://github.com/${repo}`}
            target="_blank"
            rel="noreferrer"
            underline="hover"
            variant="body2"
            color="text.secondary"
          >
            Open on GitHub
          </Link>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ pt: 3 }}>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/prs" element={<PrsPage />} />
          <Route path="/prs/:number" element={<PrDetailPage />} />
          <Route path="/commits" element={<CommitsPage />} />
          <Route path="/commits/:sha" element={<CommitDetailPage />} />
          <Route path="/releases" element={<ReleasesPage />} />
          <Route path="/releases/:id" element={<ReleaseDetailPage />} />
          <Route path="/workflows" element={<WorkflowsPage />} />
          <Route path="/workflows/:id" element={<WorkflowDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Container>
    </Box>
  );
}
