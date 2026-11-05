// Tool definitions the BookingAgent exposes to Claude (tool-use/function
// calling), and the dispatcher that actually executes them against
// packages/integrations. Every tool listed here MUST have a real handler —
// see architect.md's rule against orphaned prompt claims.

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import { flights, hotels, tours } from "@trip-planner/integrations";
import { randomUUID } from "node:crypto";

export const bookingTools: Tool[] = [
  {
    name: "search_flights",
    description:
      "Search for flight offers between two airports on given dates. Returns up to 10 offers or a structured no-availability/error result.",
    input_schema: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Origin IATA airport code, e.g. JFK" },
        destination: { type: "string", description: "Destination IATA airport code" },
        departDate: { type: "string", description: "YYYY-MM-DD" },
        returnDate: { type: "string", description: "YYYY-MM-DD, omit for one-way" },
        adults: { type: "integer", minimum: 1 },
      },
      required: ["origin", "destination", "departDate", "adults"],
    },
  },
  {
    name: "book_flight",
    description:
      "Book a specific flight offer returned by search_flights. Only call after the user (or the orchestrator on the user's behalf) has confirmed the offer and price. Idempotent: safe to retry with the same idempotencyKey.",
    input_schema: {
      type: "object",
      properties: {
        offerId: { type: "string" },
        offerRaw: { description: "The exact raw offer object returned by search_flights for this offerId." },
        travelerInfo: { description: "Traveler name/DOB/passport details required by the provider." },
        idempotencyKey: { type: "string" },
      },
      required: ["offerId", "offerRaw", "travelerInfo", "idempotencyKey"],
    },
  },
  {
    name: "search_hotels",
    description: "Search for hotel offers in a city for a date range.",
    input_schema: {
      type: "object",
      properties: {
        cityCode: { type: "string", description: "IATA city code, e.g. LIS" },
        checkIn: { type: "string", description: "YYYY-MM-DD" },
        checkOut: { type: "string", description: "YYYY-MM-DD" },
        adults: { type: "integer", minimum: 1 },
      },
      required: ["cityCode", "checkIn", "checkOut", "adults"],
    },
  },
  {
    name: "book_hotel",
    description: "Book a specific hotel offer returned by search_hotels. Idempotent.",
    input_schema: {
      type: "object",
      properties: {
        offerId: { type: "string" },
        offerRaw: { description: "The exact raw offer object returned by search_hotels." },
        guestInfo: { description: "Primary guest name/contact details." },
        idempotencyKey: { type: "string" },
      },
      required: ["offerId", "offerRaw", "guestInfo", "idempotencyKey"],
    },
  },
  {
    name: "search_tours",
    description: "Search for tours/activities at a destination for a given date.",
    input_schema: {
      type: "object",
      properties: {
        destination: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        participants: { type: "integer", minimum: 1 },
        interests: { type: "array", items: { type: "string" } },
      },
      required: ["destination", "date", "participants"],
    },
  },
  {
    name: "book_tour",
    description: "Book a specific tour offer returned by search_tours. Idempotent.",
    input_schema: {
      type: "object",
      properties: {
        offerId: { type: "string" },
        offerRaw: { description: "The exact raw offer object returned by search_tours." },
        participantInfo: { description: "Participant names/count for the booking." },
        idempotencyKey: { type: "string" },
      },
      required: ["offerId", "offerRaw", "participantInfo", "idempotencyKey"],
    },
  },
];

export type BookingToolName = (typeof bookingTools)[number]["name"];

/**
 * Executes one tool call by name. Returns a JSON-serializable result that
 * gets fed straight back to Claude as the tool_result content — including
 * on business "failure" (no availability, price changed, etc.), since those
 * are expected outcomes the model needs to see and reason about, not just
 * success/error booleans.
 */
export async function runBookingTool(name: string, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "search_flights":
      return flights.searchFlights(input as Parameters<typeof flights.searchFlights>[0]);
    case "book_flight":
      return flights.bookFlight({
        offerId: input.offerId as string,
        offerRaw: input.offerRaw,
        travelerInfo: input.travelerInfo,
        idempotencyKey: (input.idempotencyKey as string) ?? randomUUID(),
      });
    case "search_hotels":
      return hotels.searchHotels(input as Parameters<typeof hotels.searchHotels>[0]);
    case "book_hotel":
      return hotels.bookHotel({
        offerId: input.offerId as string,
        offerRaw: input.offerRaw,
        guestInfo: input.guestInfo,
        idempotencyKey: (input.idempotencyKey as string) ?? randomUUID(),
      });
    case "search_tours":
      return tours.searchTours(input as Parameters<typeof tours.searchTours>[0]);
    case "book_tour":
      return tours.bookTour({
        offerId: input.offerId as string,
        offerRaw: input.offerRaw,
        participantInfo: input.participantInfo,
        idempotencyKey: (input.idempotencyKey as string) ?? randomUUID(),
      });
    default:
      throw new Error(`Unknown booking tool: ${name}`);
  }
}
