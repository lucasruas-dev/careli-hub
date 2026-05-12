import { type ReactNode } from "react";
import { cx } from "../utils/class-name";
import { EmptyState } from "./empty-state";

export type NotificationPanelItemStatus =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "processing";

export type NotificationPanelItem = {
  action?: ReactNode;
  description?: ReactNode;
  id: string;
  read?: boolean;
  status?: NotificationPanelItemStatus;
  timestamp?: ReactNode;
  title: ReactNode;
};

export type NotificationPanelProps = {
  className?: string;
  emptyState?: ReactNode;
  isLoading?: boolean;
  items: readonly NotificationPanelItem[];
  loadingLabel?: ReactNode;
  title?: ReactNode;
  unreadCount?: number;
};

export function NotificationPanel({
  className,
  emptyState,
  isLoading = false,
  items,
  loadingLabel = "Loading notifications",
  title = "Notifications",
  unreadCount,
}: NotificationPanelProps) {
  const count = unreadCount ?? items.filter((item) => !item.read).length;
  const groupedItems = items.reduce<Record<string, NotificationPanelItem[]>>(
    (groups, item) => {
      const status = item.status ?? "neutral";
      groups[status] = [...(groups[status] ?? []), item];

      return groups;
    },
    {},
  );

  return (
    <aside
      aria-busy={isLoading || undefined}
      aria-label={typeof title === "string" ? title : "Notifications"}
      className={cx("uix-notification-panel", className)}
    >
      <header className="uix-notification-panel__header">
        <div>
          <h2 className="uix-notification-panel__title">{title}</h2>
          <p className="uix-notification-panel__meta">{count} unread</p>
        </div>
      </header>

      {isLoading ? (
        <div className="uix-notification-panel__state" role="status">
          <span aria-hidden="true" className="uix-button__spinner" />
          <span>{loadingLabel}</span>
        </div>
      ) : null}

      {!isLoading && items.length === 0 ? (
        <div className="uix-notification-panel__state">
          {emptyState ?? (
            <EmptyState
              description="New operational notifications will appear here."
              title="No notifications"
            />
          )}
        </div>
      ) : null}

      {!isLoading && items.length > 0 ? (
        <div className="uix-notification-panel__body">
          {Object.entries(groupedItems).map(([status, groupItems]) => (
            <section className="uix-notification-panel__group" key={status}>
              <h3 className="uix-notification-panel__group-title">{status}</h3>
              <div className="uix-notification-panel__items">
                {groupItems.map((item) => (
                  <article
                    className="uix-notification-panel__item"
                    data-read={item.read || undefined}
                    data-status={item.status ?? "neutral"}
                    key={item.id}
                  >
                    <span
                      aria-hidden="true"
                      className="uix-notification-panel__marker"
                    />
                    <div className="uix-notification-panel__content">
                      <div className="uix-notification-panel__line">
                        <h4 className="uix-notification-panel__item-title">
                          {item.title}
                        </h4>
                        {item.timestamp ? (
                          <time className="uix-notification-panel__timestamp">
                            {item.timestamp}
                          </time>
                        ) : null}
                      </div>
                      {item.description ? (
                        <p className="uix-notification-panel__description">
                          {item.description}
                        </p>
                      ) : null}
                      {item.action ? (
                        <div className="uix-notification-panel__action">
                          {item.action}
                        </div>
                      ) : null}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
