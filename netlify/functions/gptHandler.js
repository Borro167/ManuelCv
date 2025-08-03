import { OpenAI } from "openai";

// Memoria globale (solo per demo, NON persistente su Netlify production!)
let summaryMemory = "Nessun contesto precedente.";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Riassunto con GPT-3.5 Turbo, strutturato
async function aggiornaRiassuntoConGPT3({ oldSummary, userMessage, aiResponse }) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `Aggiorna la memoria conversazionale in modo strutturato.
Scrivi sempre:
- Domande fatte (elenco di tutte le domande dell’utente fino ad ora)
- Risposte date (elenco delle risposte fornite dall'AI fino ad ora)
- Informazioni scambiate rilevanti riguardo il ruolo dell’assistente (ad esempio capacità, limiti, richieste speciali fatte dall’utente)

Organizza il riassunto come in un report, aggiorna e integra SOLO con le nuove informazioni di questa interazione, mantenendo lo storico dei punti precedenti. Non ripetere contenuti già inclusi nel riassunto attuale.`
        },
        {
          role: "user",
          content: `
RIASSUNTO ATTUALE:
${oldSummary}

NUOVA DOMANDA UTENTE:
${userMessage}

NUOVA RISPOSTA AI:
${aiResponse}

Aggiorna le tre sezioni mantenendo tutte le informazioni passate e aggiungi solo quelle nuove:`
        }
      ],
      temperature: 0.2,
      max_tokens: 700,
    });
    return completion.choices[0].message.content.trim();
  } catch (err) {
    console.error("Errore aggiornaRiassuntoConGPT3:", err);
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

    // 1. Crea una nuova thread Assistant (per la risposta AI)
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

    // 5. Polling aumentato (max 7,5 sec)
    let completedRun;
    let attempts = 0;
    const maxAttempts = 25; // 25 x 300ms = 7,5 secondi

    do {
      await new Promise((resolve) => setTimeout(resolve, 300));
      completedRun = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      attempts++;
      if (attempts > maxAttempts) throw new Error("Timeout risposta AI.");
    } while (completedRun.status !== "completed");

    // 6. Ottieni risposta AI
    const messages = await openai.beta.threads.messages.list(thread.id);
    const assistantMsg = messages.data.reverse().find(m => m.role === "assistant");
    const aiResponse = assistantMsg?.content?.[0]?.text?.value || "Risposta non trovata.";

    // 7. Aggiorna riassunto in modo BLOCCANTE, PRIMA di rispondere all’utente
    summaryMemory = await aggiornaRiassuntoConGPT3({
      oldSummary: summaryMemory,
      userMessage,
      aiResponse,
    });

    // 8. Rispondi all'utente (riassunto già aggiornato per il prossimo prompt)
    return {
      statusCode: 200,
      body: JSON.stringify({ reply: aiResponse }),
    };
  } catch (err) {
    console.error("SERVER ERROR:", err);
    // Fallback: rispondi comunque, l’utente non resta bloccato
    return {
      statusCode: 200,
      body: JSON.stringify({ reply: "Sto riscontrando rallentamenti temporanei: riprova tra qualche secondo, per favore." }),
    };
  }
}
