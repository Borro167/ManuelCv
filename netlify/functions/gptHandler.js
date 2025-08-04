import { OpenAI } from "openai";

// Memoria globale (volatile, non persistente su Netlify Production)
let summaryMemory = "L'utente che chiede di Manuel è \"Non specificato\". Le domande fatte sono: . Le risposte sono: .";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Funzione per aggiornare il riassunto in modo compatto secondo formato richiesto
async function aggiornaRiassuntoConGPT3({ oldSummary, userMessage, aiResponse }) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `
Il tuo compito è AGGIORNARE un breve riassunto della conversazione secondo questo formato fisso:

L'utente che chiede di Manuel è "[NOME REPARTO, RUOLO, AZIENDA, ecc.]" (anche dedotto dal contesto, oppure scrivi "Non specificato" se non emerge).
Le domande fatte sono: [elenco sintetico delle domande finora, senza duplicati].
Le risposte sono: [elenco sintetico delle risposte date dall’AI, senza duplicati, una frase per risposta].

IMPORTANTE:
- Aggiorna la lista aggiungendo solo le nuove domande o risposte (evita duplicati).
- NON ripetere cose già incluse.
- Sintetizza ogni domanda/risposta in poche parole.
- Mantieni SEMPRE il formato sopra, breve e chiaro.

Esempio:
L'utente che chiede di Manuel è "HR".
Le domande fatte sono: "Che competenze ha?", "Che progetti segue?"
Le risposte sono: "Manuel lavora su progetti di AI.", "Le sue competenze includono Python e prompt engineering."
`
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

Aggiorna solo se emergono nuove informazioni.`
        }
      ],
      temperature: 0.1,
      max_tokens: 300,
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

    // 5. Polling più rapido (fino a 5 secondi circa)
    let completedRun;
    let attempts = 0;
    const maxAttempts = 16; // 16 x 300ms ≈ 5s

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

    // 7. Aggiorna riassunto (reparto + domande + risposte)
    summaryMemory = await aggiornaRiassuntoConGPT3({
      oldSummary: summaryMemory,
      userMessage,
      aiResponse,
    });

    // 8. Rispondi all'utente
    return {
      statusCode: 200,
      body: JSON.stringify({ reply: aiResponse }),
    };
  } catch (err) {
    console.error("SERVER ERROR:", err);
    return {
      statusCode: 200,
      body: JSON.stringify({ reply: "Sto riscontrando rallentamenti temporanei: riprova tra qualche secondo, per favore." }),
    };
  }
}
