const PENDING_SLOTS = 6;

/** Same grid and slot size as live search cards. */
export function SearchPendingTiles() {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: PENDING_SLOTS }, (_, index) => (
        <li className="business-card-slot" key={`pending-${index}`}>
          <div
            className="ai-search-skel"
            style={{ animationDelay: `${index * 0.12}s` }}
          >
            <span className="ai-search-skel__photo" />
            <span className="ai-search-skel__copy">
              <span />
              <span />
              <span />
            </span>
            <span className="ai-search-skel__shine" />
          </div>
        </li>
      ))}
    </ul>
  );
}
