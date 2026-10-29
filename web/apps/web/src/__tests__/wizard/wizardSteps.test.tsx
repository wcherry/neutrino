import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { preferences } from '@neutrino/preferences';
import { StepContext, type StepCommit } from '@/components/WelcomeWizard/stepApi';
import { WIZARD_RETURN_KEY } from '@/components/WelcomeWizard';

// ── mocks ─────────────────────────────────────────────────────────────────────
const m = vi.hoisted(() => ({
  setTheme: vi.fn(),
  theme: 'system' as string,
  complete: vi.fn(),
  setAiSettings: vi.fn(),
  aiSettings: { provider: 'gemini', apiKey: '' } as { provider: string; apiKey: string },
  updateProfile: vi.fn(),
  getProfile: vi.fn(),
  refresh: vi.fn(),
  listConnections: vi.fn(),
  connectGoogle: vi.fn(),
  connectOutlook: vi.fn(),
  connectApple: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/providers/ThemeProvider', () => ({
  useTheme: () => ({
    theme: m.theme,
    setTheme: (t: string) => {
      m.theme = t;
      m.setTheme(t);
    },
    resolvedTheme: 'light',
  }),
}));
vi.mock('@neutrino/api-core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@neutrino/api-core')>()),
  aiApi: { complete: m.complete },
}));
vi.mock('@/hooks/useAiSettings', () => ({
  useAiSettings: () => ({ settings: m.aiSettings, setSettings: m.setAiSettings, getProviderOptions: () => ({}) }),
}));
vi.mock('@/lib/api', () => ({
  authApi: { getProfileDetails: m.getProfile, updateProfileDetails: m.updateProfile },
  useAuth: () => ({ user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' }, refresh: m.refresh }),
  calendarApi: {
    listConnections: m.listConnections,
    connectGoogle: m.connectGoogle,
    connectOutlook: m.connectOutlook,
    connectApple: m.connectApple,
  },
}));
vi.mock('@neutrino/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@neutrino/ui')>()),
  useToast: () => ({ success: vi.fn(), error: m.toastError }),
  AvatarPickerDialog: ({ onApply, onClose }: { onApply: (u: string) => void; onClose: () => void }) => (
    <div role="dialog" aria-label="Avatar picker">
      <button onClick={() => { onApply('data:image/png;base64,AAAA'); onClose(); }}>Use this photo</button>
    </div>
  ),
}));
const localImportStarted = vi.hoisted(() => ({ fire: null as null | (() => void) }));
vi.mock('@/components/LocalImport', () => ({
  LocalImport: ({ onStarted, showTakeout }: { onStarted?: () => void; showTakeout?: boolean }) => {
    localImportStarted.fire = () => onStarted?.();
    return (
      <div data-testid="local-import" data-takeout={String(showTakeout)}>
        <button onClick={() => onStarted?.()}>Import 3 files</button>
      </div>
    );
  },
}));
vi.mock('@/components/InviteFriends', () => ({
  InviteFriendsPanel: ({ onSent, onLinkUsed, showSentList }: { onSent?: () => void; onLinkUsed?: () => void; showSentList?: boolean }) => (
    <div data-testid="invite-panel" data-sent-list={String(showSentList)}>
      <button onClick={() => onLinkUsed?.()}>Copy</button>
      <button onClick={() => onSent?.()}>Send 2 invites</button>
    </div>
  ),
}));

import { LookStep } from '@/components/WelcomeWizard/steps/LookStep';
import { ProfileStep } from '@/components/WelcomeWizard/steps/ProfileStep';
import { AiStep } from '@/components/WelcomeWizard/steps/AiStep';
import { CalendarStep } from '@/components/WelcomeWizard/steps/CalendarStep';
import { FilesStep } from '@/components/WelcomeWizard/steps/FilesStep';
import { InviteStep } from '@/components/WelcomeWizard/steps/InviteStep';

// ── harness ───────────────────────────────────────────────────────────────────
function host() {
  const state = { done: 0, commit: null as StepCommit | null };
  const value = {
    markDone: () => { state.done += 1; },
    setCommit: (c: StepCommit | null) => { state.commit = c; },
  };
  return { state, value };
}

