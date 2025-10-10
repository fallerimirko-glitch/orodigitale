import { DOCUMENT_CONTEXT } from '../constants';
import { Message } from '../types';

const buildPrompt = (question: string, history: Message[]) => {
  const historyText = history
    .map(m => `${m.sender === 'user' ? 'UTENTE' : 'FLEXI'}: ${m.text}`)
    .join('\n');

  return `Sei Flexi, l'assistente Al di Digital Force, esperto in mining Bitcoin e servizi finanziari.
---
DOCUMENTAZIONE AZIENDALE:
${DOCUMENT_CONTEXT}
---
RUOLO: Assistente commerciale professionale ma amichevole
OBIETTIVO: Informare sui servizi, guidare verso l'acquisto, enfatizzare vantaggi fiscali

STILE DI RISPOSTA:
- Professionale ma accessibile
- Usa emoji quando appropriato (✅, ➡️, 👍)
- Risposte concise (max 150 parole)
- Sempre concludi con una domanda o call-to-action
- Non promettere mai guadagni certi
- Basa le tue risposte ESCLUSIVAMENTE sulla DOCUMENTAZIONE AZIENDALE fornita. Se un'informazione non è presente, rispondi educatamente che non possiedi quel dettaglio e suggerisci di contattare il supporto.

CRONOLOGIA CONVERSAZIONE:
${historyText}

DOMANDA UTENTE: ${question}

RISPOSTA (max 150 parole):`;
};

const getFallbackResponse = (message: string): string => {
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('prezzo') || lowerMessage.includes('costo')) {
    return "Ecco i nostri prodotti principali:\n• ASIC intero: €7.450 (€2.607 netti con detrazione)\n• ½ ASIC: €3.810 (€1.333 netti con detrazione)\n• ¼ ASIC: €1.966 (€688 netti con detrazione)\n• MAP a partire da €150.";
  }

  if (lowerMessage.includes('garanzia') || lowerMessage.includes('sicurezza')) {
    return "Le tue garanzie:\n✅ Piena proprietà legale\n✅ Contratto italiano\n✅ Certificazione BDO Italia\n✅ Diritto di recesso entro 14 giorni.";
  }
  
  return "Mi dispiace, sto avendo difficoltà tecniche. Puoi riformulare la domanda o contattarci direttamente per assistenza.";
};

let lastCallTime = 0;
const MIN_INTERVAL = 2000; // 2 seconds between calls

export const getBotResponse = async (question: string, history: Message[]): Promise<string> => {
  try {
    const now = Date.now();
    if (now - lastCallTime < MIN_INTERVAL) {
      await new Promise(resolve => setTimeout(resolve, MIN_INTERVAL - (now - lastCallTime)));
    }
    lastCallTime = Date.now();

    const prompt = buildPrompt(question, history);

    // Call the server-side endpoint which holds the API key and interacts with the Gemini API
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, history, prompt }),
    });

    if (!resp.ok) {
      console.error('Server returned error from /api/chat', await resp.text());
      return getFallbackResponse(question);
    }

    const data = await resp.json();
    // server returns { text }
    return data?.text || getFallbackResponse(question);
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    return getFallbackResponse(question);
  }
};