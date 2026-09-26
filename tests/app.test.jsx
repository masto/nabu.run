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
  // route() doesn't touch the URL with no router mounted; start each test
  // on a plain URL, since the channel is kept in it.
  window.history.replaceState(null, '', '/');
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
    expect(await screen.findByRole('button', { name: /Channel 102 Cycle 2/ })).toBeTruthy();
  });

  it('falls back to the first channel without a default', async () => {
    stubChannels(channels.map(({ default: _, ...c }) => c));
    render(<App />);
    expect(await screen.findByRole('button', { name: /Channel 101 Cycle 1/ })).toBeTruthy();
  });

  it('opens and cancels the WebSocket dialog', async () => {
    render(<App />);
    await screen.findByText('Adaptor state: waitingForPort');
    fireEvent.click(screen.getByRole('button', { name: 'Connect WebSocket' }));

    const dialog = document.querySelector('dialog[aria-labelledby="ws-dialog-title"]');
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

describe('channel guide', () => {
  const categorized = {
    categories: [
      {
        name: 'Cycles', description: 'The originals',
        channels: [
          { label: 'Cycle 1', value: 'cycle-1', channel: { imageDir: 'cycles/cycle-1' } },
          { label: 'Cycle 2', value: 'cycle-2', default: true, channel: { imageDir: 'cycles/cycle-2' } },
        ],
      },
      {
        name: 'Games',
        channels: [
          { label: 'Pac-Man', value: 'pac-man', author: 'Namco', channel: { imageDir: 'titles', imageName: 'pac-man.nabu' } },
          { label: 'Tetris', value: 'tetris', author: 'ProductionDave', channel: { imageDir: 'titles', imageName: 'tetris.nabu' } },
        ],
      },
    ],
  };

  const openGuide = async (current = /Channel 102/) => {
    fireEvent.click(await screen.findByRole('button', { name: current }));
    const dialog = document.querySelector('dialog[aria-labelledby="channel-guide-title"]');
    await waitFor(() => expect(dialog.open).toBe(true));
    return dialog;
  };

  const channelButton = label => screen.getByRole('option', { name: new RegExp(label) });
  const key = (el, k) => fireEvent.keyDown(el, { key: k });

  beforeEach(() => stubChannels(categorized));

  it('tunes a channel found by search', async () => {
    render(<App />);
    const dialog = await openGuide();
    fireEvent.input(screen.getByLabelText('Search channels'), { target: { value: 'namco' } });

    expect(screen.getByText('1 match for “namco”')).toBeTruthy();
    fireEvent.click(channelButton('Pac-Man'));
    fireEvent.click(screen.getByRole('button', { name: 'Tune in' }));

    await waitFor(() => expect(dialog.open).toBe(false));
    expect(screen.getByRole('button', { name: /Channel 201 Pac-Man/ })).toBeTruthy();
  });

  it('matches channel numbers', async () => {
    render(<App />);
    await openGuide();
    fireEvent.input(screen.getByLabelText('Search channels'), { target: { value: '202' } });
    expect(screen.getAllByRole('option').map(o => o.dataset.channel)).toEqual(['tetris']);
  });

  it('filters by category', async () => {
    render(<App />);
    await openGuide();
    fireEvent.click(screen.getByRole('button', { name: /Games/ }));
    expect(screen.getAllByRole('option').map(o => o.dataset.channel)).toEqual(['pac-man', 'tetris']);
  });

  it('reopens in the same category', async () => {
    render(<App />);
    const dialog = await openGuide();
    fireEvent.click(screen.getByRole('button', { name: /Games/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Close channel guide' }));
    await waitFor(() => expect(dialog.open).toBe(false));

    await openGuide();
    expect(screen.getByRole('button', { name: /Games/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getAllByRole('option').map(o => o.dataset.channel)).toEqual(['pac-man', 'tetris']);
  });

  it('moves with the arrow keys and tunes with Enter', async () => {
    render(<App />);
    const dialog = await openGuide();

    // Down from search into the list, which starts on the current channel.
    key(screen.getByLabelText('Search channels'), 'ArrowDown');
    expect(document.activeElement).toBe(channelButton('Cycle 2'));

    key(document.activeElement, 'ArrowDown');
    await waitFor(() => expect(document.activeElement).toBe(channelButton('Pac-Man')));
    expect(channelButton('Pac-Man').getAttribute('aria-selected')).toBe('true');

    // Right to the details, back left to the list, left again to the categories.
    key(document.activeElement, 'ArrowRight');
    expect(document.activeElement.textContent).toBe('Tune in');
    key(document.activeElement, 'ArrowLeft');
    expect(document.activeElement).toBe(channelButton('Pac-Man'));
    key(document.activeElement, 'ArrowLeft');
    expect(document.activeElement.textContent).toMatch(/All channels/);

    // Down the categories narrows the list.
    key(document.activeElement, 'ArrowDown');
    await waitFor(() => expect(document.activeElement.textContent).toMatch(/Cycles/));
    expect(screen.getAllByRole('option')).toHaveLength(2);

    key(document.activeElement, 'ArrowRight');
    key(document.activeElement, 'ArrowDown');
    await waitFor(() => expect(document.activeElement).toBe(channelButton('Cycle 2')));
    key(document.activeElement, 'ArrowUp');
    await waitFor(() => expect(document.activeElement).toBe(channelButton('Cycle 1')));
    key(document.activeElement, 'Enter');

    await waitFor(() => expect(dialog.open).toBe(false));
    expect(screen.getByRole('button', { name: /Channel 101 Cycle 1/ })).toBeTruthy();
  });

  it('remembers recently tuned channels', async () => {
    localStorage.clear();
    render(<App />);
    await openGuide();
    key(screen.getByLabelText('Search channels'), 'ArrowDown');
    key(document.activeElement, 'End');
    await waitFor(() => expect(document.activeElement).toBe(channelButton('Tetris')));
    key(document.activeElement, 'Enter');

    await openGuide(/Channel 202 Tetris/);
    const recent = await screen.findByRole('group', { name: 'Recent channels' });
    expect(recent.textContent).toMatch(/Tetris/);
    expect(JSON.parse(localStorage.getItem('nabu.run:recentChannels'))).toEqual(['tetris']);
  });
});

describe('channel in the URL', () => {
  const at = url => window.history.replaceState(null, '', url);
  const ch = () => new URLSearchParams(window.location.search).get('ch');

  it('starts on the channel in the URL', async () => {
    at('/?ch=pac-man');
    render(<App />);
    expect(await screen.findByRole('button', { name: /Channel 103 Pac-Man/ })).toBeTruthy();
    expect(ch()).toBe('pac-man');
  });

  it('falls back to the default for a channel it doesn\'t know', async () => {
    at('/?ch=nope');
    render(<App />);
    expect(await screen.findByRole('button', { name: /Channel 102 Cycle 2/ })).toBeTruthy();
    await waitFor(() => expect(ch()).toBeNull());
  });

  it('keeps the URL plain for the default channel', async () => {
    render(<App />);
    await screen.findByRole('button', { name: /Channel 102 Cycle 2/ });
    expect(window.location.search).toBe('');
  });

  it('follows the channel as it changes, without adding history', async () => {
    const length = window.history.length;
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Channel 102/ }));
    fireEvent.click(screen.getByRole('option', { name: /Pac-Man/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Tune in' }));
    await waitFor(() => expect(ch()).toBe('pac-man'));
    expect(window.history.length).toBe(length);

    fireEvent.click(screen.getByRole('button', { name: /Channel 103/ }));
    fireEvent.click(screen.getByRole('option', { name: /Cycle 2/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Tune in' }));
    await waitFor(() => expect(ch()).toBeNull());
  });

  it('keeps the channel across pages', async () => {
    at('/?ch=pac-man');
    render(<App />);
    fireEvent.click(await screen.findByRole('link', { name: 'FAQ' }));
    await screen.findByText('Frequently Assumed Questions');
    await waitFor(() => expect(window.location.pathname).toBe('/faq'));
    await waitFor(() => expect(ch()).toBe('pac-man'));
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
