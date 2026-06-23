// netlify/edge-functions/gemini-proxy.js
const MAX_TOTAL_CHARS = 6000;
const MAX_TOKENS_CEILING = 700;
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

export default async (request, context) => {
  const apiKey = Netlify.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "server_misconfigured", message: "GEMINI_API_KEY belum diset di Environment Variables Netlify." }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  const url = new URL(request.url);
  const upstreamPath = url.pathname.replace(/^\/api\/chat/, "");
  const target = GEMINI_BASE + upstreamPath + url.search;

  const headers = new Headers();
  headers.set("authorization", `Bearer ${apiKey}`);
  headers.set("content-type", "application/json");

  let outgoingBody = request.body;

  if (upstreamPath.startsWith("/chat/completions") && request.method === "POST") {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "invalid_json" }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    }

    const totalChars = (payload.messages || []).reduce(
      (sum, m) => sum + (typeof m.content === "string" ? m.content.length : 0), 0
    );
    if (totalChars > MAX_TOTAL_CHARS) {
      return new Response(
        JSON.stringify({ error: "message_too_long", message: `Total pesan maksimal ${MAX_TOTAL_CHARS} karakter. Mulai obrolan baru ya.` }),
        { status: 413, headers: { "content-type": "application/json" } }
      );
    }

    payload.max_tokens = Math.min(payload.max_tokens || MAX_TOKENS_CEILING, MAX_TOKENS_CEILING);
    outgoingBody = JSON.stringify(payload);
  }

  let upstreamRes;
  try {
    upstreamRes = await fetch(target, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : outgoingBody,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "proxy_fetch_failed", message: String(err) }),
      { status: 502, headers: { "content-type": "application/json" } }
    );
  }

  const resHeaders = new Headers(upstreamRes.headers);
  resHeaders.delete("content-encoding");
  resHeaders.delete("content-length");

  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: resHeaders,
  });
};

export const config = {
  path: "/api/chat/*",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
