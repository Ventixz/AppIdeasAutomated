// sample-data.js — a small, API-shaped catalog so the app works with zero setup.
//
// These records are shaped exactly like TheMovieDB's /discover and /movie
// responses, so the same movie-core.js code path runs whether the data comes
// from here or from the live API. Posters are omitted (posterPath === '') so no
// external images are required offline; the UI shows a lettered placeholder.

(function (root) {
  'use strict';

  const MOVIES = [
    {
      id: 693134, title: 'Dune: Part Two', release_date: '2024-02-27',
      vote_average: 8.2, vote_count: 5400, runtime: 167,
      overview: 'Paul Atreides unites with the Fremen to wage war against House Harkonnen and avenge his family, while grappling with the visions of a terrible future only he can prevent.',
      genres: [{ id: 878, name: 'Science Fiction' }, { id: 12, name: 'Adventure' }],
      credits: { cast: [
        { name: 'Timothée Chalamet', character: 'Paul Atreides' },
        { name: 'Zendaya', character: 'Chani' },
        { name: 'Rebecca Ferguson', character: 'Lady Jessica' },
        { name: 'Javier Bardem', character: 'Stilgar' },
      ] },
    },
    {
      id: 872585, title: 'Oppenheimer', release_date: '2023-07-19',
      vote_average: 8.1, vote_count: 8900, runtime: 181,
      overview: 'The story of J. Robert Oppenheimer and his role in the development of the atomic bomb during World War II.',
      genres: [{ id: 18, name: 'Drama' }, { id: 36, name: 'History' }],
      credits: { cast: [
        { name: 'Cillian Murphy', character: 'J. Robert Oppenheimer' },
        { name: 'Emily Blunt', character: 'Kitty Oppenheimer' },
        { name: 'Robert Downey Jr.', character: 'Lewis Strauss' },
      ] },
    },
    {
      id: 346698, title: 'Barbie', release_date: '2023-07-19',
      vote_average: 7.0, vote_count: 9500, runtime: 114,
      overview: 'Barbie suffers a crisis that leads her to question her world and her existence, taking her on a journey to the real world.',
      genres: [{ id: 35, name: 'Comedy' }, { id: 12, name: 'Adventure' }],
      credits: { cast: [
        { name: 'Margot Robbie', character: 'Barbie' },
        { name: 'Ryan Gosling', character: 'Ken' },
      ] },
    },
    {
      id: 335984, title: 'Blade Runner 2049', release_date: '2017-10-04',
      vote_average: 7.6, vote_count: 13200, runtime: 164,
      overview: 'A young Blade Runner’s discovery of a long-buried secret leads him to track down former Blade Runner Rick Deckard, who has been missing for thirty years.',
      genres: [{ id: 878, name: 'Science Fiction' }, { id: 53, name: 'Thriller' }],
      credits: { cast: [
        { name: 'Ryan Gosling', character: 'K' },
        { name: 'Harrison Ford', character: 'Rick Deckard' },
        { name: 'Ana de Armas', character: 'Joi' },
      ] },
    },
    {
      id: 329865, title: 'Arrival', release_date: '2016-11-10',
      vote_average: 7.6, vote_count: 16500, runtime: 116,
      overview: 'A linguist is recruited by the military to communicate with alien lifeforms after twelve mysterious spacecraft land around the world.',
      genres: [{ id: 878, name: 'Science Fiction' }, { id: 18, name: 'Drama' }],
      credits: { cast: [
        { name: 'Amy Adams', character: 'Louise Banks' },
        { name: 'Jeremy Renner', character: 'Ian Donnelly' },
      ] },
    },
    {
      id: 27205, title: 'Inception', release_date: '2010-07-15',
      vote_average: 8.4, vote_count: 35000, runtime: 148,
      overview: 'A thief who steals corporate secrets through dream-sharing technology is given the inverse task of planting an idea into the mind of a C.E.O.',
      genres: [{ id: 28, name: 'Action' }, { id: 878, name: 'Science Fiction' }],
      credits: { cast: [
        { name: 'Leonardo DiCaprio', character: 'Dom Cobb' },
        { name: 'Joseph Gordon-Levitt', character: 'Arthur' },
        { name: 'Elliot Page', character: 'Ariadne' },
      ] },
    },
    {
      id: 157336, title: 'Interstellar', release_date: '2014-11-05',
      vote_average: 8.4, vote_count: 33000, runtime: 169,
      overview: 'A team of explorers travel through a wormhole in space in an attempt to ensure humanity’s survival.',
      genres: [{ id: 12, name: 'Adventure' }, { id: 18, name: 'Drama' }, { id: 878, name: 'Science Fiction' }],
      credits: { cast: [
        { name: 'Matthew McConaughey', character: 'Cooper' },
        { name: 'Anne Hathaway', character: 'Brand' },
        { name: 'Jessica Chastain', character: 'Murph' },
      ] },
    },
    {
      id: 155, title: 'The Dark Knight', release_date: '2008-07-16',
      vote_average: 8.5, vote_count: 31000, runtime: 152,
      overview: 'Batman raises the stakes in his war on crime, setting out to dismantle the remaining criminal organizations that plague Gotham with the help of Lieutenant Gordon and Harvey Dent.',
      genres: [{ id: 18, name: 'Drama' }, { id: 28, name: 'Action' }, { id: 80, name: 'Crime' }],
      credits: { cast: [
        { name: 'Christian Bale', character: 'Bruce Wayne' },
        { name: 'Heath Ledger', character: 'Joker' },
        { name: 'Aaron Eckhart', character: 'Harvey Dent' },
      ] },
    },
    {
      id: 680, title: 'Pulp Fiction', release_date: '1994-09-10',
      vote_average: 8.5, vote_count: 27000, runtime: 154,
      overview: 'The lives of two mob hitmen, a boxer, a gangster and his wife intertwine in four tales of violence and redemption.',
      genres: [{ id: 53, name: 'Thriller' }, { id: 80, name: 'Crime' }],
      credits: { cast: [
        { name: 'John Travolta', character: 'Vincent Vega' },
        { name: 'Samuel L. Jackson', character: 'Jules Winnfield' },
        { name: 'Uma Thurman', character: 'Mia Wallace' },
      ] },
    },
    {
      id: 13, title: 'Forrest Gump', release_date: '1994-06-23',
      vote_average: 8.5, vote_count: 26000, runtime: 142,
      overview: 'A man with a low IQ has accomplished great things in his life and been present during significant historic events, all while longing for his childhood sweetheart.',
      genres: [{ id: 35, name: 'Comedy' }, { id: 18, name: 'Drama' }, { id: 10749, name: 'Romance' }],
      credits: { cast: [
        { name: 'Tom Hanks', character: 'Forrest Gump' },
        { name: 'Robin Wright', character: 'Jenny Curran' },
      ] },
    },
    {
      id: 129, title: 'Spirited Away', release_date: '2001-07-20',
      vote_average: 8.5, vote_count: 16000, runtime: 125,
      overview: 'A young girl wanders into a world ruled by gods, witches and spirits, where humans are changed into beasts, and must find a way to free herself and her parents.',
      genres: [{ id: 16, name: 'Animation' }, { id: 10751, name: 'Family' }, { id: 14, name: 'Fantasy' }],
      credits: { cast: [
        { name: 'Rumi Hiiragi', character: 'Chihiro (voice)' },
        { name: 'Miyu Irino', character: 'Haku (voice)' },
      ] },
    },
    {
      id: 496243, title: 'Parasite', release_date: '2019-05-30',
      vote_average: 8.5, vote_count: 18000, runtime: 133,
      overview: 'All unemployed, Ki-taek’s family takes peculiar interest in the wealthy and glamorous Parks, until they get entangled in an unexpected incident.',
      genres: [{ id: 35, name: 'Comedy' }, { id: 53, name: 'Thriller' }, { id: 18, name: 'Drama' }],
      credits: { cast: [
        { name: 'Song Kang-ho', character: 'Ki-taek' },
        { name: 'Lee Sun-kyun', character: 'Park Dong-ik' },
      ] },
    },
  ];

  // Emulate the API's paged /discover response. Sorted newest-first here just so
  // paging behaves like the live endpoint; movie-core re-sorts anyway.
  function page(pageNum, perPage) {
    const size = perPage || 6;
    const sorted = MOVIES.slice().sort((a, b) =>
      a.release_date < b.release_date ? 1 : a.release_date > b.release_date ? -1 : 0);
    const start = (pageNum - 1) * size;
    const slice = sorted.slice(start, start + size);
    return {
      page: pageNum,
      results: slice,
      total_pages: Math.max(1, Math.ceil(sorted.length / size)),
      total_results: sorted.length,
    };
  }

  function find(id) {
    return MOVIES.find((m) => String(m.id) === String(id)) || null;
  }

  function search(query) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return { results: [] };
    return { results: MOVIES.filter((m) => m.title.toLowerCase().includes(q)) };
  }

  root.SampleData = { MOVIES, page, find, search };
})(typeof self !== 'undefined' ? self : this);
