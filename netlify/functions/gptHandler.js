import OpenAI from "openai";

// CORS (utile anche in locale)
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  // per leggere l'header custom dal browser
  "Access-Control-Expose-Headers": "x-thread-id"
};

// ripulitura base (stesse regole, usata lato client)
function sanitizeInline(text) {
  let s = String(text || "");
  s = s.replace(/[【〔][^】〕]*[】〕]/g, "");
  s = s.replace(/(?:\s*`?\[(?:\^\w+|\d+(?::[^\]]+)?|[^\]]{1,120}\.(?:pdf|docx?|xlsx?|pptx?|txt|md|png|jpe?g|webp|svg))\]`?)+/gi, "");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
  s = s.replace(/<https?:\/\/[^>\s]+>/gi, "");
  s = s.replace(/`{1,3}([\s\S]*?)`{1,3}/g, "$1");
  s = s.replace(/\s*[\(\[\{]\s*[\)\]\}]\s*/g, "");
  s = s.replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1");
  return s.trimStart(); // non tronchiamo la fine durante lo stream
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Netlify Functions (runtime Web): default export -> Request, Context
export default async (req) => {
  // preflight
  if (req.method === "OPTIONS") {
    return new Response("", { status: 200, headers: CORS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" }
    });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY mancante" }), {
        status: 500,
        headers: { ...CORS, "Content-Type": "application/json" }
      });
    }
    if (!process.env.OPENAI_ASSISTANT_ID) {
      return new Response(JSON.stringify({ error: "OPENAI_ASSISTANT_ID mancante" }), {
        status: 500,
        headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    const { message, threadId: incomingThreadId, behavior, summary } = await req.json();
    const userText = String(message || "").trim();
    if (!userText) {
      return new Response(JSON.stringify({ error: "message vuoto" }), {
        status: 400,
        headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    // crea thread se assente
    let threadId = (incomingThreadId || "").toString() || null;
    if (!threadId) {
      const thread = await client.beta.threads.create();
      threadId = thread.id;
    }

    // scrivi eventuale sintesi/contensto
    if (summary) {
      await client.beta.threads.messages.create(threadId, {
        role: "user",
        content: `[SINTESI CONVERSAZIONE]\n${summary}`
      });
    }

    // messaggio utente
    await client.beta.threads.messages.create(threadId, {
      role: "user",
      content: userText
    });

    // AVVIO RUN IN STREAMING (Assistants API)
    // Nota: lo stream SDK espone eventi e anche toReadableStream()
    const runStream = await client.beta.threads.runs.create(threadId, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
      additional_instructions:
        behavior ||
        "Parla chiaro e sintetico. Non inventare dati. Evita link e citazioni visibili in chat.",
      stream: true
    });

    // Converte lo stream SDK in ReadableStream nativo e risponde subito.
    // L'header x-thread-id serve al client per salvare il thread.
    const resHeaders = {
      ...CORS,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "x-thread-id": threadId
    };

    // Se vuoi filtrare a monte i delta testuali,
    // puoi trasformare lo stream qui. Manteniamo passthrough per massima velocità.
    return new Response(runStream.toReadableStream(), { status: 200, headers: resHeaders });
  } catch (err) {
    console.error("SERVER ERROR:", err);
    // in errore, rispondi JSON (il client farà fallback)
    return new Response(
      JSON.stringify({
        reply: "Errore temporaneo dal server. Riprova tra qualche secondo.",
        error: String(err?.message || err)
      }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
}
