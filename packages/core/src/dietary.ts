// Dietary needs: the shape stored on the TripBrief, merging, labels, and a
// deterministic check that flags food suggestions which may conflict with them.
//
// The check is a safety net, not a guarantee. The itinerary agent is told to
// respect the traveller's needs, but it can slip, and nothing here can verify
// a restaurant's halal/kosher certification or a dish's ingredients. So:
// - the check errs towards flagging (a false alarm costs a glance; a miss
//   could cost someone's health), and
// - the UI always tells travellers with needs to confirm with the restaurant.

import { z } from "zod";

import { DIET_LABELS, DIET_TAGS, type DietTag } from "./dietTags";

export { DIET_LABELS, DIET_TAGS, type DietTag };

const TAG_PATTERNS: Array<[DietTag, RegExp]> = [
  ["halal", /\bhalal\b/],
  ["kosher", /\bkosher\b/],
  ["vegan", /\bvegan\b/],
  ["vegetarian", /\bvegetarian\b|\bveggie\b/],
  ["pescatarian", /\bpescatarian\b|\bpescetarian\b/],
  ["gluten_free", /\bgluten\b|\bcoeliac\b|\bceliac\b/],
  ["dairy_free", /\bdairy\b|\blactose\b/],
  ["no_pork", /\bpork\b/],
  ["no_alcohol", /\balcohol\b|\bteetotal\b|\bsober\b/],
];

/**
 * Every tag a piece of loose wording names: "vegan and gluten-free" ->
 * ["vegan", "gluten_free"]; "Halal food" -> ["halal"]; unknown -> [].
 */
export function normalizeDietTags(raw: string): DietTag[] {
  const t = raw.toLowerCase().replace(/[^a-z]+/g, " ").trim();
  return TAG_PATTERNS.filter(([, re]) => re.test(t)).map(([tag]) => tag);
}

/** The first tag the wording names (see normalizeDietTags). */
export function normalizeDietTag(raw: string): DietTag | undefined {
  return normalizeDietTags(raw)[0];
}

// Lenient on purpose, field by field: a model that returns one odd value
// (a number in a list, an over-long note) must not cost the traveller the
// needs it got right. Junk is dropped or truncated, never fatal.
const strings = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === "string" ? [v] : []).filter((x): x is string => typeof x === "string");

const tagList = z
  .unknown()
  .transform((v) => [...new Set(strings(v).flatMap(normalizeDietTags))]);

const allergyList = z
  .unknown()
  .transform((v) =>
    [...new Set(strings(v).flatMap((x) => x.split(/[,;]/)).map((x) => x.trim().toLowerCase()).filter((x) => x.length > 0))]
      .map((x) => x.slice(0, 40))
      .slice(0, 10),
  );

export const DietarySchema = z.object({
  /** Diets/religious rules, as tags (unknown wording is dropped; see notes). */
  requirements: tagList,
  /** Free text allergens, lower-cased: "peanuts", "shellfish", "sesame". */
  allergies: allergyList,
  /** Anything that didn't fit the above ("no spicy food"), verbatim, up to 300 chars. */
  notes: z
    .unknown()
    .transform((v) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : undefined)),
});
export type Dietary = z.infer<typeof DietarySchema>;

export const NO_DIETARY: Dietary = { requirements: [], allergies: [] };

export function hasDietaryNeeds(d: Dietary | undefined | null): boolean {
  return !!d && (d.requirements.length > 0 || d.allergies.length > 0 || !!d.notes?.trim());
}

/** Union of two sets of needs. Used to merge what the traveller ticked with what they wrote. */
export function mergeDietary(a: Partial<Dietary> | undefined | null, b: Partial<Dietary> | undefined | null): Dietary {
  // Split earlier merges back into parts, so a note restated in a later
  // clarification round isn't appended again each time.
  const notes = [a?.notes, b?.notes].flatMap((n) => (n ? n.split(";") : [])).map((n) => n.trim()).filter((n) => !!n);
  return DietarySchema.parse({
    requirements: [...(a?.requirements ?? []), ...(b?.requirements ?? [])],
    allergies: [...(a?.allergies ?? []), ...(b?.allergies ?? [])],
    notes: notes.length ? [...new Set(notes)].join("; ").slice(0, 300) : undefined,
  });
}

