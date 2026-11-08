// A tiny in-memory stand-in for the Wikimedia Action API, enough for the
// photo modules' queries (pageimages/coordinates, imageinfo, search).

import type { FetchLike } from "../wikimedia";

export type FakePage = {
  image?: string;
  coords?: [number, number];
  disambiguation?: boolean;
  /** Title this one redirects to. */
  redirectTo?: string;
};
export type FakeFile = { mime?: string; repo?: string; license?: string; nonFree?: boolean; artist?: string };
export type FakeWiki = {
  wikipedia?: Record<string, FakePage>;
  wikivoyage?: Record<string, FakePage>;
  files?: Record<string, FakeFile>;
  /** search query -> ordered result titles (from `wikipedia`). */
  search?: Record<string, string[]>;
};

export function fakeWikimedia(wiki: FakeWiki) {
  const calls: URL[] = [];
  let failWith: number | null = null;

  const page = (title: string, p: FakePage | undefined, index?: number) =>
    p
      ? {
          title,
          index,
          pageimage: p.image,
          coordinates: p.coords ? [{ lat: p.coords[0], lon: p.coords[1] }] : undefined,
          pageprops: p.disambiguation ? { disambiguation: "" } : {},
        }
      : { title, missing: true };

  const fn: FetchLike = async (url) => {
    const u = new URL(url);
    calls.push(u);
    if (failWith) {
      return { ok: false, status: failWith, headers: { get: () => "30" }, json: async () => ({}) };
    }
    const p = u.searchParams;
    const pages = u.host.includes("wikivoyage") ? wiki.wikivoyage ?? {} : wiki.wikipedia ?? {};
    let body: any;

    if (p.get("generator") === "search") {
      const titles = wiki.search?.[p.get("gsrsearch")!] ?? [];
      body = { query: { pages: titles.map((t, i) => page(t, pages[t], i + 1)) } };
    } else if (p.get("prop") === "imageinfo") {
      body = {
        query: {
          pages: p.get("titles")!.split("|").map((t) => {
            const f = wiki.files?.[t.slice(5)];
            if (!f) return { title: t, missing: true };
            return {
              title: t,
              imagerepository: f.repo ?? "shared",
              imageinfo: [
                {
                  mime: f.mime ?? "image/jpeg",
                  thumburl: `https://upload.wikimedia.org/thumb/x/1920px-${t.slice(5)}`,
                  thumbwidth: 1920,
                  thumbheight: 1280,
                  descriptionurl: `https://commons.wikimedia.org/wiki/${t}`,
                  extmetadata: {
                    Artist: { value: f.artist ?? '<a href="https://x">Ana Silva</a>' },
                    LicenseShortName: { value: f.license ?? "CC BY-SA 4.0" },
                    LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0" },
                    ...(f.nonFree ? { NonFree: { value: "true" } } : {}),
                  },
                },
              ],
            };
          }),
        },
      };
    } else {
      const redirects: Array<{ from: string; to: string }> = [];
      const out: any[] = [];
      for (const t of p.get("titles")!.split("|")) {
        let title = t;
        const r = pages[t]?.redirectTo;
        if (r) {
          redirects.push({ from: t, to: r });
          title = r;
        }
        out.push(page(title, pages[title]));
      }
      body = { query: { redirects, pages: out } };
    }
    return { ok: true, status: 200, json: async () => body };
  };

  return {
    fn,
    calls,
    /** Make every following request fail with this HTTP status (null to stop). */
    failAll(status: number | null) {
      failWith = status;
    },
  };
}
