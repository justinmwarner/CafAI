/**
 * Dev preview of the shell and the machine panel against fake services, for
 * looking at the layout without a DE1. Never part of a build (only
 * dev/preview-shell.html loads it).
 *
 *   npx vite --port 5181 --strictPort
 *   http://localhost:5181/dev/preview-shell.html?scenario=pulling&at=22&freeze=1
 *
 * scenario: live (default; a shot every 30 s) | idle | last | pulling | steam
 *           | sleeping | disconnected | ghc | noscale | error
 * at, freeze: for "pulling", the second to show and whether to hold there.
 * inside=1: pretend to run inside Decaid (changes the Exit label).
 * Routes work as in the app: #/, #/history, #/settings.
 */
import '../fonts.ts';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { ServicesProvider } from '../../app/services.tsx';
import { AppTheme } from '../AppTheme.tsx';
import { GHC_CACHE_KEY } from '../machine/ghcCache.ts';
import { navigate, useRoute, type Route } from '../router.ts';
import { AppShell } from '../shell/AppShell.tsx';
import { createFakeServices } from '../testing/fakeServices.ts';
import { createPreviewMachine, type Scenario } from './previewMachine.ts';

const SCENARIOS: readonly Scenario[] = ['live', 'idle', 'last', 'pulling', 'steam', 'sleeping', 'disconnected', 'ghc', 'noscale', 'error'];

const params = new URLSearchParams(window.location.search);
const requested = params.get('scenario') as Scenario | null;
const scenario: Scenario = requested && SCENARIOS.includes(requested) ? requested : 'live';
const at = params.has('at') ? Number(params.get('at')) : undefined;

// Each preview load starts from what the scenario says, not from a GHC answer cached by the last one.
localStorage.removeItem(GHC_CACHE_KEY);
const services = createFakeServices({ insideDecaid: params.get('inside') === '1' });
const machine = createPreviewMachine(services, scenario, { at, freeze: params.get('freeze') === '1' });

const bubble = (mine: boolean) =>
  ({
    alignSelf: mine ? 'flex-end' : 'flex-start',
    maxWidth: '80%',
    px: 2,
    py: 1.25,
    borderRadius: 2,
    bgcolor: mine ? 'rgba(200, 162, 122, 0.18)' : 'background.paper',
  }) as const;

/** Stands in for the chat agent's screens; only here to judge the frame around them. */
function ScreenPlaceholder({ route }: { route: Route }) {
  if (route.name !== 'coach') {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h5" component="h1">
          {route.name === 'history' ? 'History' : 'Settings'}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          The {route.name} screen renders here{route.name === 'history' && route.bagId ? ` (bag ${route.bagId})` : ''}.
        </Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="subtitle1" sx={{ flex: 1 }} noWrap>
          Kiambu AA · v2
        </Typography>
        <Button variant="outlined" color="inherit" sx={{ borderColor: 'divider' }}>
          New bag
        </Button>
      </Box>
      <Box sx={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1.5, p: 2 }}>
        <Typography sx={bubble(false)}>Tell me about the bag: origin, roast, process and notes.</Typography>
        <Typography sx={bubble(true)}>Kenya Kiambu AA, washed, light roast, blackcurrant and lime.</Typography>
        <Typography sx={bubble(false)}>
          Pull a shot with Blooming Espresso and tell me how it tasted. I will suggest one change at a time.
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', gap: 1, p: 1.5, borderTop: 1, borderColor: 'divider' }}>
        <Box sx={{ flex: 1, minHeight: 48, borderRadius: 1.5, border: 1, borderColor: 'divider', px: 2, display: 'flex', alignItems: 'center' }}>
          <Typography color="text.secondary">How did it taste?</Typography>
        </Box>
        <Button variant="contained">Send</Button>
      </Box>
    </Box>
  );
}

function Preview() {
  const route = useRoute();
  useEffect(() => {
    machine.start();
    return () => machine.dispose();
  }, []);
  return (
    <AppShell route={route} onNavigate={(next) => navigate(next)}>
      <ScreenPlaceholder route={route} />
    </AppShell>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ServicesProvider services={services}>
      <AppTheme>
        <Preview />
      </AppTheme>
    </ServicesProvider>
  </StrictMode>,
);
