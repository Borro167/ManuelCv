import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_ASSISTANT_ID) {
    return { statusCode: 500, body: "Manca una variabile di ambiente (OPENAI_API_KEY o OPENAI_ASSISTANT_ID)." };
  }

  try {
    const body = JSON.parse(event.body);
    const userMessage = body.message;

    // 1. Crea una thread
    const thread = await openai.beta.threads.create();

    // 2. Inserisci il messaggio dell'utente nella thread
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userMessage,
    });

    // 3. Esegui la "run" dell'assistente con il suo ID
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
    });

    // 4. Polling: aspetta che il run sia completo
    let completedRun;
    let attempts = 0;
    do {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      completedRun = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      attempts++;
      if (attempts > 15) throw new Error("Timeout risposta AI.");
    } while (completedRun.status !== "completed");

    // 5. Ottieni il messaggio dell'assistente dalla thread
    const messages = await openai.beta.threads.messages.list(thread.id);
    // Prendi l’ultimo messaggio di tipo “assistant”
    const assistantMsg = messages.data.reverse().find(m => m.role === "assistant");

    return {
      statusCode: 200,
      body: JSON.stringify({ reply: assistantMsg?.content?.[0]?.text?.value || "Risposta non trovata." }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Errore interno nel server: " + (err.message || "Unknown") }),
    };
  }
}
