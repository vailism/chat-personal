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
console.log('Loaded env CLIENT_ID?', !!CLIENT_ID, 'CLIENT_SECRET?', !!CLIENT_SECRET);

if(!CLIENT_ID || !CLIENT_SECRET){
  console.warn('Missing SPOTIFY_CLIENT_ID or SPOTIFY_CLIENT_SECRET in environment.');
}

function basicAuthHeader(){
  const creds = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  return `Basic ${creds}`;
}

app.post('/spotify-auth', async (req,res) => {
  try {
    const { code, redirect_uri } = req.body;
    if(!code || !redirect_uri) return res.status(400).json({ error: 'Missing code or redirect_uri' });
    const params = new URLSearchParams();
    params.set('grant_type','authorization_code');
    params.set('code', code);
    params.set('redirect_uri', redirect_uri);
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
