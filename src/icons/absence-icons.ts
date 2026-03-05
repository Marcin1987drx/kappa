/**
 * Corporate SVG icons for absence types.
 * Minimalist, high-contrast, single-path designs.
 * Each icon is a function returning an SVG string that takes optional size and color params.
 */

const icons: Record<string, string> = {
  // Urlop wypoczynkowy — sun icon
  vacation: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,

  // Urlop siła wyższa 50% — zap/bolt icon
  'vacation-force': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,

  // Zaległy urlop — calendar clock icon
  'vacation-overdue': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><circle cx="14" cy="16" r="3"/><polyline points="14 15 14 16 15 16.5"/></svg>`,

  // Urlop ojcowski — baby/child icon
  paternity: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="6" r="3"/><path d="M12 9c-3.3 0-6 2.7-6 6v1h3l1 6h4l1-6h3v-1c0-3.3-2.7-6-6-6z"/></svg>`,

  // Urlop macierzyński/rodzicielski — family icon
  parental: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="5" r="2.5"/><circle cx="17" cy="6" r="2"/><path d="M9 7.5c-2.8 0-5 2.2-5 5v1h2.5l.8 5h3.4l.8-5H14v-1c0-2.8-2.2-5-5-5z"/><path d="M17 8c-1.8 0-3.2 1.2-3.5 2.8"/><path d="M19.5 12.5v1h-1.5l-.5 3.5h-2l-.5-3.5h-1"/></svg>`,

  // Opieka nad dzieckiem — heart in hand / care icon
  childcare: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21C12 21 4 15 4 9.5 4 7 6 5 8.5 5c1.5 0 2.8.7 3.5 1.8C12.7 5.7 14 5 15.5 5 18 5 20 7 20 9.5 20 15 12 21 12 21z"/><path d="M2 19h5l2-3"/><path d="M22 19h-5l-2-3"/></svg>`,

  // Urlop okolicznościowy — star/event icon
  occasional: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,

  // Chorobowe — medical cross / thermometer icon
  sick: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2h6v6h6v6h-6v6H9v-6H3V8h6z" opacity="0"/><rect x="3" y="3" width="18" height="18" rx="3"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,

  // Badania okresowe — stethoscope / clipboard check icon
  medical: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><path d="M9 14l2 2 4-4"/></svg>`,

  // Urlop bezpłatny — briefcase icon
  unpaid: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,

  // Urlop okolicznościowy (env) — same as occasional
  'occasional-env': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,

  // Delegacja — airplane icon
  delegation: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4z"/></svg>`,

  // Home Office — home icon
  'home-office': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
};

// Emoji fallback map (kept for backward compat in exports / plain text contexts)
const emojiFallback: Record<string, string> = {
  vacation: '☀',
  'vacation-force': '⚡',
  'vacation-overdue': '📅',
  paternity: '👶',
  parental: '👪',
  childcare: '❤',
  occasional: '★',
  sick: '✚',
  medical: '✓',
  unpaid: '💼',
  'occasional-env': '★',
  delegation: '✈',
  'home-office': '⌂',
};

/**
 * Returns an inline SVG string for a given absence type ID.
 * @param typeId - the absence type id (e.g. 'vacation', 'sick')
 * @param size - icon size in px (default 18)
 * @param color - CSS color for the stroke (default 'currentColor')
 */
export function getAbsenceIcon(typeId: string, size: number = 18, color: string = 'currentColor'): string {
  const raw = icons[typeId];
  if (!raw) {
    // Generic calendar fallback
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
  }
  // Inject width, height, and color into the raw SVG
  return raw
    .replace('<svg ', `<svg width="${size}" height="${size}" `)
    .replace(/stroke="currentColor"/g, `stroke="${color}"`);
}

/**
 * Returns an inline SVG wrapped in a styled span for UI rendering.
 * Shows a rounded pill with tinted background and the icon in brand color.
 * Consistent across settings, calendar, legend, modals, etc.
 * @param typeId - the absence type id
 * @param color - the type's brand color
 * @param size - icon size in px (default 18)
 */
export function renderAbsenceIcon(typeId: string, color: string, size: number = 18): string {
  const svg = getAbsenceIcon(typeId, size, color);
  const outer = size + 10;
  return `<span class="absence-icon" style="display:inline-flex;align-items:center;justify-content:center;width:${outer}px;height:${outer}px;min-width:${outer}px;border-radius:${Math.round(outer * 0.3)}px;background:${color}22;flex-shrink:0;">${svg}</span>`;
}

/**
 * Get plain-text emoji fallback (for text-only contexts like exports).
 */
export function getAbsenceEmoji(typeId: string): string {
  return emojiFallback[typeId] || '📅';
}
