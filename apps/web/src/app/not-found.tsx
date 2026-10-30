import NextLink from "next/link";

export default function NotFound() {
  return (
    <div className="sr-page">
      <div className="sr-card sr-empty">
        <div className="sr-empty__title">That page does not exist</div>
        <p className="sr-empty__text">The product or alert may have been removed from this workspace.</p>
        <div className="sr-empty__actions">
          <NextLink className="sr-btn sr-btn--primary" href="/">
            Back to the Watchlist
          </NextLink>
        </div>
      </div>
    </div>
  );
}
