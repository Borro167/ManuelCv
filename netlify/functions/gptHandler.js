// Web Runtime-style: restituiamo una Response con ReadableStream
import OpenAI from "openai";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "x-thread-id"
};

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async (req) => {
  if (req.method === "OPTIONS") return new Response("", { status: 200, headers: CORS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { ...CORS, "Content-Type": "application/json" }
    });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY mancante" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }
    if (!process.env.OPENAI_ASSISTANT_ID) {
      return new Response(JSON.stringify({ error: "OPENAI_ASSISTANT_ID mancante" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    const { message, threadId: incomingThreadId, behavior, summary } = await req.json();
    const userText = String(message || "").trim();
    if (!userText) {
      return new Response(JSON.stringify({ error: "message vuoto" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" }
      });
    }

    // crea/recupera thread
    let threadId = (incomingThreadId || "").toString() || null;
    if (!threadId) {
      const thread = await client.beta.threads.create();
      threadId = thread.id;
    }

    if (summary) {
      await client.beta.threads.messages.create(threadId, {
        role: "user",
        content: `[SINTESI]\n${summary}`
      });
    }

    await client.beta.threads.messages.create(threadId, { role: "user", content: userText });

    // Avvia run con streaming eventi
    const runStream = await client.beta.threads.runs.create(threadId, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
      additional_instructions:
        behavior || "Parla chiaro e sintetico. Evita link/citazioni visibili.",
      stream: true
    });

    // rispondiamo con lo stream degli eventi (il client filtra solo il testo)
    const headers = {
      ...CORS,
      // event-stream per favorire il proxying corretto
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "x-thread-id": threadId
    };

    return new Response(runStream.toReadableStream(), { status: 200, headers });
  } catch (err) {
    console.error("SERVER ERROR:", err);
    return new Response(
      JSON.stringify({ reply: "Errore temporaneo. Riprova tra poco.", error: String(err?.message || err) }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
};
