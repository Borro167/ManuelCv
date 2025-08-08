import { OpenAI } from "openai";

/** 
 * Netlify Function: gptHandler
 * - Supporta thread persistente: passa/ritorna threadId
 * - Migliore gestione errori e timeout
 * - Summarizer usa gpt-4o-mini (veloce/economico)
 */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

let summaryMemory = "L'utente che chiede di Manuel è \"Non specificato\". Le domande fatte sono: . Le risposte sono: .";

export async function handler(event) {
  // CORS basic (utile in dev)
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_ASSISTANT_ID) {
    return { statusCode: 500, body: JSON.stringify({ error: "Manca una variabile di ambiente (OPENAI_API_KEY o OPENAI_ASSISTANT_ID)." }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const userMessage = String(body.message || "").trim();
    const incomingThreadId = body.threadId || null;

    if (!userMessage) {
      return { statusCode: 400, body: JSON.stringify({ error: "Messaggio vuoto." }) };
    }

    // 1) Usa thread esistente oppure creane uno nuovo
    const threadId = incomingThreadId || (await openai.beta.threads.create()).id;

    // 2) Inietta il riassunto (memoria volatile) come contesto USER separato
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: `[CONTESTO RIASSUNTO]: ${summaryMemory}`,
    });

    // 3) Messaggio utente reale
    await openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: userMessage,
    });

    // 4) Avvia run
    const run = await openai.beta.threads.runs.create(threadId, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
    });

    // 5) Polling robusto (max ~30s)
    const start = Date.now();
    let status = "queued";
    while (!["completed", "failed", "cancelled", "expired", "requires_action"].includes(status)) {
      if (Date.now() - start > 30000) throw new Error("Timeout risposta AI.");
      await new Promise(r => setTimeout(r, 300));
      const r = await openai.beta.threads.runs.retrieve(threadId, run.id);
      status = r.status;
      if (status === "requires_action") break;
    }

    if (status !== "completed" && status !== "requires_action") {
      throw new Error(`Run non completato: ${status}`);
    }

    // 6) Estrai ultimo messaggio assistant
    const list = await openai.beta.threads.messages.list(threadId, { order: "desc", limit: 10 });
    const assistantMsg = list.data.find(m => m.role === "assistant");
    const aiResponse = assistantMsg?.content?.[0]?.text?.value || "Risposta non trovata.";

    // 7) Aggiorna riassunto con modello rapido
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `
Aggiorna un breve riassunto della conversazione secondo il formato:

L'utente che chiede di Manuel è "[NOME REPARTO/ RUOLO / AZIENDA]" (o "Non specificato").
Le domande fatte sono: [elenco sintetico].
Le risposte sono: [elenco sintetico].
- Aggiungi solo nuove info (niente duplicati), frasi cortissime.
`.trim()
          },
          {
            role: "user",
            content: `RIASSUNTO ATTUALE:\n${summaryMemory}\n\nNUOVA DOMANDA UTENTE:\n${userMessage}\n\nNUOVA RISPOSTA AI:\n${aiResponse}`
          }
        ],
        temperature: 0.1,
        max_tokens: 250
      });
      summaryMemory = completion.choices?.[0]?.message?.content?.trim() || summaryMemory;
    } catch (e) {
      // Non bloccare la reply se il riassunto fallisce
      console.error("Errore summarizer:", e.message);
    }

    // 8) Risposta
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: aiResponse, threadId })
    };
  } catch (err) {
    console.error("SERVER ERROR:", err);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply: "Sto riscontrando rallentamenti temporanei. Riprova tra qualche secondo.", error: err.message })
    };
  }
}