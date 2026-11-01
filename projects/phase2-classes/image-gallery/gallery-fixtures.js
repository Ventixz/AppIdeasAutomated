/*
 * gallery-fixtures.js — a sample gallery used by the CLI, the tests and the
 * browser demo so all three show the same data. `buildGallery(core)` takes the
 * core module (so the same factory works under Node's require and the browser's
 * window global) and returns a populated Gallery.
 */
'use strict';

function buildGallery(core) {
  const { Gallery, JpegImage, PngImage, GifImage, SvgImage } = core;
  const g = new Gallery('Sample Gallery');

  const sunset = new JpegImage({
    id: 'img-sunset', title: 'Sunset over the bay',
    width: 4032, height: 3024, createdAt: '2026-07-14T19:32:00Z',
    tags: ['travel', 'landscape', 'favourite'],
  });

  const logo = new PngImage({
    id: 'img-logo', title: 'Brand logo (transparent)',
    width: 1024, height: 1024, createdAt: '2026-01-02T09:00:00Z',
    tags: ['brand', 'ui'],
  });

  const spinner = new GifImage({
    id: 'img-spinner', title: 'Loading spinner',
    width: 128, height: 128, frames: 24, createdAt: '2026-03-21T11:15:00Z',
    tags: ['ui', 'animation'],
  });

  const chart = new SvgImage({
    id: 'img-chart', title: 'Quarterly chart',
    width: 800, height: 600, sourceLength: 9400, createdAt: '2026-10-01T08:00:00Z',
    tags: ['brand', 'vector'],
  });

  const portrait = new JpegImage({
    id: 'img-portrait', title: 'Team portrait',
    width: 3000, height: 2000, createdAt: '2026-05-09T14:45:00Z',
    tags: ['team', 'favourite'],
  });

  const icon = new PngImage({
    id: 'img-icon', title: 'App icon',
    width: 512, height: 512, createdAt: '2026-02-18T16:20:00Z',
    tags: ['ui', 'brand'],
  });

  for (const img of [sunset, logo, spinner, chart, portrait, icon]) g.add(img);

  g.createAlbum('Marketing');
  g.addToAlbum('Marketing', 'img-logo');
  g.addToAlbum('Marketing', 'img-chart');
  g.addToAlbum('Marketing', 'img-sunset');

  g.createAlbum('Favourites');
  g.addToAlbum('Favourites', 'img-sunset');
  g.addToAlbum('Favourites', 'img-portrait');

  return g;
}

const api = { buildGallery };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (typeof window !== 'undefined') window.GalleryFixtures = api;
