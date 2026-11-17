/** The mark: a check, and the box of what it found. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <path d="M3.5 12.6l4.6 4.6L18.5 6.8" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="square" strokeLinejoin="miter" />
      <rect x="16.6" y="14.8" width="5.4" height="5.4" fill="currentColor" />
    </svg>
  );
}
