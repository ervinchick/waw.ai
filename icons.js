/* ===========================================================
   WAW — библиотека SVG-иконок
   Все иконки в одном стиле: viewBox 0 0 24 24, линейные,
   stroke=currentColor, stroke-width=2, без заливки.

   Использование в тексте от модели:
     <i data-icon="study"></i> 7 класс
     <i data-icon="location"></i> Тула
     <i data-icon="pet"></i> Ресса и Мартин

   После рендера markdown функция enhanceIcons() заменяет
   <i data-icon="..."> на <span class="inline-icon">...svg...</span>.
   =========================================================== */

window.WAW_ICONS = {
  /* ===== Учёба и работа ===== */
  study: '<path d="M12 3L2 9l10 6 10-6-10-6z"/><path d="M6 12v5c0 1 3 3 6 3s6-2 6-3v-5"/>',
  book: '<path d="M4 4h7a2 2 0 012 2v14a2 2 0 00-2-2H4z"/><path d="M20 4h-7a2 2 0 00-2 2v14a2 2 0 012-2h7z"/>',
  notebook: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v18M13 8h3M13 12h3"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/>',
  code: '<path d="M8 6l-6 6 6 6M16 6l6 6-6 6"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9l3 3-3 3M13 15h4"/>',
  bug: '<circle cx="12" cy="13" r="5"/><path d="M12 4v4M7 7l2 2M17 7l-2 2M4 13h3M17 13h3M6 18l2-2M18 18l-2-2"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-4M12 16v-8M16 16v-6"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2"/>',

  /* ===== Место и время ===== */
  location: '<path d="M12 22s8-8 8-13a8 8 0 10-16 0c0 5 8 13 8 13z"/><circle cx="12" cy="9" r="3"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  map: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',

  /* ===== Природа и животные ===== */
  pet: '<circle cx="6" cy="8" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="9" cy="4" r="2"/><circle cx="15" cy="4" r="2"/><path d="M12 20c-4 0-7-3-7-6 0-2 3-4 7-4s7 2 7 4c0 3-3 6-7 6z"/>',
  paw: '<circle cx="6" cy="9" r="2"/><circle cx="18" cy="9" r="2"/><circle cx="9" cy="5" r="2"/><circle cx="15" cy="5" r="2"/><path d="M12 19c-3 0-6-2-6-5 0-2 3-3 6-3s6 1 6 3c0 3-3 5-6 5z"/>',
  tree: '<path d="M12 3l6 9h-4l4 6H6l4-6H6z"/><path d="M12 18v3"/>',
  flower: '<circle cx="12" cy="12" r="2"/><path d="M12 2a3 3 0 000 6M12 16a3 3 0 000 6M2 12a3 3 0 006 0M16 12a3 3 0 006 0"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"/>',
  moon: '<path d="M21 13A9 9 0 1111 3a7 7 0 1010 10z"/>',

  /* ===== Развлечения ===== */
  movie: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 8h18M7 4l2 4M13 4l2 4M17 4l2 4"/>',
  game: '<rect x="2" y="7" width="20" height="12" rx="3"/><path d="M7 12h2M8 11v2M15 11h.01M17 13h.01"/>',
  music: '<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
  camera: '<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13" r="4"/><path d="M8 7l1-3h6l1 3"/>',
  art: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.5"/><circle cx="16" cy="10" r="1.5"/><circle cx="9" cy="16" r="1.5"/><circle cx="16" cy="15" r="1.5"/>',

  /* ===== Идеи и статусы ===== */
  idea: '<path d="M12 2a7 7 0 00-4 12.7V17a2 2 0 002 2h4a2 2 0 002-2v-2.3A7 7 0 0012 2z"/><path d="M9.5 21h5"/>',
  star: '<path d="M12 3l2.7 6.3 6.8.6-5.2 4.5 1.6 6.7L12 17.7 6.1 21l1.6-6.7L2.5 9.9l6.8-.6z"/>',
  fire: '<path d="M12 2c1 4-3 5-3 9a3 3 0 006 0c0-1 1-2 1-4 2 3 3 6 3 8a7 7 0 11-14 0c0-5 5-7 7-13z"/>',
  heart: '<path d="M12 21s-8-5-8-11a4 4 0 018-2 4 4 0 018 2c0 6-8 11-8 11z"/>',
  check: '<path d="M5 12l4 4L19 6"/>',
  cross: '<path d="M6 6l12 12M18 6L6 18"/>',
  warn: '<path d="M12 3l10 18H2z"/><path d="M12 10v4M12 18h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 4M12 17h.01"/>',
  sparkle: '<path d="M12 3l1.8 4.5L18 9l-4.2 1.5L12 15l-1.8-4.5L6 9l4.2-1.5z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/>',
  rocket: '<path d="M14 4c3 0 6 3 6 6l-8 8-4-4 8-8z"/><path d="M8 14l-4 1 1-4M10 16l-1 4 4-1"/><circle cx="15" cy="9" r="1.5"/>',
  flag: '<path d="M5 3v18"/><path d="M5 4h11l-2 3 2 3H5"/>',

  /* ===== Инструменты ===== */
  link: '<path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1"/><path d="M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 3l3 3M14 6l2 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  trash: '<path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13a1 1 0 001 1h8a1 1 0 001-1l1-13"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 20h16"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5"/><path d="M4 4h16"/>',
  folder: '<path d="M3 6a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>',
  file: '<path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6"/>',

  /* ===== Эмоции ===== */
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14a4 4 0 008 0M9 9h.01M15 9h.01"/>',
  sad: '<circle cx="12" cy="12" r="9"/><path d="M8 16a4 4 0 018 0M9 9h.01M15 9h.01"/>',
  angry: '<circle cx="12" cy="12" r="9"/><path d="M8 16a4 4 0 018 0M8 9l2 1M16 9l-2 1"/>',
  think: '<circle cx="12" cy="12" r="9"/><path d="M9 10a3 3 0 015.5 1.5c0 1.5-2.5 2-2.5 3.5M12 18h.01"/>',

  /* ===== Люди ===== */
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  users: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><path d="M15 20c0-2 2-4 4-4s2 1 2 2"/>',
  robot: '<rect x="4" y="7" width="16" height="12" rx="2"/><circle cx="9" cy="13" r="1.5"/><circle cx="15" cy="13" r="1.5"/><path d="M12 4v3M8 19v2M16 19v2"/>',
};

/**
 * Заменяет <i data-icon="имя"></i> на <span class="inline-icon">…svg…</span>.
 * Если иконки с таким именем нет — элемент остаётся как есть.
 */
window.WAW_enhanceIcons = function enhanceIcons(root) {
  if (!root) return;
  const icons = window.WAW_ICONS;
  root.querySelectorAll("i[data-icon]").forEach((el) => {
    const name = el.getAttribute("data-icon");
    const svg = icons && icons[name];
    if (!svg) return;

    const span = document.createElement("span");
    span.className = "inline-icon";
    span.setAttribute("data-icon", name);
    span.innerHTML =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      svg +
      "</svg>";
    el.replaceWith(span);
  });
};