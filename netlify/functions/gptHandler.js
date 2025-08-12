import OpenAI from "openai";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Expose-Headers": "x-thread-id"
};

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: CORS, body: "" };
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  if (!process.env.OPENAI_API_KEY)  return { statusCode: 500, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: "OPENAI_API_KEY mancante" }) };
  if (!process.env.OPENAI_ASSISTANT_ID) return { statusCode: 500, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: "OPENAI_ASSISTANT_ID mancante" }) };

  const { message, threadId: incomingThreadId, behavior } = JSON.parse(event.body || "{}");
  const userText = String(message || "").trim();
  if (!userText) return { statusCode: 400, headers: { ...CORS, "Content-Type": "application/json" }, body: JSON.stringify({ error: "message vuoto" }) };

  let threadId = (incomingThreadId || "").toString() || null;
  if (!threadId) {
    const thread = await client.beta.threads.create();
    threadId = thread.id;
  }

  await client.beta.threads.messages.create(threadId, { role: "user", content: userText });

  await client.beta.threads.runs.createAndPoll(threadId, {
    assistant_id: process.env.OPENAI_ASSISTANT_ID,
    additional_instructions: behavior || "Rispondi chiaro e sintetico."
  });

  const msgs = await client.beta.threads.messages.list(threadId, { order: "desc", limit: 1 });
  const reply = (msgs.data[0]?.content || [])
    .filter(p => p.type === "text")
    .map(p => p.text.value)
    .join("\\n") || "Nessuna risposta.";

  return {
    statusCode: 200,
    headers: { ...CORS, "Content-Type": "application/json", "x-thread-id": threadId },
    body: JSON.stringify({ reply })
  };
};
