const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
let summaryMemory = "Nessun contesto precedente.";

exports.handler = async function(event, context) {
  console.log(">>>> GPT Handler START");
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Metodo non consentito" };
  }
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_ASSISTANT_ID) {
    console.error("✖ env mancanti");
    return { statusCode: 500, body: "Missing API_KEY or ASSISTANT_ID." };
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
    body: (async function* () {
      try {
        const { message: userMessage } = JSON.parse(event.body);
        console.log("UserMessage:", userMessage);

        const thread = await openai.beta.threads.create();
        await openai.beta.threads.messages.create(thread.id, {
          role: "user",
          content: `[CONTESTO RIASSUNTO]: ${summaryMemory}`,
        });
        await openai.beta.threads.messages.create(thread.id, {
          role: "user",
          content: userMessage,
        });

        const run = await openai.beta.threads.runs.create(thread.id, {
          assistant_id: process.env.OPENAI_ASSISTANT_ID,
          stream: true,
        });

        let finalText = "";
        for await (const chunk of run) {
          const content = chunk.data?.delta?.content;
          console.log("➤ CHUNK =", content ? JSON.stringify(content) : "[no content]");
          if (content) {
            finalText += content;
            yield `data: ${content}\n\n`;
          }
        }

        yield "data: [END]\n\n";
        console.log("Reply COMPLETE:", finalText);

      } catch (err) {
        console.error("🚨 STREAM ERROR:", err);
        yield "data: [ERRORE]\n\n";
      }
    })(),
  };
};
