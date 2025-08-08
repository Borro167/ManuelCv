import { OpenAI } from "openai";

// Volatile (non persiste tra invocazioni)
let summaryMemory = "L'utente che chiede di Manuel è \"Non specificato\". Le domande fatte sono: . Le risposte sono: .";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Mini-riassunto conversazione
async function aggiornaRiassuntoConGPT3({ oldSummary, userMessage, aiResponse }) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      temperature: 0.1,
      max_tokens: 300,
      messages: [
        { role: "system", content: `
Il tuo compito è AGGIORNARE un breve riassunto della conversazione secondo questo formato fisso:

L'utente che chiede di Manuel è "[NOME REPARTO, RUOLO, AZIENDA, ecc.]" (anche dedotto dal contesto, oppure scrivi "Non specificato" se non emerge).
Le domande fatte sono: [elenco sintetico delle domande finora, senza duplicati].
Le risposte sono: [elenco sintetico delle risposte date dall’AI, senza duplicati, una frase per risposta].

IMPORTANTE:
- Aggiungi solo nuove voci, niente duplicati.
- Tono sintetico.
`},
        { role: "user", content: `
RIASSUNTO ATTUALE:
${oldSummary}

NUOVA DOMANDA UTENTE:
${userMessage}

NUOVA RISPOSTA AI:
${aiResponse}

Aggiorna solo se emergono nuove informazioni.`}
      ],
    });
    return completion.choices[0].message.content.trim();
  } catch {
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
    const body = JSON.parse(event.body || "{}");
    const userMessage = body.message;
    if (!userMessage || typeof userMessage !== "string") {
      return { statusCode: 400, body: "Richiesta non valida." };
    }

    // 1) Thread nuovo
    const thread = await openai.beta.threads.create();

    // 2) Contesto sintetico
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: `[CONTESTO RIASSUNTO]: ${summaryMemory}`,
    });

    // 3) Messaggio utente
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userMessage,
    });

    // 4) Run assistant
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
    });

    // 5) Polling semplice (≈6s)
    let completedRun;
    let attempts = 0;
    const maxAttempts = 20; // 20 x 300ms ≈ 6s
    do {
      await new Promise((r) => setTimeout(r, 300));
      completedRun = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      if (++attempts > maxAttempts) throw new Error("Timeout risposta AI.");
      if (["failed","cancelled","expired"].includes(completedRun.status)) {
        throw new Error(`Run ${completedRun.status}`);
      }
    } while (completedRun.status !== "completed");

    // 6) Leggi risposta AI
    const msgs = await openai.beta.threads.messages.list(thread.id);
    const assistantMsg = msgs.data.reverse().find(m => m.role === "assistant");
    const aiResponse = assistantMsg?.content?.[0]?.text?.value || "Risposta non trovata.";

    // 7) Aggiorna mini-memoria
    summaryMemory = await aggiornaRiassuntoConGPT3({ oldSummary: summaryMemory, userMessage, aiResponse });

    // 8) Risposta
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: aiResponse }),
    };
  } catch (err) {
    console.error("SERVER ERROR:", err);
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: "Sto riscontrando rallentamenti temporanei: riprova tra qualche secondo, per favore." }),
    };
  }
}
