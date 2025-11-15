import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files (index.html, callback.html, assets)
app.use(express.static(__dirname));

// Root and callback routes
app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.get('/callback.html', (req,res)=>res.sendFile(path.join(__dirname,'callback.html')));

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const SPOTIFY_SCOPES = (process.env.SPOTIFY_SCOPES || 'user-read-playback-state user-modify-playback-state user-read-currently-playing').split(/[ ,]+/).filter(Boolean);
const SPOTIFY_SHOW_DIALOG = process.env.SPOTIFY_SHOW_DIALOG === 'false' ? 'false' : 'true';

console.log('Loaded env CLIENT_ID?', !!CLIENT_ID, 'CLIENT_SECRET?', !!CLIENT_SECRET);

if(!CLIENT_ID || !CLIENT_SECRET){
  console.warn('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in environment.');
}

function basicAuthHeader(){
  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  return `Basic ${creds}`;
}

function getRedirectUri(req){
  // Use explicit env if provided, else derive from request host
  if (process.env.SPOTIFY_REDIRECT_URI) return process.env.SPOTIFY_REDIRECT_URI;
  const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}/callback.html`;
}

// New endpoint: server builds the Spotify authorize URL and redirects
app.get('/spotify-login', (req, res) => {
  if(!CLIENT_ID) return res.status(500).send('Missing SPOTIFY_CLIENT_ID');
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: getRedirectUri(req),
    scope: SPOTIFY_SCOPES.join(' '),
    show_dialog: SPOTIFY_SHOW_DIALOG
  });
  const url = `https://accounts.spotify.com/authorize?${params.toString()}`;
  return res.redirect(url);
});

app.post('/spotify-auth', async (req,res) => {
  try {
    const { code, redirect_uri } = req.body || {};
    if(!code) return res.status(400).json({ error: 'Missing code' });
    const redirectUri = redirect_uri || getRedirectUri(req);
    const params = new URLSearchParams();
    params.set('grant_type','authorization_code');
    params.set('code', code);
    params.set('redirect_uri', redirectUri);
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method:'POST',
      headers:{ 'Authorization': basicAuthHeader(), 'Content-Type':'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    if(!tokenRes.ok){
      const text = await tokenRes.text();
      return res.status(tokenRes.status).json({ error:'Token exchange failed', detail:text });
    }
    const data = await tokenRes.json();
    res.json(data);
  } catch (e){
    console.error(e);
    res.status(500).json({ error:'Server error' });
  }
});

app.post('/spotify-refresh', async (req,res) => {
  try {
    const { refresh_token } = req.body;
    if(!refresh_token) return res.status(400).json({ error: 'Missing refresh_token' });
    const params = new URLSearchParams();
    params.set('grant_type','refresh_token');
    params.set('refresh_token', refresh_token);
    const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
      method:'POST',
      headers:{ 'Authorization': basicAuthHeader(), 'Content-Type':'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    if(!tokenRes.ok){
      const text = await tokenRes.text();
      return res.status(tokenRes.status).json({ error:'Refresh failed', detail:text });
    }
    const data = await tokenRes.json();
    res.json(data);
  } catch (e){
    console.error(e);
    res.status(500).json({ error:'Server error' });
  }
});

// Chat proxy (Gemini) - keep API key on server only
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

app.post('/chat', async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
    if (!GEMINI_API_KEY) return res.status(500).json({ error: 'Server missing GEMINI_API_KEY' });

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': GEMINI_API_KEY
      },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });

    if (!resp.ok) {
      const t = await resp.text();
      return res.status(resp.status).json({ error: 'Upstream error', detail: t });
    }

    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return res.json({ text });
  } catch (e) {
    console.error('Gemini chat error', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