function mountStep(step: React.ReactElement) {
  const h = host();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <StepContext.Provider value={h.value}>{step}</StepContext.Provider>
    </QueryClientProvider>,
  );
  return { ...h, ...utils };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.theme = 'system';
  m.aiSettings = { provider: 'gemini', apiKey: '' };
  m.getProfile.mockResolvedValue({ bio: '', language: '', country: '', avatar: null });
  m.updateProfile.mockResolvedValue({});
  m.listConnections.mockResolvedValue({ connections: [] });
  preferences.set('appearance.look', 'classic');
  preferences.set('appearance.accent', null);
});
afterEach(() => window.sessionStorage.removeItem(WIZARD_RETURN_KEY));

// ── Look & theme ──────────────────────────────────────────────────────────────
describe('Look & theme', () => {
  it('applies and persists a look on click: it is the preference the app behind the dialog reads', () => {
    const { state } = mountStep(<LookStep />);
    fireEvent.click(screen.getByRole('radio', { name: /Quiet Precision/ }));
    expect(preferences.get('appearance.look')).toBe('precision');
    expect(preferences.pendingKeys().has('appearance.look')).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /Blended Flow/ }));
    expect(preferences.get('appearance.look')).toBe('blended');
    expect(state.done).toBe(2);
  });

  it('offers the accents the app really has, by name, and applies one on click', () => {
    const { state } = mountStep(<LookStep />);
    for (const name of ['Indigo', 'Green', 'Teal', 'Violet', 'Rose', 'Orange']) {
      expect(screen.getByRole('radio', { name })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('radio', { name: 'Teal' }));
    expect(preferences.get('appearance.accent')).toBe('#0e8c8c');
    expect(screen.getByRole('radio', { name: 'Teal' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: /Look.s own/ }));
    expect(preferences.get('appearance.accent')).toBeNull();
    expect(state.done).toBe(2);
  });

  it('applies Light, Dark and As the device through the theme setting, on click', () => {
    const { state } = mountStep(<LookStep />);
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    fireEvent.click(screen.getByRole('radio', { name: 'As the device' }));
    expect(m.setTheme.mock.calls.map((c) => c[0])).toEqual(['dark', 'light', 'system']);
    expect(state.done).toBe(3);
  });

  it('registers nothing to save on leaving: every choice is already applied, and Back does not undo it', () => {
    const { state } = mountStep(<LookStep />);
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(state.commit).toBeNull();
    expect(m.theme).toBe('dark');
  });
});

