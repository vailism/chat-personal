# Chat Personal

A personal chat app powered by Gemini with Spotify integration, accessible UI, and Express backend.

## Deploy

Frontend: GitHub Pages (already set up)

Backend: deploy the API server to any Node host (Render, Railway, Fly, Docker, EC2, etc.).

### Env
- GEMINI_API_KEY
- SPOTIFY_CLIENT_ID
- SPOTIFY_CLIENT_SECRET
- SPOTIFY_REDIRECT_URI=https://vailism.github.io/chat-personal/callback.html
- CORS_ORIGIN=https://vailism.github.io
- (optional) GEMINI_MODEL=gemini-1.5-flash

### Docker
```
docker build -t chat-personal-api .
docker run -p 3000:3000 \
  -e GEMINI_API_KEY=... \
  -e SPOTIFY_CLIENT_ID=... \
  -e SPOTIFY_CLIENT_SECRET=... \
  -e SPOTIFY_REDIRECT_URI=https://vailism.github.io/chat-personal/callback.html \
  -e CORS_ORIGIN=https://vailism.github.io \
  chat-personal-api
```

Then set the meta tag in `index.html` to point to your API base if not at the same origin:
```
<meta name="api-base" content="https://your-api.example.com">
```

