/** The studio's mark: a pine, standing in a vertical frame. The same drawing is public/icon.svg. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5.25" y="1" width="13.5" height="22" rx="2.2" fill="var(--seal)" />
      <path d="M12 4.5 L15.4 16.6 H8.6 Z" fill="var(--sheet)" />
      <rect x="11.2" y="16.2" width="1.6" height="3.2" fill="var(--sheet)" />
    </svg>
  );
}