// ── Your profile ──────────────────────────────────────────────────────────────
describe('Your profile', () => {
  async function ready() {
    const h = mountStep(<ProfileStep />);
    await waitFor(() => expect((screen.getByLabelText('Display name') as HTMLInputElement).value).toBe('Ada Lovelace'));
    return h;
  }

  it('offers an avatar, a display name, a line about you, a language and a region, with no "(optional)"', async () => {
    await ready();
    expect(screen.getByRole('button', { name: 'Upload a photo' })).toBeTruthy();
    for (const label of ['Display name', 'A line about you', 'Language', 'Region']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    expect(document.body.textContent?.toLowerCase()).not.toContain('optional');
  });

  it('saves only what changed, when the step is left, and then counts as done', async () => {
    const { state } = await ready();
    fireEvent.change(screen.getByLabelText('A line about you'), { target: { value: ' Maths, mostly. ' } });
    fireEvent.change(screen.getByLabelText('Region'), { target: { value: 'GB' } });
    let saved: boolean | void = undefined;
    await act(async () => { saved = await state.commit!(); });
    expect(saved).toBe(true);
    expect(m.updateProfile).toHaveBeenCalledTimes(1);
    expect(m.updateProfile).toHaveBeenCalledWith({ bio: 'Maths, mostly.', country: 'GB' });
    expect(m.refresh).toHaveBeenCalled();
    expect(state.done).toBe(1);
  });

  it('saves a new photo and a new name', async () => {
    const { state } = await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Upload a photo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use this photo' }));
    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Ada L.' } });
    await act(async () => { await state.commit!(); });
    expect(m.updateProfile).toHaveBeenCalledWith({ name: 'Ada L.', avatar: 'data:image/png;base64,AAAA' });
  });

  it('writes nothing, and is not done, when nothing was changed', async () => {
    const { state } = await ready();
    let saved: boolean | void = undefined;
    await act(async () => { saved = await state.commit!(); });
    expect(saved).toBe(false);
    expect(m.updateProfile).not.toHaveBeenCalled();
    expect(state.done).toBe(0);
  });

  it('shows why and keeps the user here when the save fails', async () => {
    m.updateProfile.mockRejectedValue(new Error('Server unavailable'));
    const { state } = await ready();
    fireEvent.change(screen.getByLabelText('A line about you'), { target: { value: 'x' } });
    await act(async () => { await expect(state.commit!()).rejects.toThrow('Server unavailable'); });
    expect(screen.getByRole('alert').textContent).toBe('Server unavailable');
    expect(state.done).toBe(0);
  });
});

// ── AI assistant ──────────────────────────────────────────────────────────────
describe('AI assistant', () => {
  it('offers only the providers the app supports and a key field with Test key beside it', () => {
    mountStep(<AiStep />);
    const options = Array.from((screen.getByLabelText('Provider') as HTMLSelectElement).options).map((o) => o.value);
    expect(options).toEqual(['gemini', 'claude', 'openai']);
    expect(screen.getByLabelText('API key')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Test key' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Leave it empty to set it up later\. Next saves a key you.ve pasted\./)).toBeTruthy();
  });

  it('links "Where do I get a key?" to the chosen provider', () => {
    mountStep(<AiStep />);
    const link = () => screen.getByRole('link', { name: 'Where do I get a key?' }) as HTMLAnchorElement;
    expect(link().href).toBe('https://aistudio.google.com/apikey');
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'claude' } });
    expect(link().href).toBe('https://console.anthropic.com/settings/keys');
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai' } });
    expect(link().href).toBe('https://platform.openai.com/api-keys');
  });

  it('tests the key as typed, with the chosen provider, and saves nothing', async () => {
    m.complete.mockResolvedValue('ready');
    const { state } = mountStep(<AiStep />);
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'claude' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'sk-test' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Test key' })); });
    expect(m.complete).toHaveBeenCalledTimes(1);
    expect(m.complete.mock.calls[0][1]).toMatchObject({ credentials: { provider: 'claude', apiKey: 'sk-test' } });
    expect(await screen.findByText(/Key works/)).toBeTruthy();
    expect(m.setAiSettings).not.toHaveBeenCalled();
    expect(state.done).toBe(0);
  });

  it('says what the provider said when the key is refused', async () => {
    m.complete.mockRejectedValue(new Error('Anthropic Claude rejected the API key'));
    mountStep(<AiStep />);
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'nope' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Test key' })); });
    expect(await screen.findByText('Anthropic Claude rejected the API key')).toBeTruthy();
  });

  it('saves a pasted key and its provider when the step is left, through the existing setting', async () => {
    const { state } = mountStep(<AiStep />);
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'openai' } });
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: ' sk-live ' } });
    let saved: boolean | void = undefined;
    await act(async () => { saved = await state.commit!(); });
    expect(saved).toBe(true);
    expect(m.setAiSettings).toHaveBeenCalledWith({ provider: 'openai', apiKey: 'sk-live' });
    expect(state.done).toBe(1);
  });

  it('saves nothing when the key is left empty: that is "set it up later"', async () => {
    const { state } = mountStep(<AiStep />);
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'claude' } });
    let saved: boolean | void = undefined;
    await act(async () => { saved = await state.commit!(); });
    expect(saved).toBe(false);
    expect(m.setAiSettings).not.toHaveBeenCalled();
    expect(state.done).toBe(0);
  });

  it('does not clear a key that is already set when the field is left alone', async () => {
    m.aiSettings = { provider: 'claude', apiKey: 'sk-existing' };
    const { state } = mountStep(<AiStep />);
    await act(async () => { await state.commit!(); });
    expect(m.setAiSettings).not.toHaveBeenCalled();
  });
});

