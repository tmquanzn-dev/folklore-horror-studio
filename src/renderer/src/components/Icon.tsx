/** Bộ icon SVG nội tuyến (không thêm thư viện icon) */
const PATHS: Record<string, string> = {
  home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  story: 'M5 4h11l3 3v13H5zM9 9h6M9 13h6M9 17h4',
  folklore: 'M12 3c-4 3-6 6-6 9a6 6 0 0 0 12 0c0-3-2-6-6-9zM12 14v4',
  channel: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  script: 'M4 5h16M4 10h16M4 15h10M4 20h7',
  voice: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  film: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4',
  storyboard: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  autoedit: 'M3 7h18M3 12h18M3 17h18M8 4v6M15 9v6M10 14v6',
  publish: 'M12 3v12M7 8l5-5 5 5M5 21h14',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 15H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9.7 4.6V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
  play: 'M7 4l13 8-13 8z',
  stop: 'M6 6h12v12H6z',
  next: 'M5 4l10 8-10 8zM17 4h2v16h-2z',
  refresh: 'M4 4v6h6M20 20v-6h-6M5 15a7 7 0 0 0 12 3M19 9A7 7 0 0 0 7 6',
  log: 'M4 6h16M4 12h16M4 18h10',
  folder: 'M3 6h6l2 2h10v11H3z',
  check: 'M5 12l5 5L20 7',
  x: 'M6 6l12 12M18 6L6 18',
  warn: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  star: 'M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.3L12 17.5 6.5 20.4l1-6.3L3 9.7l6.2-.9z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 3'
}

export function Icon({ name, className = 'h-5 w-5' }: { name: keyof typeof PATHS | string; className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d={PATHS[name] ?? PATHS.story} />
    </svg>
  )
}
