// Ikon garis sederhana (SVG inline) agar aplikasi tidak bergantung pada internet.
const P = {
  home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10',
  cart: 'M3 4h2l2.4 11.2a1 1 0 001 .8h9.2a1 1 0 001-.8L20 8H6.2M9 20a1 1 0 100-2 1 1 0 000 2zm8 0a1 1 0 100-2 1 1 0 000 2z',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zm3 5h6m-6 4h6m-6 4h4',
  users: 'M16 20v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M9 10a4 4 0 100-8 4 4 0 000 8zm13 10v-2a4 4 0 00-3-3.9M16 2.1a4 4 0 010 7.8',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8',
  alert: 'M12 3l10 18H2L12 3zm0 7v4m0 3v.01',
  check: 'M9 11l3 3 8-8M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h9',
  tag: 'M20.6 13.4L13.4 20.6a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8zM7.5 7.5h.01',
  folder: 'M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V6z',
  truck: 'M1 4h14v12H1zM15 9h4l3 3v4h-7M5.5 20a2 2 0 100-4 2 2 0 000 4zm13 0a2 2 0 100-4 2 2 0 000 4z',
  building: 'M4 21V4a1 1 0 011-1h10a1 1 0 011 1v17M16 9h3a1 1 0 011 1v11M2 21h20M8 7h4M8 11h4M8 15h4',
  wallet: 'M3 7a2 2 0 012-2h14v4M3 7v11a2 2 0 002 2h16v-6M3 7h16M21 10h-5a2 2 0 000 4h5v-4z',
  'arrow-up': 'M7 17L17 7M8 7h9v9',
  'arrow-down': 'M17 7L7 17M16 17H7V8',
  book: 'M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5v14zM4 19.5A2.5 2.5 0 006.5 22H20v-5',
  id: 'M3 5h18v14H3zM8 11a2 2 0 100-4 2 2 0 000 4zm-3 5c.5-2 1.8-3 3-3s2.5 1 3 3M14 9h4m-4 4h4',
  calendar: 'M4 5h16v16H4zM4 9h16M8 3v4m8-4v4',
  cash: 'M2 6h20v12H2zM12 15a3 3 0 100-6 3 3 0 000 6zM6 12h.01M18 12h.01',
  chart: 'M3 3v18h18M7 15l4-4 3 3 6-6',
  scale: 'M12 3v18M5 7h14M5 7l-3 7a3 3 0 006 0L5 7zm14 0l-3 7a3 3 0 006 0l-3-7zM8 21h8',
  flow: 'M4 7h13l-3-3m3 3l-3 3M20 17H7l3-3m-3 3l3 3',
  trend: 'M22 7l-8.5 8.5-5-5L2 17M16 7h6v6',
  layers: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  key: 'M15 7a4 4 0 11-3.9 5H3v3h3v3h3v-3h2.1A4 4 0 0115 7zm2 0h.01',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  menu: 'M3 6h18M3 12h18M3 18h18',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4m7 14l5-5-5-5m5 5H9',
  print: 'M6 9V3h12v6M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v7H6z',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 19a8 8 0 100-16 8 8 0 000 16zm10 2l-4.3-4.3',
  trash: 'M3 6h18M8 6V4h8v2m-9 0l1 14h8l1-14',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z',
  x: 'M18 6L6 18M6 6l12 12',
};

const icon = (name, cls = 'icon') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[name] || P.list}"/></svg>`;

module.exports = { icon };
