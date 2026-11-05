// Recorded-shape fixtures for the Google Places API (New), trimmed to the
// fields our field masks actually request. Shapes follow
// https://developers.google.com/maps/documentation/places/web-service/text-search
// and .../place-details so the adapter can be tested without a real key or a
// live (billed) network call -- see integrations-dev.md rule 5.

export const textSearchHit = {
  places: [
    {
      id: "ChIJ_place_id_memmo_alfama",
      displayName: { text: "Memmo Alfama Hotel", languageCode: "en" },
      formattedAddress: "Travessa das Merceeiras 27, 1100-348 Lisboa, Portugal",
      rating: 4.6,
      userRatingCount: 1843,
    },
  ],
};

/** Google returns an empty array (or omits the key) when nothing matches. */
export const textSearchEmpty = { places: [] };

export const placeDetailsHit = {
  id: "ChIJ_place_id_memmo_alfama",
  rating: 4.6,
  userRatingCount: 1843,
  googleMapsUri: "https://maps.google.com/?cid=12345",
  reviews: [
    {
      text: { text: "Rooftop pool over the rooftops of Alfama. Worth it.", languageCode: "en" },
      rating: 5,
      authorAttribution: { displayName: "A. Traveller" },
      relativePublishTimeDescription: "2 months ago",
    },
    {
      text: { text: "Small rooms, but the location and staff more than make up for it.", languageCode: "en" },
      rating: 4,
      authorAttribution: { displayName: "B. Visitor" },
      relativePublishTimeDescription: "a month ago",
    },
    {
      text: { text: "Third review, should be trimmed by MAX_EXCERPTS.", languageCode: "en" },
      rating: 5,
      authorAttribution: { displayName: "C. Guest" },
      relativePublishTimeDescription: "a week ago",
    },
  ],
};

/** A real place that genuinely has no ratings yet -- fields absent, not zero. */
export const textSearchUnratedPlace = {
  places: [
    {
      id: "ChIJ_place_id_brand_new",
      displayName: { text: "Brand New Guesthouse", languageCode: "en" },
      formattedAddress: "Rua Nova 1, Lisboa, Portugal",
    },
  ],
};

export const quotaExceededBody = JSON.stringify({
  error: {
    code: 403,
    message: "Quota exceeded for quota metric 'Requests'.",
    status: "RESOURCE_EXHAUSTED",
  },
});

export const apiDisabledBody = JSON.stringify({
  error: {
    code: 403,
    message: "Places API (New) has not been used in project 123 before or it is disabled.",
    status: "PERMISSION_DENIED",
  },
});
