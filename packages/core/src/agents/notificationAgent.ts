// NotificationAgent: writes in-app Notification rows. Deterministic, not an
// LLM call -- it just formats events that other agents/the orchestrator
// already decided happened. Current scope is in-app only; email/SMS/Slack
// channels would plug in here later without touching callers.

import { prisma, type NotificationKind } from "@trip-planner/db";

export async function notify(params: {
  tripId: string;
  kind: NotificationKind;
  message: string;
}): Promise<void> {
  await prisma.notification.create({
    data: {
      tripId: params.tripId,
      kind: params.kind,
      message: params.message,
    },
  });
}

export async function getUnreadNotifications(tripId: string) {
  return prisma.notification.findMany({
    where: { tripId, read: false },
    orderBy: { createdAt: "desc" },
  });
}

export async function markAllRead(tripId: string): Promise<void> {
  await prisma.notification.updateMany({ where: { tripId, read: false }, data: { read: true } });
}
