# Gemini Chat App

A simple React chat application powered by Google Gemini 3.5 Flash model.

## Setup

1. **Get API Key**
   - Visit [Google AI Studio](https://aistudio.google.com/apikey)
   - Create a new API key
   - Copy the key

2. **Set Environment Variable**
   - Copy `.env.local.example` to `.env.local`
   - Add your API key:
   ```bash
   GOOGLE_GENAI_API_KEY=your_api_key_here
   ```

3. **Install Dependencies**
   ```bash
   npm install
   ```

4. **Run Development Server**
   ```bash
   npm run dev
   ```

5. **Open in Browser**
   - Navigate to [http://localhost:3000](http://localhost:3000)
   - Start chatting!

## Features

- Clean, modern chat interface with Tailwind CSS
- Real-time message streaming
- Smooth animations and auto-scrolling
- Error handling
- Loading indicators
- Responsive design

## Tech Stack

- **Frontend**: Next.js 15 + React 19 + TypeScript + Tailwind CSS
- **AI Model**: Google Gemini 3.5 Flash
- **SDK**: @google/genai

## Project Structure

- `app/page.tsx` - Home page
- `app/components/Chat.tsx` - Chat UI component
- `app/api/chat/route.ts` - Chat API endpoint
- `.env.local` - Environment variables (create from `.env.local.example`)
