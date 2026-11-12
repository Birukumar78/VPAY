require("dotenv").config();
const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const PAYPAL_BASE = process.env.PAYPAL_BASE;
const INR_PER_USD = 85;
const expenses = [];

app.get("/api/health", (req, res) => {
  res.json({ status: "VPAY server chal raha hai" });
});

app.get("/api/config", (req, res) => {
  res.json({ clientId: process.env.PAYPAL_CLIENT_ID, inrPerUsd: INR_PER_USD });
});

async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`
  ).toString("base64");
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data.access_token;
}

app.get("/api/paypal-test", async (req, res) => {
  try {
    const token = await getAccessToken();
    res.json({ ok: true, tokenPreview: token.slice(0, 10) + "..." });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------- Gemini with retry + fallback ----------
const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

async function callGemini(body) {
  let lastErr = "unknown error";
  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(4000),
        }
      );
      const data = await res.json();
      if (res.ok) return data;
      lastErr = JSON.stringify(data);
    } catch (e) {
      lastErr = e.message;
    }
  }
  throw new Error(lastErr);
}

// Simple offline parser: Gemini fail ho to bhi basic commands chalein
function fallbackParse(text) {
  const t = text.toLowerCase();
  const num = t.match(/(\d+(\.\d+)?)/);
  const amount = num ? parseFloat(num[1]) : null;
  const isInr = /(rupee|rupaye|rupay|rs|inr|₹)/.test(t);
  const nameMatch = text.match(/^\s*([A-Za-z\u0900-\u097F]+)\s+(ko|to)\b/i) || text.match(/\b(?:to|send)\s+([A-Za-z]+)/i);
  const to = nameMatch ? nameMatch[1] : null;
  let category = "other";
  if (/(khana|food|lunch|dinner|pizza|chai)/.test(t)) category = "food";
  else if (/(travel|taxi|uber|petrol|bus|train)/.test(t)) category = "travel";
  else if (/(bill|recharge|rent)/.test(t)) category = "bills";
  else if (/(shopping|kapde|shirt)/.test(t)) category = "shopping";
  if (/(kharch|spent|spending|kitna)/.test(t)) return { action: "query", query: text };
  if (amount && to) return { action: "send", to, amount, currency: isInr ? "INR" : "USD", category };
  return { action: "unknown" };
}

async function parseCommand(text) {
  const prompt = `You are a payment assistant. Convert the user's command (Hindi, Hinglish or English) into JSON only, no extra text.
Format: {"action":"send"|"query"|"unknown","to":string|null,"amount":number|null,"currency":"USD"|"INR","category":"food"|"travel"|"bills"|"shopping"|"other"|null,"query":string|null}
- action "send" when user wants to pay/send money. "to" can be ANY person name.
- action "query" when user asks about spending; put the question in "query".
- currency is "INR" if user says rupees/rupaye/rs/₹, otherwise "USD". Keep the amount number exactly as spoken, do not convert.
Command: "${text}"`;
  try {
    const data = await callGemini({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" },
    });
    return JSON.parse(data.candidates[0].content.parts[0].text);
  } catch (e) {
    console.log("Gemini fail, fallback parser use ho raha hai:", e.message.slice(0, 120));
    return fallbackParse(text);
  }
}

app.post("/api/parse", async (req, res) => {
  try {
    const parsed = await parseCommand(req.body.text);
    res.json({ ok: true, parsed });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ---------- PayPal orders ----------
app.post("/api/create-order", async (req, res) => {
  try {
    const { amountUsd, to, category } = req.body;
    const token = await getAccessToken();
    const r = await fetch(`${PAYPAL_BASE}/v2/checkout/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: { currency_code: "USD", value: Number(amountUsd).toFixed(2) },
            description: `VPAY payment to ${to} (${category})`,
          },
        ],
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(data));
    res.json({ ok: true, orderId: data.id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/capture-order", async (req, res) => {
  try {
    const { orderId, to, amountUsd, originalAmount, originalCurrency, category } = req.body;
    const token = await getAccessToken();
    const r = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    const data = await r.json();
    if (!r.ok) throw new Error(JSON.stringify(data));
    expenses.push({
      id: orderId,
      to,
      amountUsd: Number(amountUsd),
      originalAmount: Number(originalAmount),
      originalCurrency,
      category,
      status: data.status,
      date: new Date().toISOString(),
    });
    res.json({ ok: true, status: data.status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/expenses", (req, res) => {
  res.json({ ok: true, expenses });
});

app.post("/api/ask", async (req, res) => {
  try {
    const prompt = `You are a friendly expense assistant. Here are the user's expenses as JSON: ${JSON.stringify(expenses)}.
Answer the question briefly (2 sentences max) in Hinglish. If there are no expenses, say so.
Question: "${req.body.question}"`;
    const data = await callGemini({ contents: [{ parts: [{ text: prompt }] }] });
    res.json({ ok: true, answer: data.candidates[0].content.parts[0].text });
  } catch (err) {
    // Gemini down ho to simple local summary
    const total = expenses.reduce((s, e) => s + e.amountUsd, 0);
    res.json({
      ok: true,
      answer: expenses.length   
        ? `Ab tak ${expenses.length} payments hue, total $${total.toFixed(2)} kharch hua.`
        : "Abhi tak koi kharcha nahi hua.",
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`VPAY running on http://localhost:${PORT}`));