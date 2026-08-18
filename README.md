# Chat Personal

A full-stack, accessible personal chat application powered by Google Gemini AI with Spotify Web API integration and a responsive Express.js backend.

## Architecture

```
┌────────────────────────────────────────┐
│        Frontend (GitHub Pages)         │
│  - Vanilla JS, HTML5, Modern CSS       │
│  - Real-time streaming & Accessibility │
└───────────────────┬────────────────────┘
                    │ REST / Events
┌───────────────────▼────────────────────┐
│         Backend (Express API)          │
│  - Google Gemini 1.5 Flash             │
│  - Spotify OAuth & Player Controls     │
│  - Rate Limiting & Security Headers    │
└────────────────────────────────────────┘
```

## Key Features

- **Gemini AI Engine**: Intelligent conversational assistance powered by `gemini-1.5-flash`.
- **Spotify Integration**: Search tracks, control playback, and display live Spotify widgets.
- **Accessible & Responsive**: High-contrast modes, screen-reader friendly semantics, and mobile layout.
- **Containerized**: Production-ready `Dockerfile` for seamless deployment to Fly.io, Railway, or Render.

## Deployment & Setup

### 1. Environment Variables

Create a `.env` file in the root directory:

```ini
GEMINI_API_KEY=your_gemini_api_key
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=https://vailism.github.io/chat-personal/callback.html
CORS_ORIGIN=https://vailism.github.io
GEMINI_MODEL=gemini-1.5-flash
PORT=3000
```

### 2. Docker Deployment

```bash
docker build -t chat-personal-api .
docker run -p 3000:3000 --env-file .env chat-personal-api
```

### 3. Local Development

```bash
npm install
npm start
```

## License

MIT License. Built by [Vaibhav Anand](https://github.com/vailism).
