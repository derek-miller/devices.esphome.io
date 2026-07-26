/**
 * The whole catalog — every device with its thumbnail, facet values and date,
 * plus catalog-wide facet counts — as one JSON file.
 *
 * The browser UI does not need this (its cards are server-rendered), but the
 * same data being queryable is useful on its own: it is what anyone building
 * against this site would otherwise have to scrape back out of the HTML.
 */
import type { APIRoute } from "astro";
import { getDeviceIndex } from "../utils/deviceIndex";

export const GET: APIRoute = async () => {
  const { cards, counts } = await getDeviceIndex();
  return new Response(JSON.stringify({ cards, counts }), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
