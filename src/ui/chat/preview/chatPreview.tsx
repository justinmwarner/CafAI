/**
 * Dev preview of the chat UI screens with fake services (dev/preview-chat.html).
 *
 *   ?screen=coach|history|settings
 *   &state=intake|templates|machine-loading|shot-search|shot|options|rated|options-multi|diff|applying
 *          |applied|failed|streaming|thinking|error|nokey|nobag|firstbag|loading
 *   &bag=<bagId>   (history detail)
 *
 * The frame imitates the shell (top bar, machine panel on the left) so the
 * screens are seen at their real size. Not shipped.
 */
import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import Box from '@mui/material/Box';
import CssBaseline from '@mui/material/CssBaseline';
import Typography from '@mui/material/Typography';
import { ThemeProvider } from '@mui/material/styles';
import '../../fonts.ts';
import type { CoachState } from '../../../app/types.ts';
import { ServicesProvider } from '../../../app/services.tsx';
import { createFakeServices, type FakeServices } from '../../testing/fakeServices.ts';
import { CoachScreen } from '../CoachScreen.tsx';
import { HistoryScreen } from '../../history/HistoryScreen.tsx';
import { SettingsScreen } from '../../settings/SettingsScreen.tsx';
import { previewTheme } from '../testing/previewTheme.ts';
import {
  KIAMBU,
  KIAMBU_ITERATIONS,
  KIAMBU_VERSIONS,
  SANTOS,
  coachStateFor,
  type ConversationStage,
} from '../testing/fixtures.ts';

const params = new URLSearchParams(location.search);
const screen = params.get('screen') ?? 'coach';
const state = params.get('state') ?? 'diff';

function coachState(): Partial<CoachState> {
  switch (state) {
    case 'nokey':
      return { ...coachStateFor('intake'), hasApiKey: false };
    case 'nobag':
      return { ...coachStateFor('intake'), activeBag: null, activeVersion: null, messages: [], phase: 'no_bag' };
    case 'firstbag':
      return { ready: true, hasApiKey: true, bags: [], phase: 'no_bag' };
    case 'loading':
      return { ready: false };
    case 'error':
      return coachStateFor('diff', { error: 'The coach could not be reached. Check the Wi-Fi, then tap Retry.' });
    case 'thinking':
      return coachStateFor('options', {
        busy: true,
        messages: coachStateFor('applied').messages,
      });
    default:
      return coachStateFor(state as ConversationStage);
  }
}

function createServices(): FakeServices {
  const services = createFakeServices({
    coach: coachState(),
    storage: {
      bags: [KIAMBU, SANTOS],
      versions: KIAMBU_VERSIONS,
      iterations: KIAMBU_ITERATIONS,
      settings: { model: 'claude-opus-5-5', grinderName: 'Niche Zero', grinderSetting: '14', activeBagId: KIAMBU.id },
    },
    insideDecaid: params.get('decaid') === '1',
  });
  if (params.get('key') === '1') services.storage.apiKey = 'sk-ant-preview';
  // Make the fake coach visibly react in the preview.
  const coach = services.coach;
  const pickTemplate = coach.pickTemplate;
  coach.pickTemplate = async (requestId, templateId) => {
    await pickTemplate(requestId, templateId);
    coach.setState({ busy: true });
    window.setTimeout(() => coach.setState({ busy: false }), 4000);
  };
  return services;
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <Box
        sx={{
          height: 56,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          px: 2,
          borderBottom: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Typography variant="h6" sx={{ color: 'primary.main', fontWeight: 700 }}>
          CafAI
        </Typography>
        {['coach', 'history', 'settings'].map((name) => (
          <Typography
            key={name}
            component="a"
            href={`?screen=${name}&state=${state}`}
            sx={{ color: name === screen ? 'primary.main' : 'text.secondary', textDecoration: 'none' }}
          >
            {name[0]?.toUpperCase()}
            {name.slice(1)}
          </Typography>
        ))}
        <Box sx={{ flex: 1 }} />
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          shell placeholder
        </Typography>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Box
          sx={{
            width: { xs: 360, lg: 440 },
            flexShrink: 0,
            borderRight: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            p: 2,
            color: 'text.secondary',
          }}
        >
          machine panel placeholder
        </Box>
        <Box component="main" sx={{ flex: 1, minWidth: 0, minHeight: 0 }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}

function Screen() {
  const [bagId, setBagId] = useState<string | null>(params.get('bag'));
  if (screen === 'history') return <HistoryScreen bagId={bagId} onSelectBag={setBagId} />;
  if (screen === 'settings') return <SettingsScreen />;
  return <CoachScreen />;
}

function Preview() {
  const [services] = useState(createServices);
  useEffect(() => {
    document.title = `CafAI preview: ${screen} / ${state}`;
  }, []);
  return (
    <ThemeProvider theme={previewTheme}>
      <CssBaseline />
      <ServicesProvider services={services}>
        <Frame>
          <Screen />
        </Frame>
      </ServicesProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
