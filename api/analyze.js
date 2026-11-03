import fs from "node:fs/promises";
import path from "node:path";
import { compose, parseModelJson } from "../lib/compose.js";

// Один запрос = один ответ. Никакой истории: каждый разбор начинается с чистого листа.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Нужен POST-запрос." });
    return;
  }

  const { code, message, image, prompt } = req.body || {};

  if (process.env.ACCESS_CODE && code !== process.env.ACCESS_CODE) {
    res.status(401).json({ error: "Неверный код доступа." });
    return;
  }
  const useOpenAI = !!process.env.OPENAI_API_KEY;
  if (!useOpenAI && !process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "На сервере не задан ни OPENAI_API_KEY, ни ANTHROPIC_API_KEY (Vercel → Settings → Environment Variables)." });
    return;
  }
  if (useOpenAI && !process.env.MODEL) {
    res.status(500).json({ error: "Для OpenAI задайте переменную MODEL — название модели, например ту, что стоит в вашем ChatGPT." });
    return;
  }
  if (typeof message !== "string" || !message.trim()) {
    res.status(400).json({ error: "Пустое сообщение." });
    return;
  }

  let system;
  if (typeof prompt === "string" && prompt.trim()) {
    system = prompt.trim();
  } else {
    system = await fs.readFile(path.join(process.cwd(), "prompt.md"), "utf8");
  }

  if (useOpenAI) {
    await viaOpenAI({ system, message, image, res });
    return;
  }

  const content = [];
  if (image && typeof image.data === "string" && image.data) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: image.media_type || "image/jpeg", data: image.data },
    });
  }
  content.push({ type: "text", text: message });

  const body = {
    model: process.env.MODEL || "claude-sonnet-5-5",
    max_tokens: 4000,
    // Промпт кэшируется на стороне API: повторные разборы дешевле и быстрее.
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
  };
  if (process.env.TEMPERATURE !== undefined && process.env.TEMPERATURE !== "") {
    body.temperature = Number(process.env.TEMPERATURE);
  }

  const started = Date.now();
  let r, data;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    data = await r.json();
  } catch (e) {
    res.status(502).json({ error: "Не удалось связаться с Claude API: " + (e?.message || e) });
    return;
  }

  if (!r.ok) {
    res.status(502).json({ error: "Claude API: " + (data?.error?.message || r.status) });
    return;
  }

  const raw = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
  finish(res, raw, { model: data.model, seconds: Math.round((Date.now() - started) / 1000), usage: data.usage, stop_reason: data.stop_reason });
}

// Модель вернула JSON → собираем текст из готовых фраз.
function finish(res, raw, meta) {
  const j = parseModelJson(raw);
  if (!j) {
    res.status(502).json({ error: "Модель вернула не JSON. Попробуйте ещё раз. Начало ответа: " + String(raw).slice(0, 300) });
    return;
  }
  res.status(200).json({ text: compose(j), json: j, ...meta });
}

// OpenAI (тот же GPT, что в ChatGPT): включается, если задан OPENAI_API_KEY.
async function viaOpenAI({ system, message, image, res }) {
  const userContent = [{ type: "text", text: message }];
  if (image && typeof image.data === "string" && image.data) {
    userContent.push({ type: "image_url", image_url: { url: `data:${image.media_type || "image/jpeg"};base64,${image.data}` } });
  }
  const body = {
    model: process.env.MODEL,
    max_completion_tokens: 16000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: userContent },
    ],
  };
  if (process.env.TEMPERATURE !== undefined && process.env.TEMPERATURE !== "") {
    body.temperature = Number(process.env.TEMPERATURE);
  }

  const started = Date.now();
  let r, data;
  try {
    r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: "Bearer " + process.env.OPENAI_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    data = await r.json();
  } catch (e) {
    res.status(502).json({ error: "Не удалось связаться с OpenAI API: " + (e?.message || e) });
    return;
  }
  if (!r.ok) {
    res.status(502).json({ error: "OpenAI API: " + (data?.error?.message || r.status) });
    return;
  }
  const choice = data.choices?.[0];
  finish(res, (choice?.message?.content || "").trim(), {
    model: data.model,
    seconds: Math.round((Date.now() - started) / 1000),
    usage: data.usage,
    stop_reason: choice?.finish_reason === "length" ? "max_tokens" : choice?.finish_reason,
  });
}
