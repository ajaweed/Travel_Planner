// Mirrors the comment-documented string columns in prisma/schema.prisma.
// SQLite can't enforce these at the DB level (see schema.prisma note), so
// this is the actual type-safety boundary for application code.

export type TripStatus =
  | "DRAFT"
  | "PLANNING"
  | "CHOOSING" // itinerary options generated; waiting on the user to pick one
  | "READY_TO_BOOK" // plan chosen; the user books each item themselves via links
  | "BOOKING" // legacy: app-side booking, no longer entered (see bookingLinks.ts)
  | "CONFIRMED"
  | "NEEDS_ATTENTION"
  | "CANCELLED"
  | "COMPLETED";

export type BookingKind = "FLIGHT" | "HOTEL" | "TOUR" | "RESERVATION";

export type BookingStatus =
  | "LINK_OUT" // the user books this themselves via search links; the app never books
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

export type ItineraryOptionStatus = "PROPOSED" | "SELECTED" | "DISCARDED";