/** Short human labels: ["Halal", "Allergy: peanuts"]. */
export function dietaryLabels(d: Dietary | undefined | null): string[] {
  if (!d) return [];
  return [...d.requirements.map((t) => DIET_LABELS[t]), ...d.allergies.map((a) => `Allergy: ${a}`)];
}

// ------------------------------------------------------------ conflicts

// Word lists in English plus the local names travellers will actually meet on
// menus. Whole-word, accent-insensitive matching (see `mentions`).
const PORK = [
  "pork", "pig", "piglet", "bacon", "ham", "lard", "lardo", "gammon", "prosciutto", "pancetta", "guanciale",
  "salami", "pepperoni", "chorizo", "chouriço", "chourico", "jamón", "jamon", "presunto", "porco", "leitão",
  "leitao", "bifana", "bifanas", "alheira", "morcilla", "morcela", "sobrasada", "carnitas", "al pastor",
  "cochinita", "chicharrón", "chicharron", "tonkatsu", "katsu", "char siu", "chashu", "tonkotsu", "schnitzel",
  "bratwurst", "sausage", "sausages", "hot dog", "porchetta", "cochinillo", "lechon", "lechón", "spam",
];
const SHELLFISH = [
  "shellfish", "shrimp", "shrimps", "prawn", "prawns", "crab", "crabs", "lobster", "langoustine", "crayfish",
  "clam", "clams", "mussel", "mussels", "oyster", "oysters", "scallop", "scallops", "squid", "calamari",
  "octopus", "polvo", "lula", "cuttlefish", "camarão", "camarao", "gambas", "amêijoas", "ameijoas",
  "mejillones", "percebes", "sea urchin", "uni", "ebi", "seafood", "cataplana", "paella",
];
const MEAT = [
  "meat", "beef", "steak", "veal", "lamb", "mutton", "goat", "chicken", "duck", "turkey", "venison", "rabbit",
  "game", "liver", "tripe", "oxtail", "brisket", "burger", "kebab", "kebabs", "shawarma", "gyro", "gyros",
  "kofta", "tagine", "bife", "frango", "pato", "vitela", "cabrito", "carne", "yakitori", "wagyu", "kobe",
  "ramen", "barbecue", "bbq", "meatballs", "dumplings", "foie gras", "tacos", "birria", "asado",
  ...PORK,
];
const FISH = [
  "fish", "cod", "bacalhau", "bacalao", "sardine", "sardines", "sardinhas", "tuna", "salmon", "anchovy",
  "anchovies", "mackerel", "sea bass", "bream", "sushi", "sashimi", "ceviche", "dashi", "bonito", "eel",
  "unagi", "fish sauce",
];
const DAIRY = [
  "cheese", "milk", "cream", "butter", "yogurt", "yoghurt", "ghee", "paneer", "queijo", "queso", "gelato",
  "ice cream", "custard", "nata", "pastel de nata", "pastéis de nata", "burrata", "mozzarella", "ricotta",
  "labneh", "kunafa", "knafeh", "cheesecake", "latte", "cappuccino",
];
const EGG = ["egg", "eggs", "omelette", "omelet", "tortilla", "mayonnaise", "aioli", "meringue", "custard", "nata", "pastel de nata", "pastéis de nata", "carbonara", "tamagoyaki"];
const GLUTEN = [
  "gluten", "wheat", "bread", "pasta", "noodles", "ramen", "udon", "pizza", "pastry", "pastries", "croissant",
  "cake", "biscuit", "cookie", "beer", "flour", "couscous", "bulgur", "seitan", "dumplings", "pão", "pao",
  "bifana", "francesinha", "tempura", "panko", "pastel de nata", "pastéis de nata", "churros", "baklava",
  "sandwich", "burger", "tacos al pastor", "soy sauce",
];
const ALCOHOL = [
  "alcohol", "wine", "wines", "beer", "beers", "brewery", "cocktail", "cocktails", "sake", "port wine",
  "port tasting", "vinho", "ginjinha", "sangria", "whisky", "whiskey", "gin", "rum", "vodka", "tequila",
  "mezcal", "pub", "bar crawl", "pub crawl", "winery", "vineyard", "tasting room", "cava", "prosecco",
  "champagne", "liqueur", "soju", "arak", "raki", "ouzo", "pisco",
];
const NUTS = [
  "nut", "nuts", "almond", "almonds", "walnut", "walnuts", "hazelnut", "hazelnuts", "pistachio", "pistachios",
  "cashew", "cashews", "pecan", "pecans", "macadamia", "praline", "marzipan", "nougat", "pesto", "baklava",
  "amêndoa", "amendoa", "turrón", "turron", "gianduja", "nutella", "satay", "frangipane",
];
const PEANUT = ["peanut", "peanuts", "satay", "groundnut", "pad thai", "kare kare", "mafe"];
const SESAME = ["sesame", "tahini", "tahina", "hummus", "halva", "halwa", "simit", "gomasio", "za'atar", "zaatar"];
const SOY = ["soy", "soya", "tofu", "edamame", "miso", "tempeh", "soy sauce", "natto", "shoyu", "teriyaki"];

