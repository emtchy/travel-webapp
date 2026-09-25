/**
 * Templates: a ready-made list of places a new trip can start from.
 *
 * There is one for now — the London list in src/sights.js, the file the
 * London trip itself was seeded from. A template is offered when the
 * destination someone types matches it, and copying it gives the new trip
 * its own rows with its own ids (`<slug>-t<trip>`), so votes on the copy
 * never touch the original and the ids stay unique across trips.
 */

import { SIGHTS } from "./sights.js";

export const TEMPLATES = [
  {
    key: "london",
    name: "London",
    match: /\blondon\b/i,
    count: SIGHTS.length,
    /** The items rows for trip `tripId`, as arrays in ITEM_COLUMNS order. */
    rows: (tripId, now) => SIGHTS.map((s) => [
      `${s.id}-t${tripId}`, tripId, "builtin", s.rank, s.tier ?? null, s.name, s.name_de ?? null,
      s.summary ?? null, s.summary_de ?? null,
      JSON.stringify(s.categories ?? []), s.area ?? null, s.station ?? null,
      s.cost ?? "free", s.priceLabel ?? null, s.priceLabel_de ?? null,
      JSON.stringify(s.openOn ?? []), s.bookingRequired ? 1 : 0,
      JSON.stringify(s.flags ?? []), s.url ?? null, s.wiki ?? null,
      s.lat ?? null, s.lon ?? null, "template", "template", now,
    ]),
  },
];

export const ITEM_COLUMNS = [
  "id", "trip_id", "source", "rank", "tier", "name", "name_de", "summary", "summary_de",
  "categories", "area", "station", "cost", "price_label", "price_label_de", "open_on",
  "booking_required", "flags", "url", "wiki", "lat", "lon", "added_by", "added_by_key",
  "created_at",
];

/** The templates that fit a destination, for the new-trip form. */
export const templatesFor = (destination) =>
  TEMPLATES.filter((t) => t.match.test(destination || "")).map(({ key, name, count }) => ({ key, name, count }));
