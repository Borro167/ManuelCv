import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_ASSISTANT_ID) {
    return {
      statusCode: 500,
      body: "Manca una variabile di ambiente (OPENAI_API_KEY o OPENAI_ASSISTANT_ID).",
    };
  }

  try {
    const body = JSON.parse(event.body);
    const userMessage = body.message;
    let threadId = body.thread_id;

    // ✅ Se non esiste un threadId, creane uno nuovo
    if (!threadId) {
      const thread = await openai.beta.threads.create();
      threadId = thread.id;
    }

    // Inserisci il messaggio dell'utente nella stessa thread
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: userMessage,
    });

    // Esegui la run dell'assistente
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
    });

    // Polling per ottenere la risposta
    let runStatus;
    let attempts = 0;
    do {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      runStatus = await openai.beta.threads.runs.retrieve(threadId, run.id);
      attempts++;
      if (attempts > 20) {
        throw new Error("Timeout nella risposta dell'assistente.");
      }
    } while (runStatus.status === "in_progress");

    if (runStatus.status !== "completed") {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Errore durante l'esecuzione della run." }),
      };
    }

    // Recupera i messaggi finali
    const messages = await openai.beta.threads.messages.list(threadId);
    const assistantMessage = messages.data[0].content[0].text.value;

    return {
      statusCode: 200,
      body: JSON.stringify({ reply: assistantMessage, thread_id: threadId }),
    };
  } catch (error) {
    return { statusCode: 500, body: "Errore: " + error.message };
  }
}
