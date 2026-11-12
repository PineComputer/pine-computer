import type { Still as StillData } from "../shared/types.ts";

/**
 * A picture of the work, filling its box: an image, or a video's opening frame. A live
 * still plays its video, muted, while the pointer rests on it, as a preview.
 */
export function Still({ still, live = false }: { still?: StillData; live?: boolean }) {
  if (!still) return null;
  if (!still.video) return <span className="still" style={{ backgroundImage: `url(${still.url})` }} />;
  return (
    <video
      className="still"
      src={`${still.url}#t=0.5`}
      muted
      playsInline
      loop
      preload="metadata"
      onMouseEnter={live ? (event) => void event.currentTarget.play().catch(() => undefined) : undefined}
      onMouseLeave={
        live
          ? (event) => {
              event.currentTarget.pause();
              event.currentTarget.currentTime = 0.5;
            }
          : undefined
      }
    />
  );
}
