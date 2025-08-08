// netlify/functions/gptHandler.js
// Migliorato: thread persistenti, override istruzioni per-run, polling robusto, errori chiari
// Niente riassunto bloccante: più veloce e stabile su Netlify Free

import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

/**
 * Utility: attende ms
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll run status entro un budget di tempo (≈ 9s, compatibile con Netlify Free)
 */
async function waitForRunCompletion(threadId, runId, maxAttempts = 30, delayMs = 300) {
  let attempts = 0;
  while (attempts < maxAttempts) {
    const run = await openai.beta.threads.runs.retrieve(threadId, runId);

    if (run.status === "completed") return run;
    if (run.status === "requires_action") {
      // Non gestiamo tool-calls in questo flow minimal: termina con messaggio chiaro
      throw new Error("L'assistente richiede un'azione (tool). Disabilita tool o aggiorna il flow.");
    }
    if (["failed", "cancelled", "expired"].includes(run.status)) {
      throw new Error(`Run terminata con stato: ${run.status}`);
    }

    await sleep(delayMs);
    attempts++;
  }
  throw new Error("Timeout risposta AI (limite Netlify). Prova di nuovo.");
}

/**
 * Estrae l'ultimo messaggio dell'assistente in modo affidabile
 */
async function getLastAssistantMessage(threadId) {
  const list = await openai.beta.threads.messages.list(threadId, { order: "desc", limit: 10 });
  const msg = list.data.find((m) => m.role === "assistant");
  if (!msg) return null;

  // Supporto contenuti misti; qui estraiamo solo testo
  const part = msg.content.find((c) => c.type === "text");
  return part?.text?.value ?? null;
}

export async function handler(event) {
  if (!process.env.OPENAI_API_KEY || !ASSISTANT_ID) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Variabili ambiente mancanti: OPENAI_API_KEY/OPENAI_ASSISTANT_ID" }),
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const { action = "message", message, threadId, extraInstructions } = JSON.parse(event.body || "{}");

    if (action === "init") {
      const thread = await openai.beta.threads.create({
        // Puoi salvare contesto iniziale direttamente nel thread via metadata
        // metadata: { app: "manuel-chat", version: "v2" }
      });
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, threadId: thread.id }),
      };
    }

    if (action === "reset") {
      const thread = await openai.beta.threads.create();
      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, threadId: thread.id }),
      };
    }

    if (action === "message") {
      if (!message || typeof message !== "string") {
        return { statusCode: 400, body: JSON.stringify({ error: "Parametro 'message' mancante" }) };
      }

      // Se non c'è un thread, creane uno al volo
      let _threadId = threadId;
      if (!_threadId) {
        const thread = await openai.beta.threads.create();
        _threadId = thread.id;
      }

      // Aggiungi messaggio utente al thread
      await openai.beta.threads.messages.create(_threadId, {
        role: "user",
        content: message,
      });

      // Avvia run con assistant scelto; opzionale override istruzioni per-run
      const run = await openai.beta.threads.runs.create(_threadId, {
        assistant_id: ASSISTANT_ID,
        ...(extraInstructions ? { instructions: extraInstructions } : {}),
      });

      // Poll entro 9s
      await waitForRunCompletion(_threadId, run.id);

      // Recupera ultima risposta
      const text = await getLastAssistantMessage(_threadId);

      return {
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true, threadId: _threadId, reply: text ?? "(nessun testo)" }),
      };
    }

    return { statusCode: 400, body: JSON.stringify({ error: `Azione non supportata: ${action}` }) };
  } catch (err) {
    console.error("SERVER ERROR:", err);
    return {
      statusCode: 200, // evitiamo 5xx per non mostrare pagina Netlify error
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: false, error: String(err?.message || err) }),
    };
  }
}
