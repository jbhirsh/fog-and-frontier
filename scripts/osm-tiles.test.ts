import { describe, expect, it } from 'vitest';
import { osmTileUrl, tileOf } from './osm-tiles.ts';

describe('tileOf', () => {
  it('reads a CARTO tile, at either density and with a key', () => {
    expect(tileOf('https://a.basemaps.cartocdn.com/light_all/8/40/98.png')).toBe('8/40/98');
    expect(tileOf('https://d.basemaps.cartocdn.com/light_all/11/327/791@2x.png?key=k')).toBe(
      '11/327/791',
    );
  });

  it('reads an OpenStreetMap tile, with or without a subdomain', () => {
    expect(tileOf('https://tile.openstreetmap.org/8/40/98.png')).toBe('8/40/98');
    expect(tileOf('https://b.tile.openstreetmap.org/11/327/791.png')).toBe('11/327/791');
  });

  it('refuses anything else', () => {
    expect(tileOf('https://example.com/8/40/98.png')).toBeNull();
    expect(tileOf('https://e.basemaps.cartocdn.com/light_all/8/40/98.png')).toBeNull();
    expect(tileOf('https://tile.openstreetmap.org/8/40/98.jpg')).toBeNull();
    expect(tileOf('https://tile.openstreetmap.org/8/40/98.png.evil')).toBeNull();
    expect(tileOf('http://tile.openstreetmap.org/8/40/98.png')).toBeNull();
    expect(tileOf('')).toBeNull();
  });
});

describe('osmTileUrl', () => {
  it('is OpenStreetMap’s standard tile at that place', () => {
    expect(osmTileUrl('8/40/98')).toBe('https://tile.openstreetmap.org/8/40/98.png');
  });
});
