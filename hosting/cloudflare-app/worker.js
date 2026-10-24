// The app is served from static assets (see wrangler.json). Only the media
// prefixes below run this Worker; everything else is a plain asset hit.
// The recordings live in the bible-reading-audio Pages project, whose worker
// answers byte ranges, so this one forwards requests and returns the answer
// untouched. It mirrors the Vercel rewrites in vercel.json.
const AUDIO_ORIGIN = "https://bible-reading-audio.pages.dev";
const MEDIA = /^\/audio\/(days|chapters\/assets|clips)\/[^/]+$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!MEDIA.test(url.pathname)) return env.ASSETS.fetch(request);

    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      });

    // Range, If-Range and conditional headers travel with the request, so
    // seeking and revalidation behave exactly as they do against the origin.
    return fetch(
      new Request(AUDIO_ORIGIN + url.pathname + url.search, request),
    );
  },
};
