import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#0F4C5C', light: '#1A6B7F', dark: '#0A3440' },
    secondary: { main: '#E36414', light: '#F0843C', dark: '#B54E0E' },
    background: {
      default: '#E8EEF2',
      paper: '#F7FAFC',
    },
    success: { main: '#0F7B4B' },
    error: { main: '#C62828' },
    warning: { main: '#C77700' },
    info: { main: '#1565C0' },
    divider: 'rgba(15, 76, 92, 0.14)',
    text: {
      primary: '#0D1B22',
      secondary: '#3D5560',
    },
  },
  typography: {
    fontFamily: '"IBM Plex Sans", "Helvetica", "Arial", sans-serif',
    h1: { fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontWeight: 700, letterSpacing: '-0.02em' },
    h3: { fontWeight: 650, letterSpacing: '-0.015em' },
    h4: { fontWeight: 650 },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
    overline: {
      fontFamily: '"IBM Plex Mono", monospace',
      letterSpacing: '0.08em',
    },
    caption: {
      fontFamily: '"IBM Plex Mono", monospace',
    },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundImage:
            'linear-gradient(165deg, #d5e3ea 0%, #e8eef2 38%, #eef3f6 100%), radial-gradient(ellipse 70% 45% at 100% 0%, rgba(227, 100, 20, 0.07), transparent 55%)',
          backgroundAttachment: 'fixed',
          minHeight: '100vh',
        },
        a: { color: 'inherit' },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: 'rgba(247, 250, 252, 0.9)',
          backdropFilter: 'blur(10px)',
          color: '#0D1B22',
          borderBottom: '1px solid rgba(15, 76, 92, 0.14)',
          boxShadow: 'none',
        },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: '1px solid rgba(15, 76, 92, 0.12)',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontFamily: '"IBM Plex Mono", monospace',
          fontSize: '0.75rem',
          fontWeight: 600,
          color: '#3D5560',
          backgroundColor: 'rgba(15, 76, 92, 0.04)',
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 500 },
      },
    },
  },
});
