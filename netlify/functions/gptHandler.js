import { OpenAI } from "openai";

// Memoria globale locale. In produzione va sostituita con DB.
let summaryMemory = "Nessun contesto precedente.";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Aggiornamento riassunto in parallelo
async function aggiornaRiassunto({ oldSummary, userMessage, aiResponse }) {
  try {
    const thread = await openai.beta.threads.create();
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: "Sei un assistente che aggiorna il riassunto di una conversazione.",
    });
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `
RIASSUNTO PRECEDENTE: ${oldSummary}
NUOVO MESSAGGIO UTENTE: ${userMessage}
RISPOSTA AI: ${aiResponse}

Riscrivi il riassunto in massimo 200 parole, tenendo solo le informazioni importanti per ricordare la conversazione.`,
    });
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
    });

    let completed;
    let attempts = 0;
    do {
      await new Promise(res => setTimeout(res, 300));
      completed = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      attempts++;
      if (attempts > 10) throw new Error("Timeout aggiornamento riassunto.");
    } while (completed.status !== "completed");

    const messages = await openai.beta.threads.messages.list(thread.id);
    const assistantMsg = messages.data.reverse().find(m => m.role === "assistant");
    return assistantMsg?.content?.[0]?.text?.value || oldSummary;
  } catch (err) {
    console.error("Errore aggiornaRiassunto:", err);
    return oldSummary;
  }
}

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

    // 1. Crea una nuova thread
    const thread = await openai.beta.threads.create();

    // 2. Invia il riassunto come messaggio di contesto
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `[CONTESTO RIASSUNTO]: ${summaryMemory}`,
    });

    // 3. Invia il vero messaggio dell'utente
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userMessage,
    });

    // 4. Run assistant
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
    });

    // 5. Polling più rapido
    let completedRun;
    let attempts = 0;
    do {
      await new Promise((resolve) => setTimeout(resolve, 300));
      completedRun = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      attempts++;
      if (attempts > 10) throw new Error("Timeout risposta AI.");
    } while (completedRun.status !== "completed");

    // 6. Ottieni risposta AI
    const messages = await openai.beta.threads.messages.list(thread.id);
    const assistantMsg = messages.data.reverse().find(m => m.role === "assistant");
    const aiResponse = assistantMsg?.content?.[0]?.text?.value || "Risposta non trovata.";

    // 7. Aggiorna il riassunto in background (non blocca la risposta)
    aggiornaRiassunto({
      oldSummary: summaryMemory,
      userMessage,
      aiResponse,
    }).then(newSummary => { summaryMemory = newSummary; }).catch(console.error);

    // 8. Rispondi all'utente
    return {
      statusCode: 200,
      body: JSON.stringify({ reply: aiResponse }),
    };
  } catch (err) {
    console.error("SERVER ERROR:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Errore interno nel server: " + (err.message || "Unknown") }),
    };
  }
}
