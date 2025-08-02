const { OpenAI } = require("openai");
let summaryMemory = "Nessun contesto precedente.";
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async function(event, context) {
  console.log(">>>> gptHandler STARTED <<<<");
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_ASSISTANT_ID) {
    console.error("Missing env!");
    return { statusCode: 500, body: "Missing API key or assistant ID." };
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
    body: (async function* () {
      try {
        const { message: userMessage } = JSON.parse(event.body);
        console.log("User message:", userMessage);

        const thread = await openai.beta.threads.create();

        await openai.beta.threads.messages.create(thread.id, {
          role: "user",
          content: `[CONTESTO RIASSUNTO]: ${summaryMemory}`
        });
        await openai.beta.threads.messages.create(thread.id, {
          role: "user",
          content: userMessage
        });

        const stream = await openai.beta.threads.runs.create(thread.id, {
          assistant_id: process.env.OPENAI_ASSISTANT_ID,
          stream: true
        });

        let finalReply = '';
        for await (const event of stream) {
          console.log("CHUNK EVENT:", JSON.stringify(event));
          const content = event.data?.delta?.content;
          if (content) {
            const text = typeof content === "string"
              ? content
              : content[0]?.text?.value;
            if (text) {
              finalReply += text;
              yield `data: ${text}\n\n`;
            }
          }
        }
        yield "data: [END]\n\n";
      } catch (err) {
        console.error("STREAM ERROR:", err);
        yield "data: [ERRORE]\n\n";
      }
    })()
  };
};
