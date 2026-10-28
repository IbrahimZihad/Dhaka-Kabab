import { formatPoisa } from "@/lib/money";

/**
 * Menu photography is served by our own `/api/media` route (or a URL the owner
 * typed in), so it goes straight to the browser rather than through the image
 * optimiser. That keeps the server from fetching arbitrary hosts on a guest's
 * behalf, which is the one thing the optimiser would add here.
 */
export function MenuImage({
  src,
  alt,
  width = 640,
  height = 480,
  className = "h-40 w-full object-cover",
}: {
  src: string | null;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (!src) {
    return (
      <div className={`${className} flex items-center justify-center bg-line/40`} aria-hidden>
        <span className="text-xs muted">No photo yet</span>
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element -- see the note above
  return <img src={src} alt={alt} width={width} height={height} loading="lazy" className={className} />;
}

export function Price({ poisa, symbol, className = "price" }: { poisa: number; symbol: string; className?: string }) {
  return <span className={className}>{formatPoisa(poisa, { symbol })}</span>;
}
