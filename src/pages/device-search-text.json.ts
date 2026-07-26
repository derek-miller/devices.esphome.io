/**
 * Full-text tokens for every device page, keyed by device id.
 *
 * Split out from device-index.json because it is an order of magnitude
 * larger: the browser only fetches it when someone actually reaches for the
 * search box, and searches titles and facets in the meantime.
 */
import type { APIRoute } from "astro";
import { getDeviceIndex } from "../utils/deviceIndex";

export const GET: APIRoute = async () => {
  const { text } = await getDeviceIndex();
  return new Response(JSON.stringify(text), {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
};
