export interface Env {
  IMAGES_BUCKET: R2Bucket;
  IMAGES: ImagesBinding;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const key = decodeURIComponent(url.pathname.slice(1)); // buang leading "/"

    if (!key) {
      return new Response("Not found", { status: 404 });
    }

    const object = await env.IMAGES_BUCKET.get(key);
    if (!object) {
      return new Response("Not found", { status: 404 });
    }

    const width = url.searchParams.get("width");
    const quality = url.searchParams.get("quality") ?? "80";
    const format = url.searchParams.get("format") ?? "webp";

    // Kalau tidak ada param resize, serve file asli
    if (!width) {
      return new Response(object.body, {
        headers: {
          "Content-Type": object.httpMetadata?.contentType ?? "image/webp",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    const transformed = await env.IMAGES.input(object.body)
      .transform({ width: Number(width) })
      .output({ format: format === "webp" ? "image/webp" : "image/jpeg", quality: Number(quality) });

    const response = await transformed.response();
    response.headers.set("Cache-Control", "public, max-age=31536000, immutable");
    return response;
  },
};