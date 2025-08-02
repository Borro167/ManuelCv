import { OpenAI } from "openai";

// Memoria globale semplice (meglio con DB se multi-utente)
let summaryMemory = "Nessun contesto precedente.";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async function(event, context) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_ASSISTANT_ID) {
    return { statusCode: 500, body: "Manca una variabile di ambiente." };
  }

  // Netlify permette lo streaming restituendo un async iterator come body!
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
    body: streamResponse(event),
  };
};

async function* streamResponse(event) {
  try {
    const body = JSON.parse(event.body);
    const userMessage = body.message;

    // Crea thread
    const thread = await openai.beta.threads.create();

    // Invia il riassunto
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `[CONTESTO RIASSUNTO]: ${summaryMemory}`,
    });

    // Invia messaggio utente
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userMessage,
    });

    // Streaming Assistants API v2
    const stream = openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
      stream: true,
    });

    let finalReply = '';

    for await (const chunk of stream) {
      const content = chunk.data?.delta?.content;
      if (content) {
        const text = typeof content === "string" ? content : content[0]?.text?.value;
        if (text) {
          finalReply += text;
          yield `data: ${text}\n\n`;
        }
      }
    }
    yield "data: [END]\n\n";

    // (OPZIONALE) aggiorna riassunto in background qui, se vuoi.
    // summaryMemory = await aggiornaRiassunto({ oldSummary: summaryMemory, userMessage, aiResponse: finalReply });

  } catch (err) {
    yield "data: [ERRORE]\n\n";
  }
}
