import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/preact';
import { route } from 'preact-router';

import App from '../src/components/app';

const channels = [
  { label: 'Cycle 1', value: 'cycle-1', channel: { baseUrl: 'https://catalog.test/', imageDir: 'cycles/cycle-1', imageName: null } },
  { label: 'Cycle 2', value: 'cycle-2', default: true, channel: { baseUrl: 'https://catalog.test/', imageDir: 'cycles/cycle-2', imageName: null } },
  { label: 'Pac-Man', value: 'pac-man', channel: { imageDir: 'HomeBrew/titles', imageName: 'pac-man.nabu' } },
];

const stubChannels = list => vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true, json: async () => list,
})));

beforeEach(() => {
  // A browser with WebSerial but no previously granted ports.
  Object.defineProperty(navigator, 'serial', {
    configurable: true,
    value: { getPorts: async () => [], requestPort: vi.fn() },
  });
  stubChannels(channels);
});

afterEach(() => {
  cleanup();
  route('/');
  vi.unstubAllGlobals();
});

describe('home page', () => {
  it('waits for a port with both connect buttons enabled', async () => {
    render(<App />);
    expect(await screen.findByText('Adaptor state: waitingForPort')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Serial' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Connect WebSocket' }).disabled).toBe(false);
  });

  it('selects the channel marked default', async () => {
    render(<App />);
    const select = await screen.findByLabelText('Channel');
    expect(select.value).toBe('cycle-2');
  });

  it('falls back to the first channel without a default', async () => {
    stubChannels(channels.map(({ default: _, ...c }) => c));
    render(<App />);
    const select = await screen.findByLabelText('Channel');
    expect(select.value).toBe('cycle-1');
  });

  it('changes channel', async () => {
    render(<App />);
    const select = await screen.findByLabelText('Channel');
    fireEvent.change(select, { target: { value: 'pac-man' } });
    await waitFor(() => expect(screen.getByLabelText('Channel').value).toBe('pac-man'));
  });

  it('opens and cancels the WebSocket dialog', async () => {
    render(<App />);
    await screen.findByText('Adaptor state: waitingForPort');
    fireEvent.click(screen.getByRole('button', { name: 'Connect WebSocket' }));

    const dialog = document.querySelector('dialog');
    await waitFor(() => expect(dialog.open).toBe(true));
    expect(screen.getByLabelText('WebSocket URL').value).toBe('ws://127.0.0.1:5818');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(dialog.open).toBe(false));
  });

  it('navigates to the FAQ and back', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('link', { name: 'FAQ' }));
    expect(await screen.findByText('Frequently Assumed Questions')).toBeTruthy();

    fireEvent.click(screen.getByRole('link', { name: 'Back to Home' }));
    expect(await screen.findByText('Adaptor state: waitingForPort')).toBeTruthy();
  });
});

describe('without WebSerial', () => {
  it('stops and hides the connect buttons', async () => {
    Object.defineProperty(navigator, 'serial', { configurable: true, value: undefined });
    render(<App />);
    expect(await screen.findByText('Adaptor state: stopped')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect Serial' })).toBeNull();
  });
});