// Allergy wording -> extra words to look for. Whole-word patterns, so
// "coconut", "nutmeg" and "eggplant" don't count as nut/egg allergies. The
// allergen's own words are always searched too ("coconut" finds coconut).
const ALLERGEN_WORDS: Array<[RegExp, string[]]> = [
  [/\b(peanuts?|groundnuts?)\b/, PEANUT],
  [/\b(tree ?nuts?|nuts?|almonds?|walnuts?|hazelnuts?|pistachios?|cashews?|pecans?|macadamias?)\b/, [...NUTS, ...PEANUT]],
  [/\b(shellfish|shrimps?|prawns?|crabs?|lobsters?|crustaceans?|molluscs?|mollusks?|clams?|mussels?|oysters?|scallops?|squid|octopus)\b/, SHELLFISH],
  [/\bfish\b/, FISH],
  [/\bsesame\b/, SESAME],
  [/\b(dairy|milk|lactose|cheese)\b/, DAIRY],
  [/\beggs?\b/, EGG],
  [/\b(gluten|wheat|celiac|coeliac)\b/, GLUTEN],
  [/\bsoya?\b/, SOY],
];

/** Words to look for for one allergy, always including the allergy's own words. */
function allergenWords(allergy: string): string[] {
  const a = normalizeText(allergy);
  const own = a.replace(/\b(allergy|allergic|intolerance|intolerant|to)\b/g, " ").trim();
  const mapped = ALLERGEN_WORDS.filter(([re]) => re.test(a)).flatMap(([, ws]) => ws);
  return [...new Set([...mapped, ...(own ? [own] : [])])];
}

function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

const NEGATORS = new Set(["no", "not", "without", "zero", "avoid", "avoids", "skip", "skips", "minus", "except", "excluding"]);

/** Words, plus punctuation as its own tokens (so "wine, free entry" isn't "wine free"). */
function tokenize(s: string): string[] {
  return normalizeText(s).match(/[\p{L}\p{N}']+|[^\s\p{L}\p{N}']/gu) ?? [];
}

