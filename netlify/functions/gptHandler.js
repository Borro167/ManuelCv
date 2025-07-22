const { OpenAI } = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const body = JSON.parse(event.body);
    const userMessage = body.message;
    const threadId = body.thread_id; // thread_id passato dal frontend
    let thread;

    if (threadId) {
      // Se esiste già, usalo
      thread = { id: threadId };
    } else {
      // Se è la prima domanda, crea un thread nuovo
      thread = await openai.beta.threads.create();
    }

    // Inserisci il messaggio utente nel thread
    await openai.beta.threads.messages.create(thread.id, {
      role: "user",
      content: userMessage,
    });

    // Avvia la run sull’assistente
    const run = await openai.beta.threads.runs.create(thread.id, {
      assistant_id: process.env.OPENAI_ASSISTANT_ID,
    });

    // Attendi completamento della risposta
    let completedRun;
    while (true) {
      completedRun = await openai.beta.threads.runs.retrieve(thread.id, run.id);
      if (completedRun.status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Recupera l'ultimo messaggio assistant
    const messages = await openai.beta.threads.messages.list(thread.id);
    const assistantMessage = messages.data.reverse().find((msg) => msg.role === "assistant");

    return {
      statusCode: 200,
      body: JSON.stringify({
        reply: assistantMessage ? assistantMessage.content[0].text.value : "Nessuna risposta.",
        thread_id: thread.id // <-- restituisci sempre il thread id al frontend!
      }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ reply: "Errore nel backend: " + error.message }),
    };
  }
};
