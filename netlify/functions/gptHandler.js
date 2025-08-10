// netlify/functions/gptHandler.js
import OpenAI from "openai";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// stessa pulizia lato server
function sanitizeReply(text){
  let s = String(text || "");

  // blocchi editoriali tipo 【...】 o 〔...〕
  s = s.replace(/[【〔][^】〕]*[】〕]/g, "");

  // [1], [1][2], [8:0+file.ext], [^1], [qualcosa.pdf|txt|...]
  s = s.replace(
    /(?:\s*`?\[(?:\^\w+|\d+(?::[^\]]+)?|[^\]]{1,120}\.(?:pdf|docx?|xlsx?|pptx?|txt|md|png|jpe?g|webp|svg))\]`?)+/gi,
    ""
  );

  // [testo](url) -> testo
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");

  // <http://...> -> rimuovi
  s = s.replace(/<https?:\/\/[^>\s]+>/gi, "");

  // backtick (inline + blocchi)
  s = s.replace(/`{1,3}([\s\S]*?)`{1,3}/g, "$1");

  // parentesi/brackets vuoti + spazi
  s = s.replace(/\s*[\(\[\{]\s*[\)\]\}]\s*/g, "");
  s = s.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1");

  return s.trim();
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function handler(event){
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "OPENAI_API_KEY mancante" }) };
    }
    if (!process.env.OPENAI_ASSISTANT_ID) {
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: "OPENAI_ASSISTANT_ID mancante" }) };
    }

    const body = JSON.parse(event.body || "{}");
    const userText = (body.message || "").toString().trim();
    let threadId = (body.threadId || "").toString() || null;

    const behavior = (body.behavior || "").toString();
    const tone = (body.tone || "").toString();
    const summary = (body.summary || "").toString(); // vuoto nel client

    if (!userText) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "message vuoto" }) };
    }

    // 1) Thread
    if (!threadId) {
      const thread = await client.beta.threads.create();
      threadId = thread.id;
    }

    // 2) (opzionale) sintesi
    if (summary) {
      await client.beta.threads.messages.create(threadId, {
        role: "user",
        content: `[SINTESI CONVERSAZIONE]\n${summary}`
      });
    }

    // 3) Messaggio utente
    await client.beta.threads.messages.create(threadId, { role: "user", content: userText });

    // 4) Run Assistants
    let run = await client.beta.threads.runs.create(threadId, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
      additional_instructions: behavior,
      metadata: { tone }
    });

    // 5) Poll (max ~55s per Netlify)
    const start = Date.now();
    const timeoutMs = 55000;
    while (["queued","in_progress","requires_action","cancelling"].includes(run.status)) {
      if (Date.now() - start > timeoutMs) throw new Error("Timeout run");
      await new Promise(r => setTimeout(r, 1000));
      run = await client.beta.threads.runs.retrieve(threadId, run.id);
    }

    // 6) Ultima risposta
    const list = await client.beta.threads.messages.list(threadId, { limit: 10, order: "desc" });
    const assistantMsg = list.data.find(m => m.role === "assistant");
    let reply = assistantMsg?.content?.find?.(c => c.type === "text")?.text?.value
      || `Run terminata con stato: ${run.status}`;

    reply = sanitizeReply(reply);

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ reply, threadId })
    };

  } catch (err) {
    console.error("SERVER ERROR:", err);
    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({
        reply: "Errore temporaneo dal server. Riprova tra qualche secondo.",
        error: String(err?.message || err)
      })
    };
  }
}
