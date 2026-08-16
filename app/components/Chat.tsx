"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage: Message = { role: "user", content: input };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage],
        }),
      });

      if (!response.ok) throw new Error("Failed to fetch response");

      const data = await response.json();
      const assistantMessage: Message = {
        role: "assistant",
        content: data.text,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error("Error:", error);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Sorry, I encountered an error. Please try again.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-900">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-800 border-b border-slate-700 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 py-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-400 to-blue-600 rounded-lg flex items-center justify-center text-white font-bold shadow-lg">
              ✨
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 via-blue-300 to-cyan-300 bg-clip-text text-transparent">
                Gemini Chat
              </h1>
              <p className="text-xs text-slate-400 mt-0.5">
                Powered by Gemini 3.5 Flash
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
        <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">
          {messages.length === 0 && (
            <div className="text-center py-20">
              <div className="inline-block mb-4">
                <div className="text-5xl mb-4">💬</div>
              </div>
              <p className="text-slate-300 text-xl font-medium mb-2">
                Start a conversation with Gemini AI
              </p>
              <p className="text-slate-500 text-sm">
                Ask anything, get instant answers powered by AI
              </p>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex gap-3 animate-in fade-in slide-in-from-bottom-4 ${
                msg.role === "user" ? "justify-end" : "justify-start"
              }`}
            >
              {msg.role === "assistant" && (
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center flex-shrink-0 mt-1">
                  <span className="text-sm">🤖</span>
                </div>
              )}
              <div
                className={`max-w-xl px-4 py-3 rounded-2xl ${
                  msg.role === "user"
                    ? "bg-gradient-to-r from-blue-600 to-blue-500 text-white shadow-lg shadow-blue-500/20"
                    : "bg-slate-800 text-slate-100 border border-slate-700 shadow-lg"
                }`}
              >
                <p className="whitespace-pre-wrap leading-relaxed text-sm sm:text-base">
                  {msg.content}
                </p>
              </div>
              {msg.role === "user" && (
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center flex-shrink-0 mt-1">
                  <span className="text-sm">👤</span>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-3 animate-in fade-in">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center flex-shrink-0 mt-1">
                <span className="text-sm">🤖</span>
              </div>
              <div className="bg-slate-800 text-slate-100 px-4 py-3 rounded-2xl border border-slate-700 shadow-lg">
                <div className="flex space-x-2">
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: "0.1s"}}></div>
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-bounce" style={{animationDelay: "0.2s"}}></div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="bg-gradient-to-t from-slate-900 to-slate-800 border-t border-slate-700 backdrop-blur-sm py-4">
        <div className="max-w-3xl mx-auto px-4">
          <form onSubmit={handleSubmit} className="flex gap-3">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask me anything..."
              disabled={loading}
              className="flex-1 px-4 py-3 bg-slate-800 text-white border border-slate-600 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-slate-500 disabled:bg-slate-900 disabled:cursor-not-allowed transition-all"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-2xl hover:from-blue-500 hover:to-blue-400 disabled:from-slate-600 disabled:to-slate-600 disabled:cursor-not-allowed transition-all transform hover:scale-105 active:scale-95 shadow-lg font-medium"
            >
              {loading ? "..." : "Send"}
            </button>
          </form>
          <p className="text-xs text-slate-500 text-center mt-2">
            Powered by Gemini AI
          </p>
        </div>
      </div>
    </div>
  );
}
