const { OpenAI } = require("openai");
// se stai usando "type":"module" in package.json:
// import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let summaryMemory = "Nessun contesto precedente.";

exports.handler = async function(event, context) {
  console.log(">>>> GPT Handler START");
  console.log("ENV OPENAI_API_KEY:", process.env.OPENAI_API_KEY ? "✓" : "✗");
  console.log("ENV OPENAI_ASSISTANT_ID:", process.env.OPENAI_ASSISTANT_ID ? "✓" : "✗");

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Metodo non consentito" };
  }
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_ASSISTANT_ID) {
    console.error("✖ Variabili ambiente mancanti!");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Manca OPENAI_API_KEY o OPENAI_ASSISTANT_ID" })
    };
  }

  // Boxing in Promise per streaming
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive"
    },
    body: (async function* () {
      try {
        const { message: userMessage } = JSON.parse(event.body);
        console.log("UserMessage:", userMessage);

        const thread = await openai.beta.threads.create();
        await openai.beta.threads.messages.create(thread.id, {
          role: "user",
          content: `[CONTESTO RIASSUNTO]: ${summaryMemory}`
        });
        await openai.beta.threads.messages.create(thread.id, {
          role: "user",
          content: userMessage
        });

        // Utilizziamo createAndStream per gestire gli eventi textDelta come negli esempi ufficiali
        const run = await openai.beta.threads.runs.create(thread.id, {
          assistant_id: process.env.OPENAI_ASSISTANT_ID,
          stream: true
        });

        run.on("error", err => console.error("Run ERROR event:", err));

        let final = "";
        for await (const eventStep of run) {
          // Supporto sia a .stream() che createAndStream()
          const content = eventStep.data?.delta?.content;
          console.log("➤ CHUNK DELTA:", JSON.stringify(eventStep.data));
          if (content) {
            final += content;
            yield `data: ${content}\n\n`;
          }
        }
        yield "data: [END]\n\n";
        console.log("Reply finished:", final);

        // se vuoi aggiornare il riassunto:
        // summaryMemory = await aggiornaRiassunto({ oldSummary: summaryMemory, userMessage, aiResponse: final });

      } catch (err) {
        console.error("STREAM HANDLER ERROR:", err);
        yield "data: [ERRORE]\n\n";
      }
    })()
  };
};
