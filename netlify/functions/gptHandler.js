import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Variabile di memoria sintetica (in produzione usa DB/session!)
let summaryMemory = "Nessun contesto precedente.";

// Funzione per aggiornare il riassunto della chat
async function aggiornaRiassunto({ oldSummary, userMessage, aiResponse }) {
  const thread = await openai.beta.threads.create();
  await openai.beta.threads.messages.create(thread.id, {
    role: "system",
    content: "Sei un assistente che aggiorna il riassunto di una conversazione.",
  });
  await openai.beta.threads.messages.create(thread.id, {
    role: "user",
    content: `
Ecco il riassunto precedente: ${oldSummary}
Nuovo messaggio utente: ${userMessage}
Risposta AI: ${aiResponse}

Aggiorna il riassunto in massimo 200 parole, mantenendo solo le informazioni importanti e utili per ricordare la conversazione.`,
  });
  const run = await openai.beta.threads.runs.create(thread.id, {
    assistant_id: process.env.OPENAI_ASSISTANT_ID,
  });

  let completed;
  let attempts = 0;
  do {
    await new Promise(res => setTimeout(res, 1200));
    completed = await openai.beta.threads.runs.retrieve(thread.id, run.id);
    attempts++;
    if (attempts > 10) throw new Error("Timeout aggiornamento riassunto.");
  } while (completed.status !== "completed");

  const messages = await openai.beta.threads.messages.list(thread.id);
  const assistantMsg = messages.data.reverse().find(m => m.role === "assistant");
  return assistantMsg?.content?.[0]?.text?.value || oldSummary;
}

// Handler principale
export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_ASSISTANT_ID) {
    return { statusCode: 500, body: "Manca una variabile di ambiente." };
  }
  try {
    const body = JSON.parse(event.body);
    const userMessage = body.message;

    // 1. Crea una thread e invia riassunto come "system"
    const thread = await openai.beta.threads.create();
    await openai.beta.threads.messages.create(thread.id, {
      role: "system",
      content: `Memoria sintetica (non visibile all'utente): ${summaryMemory}`,
    });
    // 2. Invia messaggio utente
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userMessage,
    });

    // 3. Run
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
    });

    // 4. Polling
    let completedRun;
    let attempts = 0;
    do {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      completedRun = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      attempts++;
      if (attempts > 15) throw new Error("Timeout risposta AI.");
    } while (completedRun.status !== "completed");

    // 5. Ottieni risposta AI
    const messages = await openai.beta.threads.messages.list(thread.id);
    const assistantMsg = messages.data.reverse().find(m => m.role === "assistant");
    const aiResponse = assistantMsg?.content?.[0]?.text?.value || "Risposta non trovata.";

    // 6. Aggiorna il riassunto in background (ma aspetta prima di rispondere)
    summaryMemory = await aggiornaRiassunto({
      oldSummary: summaryMemory,
      userMessage,
      aiResponse,
    });

    // 7. Rispondi all'utente (senza mostrare il riassunto)
    return {
      statusCode: 200,
      body: JSON.stringify({ reply: aiResponse }),
    };
  } catch (err) {
    console.error(err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Errore interno nel server: " + (err.message || "Unknown") }),
    };
  }
}
