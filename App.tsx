import React, { useState, useRef, useEffect } from 'react';
import { Message } from './types';
import { getBotResponse } from './services/geminiService';
import LoadingIndicator from './components/LoadingIndicator';
import { SUGGESTED_QUESTIONS } from './constants';

// --- UTILITY & HELPER FUNCTIONS ---

const trackEvent = (eventName: string, properties: Record<string, any> = {}) => {
  console.log(`Analytics Event: ${eventName}`, properties);
  // In a real app, integrate with a service like Google Analytics, Mixpanel, etc.
};

const formatTime = (date: Date): string => {
  if (!date || isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim());
};

const validateName = (name: string): boolean => {
  return name.trim().length >= 2 && /^[a-zA-Z\s'-]+$/.test(name.trim());
};

// --- SVG COMPONENTS ---

const DigitalForceLogo: React.FC<{ size?: number, className?: string }> = ({ size = 60, className = '' }) => (
    <svg 
        viewBox="0 0 24 24" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg" 
        className={className}
        style={{width: size, height: size}}
        aria-label="Digital Force Logo"
        role="img"
    >
        <defs>
            <linearGradient id="logo-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#60a5fa" />
            </linearGradient>
        </defs>
        <path d="M12 2L4 6V12C4 17.5 7.6 22.8 12 24C16.4 22.8 20 17.5 20 12V6L12 2Z" fill="#1f2937" />
        <path d="M9 8H16V10H11V13H15V15H11V18H9V8Z" fill="url(#logo-gradient)" />
    </svg>
);

// --- UI COMPONENTS ---

const LeadForm: React.FC<{ onLeadSubmit: (name: string, email: string) => void }> = ({ onLeadSubmit }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState({ name: '', email: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const nameIsValid = validateName(name);
    const emailIsValid = validateEmail(email);

    setErrors({
      name: nameIsValid ? '' : 'Inserisci un nome valido (almeno 2 caratteri).',
      email: emailIsValid ? '' : 'Inserisci un indirizzo email valido.',
    });

    if (nameIsValid && emailIsValid) {
      setIsSubmitting(true);
      // Simulate network request
      setTimeout(() => {
        onLeadSubmit(name, email);
        setIsSubmitting(false);
      }, 500);
    }
  };

  return (
    <div className="bg-gray-800 p-8 rounded-2xl shadow-lg border border-gray-700">
      <DigitalForceLogo size={80} className="mx-auto" />
      <h2 className="text-2xl font-bold text-center mt-4 text-blue-300">Parla con Flexi</h2>
      <p className="text-center text-gray-400 mt-2 mb-6">Inserisci i tuoi dati per iniziare e scoprire di più su Digital Force. Il nostro assistente AI risponderà alle tue domande.</p>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-300">Nome</label>
          <input
            type="text"
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            required
            aria-invalid={!!errors.name}
          />
          {errors.name && <p className="text-red-400 text-xs mt-1">{errors.name}</p>}
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-300">Email</label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full bg-gray-700 border border-gray-600 rounded-md shadow-sm py-2 px-3 text-white focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            required
            aria-invalid={!!errors.email}
          />
          {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
        </div>
        <button type="submit" disabled={isSubmitting} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300 ease-in-out transform hover:scale-105 disabled:bg-gray-500 disabled:cursor-not-allowed disabled:transform-none">
          {isSubmitting ? 'Inviando...' : 'Inizia a Chattare'}
        </button>
      </form>
    </div>
  );
};

const ChatInterface: React.FC<{ leadName: string }> = ({ leadName }) => {
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, text: `Ciao ${leadName}! Sono Flexi, il tuo assistente virtuale Digital Force. Come posso aiutarti oggi? Puoi chiedermi dei nostri servizi di mining, dei vantaggi fiscali o del piano compensi.`, sender: 'bot', timestamp: new Date() }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);
  
  useEffect(() => {
    if (!isLoading) {
      chatInputRef.current?.focus();
    }
  }, [isLoading]);

  const handleSend = async (messageText?: string) => {
    const textToSend = (messageText || input).trim();
    if (!textToSend || isLoading) return;

    if (!messageText) { // It's a typed message, not a suggestion
        trackEvent('message_sent', { message_length: textToSend.length, user: leadName });
    } else {
        trackEvent('suggested_question_clicked', { question: textToSend, user: leadName });
    }


    const userMessage: Message = { id: Date.now(), text: textToSend, sender: 'user', timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    const history = [...messages, userMessage];
    const botResponseText = await getBotResponse(textToSend, history);

    const botMessage: Message = { id: Date.now() + 1, text: botResponseText, sender: 'bot', timestamp: new Date() };
    setMessages(prev => [...prev, botMessage]);
    setIsLoading(false);
  };

  return (
    <div className="flex flex-col h-full bg-gray-800 rounded-2xl shadow-lg border border-gray-700 overflow-hidden">
      <div className="p-4 bg-gray-900/50 border-b border-gray-700 flex items-center space-x-3">
         <DigitalForceLogo size={48} />
         <div>
            <h2 className="text-xl font-bold text-blue-300">Digital Force AI Assistant</h2>
            <p className="text-sm text-gray-400">Connesso come {leadName}</p>
         </div>
      </div>
      <div className="flex-1 p-4 overflow-y-auto space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-lg lg:max-w-xl px-4 py-2 rounded-2xl shadow ${msg.sender === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-gray-700 text-gray-200 rounded-bl-none'}`}>
              <p className="whitespace-pre-wrap">{msg.text}</p>
              {msg.timestamp && (
                 <p className={`text-xs mt-1 text-right ${msg.sender === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>
                    {formatTime(msg.timestamp)}
                 </p>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="flex justify-start">
            <div className="max-w-lg lg:max-w-xl px-4 py-2 rounded-2xl bg-gray-700 text-gray-200 rounded-bl-none">
              <LoadingIndicator />
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
       {!isLoading && messages.length <= 2 && (
          <div className="p-4 border-t border-gray-700">
            <p className="text-sm text-gray-400 mb-2">Oppure prova a chiedere:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(q)}
                  className="bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm px-3 py-1 rounded-full transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      <div className="p-4 bg-gray-900/50 border-t border-gray-700">
        <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex space-x-2">
          <input
            ref={chatInputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Scrivi la tua domanda..."
            className="flex-1 bg-gray-700 border border-gray-600 rounded-lg py-2 px-4 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
            aria-label="Inserisci il tuo messaggio"
            aria-describedby="input-help"
            autoComplete="off"
          />
           <div id="input-help" className="sr-only">
            Scrivi la tua domanda sui servizi Digital Force
          </div>
          <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-bold p-2 rounded-lg disabled:bg-gray-500 disabled:cursor-not-allowed" disabled={isLoading || !input.trim()} aria-label="Invia messaggio">
             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 12h14" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  );
};


const App: React.FC = () => {
  const [lead, setLead] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    const savedLead = sessionStorage.getItem('digitalforce_lead');
    if (savedLead) {
      try {
        const parsedLead = JSON.parse(savedLead);
        if (parsedLead.name && parsedLead.email) {
          setLead({ name: parsedLead.name, email: parsedLead.email });
        }
      } catch (error) {
        console.error("Failed to parse lead from session storage", error);
        sessionStorage.removeItem('digitalforce_lead');
      }
    }
  }, []);

  const handleLeadSubmit = (name: string, email: string) => {
    const leadData = { name, email, timestamp: new Date().toISOString() };
    sessionStorage.setItem('digitalforce_lead', JSON.stringify(leadData));
    trackEvent('lead_captured', { name, email, timestamp: leadData.timestamp });
    setLead({ name, email });
  };

  return (
    <main className="min-h-screen p-4 sm:p-6 lg:p-8 bg-gray-900">
      <div className="container mx-auto max-w-4xl">
        {!lead ? (
          <LeadForm onLeadSubmit={handleLeadSubmit} />
        ) : (
          <div className="h-[calc(100vh-4rem)]">
            <ChatInterface leadName={lead.name} />
          </div>
        )}
         <footer className="text-center text-xs text-gray-600 mt-4">
            <p>Powered by Gemini API. © 2024 Digital Force. All rights reserved.</p>
        </footer>
      </div>
    </main>
  );
};

export default App;