// ── Calendar ──────────────────────────────────────────────────────────────────
describe('Calendar', () => {
  it('has a row for each provider the app can connect, each with Connect', async () => {
    mountStep(<CalendarStep />);
    expect(await screen.findByText('Google Calendar')).toBeTruthy();
    expect(screen.getByText('Outlook / Microsoft 365')).toBeTruthy();
    expect(screen.getByText('Apple Calendar (iCloud)')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Connect / })).toHaveLength(3);
    expect(screen.getByText('Have an .ics file instead? Drop it on the calendar any time.')).toBeTruthy();
  });

  it('shows a connected provider as Connected with its account, and counts the step as done', async () => {
    m.listConnections.mockResolvedValue({ connections: [{ id: 'c1', provider: 'google', email: 'ada@gmail.com' }] });
    const { state } = mountStep(<CalendarStep />);
    expect(await screen.findByText('ada@gmail.com')).toBeTruthy();
    expect(screen.getByText('Connected')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^Connect / })).toHaveLength(2);
    await waitFor(() => expect(state.done).toBe(1));
  });

  it('notes the step before leaving the app for Google, so the wizard can reopen on it', async () => {
    m.connectGoogle.mockResolvedValue({ authUrl: '#google-sign-in' });
    mountStep(<CalendarStep />);
    await screen.findByText('Google Calendar');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Connect Google Calendar' })); });
    expect(m.connectGoogle).toHaveBeenCalled();
    expect(window.sessionStorage.getItem(WIZARD_RETURN_KEY)).toBe('calendar');
  });

  it('says why when a provider cannot be connected, and does not note a step to return to', async () => {
    m.connectOutlook.mockRejectedValue(new Error('OUTLOOK_CLIENT_ID is not set'));
    mountStep(<CalendarStep />);
    await screen.findByText('Google Calendar');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Connect Outlook / Microsoft 365' })); });
    expect(m.toastError).toHaveBeenCalledWith(expect.stringContaining('OUTLOOK_CLIENT_ID is not set'));
    expect(window.sessionStorage.getItem(WIZARD_RETURN_KEY)).toBeNull();
  });

  it('connects Apple with CalDAV details, in the dialog Settings uses, and counts as done', async () => {
    m.connectApple.mockResolvedValue({ id: 'c2', provider: 'apple', email: 'ada@icloud.com' });
    const { state } = mountStep(<CalendarStep />);
    await screen.findByText('Google Calendar');
    fireEvent.click(screen.getByRole('button', { name: 'Connect Apple Calendar (iCloud)' }));
    fireEvent.change(screen.getByPlaceholderText('you@icloud.com'), { target: { value: 'ada@icloud.com' } });
    fireEvent.change(screen.getByPlaceholderText('xxxx-xxxx-xxxx-xxxx'), { target: { value: 'abcd-efgh-ijkl-mnop' } });
    await act(async () => { fireEvent.submit(document.getElementById('apple-connect-form')!); });
    expect(m.connectApple).toHaveBeenCalled();
    expect(m.connectApple.mock.calls[0][0]).toEqual({
      caldavUrl: 'https://caldav.icloud.com',
      username: 'ada@icloud.com',
      password: 'abcd-efgh-ijkl-mnop',
    });
    await waitFor(() => expect(state.done).toBe(1));
  });
});

// ── Bring your files / Invite friends ─────────────────────────────────────────
describe('Bring your files', () => {
  it('embeds the local import with the "From Google" card, and starting an import counts as done', () => {
    const { state } = mountStep(<FilesStep />);
    expect(screen.getByTestId('local-import').getAttribute('data-takeout')).toBe('true');
    expect(state.done).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Import 3 files' }));
    expect(state.done).toBe(1);
  });
});

describe('Invite friends', () => {
  it('embeds the invite panel without its sent list, and says how long each kind of invite lasts', () => {
    mountStep(<InviteStep />);
    expect(screen.getByTestId('invite-panel').getAttribute('data-sent-list')).toBe('false');
    const text = document.body.textContent ?? '';
    expect(text).toContain('Invitations sent by email work once and expire after 14 days');
    expect(text).toContain('personal link can be used by several people');
    expect(text).toContain('Reset link');
  });

  it('counts sending invites, and using the personal link, as done', () => {
    const a = mountStep(<InviteStep />);
    fireEvent.click(screen.getByRole('button', { name: 'Send 2 invites' }));
    expect(a.state.done).toBe(1);
    a.unmount();
    const b = mountStep(<InviteStep />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(b.state.done).toBe(1);
  });
});
