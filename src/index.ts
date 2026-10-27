export interface Env {
  IMAGES_BUCKET: R2Bucket;
  IMAGES: ImagesBinding;
}

const IMMUTABLE = "public, max-age=31536000, immutable";
const MIN_WIDTH = 16;
const MAX_WIDTH = 2400;

const PASSTHROUGH_TYPES = ["image/svg+xml", "image/gif"];

type Negotiated = { mime: "image/avif" | "image/webp"; tag: "avif" | "webp" };

function negotiateFormat(request: Request): Negotiated {
  const accept = request.headers.get("Accept") ?? "";
  return accept.includes("image/avif")
    ? { mime: "image/avif", tag: "avif" }
    : { mime: "image/webp", tag: "webp" };
}

function rawResponse(object: R2ObjectBody): Response {
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
      "Cache-Control": IMMUTABLE,
    },
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }

    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.slice(1));
    if (!key) return new Response("Not found", { status: 404 });

    const widthParam = url.searchParams.get("width");

    // Tanpa parameter width: sajikan file asli apa adanya.
    if (!widthParam) {
      const original = await env.IMAGES_BUCKET.get(key);
      if (!original) return new Response("Not found", { status: 404 });
      return rawResponse(original);
    }

    // Batasi lebar supaya tidak bisa dipakai menghabiskan kuota transformasi
    // dengan ribuan ukuran acak.
    const width = Math.min(Math.max(Number(widthParam) || MIN_WIDTH, MIN_WIDTH), MAX_WIDTH);

    const { mime, tag } = negotiateFormat(request);

    // Cache API tidak membedakan respons berdasarkan header Accept,
    // jadi format dimasukkan ke cache key supaya browser tanpa AVIF
    // tidak pernah dapat file AVIF.
    const cache = caches.default;
    const keyUrl = new URL(request.url);
    keyUrl.searchParams.set("_f", tag);
    const cacheKey = new Request(keyUrl.toString(), { method: "GET" });

    const cached = await cache.match(cacheKey);
    if (cached) {
      const hit = new Response(cached.body, cached);
      hit.headers.set("X-Worker-Cache", "HIT");
      return hit;
    }

    const object = await env.IMAGES_BUCKET.get(key);
    if (!object) return new Response("Not found", { status: 404 });

    const contentType = object.httpMetadata?.contentType ?? "";
    if (PASSTHROUGH_TYPES.includes(contentType)) {
      return rawResponse(object);
    }

    // AVIF kualitas ~64 setara secara visual dengan WebP kualitas 80.
    const baseQuality = Number(url.searchParams.get("quality") ?? "80");
    const quality = tag === "avif" ? Math.max(40, Math.round(baseQuality * 0.8)) : baseQuality;

    try {
      const transformed = await env.IMAGES.input(object.body)
        .transform({ width })
        .output({ format: mime, quality });

      const result = new Response((await transformed.response()).body, {
        headers: {
          "Content-Type": mime,
          "Cache-Control": IMMUTABLE,
          Vary: "Accept",
          "X-Worker-Cache": "MISS",
        },
      });

      ctx.waitUntil(cache.put(cacheKey, result.clone()));
      return result;
    } catch {
      // Transformasi gagal: kembalikan file asli daripada error.
      const fallback = await env.IMAGES_BUCKET.get(key);
      return fallback ? rawResponse(fallback) : new Response("Not found", { status: 404 });
    }
  },
};