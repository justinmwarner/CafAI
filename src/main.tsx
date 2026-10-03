// TEMPORARY Chromium 91 compatibility probe. Replaced by the real entry point.
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Chip from '@mui/material/Chip';
import Slider from '@mui/material/Slider';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import { ChatBox } from '@mui/x-chat';
import { createEchoAdapter } from '@mui/x-chat/headless';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { openDB } from 'idb';
import { z } from 'zod';
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';

const probe: { errors: string[]; checks: Record<string, unknown> } = { errors: [], checks: {} };
(window as unknown as { __probe: typeof probe }).__probe = probe;
window.addEventListener('error', (e) => probe.errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => probe.errors.push(String(e.reason)));

const theme = createTheme({ palette: { mode: 'dark', primary: { main: '#c8a27a' } } });

function Graph() {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!ref.current) return;
    const xs = Array.from({ length: 30 }, (_, i) => i);
    const plot = new uPlot(
      {
        width: 500,
        height: 160,
        series: [{}, { label: 'pressure', stroke: '#4caf50' }],
      },
      [xs, xs.map((x) => Math.sin(x / 4) * 4 + 5)],
      ref.current,
    );
    probe.checks.uplot = true;
    return () => plot.destroy();
  }, []);
  return <div ref={ref} data-testid="graph" />;
}

function App() {
  const [open, setOpen] = React.useState(false);
  const adapter = React.useMemo(() => createEchoAdapter({ delayMs: 50 }), []);
  React.useEffect(() => {
    void (async () => {
      try {
        const db = await openDB('probe', 1, {
          upgrade(d) {
            d.createObjectStore('kv');
          },
        });
        await db.put('kv', { a: 1 }, 'k');
        probe.checks.idb = await db.get('kv', 'k');
      } catch (e) {
        probe.errors.push('idb: ' + String(e));
      }
      try {
        const S = z.object({ a: z.number().min(0).max(5), b: z.enum(['x', 'y']) });
        probe.checks.zod = S.safeParse({ a: 3, b: 'x' }).success && !S.safeParse({ a: 9, b: 'x' }).success;
        probe.checks.zodJsonSchema = Object.keys(z.toJSONSchema(S)).length > 0;
      } catch (e) {
        probe.errors.push('zod: ' + String(e));
      }
      probe.checks.ready = true;
    })();
  }, []);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar position="static">
        <Toolbar>
          <Typography variant="h6">CafAI probe</Typography>
        </Toolbar>
      </AppBar>
      <Stack direction="row" spacing={2} sx={{ p: 2 }}>
        <Stack spacing={2} sx={{ width: 520 }}>
          <Card>
            <CardContent>
              <Typography variant="h5">Machine: Idle</Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                <Button variant="contained" onClick={() => setOpen(true)}>
                  Espresso
                </Button>
                <Button variant="outlined">Steam</Button>
                <Chip label="Sour" onClick={() => {}} />
                <Chip label="Other" variant="outlined" onClick={() => {}} />
              </Stack>
              <Slider defaultValue={30} sx={{ mt: 2 }} />
              <TextField label="Bean" fullWidth sx={{ mt: 1 }} />
            </CardContent>
          </Card>
          <Graph />
        </Stack>
        <Box sx={{ flex: 1, height: 560 }} data-testid="chat">
          <ChatBox
            adapter={adapter}
            initialMessages={[
              {
                id: 'm1',
                role: 'assistant',
                parts: [{ type: 'text', text: 'Tell me about the bag: origin, roast, process, notes.' }],
              },
            ]}
            suggestions={['Ethiopia washed light', 'Brazil natural dark']}
            sx={{ height: '100%' }}
          />
        </Box>
      </Stack>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>Confirm</DialogTitle>
        <DialogContent>Dialog works.</DialogContent>
      </Dialog>
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
probe.checks.rendered = true;