const isWord = (t: string | undefined) => t !== undefined && /^[\p{L}\p{N}']+$/u.test(t);

/**
 * The listed words that `text` mentions as whole words (accent-insensitive),
 * ignoring negated mentions: "pork-free", "without nuts", "no alcohol served",
 * "instead of shrimp", "free of gluten". The agent writes these in exactly
 * the descriptions we check, and flagging them would teach people to ignore
 * the warnings.
 */
function mentions(text: string, words: string[]): string[] {
  const toks = tokenize(stripChecks(text));
  // Keyed by the accent-free form: "chouriço" and "chourico" are one word.
  const found = new Map<string, string>();
  for (const w of words) {
    if (found.has(normalizeText(w))) continue;
    const wt = tokenize(w).filter(isWord);
    if (wt.length === 0) continue;
    for (let i = 0; i + wt.length <= toks.length; i++) {
      if (!wt.every((x, j) => toks[i + j] === x)) continue;
      // Only direct negation counts: "no pork", "without any nuts", "instead
      // of shrimp", "free of gluten", "pork-free", "hold the cheese". Not
      // "no visit is complete without a bifana" -- that recommends it, nor
      // "port wine, free entry" -- punctuation breaks the link.
      const p1 = toks[i - 1];
      const p2 = toks[i - 2];
      const a1 = toks[i + wt.length];
      const a2 = toks[i + wt.length + 1];
      const negated =
        (p1 !== undefined && NEGATORS.has(p1)) ||
        ((p1 === "any" || p1 === "added") && p2 !== undefined && NEGATORS.has(p2)) ||
        (p1 === "of" && (p2 === "instead" || p2 === "free")) ||
        (p1 === "the" && p2 === "hold") ||
        a1 === "free" ||
        (a1 === "-" && a2 === "free");
      if (!negated) {
        found.set(normalizeText(w), w);
        break;
      }
    }
  }
  return [...found.values()];
}

// What a "check" clause checks: contents, not a menu item to order.
const CHECK_TOPIC =
  /\b(content|contents|contains?|handling|handled|ingredients?|prepar\w*|made|uses?|used|added|traces?|cross|certifi\w*|allergens?|has|have|free|safe)\b/;

/**
 * Removes the object of "ask/check/confirm ... about/whether/if ..." when it is
 * about contents ("asking each stall about pork/alcohol content", "confirm
 * whether the sauce has peanuts"): advice to verify isn't a recommendation.
 * Only the part after about/whether/if, only to the end of that clause (a
 * comma, "then", "but" or "and order" end it), and only when it names what's
 * checked -- "check out the bifana if you're hungry", "ask about the wine
 * pairing" and "...open, then order the bifana" are still read.
 */
function stripChecks(text: string): string {
  return text.replace(
    /\b(ask|asking|asks|check|checking|checks|confirm|confirming|enquire|inquire|verify)\b((?:\s+[^\s.,;!?]+){0,3}?\s+)(about|whether|if)\b([^.,;!?]*?)(?=[.,;!?]|\s+(?:then|but|and\s+order)\b|$)/giu,
    (whole, verb: string, middle: string, kw: string, clause: string) =>
      CHECK_TOPIC.test(normalizeText(clause)) ? `${verb}${middle}${kw} ` : whole,
  );
}

export type DietConflict = {
  /** What it may conflict with: "Halal", "Allergy: peanuts". */
  need: string;
  /** The words that triggered it: ["chorizo"]. */
  words: string[];
};

/**
 * Possible conflicts between a food suggestion and the traveller's needs, by
 * keyword. Errs towards flagging: "Chicken or pork bifana" flags for halal
 * even though the chicken one would be fine -- the traveller decides.
 */
export function dietConflicts(text: string, d: Dietary | undefined | null): DietConflict[] {
  if (!d || !text.trim()) return [];
  const out: DietConflict[] = [];
  const add = (need: string, words: string[]) => {
    if (words.length) out.push({ need, words });
  };
  const req = new Set(d.requirements);

  if (req.has("halal") || req.has("kosher") || req.has("no_pork")) {
    const need = req.has("halal") ? "Halal" : req.has("kosher") ? "Kosher" : "No pork";
    add(need, mentions(text, PORK));
  }
  if (req.has("kosher")) add("Kosher", mentions(text, SHELLFISH));
  if (req.has("halal") || req.has("no_alcohol")) add(req.has("halal") ? "Halal" : "No alcohol", mentions(text, ALCOHOL));
  if (req.has("vegan")) {
    add("Vegan", mentions(text, [...MEAT, ...FISH, ...SHELLFISH]));
    add("Vegan", mentions(text, [...DAIRY, ...EGG, "honey"]));
  } else if (req.has("vegetarian")) {
    add("Vegetarian", mentions(text, [...MEAT, ...FISH, ...SHELLFISH]));
  } else if (req.has("pescatarian")) {
    add("Pescatarian", mentions(text, MEAT));
  }
  if (req.has("gluten_free")) add("Gluten-free", mentions(text, GLUTEN));
  if (req.has("dairy_free")) add("Dairy-free", mentions(text, DAIRY));

  for (const allergy of d.allergies) {
    add(`Allergy: ${allergy}`, mentions(text, allergenWords(allergy)));
  }

  // One entry per need, words merged.
  const merged = new Map<string, Set<string>>();
  for (const c of out) {
    const set = merged.get(c.need) ?? new Set<string>();
    c.words.forEach((w) => set.add(w));
    merged.set(c.need, set);
  }
  return [...merged].map(([need, words]) => ({ need, words: [...words] }));
}

/** The trip's dietary needs from its stored brief JSON; undefined if unreadable. */
export function dietaryFromBrief(briefJson: string | null | undefined): Dietary | undefined {
  if (!briefJson) return undefined;
  try {
    const parsed = DietarySchema.safeParse(JSON.parse(briefJson)?.dietary ?? {});
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
