import { describe, expect, it } from 'vitest';
import { DEFAULT_ICON, decodeIcon, parseChannelList, searchChannels } from '../src/components/channel-list';

describe('parseChannelList', () => {
  it('leaves out disabled channels, and categories left empty', () => {
    const { categories, channels } = parseChannelList({
      categories: [
        {
          name: 'Games', channels: [
            { label: 'A', value: 'a', channel: {} },
            { label: 'B', value: 'b', channel: {}, disabled: 'Needs RetroNET' },
            { label: 'C', value: 'c', channel: {} },
          ],
        },
        { name: 'Network', channels: [{ label: 'D', value: 'd', channel: {}, disabled: 'Needs RetroNET' }] },
      ],
    });
    expect(channels.map(c => [c.value, c.number])).toEqual([['a', '101'], ['c', '102']]);
    expect(categories.map(c => c.name)).toEqual(['Games']);
  });

  it('puts a flat list in one category', () => {
    const { categories, channels } = parseChannelList([
      { label: 'A', value: 'a', channel: { imageDir: 'x' } },
      { label: 'B', value: 'b', channel: { imageDir: 'y' } },
    ]);
    expect(categories.map(c => c.name)).toEqual(['Channels']);
    expect(channels.map(c => [c.value, c.number, c.category])).toEqual([
      ['a', '101', 'Channels'], ['b', '102', 'Channels'],
    ]);
  });

  it('numbers channels by category and position', () => {
    const { categories, channels } = parseChannelList({
      categories: [
        { name: 'One', color: '#123456', channels: [{ label: 'A', value: 'a', channel: {} }] },
        { name: 'Empty', channels: [] },
        { name: 'Two', channels: [{ label: 'B', value: 'b', channel: {} }, { label: 'C', value: 'c', channel: {} }] },
      ],
    });
    // Empty categories are dropped after numbering.
    expect(categories.map(c => c.name)).toEqual(['One', 'Two']);
    expect(categories[0].color).toBe('#123456');
    expect(channels.map(c => c.number)).toEqual(['101', '301', '302']);
  });

  it('skips entries without a value or channel', () => {
    const { channels } = parseChannelList([{ label: 'A', value: 'a' }, { label: 'B', channel: {} }]);
    expect(channels).toEqual([]);
  });
});

describe('searchChannels', () => {
  const { channels } = parseChannelList({
    categories: [
      { name: 'Games', channels: [
        { label: 'Pac-Man', value: 'pac-man', author: 'Namco', channel: { imageName: 'pac-man.nabu' } },
        { label: 'Snake', value: 'snake', author: 'ProductionDave', description: 'Classic game', channel: {} },
      ] },
      { name: 'Demos', channels: [{ label: 'Plasma', value: 'plasma', channel: {} }] },
    ],
  });
  const values = q => searchChannels(channels, q).map(c => c.value);

  it('returns everything for an empty query', () => {
    expect(values('  ')).toHaveLength(3);
  });

  it('needs every word to match somewhere', () => {
    expect(values('classic dave')).toEqual(['snake']);
    expect(values('classic namco')).toEqual([]);
    expect(values('demos')).toEqual(['plasma']);
    expect(values('PAC-MAN.NABU')).toEqual(['pac-man']);
  });

  it('matches the start of channel numbers', () => {
    expect(values('10')).toEqual(['pac-man', 'snake']);
    expect(values('201')).toEqual(['plasma']);
  });
});

describe('decodeIcon', () => {
  it('draws the NABU logo', () => {
    const pixels = decodeIcon(DEFAULT_ICON);
    expect(pixels).toHaveLength(16 * 16 * 4);
    // The top left pixel is dark blue background (color 4), fully opaque.
    expect([...pixels.slice(0, 4)]).toEqual([43, 45, 227, 255]);
  });

  it('rejects short or broken data', () => {
    expect(decodeIcon({ pattern: 'AAAA', color: 'AAAA' })).toBeNull();
    expect(decodeIcon({ pattern: '!!', color: '!!' })).toBeNull();
  });
});
