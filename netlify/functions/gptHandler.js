const { OpenAI } = require("openai");

let summaryMemory = "Nessun contesto precedente.";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async function(event, context) {
  console.log(">>>> gptHandler STARTED <<<<");
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_ASSISTANT_ID) {
    console.error("Manca variabile ambiente!");
    return { statusCode: 500, body: "Manca una variabile di ambiente." };
  }

  try {
    const body = JSON.parse(event.body);
    const userMessage = body.message;
    console.log("Ricevuto messaggio:", userMessage);

    // Crea thread
    const thread = await openai.beta.threads.create();

    // Invia il riassunto come primo messaggio
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `[CONTESTO RIASSUNTO]: ${summaryMemory}`,
    });

    // Invia il messaggio vero dell'utente
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userMessage,
    });

    // STREAMING Assistants API v2
    const stream = openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
      stream: true,
    });

    // Ritorna lo stream come async iterator SSE (Server Sent Events)
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
      body: (async function* () {
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
      })(),
    };

  } catch (err) {
    console.error("SERVER ERROR:", err);
    return {
      statusCode: 500,
      body: "data: [ERRORE]\n\n",
      headers: { "Content-Type": "text/event-stream" }
    };
  }
};
