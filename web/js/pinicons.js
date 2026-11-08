// Map pin icons: simple 24×24 line drawings that read well at small sizes. Keys are stored on pins (pin.icon).
export const PIN_ICONS = {
  castle: '<path d="M4 20V9l2 1V7h2v3l2-1V6h4v3l2 1V7h2v3l2-1v11z"/><path d="M10 20v-4a2 2 0 0 1 4 0v4"/>',
  city: '<path d="M3.5 20.5V11l4-2v11.5M7.5 20.5V5.5h6v15M13.5 20.5V9.5h7v11"/><path d="M9.8 8.5h1.4M9.8 11.5h1.4M9.8 14.5h1.4M16 12.5h2M16 15.5h2"/>',
  village: '<path d="M3.5 20v-6l4-3.5 4 3.5v6M12.5 20v-5l4-3.5 4 3.5v5M2.5 20.5h19"/>',
  house: '<path d="M4.5 11 12 4.5l7.5 6.5"/><path d="M6.5 9.5v10h11v-10"/><path d="M10.5 19.5v-5h3v5"/>',
  tavern: '<path d="M6 7.5h9v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M15 10h1.5a2.5 2.5 0 0 1 0 5H15"/><path d="M6 5.5c1-1.5 2.5-1.5 3.5-.5 1-1 2.8-1 3.5.5"/>',
  temple: '<path d="M3.5 9 12 4l8.5 5zM5 20.5h14M6 9.5v9M10 9.5v9M14 9.5v9M18 9.5v9M4 18.5h16"/>',
  tower: '<path d="M7.5 21V9h9v12M6.5 9V4.5h2v2h2v-2h3v2h2v-2h2V9"/><path d="M11 21v-4a1 1 0 0 1 2 0v4M10.5 12h3"/>',
  cave: '<path d="M2.5 20.5c1.5-6 4.5-12 9.5-12s8 6 9.5 12z"/><path d="M8.5 20.5c.5-3 1.5-5.5 3.5-5.5s3 2.5 3.5 5.5"/>',
  dungeon: '<path d="M5 20.5V10a7 7 0 0 1 14 0v10.5"/><path d="M9 20.5v-9M12 20.5V8.5M15 20.5v-9M3.5 20.5h17"/>',
  skull: '<path d="M12 3.5a7 7 0 0 0-7 7c0 2.5 1.2 4.2 3 5.3v3.7h8v-3.7c1.8-1.1 3-2.8 3-5.3a7 7 0 0 0-7-7z"/><circle cx="9.3" cy="11" r="1.6"/><circle cx="14.7" cy="11" r="1.6"/><path d="M10.5 19.5v-2M13.5 19.5v-2"/>',
  sword: '<path d="M19.5 4.5 10 14l-2-2 9.5-9.5h2z"/><path d="m6.5 13.5 4 4M8.5 15.5l-4 4M4 18.5l1.5 1.5"/>',
  shield: '<path d="M12 3.5 5 6v6c0 4.5 3 7.5 7 8.5 4-1 7-4 7-8.5V6z"/><path d="M12 3.5v17"/>',
  crown: '<path d="M3.5 8 7 11.5 12 5l5 6.5L20.5 8 19 18H5z"/><path d="M5.5 15h13"/>',
  ship: '<path d="M3 15.5h18l-2.5 4.5h-13z"/><path d="M12 3.5v12M12 4.5l6 8H12M12 6.5l-5 7h5"/>',
  anchor: '<circle cx="12" cy="5.5" r="2"/><path d="M12 7.5v13M8 11h8M4.5 13.5a7.5 7.5 0 0 0 15 0"/>',
  mountain: '<path d="M2.5 19.5 9 8l3.5 6 2.5-4 6.5 9.5z"/><path d="m7.3 11 1.7 1.5 1.5-1.4"/>',
  tree: '<path d="M12 3.5 6 11h3l-4 5.5h14L15 11h3z"/><path d="M12 16.5v4"/>',
  forest: '<path d="M8 4 4 11h2.5l-3 4.5h9L9.5 11H12zM16 6.5l-3.5 6h2l-2.5 4h8L17.5 12.5h2z"/><path d="M8 15.5v4.5M16 16.5v3.5"/>',
  camp: '<path d="M3.5 19.5 12 5l8.5 14.5z"/><path d="m12 13 3.5 6.5M12 13l-3.5 6.5"/>',
  flag: '<path d="M5.5 21V4M5.5 4.5h12l-2.5 4 2.5 4h-12"/>',
  star: '<path d="m12 3.5 2.6 5.5 6 .7-4.4 4.1 1.2 6-5.4-3-5.4 3 1.2-6-4.4-4.1 6-.7z"/>',
  question: '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><circle cx="12" cy="16.8" r=".4"/>',
  exclaim: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5v6M12 16.5v.3"/>',
  gem: '<path d="M7 4.5h10l3.5 5L12 20 3.5 9.5z"/><path d="M3.5 9.5h17M9.5 4.5 8 9.5l4 10.5 4-10.5-1.5-5"/>',
  portal: '<ellipse cx="12" cy="12" rx="6" ry="8.5"/><ellipse cx="12" cy="12" rx="3" ry="5"/>',
  bridge: '<path d="M2.5 9.5h19M2.5 16h19M5 9.5V16M19 9.5V16"/><path d="M5 16a7 7 0 0 1 14 0"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.5 9a2.5 2 0 0 0-2.5-1.5c-1.4 0-2.5.8-2.5 2s1.1 1.6 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2A2.5 2 0 0 1 9.5 15M12 6v1.5M12 16.5V18"/>',
  book: '<path d="M4.5 5.5a2 2 0 0 1 2-2h12v15h-12a2 2 0 0 0-2 2z"/><path d="M4.5 20.5a2 2 0 0 1 2-2h12v2h-12"/>',
  heart: '<path d="M12 19.5s-7.5-4.5-7.5-10a4.2 4.2 0 0 1 7.5-2.6 4.2 4.2 0 0 1 7.5 2.6c0 5.5-7.5 10-7.5 10z"/>',
  fire: '<path d="M12 21c-3.6 0-6-2.5-6-5.8 0-3.6 3-5.2 3.5-9.2 2.5 1.5 3.4 3.7 3.2 5.6 1-.6 1.6-1.6 1.8-3 2 1.5 3.5 4 3.5 6.6 0 3.3-2.4 5.8-6 5.8z"/>',
  wave: '<path d="M2.5 9c2-2 4-2 6 0s4 2 6 0 4-2 7 0M2.5 15c2-2 4-2 6 0s4 2 6 0 4-2 7 0"/>',
};


export function pinIcon(key) {
  const d = PIN_ICONS[key];
  if (!d) return null;
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "1.9");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.innerHTML = d;
  return s;
}
