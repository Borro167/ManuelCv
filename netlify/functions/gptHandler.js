import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
let summaryMemory = "Nessun contesto precedente.";

exports.handler = async function(event, context) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_ASSISTANT_ID) {
    return { statusCode: 500, body: "Manca una variabile di ambiente." };
  }

  // Serve il "res" Node puro, Netlify lo passa come secondo parametro se lanci così:
  // exports.handler = async (event, context, callback) => { ... }
  // oppure
  // exports.handler = (event, context, callback) => { ... }

  // Netlify Vite/Next/Express style streaming:
  return new Promise(async (resolve, reject) => {
    try {
      const body = JSON.parse(event.body);
      const userMessage = body.message;

      // Crea thread
      const thread = await openai.beta.threads.create();

      // Riassunto come contesto
      await openai.beta.threads.messages.create(thread.id, {
        role: "user",
        content: `[CONTESTO RIASSUNTO]: ${summaryMemory}`,
      });

      // Messaggio vero utente
      await openai.beta.threads.messages.create(thread.id, {
        role: "user",
        content: userMessage,
      });

      // STREAMING risposte
      const stream = openai.beta.threads.runs.create(
        thread.id,
        {
          assistant_id: process.env.OPENAI_ASSISTANT_ID,
          stream: true,
        }
      );

      // Preparazione streaming HTTP
      resolve({
        statusCode: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
        body: streamToString(stream),
        isBase64Encoded: false,
      });
    } catch (err) {
      console.error("SERVER ERROR:", err);
      resolve({
        statusCode: 500,
        body: JSON.stringify({ error: "Errore interno nel server: " + (err.message || "Unknown") }),
      });
    }
  });
};

// Trasforma l'async iterator dello stream OpenAI in stringa/event-stream
async function* streamToString(stream) {
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
}
