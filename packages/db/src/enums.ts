// Mirrors the comment-documented string columns in prisma/schema.prisma.
// SQLite can't enforce these at the DB level (see schema.prisma note), so
// this is the actual type-safety boundary for application code.

export type TripStatus =
  | "DRAFT"
  | "PLANNING"
  | "BOOKING"
  | "CONFIRMED"
  | "NEEDS_ATTENTION"
  | "CANCELLED"
  | "COMPLETED";

export type BookingKind = "FLIGHT" | "HOTEL" | "TOUR" | "RESERVATION";

export type BookingStatus =
  | "SEARCHING"
  | "OPTIONS_FOUND"
  | "AWAITING_CONFIRMATION"
  | "BOOKED"
  | "FAILED"
  | "CANCELLED";

export type NotificationKind =
  | "ITINERARY_READY"
  | "BOOKING_CONFIRMED"
  | "BOOKING_FAILED"
  | "BUDGET_ALERT"
  | "CLARIFICATION_NEEDED"
  | "GENERAL";
