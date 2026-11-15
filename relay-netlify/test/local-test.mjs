// 本地自测 Netlify Function：假 Supabase + 假 event，验证转发/拦截/鉴权/二进制体。
// 用法：node relay-netlify/test/local-test.mjs
import http from "node:http";
import { createRequire } from "node:module";

process.env.SUPABASE_URL = "http://127.0.0.1:8899";
process.env.SUPABASE_ANON_KEY = "test-anon-key-0123456789";
process.env.RELAY_TOKEN = "";

const require = createRequire(import.meta.url);
const { handler } = require("../functions/relay.js");

let hits = [];

const upstream = http.createServer((req, res) => {
  let body = "";
  req.on("data", c => (body += c));
  req.on("end", () => {
    hits.push({ url: req.url, apikey: req.headers["apikey"] || "", body });

    if (req.url.startsWith("/auth/v1/settings")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ disable_signup: false }));
      return;
    }

    if (req.url.startsWith("/rest/v1/rx_profiles")) {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(req.method === "POST" ? body : "[]");
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end("{}");
  });
});

await new Promise(r => upstream.listen(8899, "127.0.0.1", r));

const call = (path, { method = "GET", headers = {}, body } = {}) =>
  handler({
    rawUrl: `https://rxnel.netlify.app${path}`,
    path,
    httpMethod: method,
    headers,
    body,
    isBase64Encoded: false
  }).then(r => ({
    status: r.statusCode,
    body: r.isBase64Encoded ? Buffer.from(r.body, "base64").toString() : r.body
  }));

const show = async (name, p) => {
  const r = await p;
  console.log(`${name}: ${r.status} ${String(r.body).slice(0, 90)}`);
};

await show("auth 转发", call("/auth/v1/settings"));
await show("rest 转发", call("/rest/v1/rx_profiles?select=id&limit=1"));
await show("POST 转发", call("/rest/v1/rx_profiles", {
  method: "POST",
  headers: { "content-type": "application/json", prefer: "return=representation" },
  body: JSON.stringify({ email: "a@b.com" })
}));
await show("非法前缀拦截", call("/evil/path"));

process.env.RELAY_TOKEN = "relay-token-123";
await show("缺 token 被拒", call("/auth/v1/settings"));
await show("带 token 通过", call("/auth/v1/settings", { headers: { "x-relay-token": "relay-token-123" } }));

console.log("upstream apikey:", hits.map(h => h.apikey)[0]);
console.log("upstream 路径:", hits.map(h => h.url).join(" | "));

upstream.close();
