// gptHandler.js
// Versione aggiornata con salvataggio reparto e gestione memoria base

import OpenAI from "openai";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Variabile per memorizzare il reparto dell'utente
let userDepartment = null;

export async function handleMessage(userInput) {
  // Controlla se il reparto non è ancora stato salvato
  if (!userDepartment) {
    // Normalizza l'input utente
    const lowerInput = userInput.trim().toLowerCase();

    // Possibili modi di scrivere HR
    const deptKeywords = ["hr", "risorse umane", "human resources"];

    if (deptKeywords.includes(lowerInput)) {
      userDepartment = "Risorse Umane";
      return "Perfetto, reparto salvato! Vuoi sapere qualcosa su Manuel?";
    } else {
      return "In quale reparto lavori?";
    }
  }

  // Se il reparto è già noto, includilo nel contesto e chiedi a OpenAI
  const messages = [
    {
      role: "system",
      content: `Sei l'assistente personale di Manuel. L'utente lavora nel reparto ${userDepartment}. Usa questo dato per rispondere alle domande.`,
    },
    {
      role: "user",
      content: userInput,
    },
  ];

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.8,
      max_tokens: 300,
    });

    return completion.choices[0].message.content;
  } catch (error) {
    console.error("Errore nella chiamata API:", error);
    return "Si è verificato un errore, riprova più tardi.";
  }
}
