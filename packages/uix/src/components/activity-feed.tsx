import { type ReactNode } from "react";
import { cx } from "../utils/class-name";
import { EmptyState } from "./empty-state";

export type ActivityFeedEventStatus =
  | "neutral"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "processing";

export type ActivityFeedEvent = {
  description?: ReactNode;
  id: string;
  status?: ActivityFeedEventStatus;
  timestamp?: ReactNode;
  title: ReactNode;
  type?: ReactNode;
};

export type ActivityFeedProps = {
  className?: string;
  emptyState?: ReactNode;
  events: readonly ActivityFeedEvent[];
  isLoading?: boolean;
  loadingLabel?: ReactNode;
};

export function ActivityFeed({
  className,
  emptyState,
  events,
  isLoading = false,
  loadingLabel = "Loading activity",
}: ActivityFeedProps) {
  const hasEvents = events.length > 0;

  return (
    <div
      aria-busy={isLoading || undefined}
      className={cx("uix-activity-feed", className)}
    >
      {isLoading ? (
        <div className="uix-activity-feed__state" role="status">
          <span aria-hidden="true" className="uix-button__spinner" />
          <span>{loadingLabel}</span>
        </div>
      ) : null}

      {!isLoading && hasEvents ? (
        <ol className="uix-activity-feed__list">
          {events.map((event) => (
            <li className="uix-activity-feed__item" key={event.id}>
              <span
                aria-hidden="true"
                className="uix-activity-feed__marker"
                data-status={event.status ?? "neutral"}
              />
              <div className="uix-activity-feed__content">
                <div className="uix-activity-feed__line">
                  <span className="uix-activity-feed__title">{event.title}</span>
                  {event.timestamp ? (
                    <time className="uix-activity-feed__timestamp">
                      {event.timestamp}
                    </time>
                  ) : null}
                </div>
                {event.description ? (
                  <p className="uix-activity-feed__description">
                    {event.description}
                  </p>
                ) : null}
                {event.type ? (
                  <span className="uix-activity-feed__type">{event.type}</span>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {!isLoading && !hasEvents ? (
        <div className="uix-activity-feed__state">
          {emptyState ?? (
            <EmptyState
              description="Realtime events will appear here when activity starts."
              title="No recent activity"
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
