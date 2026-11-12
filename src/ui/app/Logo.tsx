/** Two seats, one machine: the person and the agent, side by side. Replace with your own. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="5" width="12" height="14" rx="3.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="10" y="5" width="12" height="14" rx="3.5" fill="var(--accent)" />
    </svg>
  );
}
