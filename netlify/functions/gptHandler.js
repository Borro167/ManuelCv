import { OpenAI } from "openai";

// Funzione Netlify: inoltra ai Assistants
// - Assistant ID da OPENAI_ASSISTANT_ID
// - Usa `behavior` come additional_instructions
// - Pre-inietta `[SINTESI CONVERSAZIONE]` se ricevuta da client
// - Thread persistente, CORS, timeout

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function handler(event) {
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

    const behavior = (body.behavior || "").toString();  // istruzioni runtime (tono)
    const tone = (body.tone || "").toString();          // opzionale (telemetria)
    const summary = (body.summary || "").toString();    // sintesi chat dal client

    if (!userText) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: "message vuoto" }) };
    }

    // 1) Thread
    if (!threadId) {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
    }

    // 2) Inietta sintesi come messaggio utente (contestualizzazione leggera, mai file/fonte)
    if (summary) {
      await openai.beta.threads.messages.create(threadId, {
        role: "user",
        content: `[SINTESI CONVERSAZIONE]: ${summary}`
      });
    }

    // 3) Messaggio utente
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: userText,
      metadata: tone ? { tone } : undefined
    });

    // 4) Run
    let run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
      additional_instructions: behavior || undefined
    });

    // 5) Poll fino a 55s
    const start = Date.now();
    const timeoutMs = 55000;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    while (["queued","in_progress","requires_action","cancelling"].includes(run.status)) {
      if (Date.now() - start > timeoutMs) throw new Error("Timeout run");
      await sleep(1000);
      run = await openai.beta.threads.runs.retrieve(threadId, run.id);
    }

    // 6) Estrai risposta
    const list = await openai.beta.threads.messages.list(threadId, { limit: 10, order: "desc" });
    const assistantMsg = list.data.find(m => m.role === "assistant");
    const reply =
      assistantMsg?.content?.find?.(c => c.type === "text")?.text?.value
      || `Run terminata con stato: ${run.status}`;

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
