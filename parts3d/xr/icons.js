// One-line buttons: a small stroke icon (currentColor, so the theme applies) plus a short verb. Pure data, no DOM.
// Paths are on a 24x24 grid, stroke only.
const I = {
  cursor: 'M5 3l14 7-6 2-2 6z', plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', undo: 'M9 7L4 12l5 5M4 12h10a6 6 0 010 8h-3', redo: 'M15 7l5 5-5 5M20 12H10a6 6 0 000 8h3', dots: 'M5 12h.01M12 12h.01M19 12h.01',
  ruler: 'M3 16L16 3l5 5L8 21zM7 12l2 2M10 9l2 2M13 6l2 2', pin: 'M12 21s-6-6-6-11a6 6 0 0112 0c0 5-6 11-6 11zM12 7v6M9 10h6', trash: 'M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13',
  rotR: 'M20 12a8 8 0 11-3-6.2M20 4v5h-5', rotL: 'M4 12a8 8 0 103-6.2M4 4v5h5', up: 'M12 19V5M6 11l6-6 6 6', down: 'M12 5v14M6 13l6 6 6-6',
  left: 'M19 12H5M11 6l-6 6 6 6', right: 'M5 12h14M13 6l6 6-6 6', away: 'M12 20V6M6 11l6-6 6 6M8 20h8', toward: 'M12 4v14M6 13l6 6 6-6M8 4h8',
  cover: 'M4 9h16v10H4zM7 9V6h10v3', ruler2: 'M4 18h16M4 18V8M8 18v-3M12 18v-3M16 18v-3', check: 'M5 12l5 5 9-10', x: 'M6 6l12 12M18 6L6 18', back: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6', reset: 'M4 12a8 8 0 108-8M4 4v5h5', exit: 'M10 5H5v14h5M14 8l5 4-5 4M19 12H9', place: 'M12 21s-6-6-6-11a6 6 0 0112 0c0 5-6 11-6 11zM12 7v6', wire: 'M4 17c6 0 4-10 10-10h6', layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6', rec: 'M12 7a5 5 0 100 10 5 5 0 000-10z', play: 'M7 5l12 7-12 7z', pause: 'M8 5v14M16 5v14', skip: 'M5 5l9 7-9 7zM19 5v14',
  scene: 'M3 7l9-4 9 4-9 4zM3 12l9 4 9-4M3 17l9 4 9-4', ar: 'M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3M12 8l4 2v4l-4 2-4-2v-4z',
  lock: 'M7 11V8a5 5 0 0110 0v3M5 11h14v9H5zM12 15v2', axisX: 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4', axisY: 'M5 19L19 5M10 5h9v9M5 10v9h9', axisZ: 'M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4', rotPitch: 'M4 16a9 6 0 0116 0M4 16l-1-4M4 16l4-1', rotRoll: 'M12 4a8 8 0 018 8M12 4l-3 3M12 4l3 3M12 20a8 8 0 01-8-8', rotYaw: 'M20 12a8 8 0 11-3-6.2M20 4v5h-5', detach: 'M10 14l-3 3a3 3 0 01-4-4l3-3M14 10l3-3a3 3 0 014 4l-3 3M9 15l6-6',
  dot: 'M12 4a8 8 0 100 16 8 8 0 000-16z', length: 'M4 12h16M4 8v8M20 8v8', move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
};
// id -> [icon, short verb]. A text of null keeps what the page set (gauge value, mode name).
export const BUTTONS = {
  mode: ['cursor', null], change: ['layers', 'Change…'], jfrom: ['wire', 'Cable'], jgauge: ['wire', null], gauge2: ['layers', null], gauge3: ['dot', null], jcolor: ['dot', null], jremove: ['trash', 'Remove'], undo: ['undo', 'Undo'], redo: ['redo', 'Redo'], more: ['dots', 'More'], addpart: ['plus', 'Add part'], scenebtn: ['scene', 'Scene'], armenu: ['ar', null], undomark: ['undo', 'Undo'], mundo: ['undo', 'Undo'],
  qselect: ['cursor', 'Select'], qadd: ['plus', 'Add to it'], qmeasure: ['ruler', 'Measure'], qmark: ['pin', 'Mark'], qhere: ['plus', 'Add'],
  extp: ['length', 'Length +'], extm: ['length', 'Length \u2212'], rotm: ['rotR', 'Rotate ↻'], rotp: ['rotL', 'Rotate ↺'], cover: ['cover', 'Cover'],
  hp: ['up', 'Up'], hm: ['down', 'Down'], tp: ['rotL', 'Rotate ↺'], tm: ['rotR', 'Rotate ↻'], move: ['move', 'Move'], size: ['length', 'Size'], turn: ['rotR', 'Turn 90°'], deselect: ['x', 'Deselect'], select: ['cursor', 'Select'], gauge: ['wire', null],
  nl: ['left', 'Nudge'], nr: ['right', 'Nudge'], nu: ['away', 'Nudge'], nd: ['toward', 'Nudge'], again: ['place', 'Place'], drop: ['pin', 'Mark'],
  clearmarks: ['trash', 'Clear'], mnew: ['ruler', 'Measure'], mclear: ['trash', 'Clear'], remove: ['trash', 'Remove'], rmmark: ['trash', 'Remove'], rmmeasure: ['trash', 'Remove'],
  confirm: ['check', 'Place'], next: ['next', 'Next'], cancel: ['x', 'Cancel'], reset: ['reset', 'Reset'], exit: ['exit', 'Exit'], back: ['back', 'Back'],
  xray: ['eye', null], rec: ['rec', 'Record'], recback: ['back', 'Back'], rec0: ['rec', 'Clean'], rec4: ['play', 'Auto 4 s'], rec6: ['play', 'Auto 6 s'], rec8: ['play', 'Auto 8 s'],
  rbnext: ['skip', 'Next'], rbxray: ['eye', null], rbpause: ['pause', null], rbexit: ['x', 'Exit'],
};
export const svg = name => '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + (I[name] || I.dots) + '"/></svg>';
// button markup: icon + one text span
export const markup = (id, text) => { const b = BUTTONS[id]; return b ? svg(b[0]) + (id === 'mode' ? '<b class="t">' : '<span class="t">') + (b[1] == null ? text : b[1]) + (id === 'mode' ? '</b>' : '</span>') : null; };   // the mode chip keeps a <b> for the page
