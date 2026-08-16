# App Architecture

This app is a small Next.js App Router chat application with a single interactive client surface and one server-side API route.

The editable Draw.io source lives in [ARCHITECTURE.drawio](/Users/bhogaai/my_test_chat_app/ARCHITECTURE.drawio).

## Diagram

```mermaid
flowchart LR
  U[User in browser] --> P[App Router page<br/>app/page.tsx]
  P --> L[Root layout<br/>app/layout.tsx]
  P --> C[Client chat UI<br/>app/components/Chat.tsx]

  C <-->|local state: messages, input, loading| C
  C -->|POST /api/chat<br/>JSON: { messages }| R[Route handler<br/>app/api/chat/route.ts]

  R -->|reads| E[GOOGLE_GENAI_API_KEY<br/>environment variable]
  R -->|SDK call| G[@google/genai<br/>GoogleGenAI]
  G -->|generateContent| M[Gemini model<br/>gemini-3-flash-preview]
  M -->|response text| R
  R -->|JSON: { text }| C

  L -->|loads global styles + fonts| S[app/globals.css]
```

## Request Flow

1. The browser opens `/`, which is rendered by `app/page.tsx`.
2. `app/page.tsx` returns the `Chat` client component.
3. `Chat.tsx` manages conversation state in the browser with React hooks.
4. On submit, the client sends the full message history to `POST /api/chat`.
5. `app/api/chat/route.ts` runs on the server, reads `GOOGLE_GENAI_API_KEY`, and calls Gemini through `@google/genai`.
6. The server returns the generated text to the client, which appends it to the message list.

## Key Boundaries

- `app/page.tsx` is a server component by default.
- `app/components/Chat.tsx` is a client component because it uses `useState`, `useRef`, and `useEffect`.
- `app/api/chat/route.ts` is server-only and keeps the API key out of the browser bundle.
- `app/layout.tsx` applies the shared document shell, fonts, and metadata.

## Main Files

- `app/page.tsx` - entry point for `/`
- `app/layout.tsx` - root HTML shell and metadata
- `app/components/Chat.tsx` - interactive chat UI
- `app/api/chat/route.ts` - Gemini API bridge
- `app/globals.css` - global styling and theme tokens
