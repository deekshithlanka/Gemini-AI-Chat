"use client";

import { useState, useRef, useEffect } from "react";
import { Menu, Plus, MessageCircle, Settings, HelpCircle, FileText, Upload, ShieldCheck } from "lucide-react";
import { DEFAULT_GEMINI_MODEL, GEMINI_MODELS } from "@/app/lib/models";
import type { RagSource } from "@/app/lib/rag";

// "chat" = normal Gemini chat, "docs" = answer from your uploaded PDFs (RAG)
type Mode = "chat" | "docs";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: RagSource[]; // pages the answer came from (Document Q&A only)
  reranked?: boolean; // whether those sources were reranked
  cached?: boolean; // answer came from the response cache
  blocked?: boolean; // user message stopped by guardrails (never sent to the model)
  notice?: boolean; // assistant-side "blocked by ..." notice (not real model output)
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
}

export default function Chat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState(DEFAULT_GEMINI_MODEL);
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mode, setMode] = useState<Mode>("chat");
  const [rerank, setRerank] = useState(true);
  const [guardrails, setGuardrails] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [receiving, setReceiving] = useState(false); // true once streamed text starts arriving
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const currentConv = conversations.find((c) => c.id === currentConvId);
  const messages = currentConv?.messages || [];

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const startNewChat = () => {
    const newId = Date.now().toString();
    setConversations((prev) => [...prev, { id: newId, title: "New chat", messages: [] }]);
    setCurrentConvId(newId);
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  // Send a PDF to the RAG server so it can be searched
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow picking the same file again later
    if (!file) return;

    setUploading(true);
    setUploadStatus(`Adding ${file.name}... (embedding can take a minute)`);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/rag-ingest", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Upload failed");
      setUploadStatus(`✓ Added ${data.filename}: ${data.pages} pages, ${data.chunks} chunks`);
    } catch (error) {
      setUploadStatus(`✗ ${error instanceof Error ? error.message : "Upload failed"}`);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const convId = currentConvId || Date.now().toString();
    const userMessage: Message = { role: "user", content: input };

    if (currentConvId) {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? { ...c, messages: [...c.messages, userMessage] }
            : c
        )
      );
    } else {
      setConversations((prev) => [
        ...prev,
        { id: convId, title: "New chat", messages: [userMessage] },
      ]);
      setCurrentConvId(convId);
    }

    setInput("");
    setLoading(true);

    try {
      const controller = new AbortController();
      abortControllerRef.current = controller;
      // Send only role + content, and leave out blocked messages and guardrail notices
      const history = [...messages, userMessage]
        .filter((m) => !m.blocked && !m.notice)
        .map(({ role, content }) => ({ role, content }));
      const response = await fetch(mode === "docs" ? "/api/rag-chat" : "/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "docs"
            ? { messages: history, rerank, guardrails }
            : { messages: history, model: selectedModel, guardrails }
        ),
        signal: controller.signal,
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to fetch response");
      }

      // Guardrails blocked the question or the answer
      if (response.headers.get("X-Guardrails-Blocked")) {
        const data = await response.json();
        const b = data.blocked ?? {};
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId) return c;
            const msgs = [...c.messages];
            // Mark the user's message as blocked (it stays visible but is never sent again)
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i].role === "user") {
                msgs[i] = { ...msgs[i], blocked: true };
                break;
              }
            }
            const what = b.stage === "output" ? "The reply was blocked" : "Your message was blocked";
            msgs.push({
              role: "assistant",
              notice: true,
              content: `${what} by ${b.guard ?? "guardrails"}: ${b.reason ?? "unsafe content"}`,
            });
            return { ...c, messages: msgs };
          })
        );
        return;
      }

      const addAssistant = (msg: Message) =>
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, messages: [...c.messages, msg] } : c))
        );
      const updateLastMessage = (content: string) =>
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId) return c;
            const msgs = [...c.messages];
            msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], content };
            return { ...c, messages: msgs };
          })
        );

      if (mode === "docs") {
        // Document Q&A returns the whole answer at once, with sources
        const data = await response.json();
        // Don't show sources when the documents didn't contain the answer
        const notFound = typeof data.text === "string" && data.text.includes("couldn't find that");
        addAssistant({
          role: "assistant",
          content: data.text,
          sources: notFound ? undefined : data.sources,
          reranked: data.reranked,
        });
      } else {
        // Chat streams: read the answer piece by piece and show it as it arrives
        const cached = response.headers.get("X-Cache") === "HIT";
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let text = "";
        let started = false;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          if (!started) {
            started = true;
            setReceiving(true);
            addAssistant({ role: "assistant", content: text, cached });
          } else {
            updateLastMessage(text);
          }
        }
        text += decoder.decode();
        if (started) updateLastMessage(text);
        else addAssistant({ role: "assistant", content: "No response generated" });
      }

      if (messages.length === 0) {
        const title = userMessage.content.substring(0, 30) + (userMessage.content.length > 30 ? "..." : "");
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, title } : c))
        );
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      console.error("Error:", error);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: [
                  ...c.messages,
                  {
                    role: "assistant",
                    content: `Sorry, something went wrong: ${
                      error instanceof Error ? error.message : "please try again."
                    }`,
                  },
                ],
              }
            : c
        )
      );
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
      setReceiving(false);
    }
  };

  const suggestedPrompts =
    mode === "docs"
      ? [
          "Summarize the main points",
          "What are the key numbers mentioned?",
          "What risks or problems are described?",
          "List the main topics covered",
        ]
      : [
          "Explain quantum computing",
          "Write a Python function",
          "Plan a trip to Japan",
          "Summarize a topic",
        ];

  return (
    <div className="flex h-screen bg-gradient-to-br from-blue-100 via-blue-50 to-white">
      {/* Sidebar */}
      <div
        className={`transition-all duration-300 flex flex-col bg-white border-r border-gray-200 ${
          sidebarOpen ? "w-64" : "w-0"
        } overflow-hidden`}
      >
        <div className="p-4 border-b border-gray-200">
          <button
            onClick={startNewChat}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-800 transition-colors font-medium"
          >
            <Plus size={18} />
            New chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-3 space-y-2">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setCurrentConvId(conv.id)}
                className={`w-full text-left px-3 py-2 rounded-lg transition-colors text-sm ${
                  currentConvId === conv.id
                    ? "bg-gray-200 text-gray-900 font-medium"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <div className="flex items-center gap-2">
                  <MessageCircle size={16} />
                  <span className="truncate">{conv.title}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="p-3 border-t border-gray-200 space-y-2">
          <label
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-600 text-sm cursor-pointer select-none"
            title="Check every message and reply for jailbreaks and unsafe content. Turns off streaming while on."
          >
            <ShieldCheck size={18} />
            <span className="flex-1">Guardrails</span>
            <input
              type="checkbox"
              checked={guardrails}
              onChange={(e) => setGuardrails(e.target.checked)}
              disabled={loading}
              className="w-4 h-4 accent-blue-600"
            />
          </label>
          <button className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-600 text-sm transition-colors">
            <HelpCircle size={18} />
            Help & FAQ
          </button>
          <button className="w-full text-left flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-100 text-gray-600 text-sm transition-colors">
            <Settings size={18} />
            Settings
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 bg-white bg-opacity-80 backdrop-blur-sm">
          <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <Menu size={20} className="text-gray-700" />
              </button>
              <div className="flex items-center gap-4">
  <h1 className="text-2xl font-semibold text-gray-900">My Gemini App</h1>
  {guardrails && (
    <span className="flex items-center gap-1 rounded-full bg-green-100 text-green-800 px-2 py-1 text-xs font-medium">
      <ShieldCheck size={14} /> Guarded
    </span>
  )}

  {/* Mode switch */}
  <div className="flex rounded-lg border border-gray-300 overflow-hidden text-sm" role="group" aria-label="Mode">
    <button
      type="button"
      onClick={() => setMode("chat")}
      disabled={loading}
      className={`flex items-center gap-1 px-3 py-2 ${mode === "chat" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-100"}`}
    >
      <MessageCircle size={16} /> Chat
    </button>
    <button
      type="button"
      onClick={() => setMode("docs")}
      disabled={loading}
      className={`flex items-center gap-1 px-3 py-2 ${mode === "docs" ? "bg-blue-600 text-white" : "bg-white text-gray-700 hover:bg-gray-100"}`}
    >
      <FileText size={16} /> Documents
    </button>
  </div>

  {mode === "docs" ? (
    <>
      <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" onChange={handleUpload} className="hidden" />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading || loading}
        className="flex items-center gap-1 border text-gray-900 rounded-lg px-3 py-2 text-sm hover:bg-gray-100 disabled:bg-gray-100 disabled:cursor-not-allowed"
      >
        <Upload size={16} /> {uploading ? "Uploading..." : "Upload PDF"}
      </button>
      <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none" title="Rescore 20 search results and keep the 5 that best answer the question">
        <input
          type="checkbox"
          checked={rerank}
          onChange={(e) => setRerank(e.target.checked)}
          disabled={loading}
          className="w-4 h-4 accent-blue-600"
        />
        Rerank
      </label>
    </>
  ) : (
  <select
    value={selectedModel}
    onChange={(event) => setSelectedModel(event.target.value as typeof selectedModel)}
    disabled={loading}
    aria-label="Select Gemini model"
    className="border text-gray-900 rounded-lg px-3 py-2 text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
  >
    {GEMINI_MODELS.map((model) => (
      <option key={model.id} value={model.id}>
        {model.label}
      </option>
    ))}
  </select>
  )}
</div>
            </div>
          </div>
        </div>

        {mode === "docs" && uploadStatus && (
          <div className="max-w-4xl mx-auto w-full px-4 pt-3 text-sm text-gray-700">{uploadStatus}</div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto w-full px-4 py-8">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full min-h-[400px]">
                <h2 className="text-3xl font-semibold text-gray-900 mb-2">Hello there</h2>
                <p className="text-gray-600 mb-8">
                  {mode === "docs"
                    ? "Ask a question about your uploaded PDFs"
                    : "How can I help you today?"}
                </p>

                <div className="grid grid-cols-2 gap-3 w-full max-w-2xl">
                  {suggestedPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => setInput(prompt)}
                      className="p-4 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-left transition-colors"
                    >
                      <p className="text-gray-900 text-sm font-medium">{prompt}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex gap-4 py-6 animate-in fade-in ${
                  msg.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {msg.role === "assistant" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold text-lg">
                    🤖
                  </div>
                )}
                <div
                  className={`max-w-2xl ${
                    msg.role === "user"
                      ? "text-right"
                      : "text-left"
                  }`}
                >
                  {msg.notice ? (
                    <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 text-sm">
                      {msg.content}
                    </p>
                  ) : (
                    <p
                      className={`leading-relaxed whitespace-pre-wrap ${
                        msg.blocked ? "text-gray-400" : "text-gray-900"
                      }`}
                    >
                      {msg.content}
                    </p>
                  )}
                  {msg.blocked && (
                    <p className="mt-1 text-xs text-gray-400">Blocked, not sent to the model</p>
                  )}
                  {msg.cached && (
                    <p className="mt-2 text-xs text-gray-400" title="Same question as before, so the saved answer was used instead of calling Gemini">
                      Cached
                    </p>
                  )}
                  {msg.sources && msg.sources.length > 0 && (
                    <p className="mt-2 text-xs text-gray-500">
                      {msg.reranked ? "Sources, reranked: " : "Sources, search order: "}
                      {msg.sources
                        .map(
                          (s) =>
                            `${s.source} p. ${s.page}` +
                            (s.score !== undefined ? ` (${s.score.toFixed(2)}${s.chunks && s.chunks > 1 ? `, ×${s.chunks}` : ""})` : "")
                        )
                        .join(" · ")}
                    </p>
                  )}
                </div>
                {msg.role === "user" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-green-400 to-green-600 flex items-center justify-center text-white font-semibold text-lg">
                    👤
                  </div>
                )}
              </div>
            ))}

            {loading && !receiving && (
              <div className="flex gap-4 py-6 animate-in fade-in">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-semibold text-lg">
                  🤖
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }}></div>
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }}></div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="bg-white bg-opacity-80 backdrop-blur-sm border-t border-gray-200 py-4">
          <div className="max-w-4xl mx-auto px-4">
            <form onSubmit={handleSubmit} className="flex gap-3">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={mode === "docs" ? "Ask about your documents" : "Message Gemini"}
                disabled={loading}
                className="flex-1 px-4 py-3 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-500 disabled:bg-gray-50 disabled:cursor-not-allowed transition-all bg-white text-gray-900"
              />
              {loading ? (
                <button
                  type="button"
                  onClick={handleStop}
                  className="px-6 py-3 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors font-medium"
                >
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="px-6 py-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
                >
                  Send
                </button>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
