import { OpenAI } from "openai";

// Nota: memoria volatile (reset ad ogni deploy/cold start)
let summaryMemory = "L'utente che chiede di Manuel è \"Non specificato\". Le domande fatte sono: . Le risposte sono: .";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function aggiornaRiassunto({ oldSummary, userMessage, aiResponse }){
  try{
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.1,
      max_tokens: 250,
      messages: [
        { role:"system", content:`
Aggiorna un breve riassunto della conversazione con il formato:

L'utente che chiede di Manuel è "[NOME REPARTO, RUOLO, AZIENDA, ecc.]" (o "Non specificato").
Le domande fatte sono: [elenco sintetico delle domande finora, senza duplicati].
Le risposte sono: [elenco sintetico delle risposte date dall’AI, senza duplicati, una frase per risposta].

Regole: aggiungi solo nuove voci, evita duplicati, massima sintesi.
`},
        { role:"user", content:`RIASSUNTO ATTUALE:\n${oldSummary}\n\nNUOVA DOMANDA UTENTE:\n${userMessage}\n\nNUOVA RISPOSTA AI:\n${aiResponse}` }
      ]
    });
    return (completion.choices?.[0]?.message?.content || oldSummary).trim();
  }catch(e){
    console.error("Errore aggiornaRiassunto:", e);
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

  try{
    const { message: userMessage } = JSON.parse(event.body || "{}");
    if (!userMessage || typeof userMessage !== "string"){
      return { statusCode: 400, body: JSON.stringify({ reply: "Messaggio non valido." }) };
    }

    // 1) Crea thread
    const thread = await openai.beta.threads.create();

    // 2) Invia contesto (riassunto) + messaggio utente
    await openai.beta.threads.messages.create(thread.id, { role:"user", content:`[CONTESTO RIASSUNTO]: ${summaryMemory}` });
    await openai.beta.threads.messages.create(thread.id, { role:"user", content: userMessage });

    // 3) Avvia run
    const run = await openai.beta.threads.runs.create(thread.id, { assistant_id: process.env.OPENAI_ASSISTANT_ID });

    // 4) Poll robusto con backoff fino a ~55s
    const startedAt = Date.now();
    let status = "queued";
    while(true){
      const elapsed = Date.now() - startedAt;
      if (elapsed > 55000) throw new Error("Timeout risposta AI.");

      const current = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      status = current.status;

      if (status === "completed") break;
      if (["failed","cancelled","expired"].includes(status)){
        throw new Error("Run " + status);
      }

      // gestisce anche "requires_action", "in_progress", "queued"
      await new Promise(r => setTimeout(r, Math.min(1500, 200 + Math.floor(elapsed/10))));
    }

    // 5) Estrai ultima risposta assistant
    const msgs = await openai.beta.threads.messages.list(thread.id, { limit: 20 });
    const lastAssistant = msgs.data.find(m => m.role === "assistant");
    const aiResponse = lastAssistant?.content?.[0]?.text?.value?.trim() || "Risposta non trovata.";

    // 6) Aggiorna memoria riassunto (best-effort)
    summaryMemory = await aggiornaRiassunto({ oldSummary: summaryMemory, userMessage, aiResponse });

    return { statusCode: 200, body: JSON.stringify({ reply: aiResponse }) };
  }catch(err){
    console.error("SERVER ERROR:", err);
    // Risposta gentile lato client senza alzare 5xx generici
    return { statusCode: 200, body: JSON.stringify({ reply: "Sto riscontrando rallentamenti temporanei: riprova tra qualche secondo." }) };
  }
}
