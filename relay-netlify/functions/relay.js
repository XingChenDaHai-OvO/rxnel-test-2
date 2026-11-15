// Netlify Function：把 /auth/* 与 /rest/* 转发到 Supabase。
// 为什么用 Netlify：*.vercel.app 实测被 SNI 阻断，而 *.netlify.app 实测可达（vue.netlify.app → 200）。

const PASS_REQUEST_HEADERS = [
  "authorization",
  "content-type",
  "accept",
  "prefer",
  "range",
  "x-client-info",
  "x-supabase-api-version",
  "x-upsert"
];

const PASS_RESPONSE_HEADERS = [
  "content-type",
  "content-range",
  "content-profile",
  "preference-applied",
  "location",
  "x-csrf-token",
  "retry-after"
];


// 部署时内联的配置（Netlify 免费档不能通过 API 写共享环境变量，这里直接写死）
const INLINE_CONFIG = {
  url: "https://tytybaqkrtyqionphxob.supabase.co",
  key: process.env.SUPABASE_ANON_KEY || "probe-dummy-key",
  token: "rxnel_8f3k2m9q"
};

function config() {
  return {
    url: (process.env.SUPABASE_URL || INLINE_CONFIG.url || "").replace(/\/$/, ""),
    key: process.env.SUPABASE_ANON_KEY || INLINE_CONFIG.key || "",
    token: process.env.RELAY_TOKEN || INLINE_CONFIG.token || ""
  };
}

exports.handler = async event => {
  const { url: supabaseUrl, key: supabaseKey, token: relayToken } = config();

  if (!supabaseUrl || !supabaseKey) {
    return json(500, { error: "relay_not_configured", message: "缺少 SUPABASE_URL / SUPABASE_ANON_KEY" });
  }

  if (relayToken && (event.headers["x-relay-token"] || "") !== relayToken) {
    return json(401, { error: "unauthorized", message: "缺少或错误的 x-relay-token" });
  }

  // rawUrl 是重写前的原始地址，能拿到真正的 /auth/... 或 /rest/...
  const original = new URL(event.rawUrl);
  const path = original.pathname + original.search;

  if (!path.startsWith("/auth/") && !path.startsWith("/rest/")) {
    return json(404, { error: "not_found", message: "只转发 /auth/* 与 /rest/*" });
  }

  const headers = { apikey: supabaseKey };

  for (const name of PASS_REQUEST_HEADERS) {
    if (event.headers[name]) headers[name] = event.headers[name];
  }

  let body;

  if (event.httpMethod !== "GET" && event.httpMethod !== "HEAD" && event.body) {
    body = event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body;
  }

  let upstream;

  try {
    upstream = await fetch(supabaseUrl + path, {
      method: event.httpMethod,
      headers,
      body,
      redirect: "manual"
    });
  } catch (error) {
    return json(502, { error: "upstream_unreachable", message: String(error) });
  }

  const outHeaders = { "cache-control": "no-store" };

  for (const name of PASS_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) outHeaders[name] = value;
  }

  const buffer = Buffer.from(await upstream.arrayBuffer());

  return {
    statusCode: upstream.status,
    headers: outHeaders,
    body: buffer.toString("base64"),
    isBase64Encoded: true
  };
};

function json(status, payload) {
  return {
    statusCode: status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  };
}
