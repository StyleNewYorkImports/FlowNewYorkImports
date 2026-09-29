const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { WebhookSignatureValidator, InvalidWebhookSignatureError } = require("mercadopago");

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN || "";
const MP_PUBLIC_KEY = process.env.MP_PUBLIC_KEY || "";
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || "";
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "catalog.json"), "utf8"));

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}
function trustedTotal(items) {
  let cents = 0;
  for (const item of items || []) {
    const p = catalog[String(item.id)];
    const qty = Number(item.qty);
    if (!p || !Number.isInteger(qty) || qty < 1 || qty > 20) throw new Error("Carrinho inválido.");
    cents += Math.round(Number(p.price) * 100) * qty;
  }
  if (!cents) throw new Error("Carrinho vazio.");
  return (cents / 100).toFixed(2);
}
async function mpFetch(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
    ...(options.headers || {})
  };
  return fetch(url, { ...options, headers });
}
async function processOrder(req, res) {
  if (!MP_ACCESS_TOKEN) return sendJson(res, 503, { message: "Pagamento indisponível temporariamente." });
  try {
    const body = await readBody(req);
    const total = trustedTotal(body.store_cart);
    if (Number(body.total_amount || 0).toFixed(2) !== total) {
      return sendJson(res, 400, { message: "O valor do carrinho mudou. Atualize a página." });
    }
    const method = body.transactions?.payments?.[0]?.payment_method;
    if (!method?.token || !method?.id || !method?.type) {
      return sendJson(res, 400, { message: "Dados de pagamento incompletos." });
    }

    const order = {
      type: "online",
      processing_mode: "automatic",
      total_amount: total,
      external_reference: String(body.external_reference || `FLOW-${Date.now()}`),
      payer: body.payer,
      transactions: { payments: [{ amount: total, payment_method: method }] }
    };

    const r = await mpFetch("https://api.mercadopago.com/v1/orders", {
      method: "POST",
      headers: { "X-Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify(order)
    });
    const result = await r.json();
    return sendJson(res, r.status, result);
  } catch (e) {
    console.error("process_order:", e);
    return sendJson(res, 400, { message: e.message || "Não foi possível processar o pagamento." });
  }
}
async function webhook(req, res) {
  try {
    const u = new URL(req.url, "http://localhost");
    const dataId = u.searchParams.get("data.id") || u.searchParams.get("data_id") || "";
    if (!MP_WEBHOOK_SECRET) return sendJson(res, 503, { message: "Webhook não configurado." });

    WebhookSignatureValidator.validate({
      xSignature: req.headers["x-signature"],
      xRequestId: req.headers["x-request-id"],
      dataId,
      secret: MP_WEBHOOK_SECRET
    });

    // Responde rápido; depois consulta a Order no Mercado Pago como fonte de verdade.
    res.writeHead(200);
    res.end("OK");

    if (dataId && MP_ACCESS_TOKEN) {
      try {
        const r = await mpFetch(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(dataId)}`, { method: "GET" });
        const order = await r.json();
        console.log("Mercado Pago webhook:", {
          id: order.id || dataId,
          status: order.status,
          status_detail: order.status_detail,
          external_reference: order.external_reference
        });
        // Ponto de integração para banco de dados/ERP no futuro.
      } catch (e) {
        console.error("Falha ao consultar order após webhook:", e);
      }
    }
  } catch (e) {
    if (e instanceof InvalidWebhookSignatureError) return sendJson(res, 401, { message: "Assinatura inválida." });
    console.error("webhook:", e);
    return sendJson(res, 400, { message: "Webhook inválido." });
  }
}
function serve(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (urlPath === "/") urlPath = "/index.html";
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(file).toLowerCase();
    const types = {
      ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8",
      ".js":"application/javascript; charset=utf-8", ".json":"application/json; charset=utf-8",
      ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".webp":"image/webp", ".ico":"image/x-icon"
    };
    res.writeHead(200, {
      "Content-Type": types[ext] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    res.end(data);
  });
}
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;

  // Endpoint leve para o health check da hospedagem.
  if ((req.method === "GET" || req.method === "HEAD") && pathname === "/health") {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    });
    return res.end(req.method === "HEAD" ? undefined : "OK");
  }

  if (req.method === "GET" && req.url === "/api/config") {
    return sendJson(res, MP_PUBLIC_KEY ? 200 : 503, { publicKey: MP_PUBLIC_KEY || null });
  }
  if (req.method === "POST" && req.url === "/process_order") return processOrder(req, res);
  if (req.method === "POST" && req.url.startsWith("/api/webhooks/mercadopago")) return webhook(req, res);
  return serve(req, res);
});
server.listen(PORT, "0.0.0.0", () => console.log(`FlowNewYork rodando na porta ${PORT}`));
