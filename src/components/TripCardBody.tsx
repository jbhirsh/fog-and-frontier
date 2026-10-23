import { CdnImage } from './CdnImage';

// A trip activity's cover, name and city, as the itinerary's card
// (TripActivityCard) and the voting card (VotingCandidateCard) both show it.
// `wrap` lets the name and city wrap on a phone, one line from md; otherwise
// each stays on one line, cut short.
export function TripCardBody({
  cover,
  name,
  cityLine,
  orphaned,
  wrap = false,
}: {
  cover: string | null;
  name: string;
  cityLine: string;
  orphaned: boolean;
  wrap?: boolean;
}) {
  return (
    <>
      <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-surface-variant">
        {cover ? (
          <CdnImage alt="" src={cover} sizes="80px" className="size-full object-cover" />
        ) : (
          <span className="material-symbols-outlined text-outline" style={{ fontSize: 28 }}>
            landscape
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-xs">
        <div
          className={
            wrap
              ? 'font-headline-md text-body-lg wrap-break-word text-on-surface md:line-clamp-1 md:break-normal'
              : 'line-clamp-1 font-headline-md text-body-lg text-on-surface'
          }
        >
          {name}
        </div>
        {cityLine && (
          <div
            className={
              wrap
                ? 'font-body-md text-sm wrap-break-word text-on-surface-variant md:line-clamp-1 md:break-normal'
                : 'line-clamp-1 font-body-md text-sm text-on-surface-variant'
            }
          >
            {cityLine}
          </div>
        )}
        {orphaned && (
          <div className="font-body-md text-xs text-error">Original activity was deleted.</div>
        )}
      </div>
    </>
  );
}
