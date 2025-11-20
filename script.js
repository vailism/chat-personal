const GEMINI_MODEL = 'gemini-2.0-flash';
const SPOTIFY_SCOPES = ['user-read-playback-state','user-modify-playback-state','user-read-currently-playing'];
let spotifyAccessToken = null;
let spotifyRefreshToken = null;
let spotifyExpiresAt = 0;

const API_BASE = (document.querySelector('meta[name="api-base"]')?.content || '').trim() || '';

window.addEventListener('load', () => {
  setTimeout(() => {
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('main-app').classList.add('visible');
  }, 2500);
  handleSpotifyRedirect();
});

// Removed buildSpotifyAuthUrl: server builds secure URL at /spotify-login

function handleSpotifyRedirect(){
  const code = new URLSearchParams(window.location.search).get('code');
  if(!code) return;
  exchangeSpotifyCode(code);
}

async function exchangeSpotifyCode(code){
  try{
    toast('Connecting Spotify...','success');
    const response = await fetch((API_BASE||'') + '/spotify-auth', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ code })
    });
    if(!response.ok) throw new Error('Auth failed');
    const data = await response.json();
    spotifyAccessToken = data.access_token;
    spotifyRefreshToken = data.refresh_token;
    spotifyExpiresAt = Date.now() + (data.expires_in*1000);
    document.getElementById('spotify-login-btn').hidden = true;
    document.querySelector('.spotify-player-active').hidden = false;
    await checkDevices();
    fetchCurrentTrack();
    setInterval(fetchCurrentTrack, 15000);
  }catch(e){
    toast('Spotify auth error','error');
    console.error(e);
  }
}

async function refreshSpotifyToken(){
  if(!spotifyRefreshToken) return;
  try{
    const res = await fetch((API_BASE||'') + '/spotify-refresh',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ refresh_token: spotifyRefreshToken })
    });
    if(!res.ok) throw new Error('Refresh failed');
    const d = await res.json();
    spotifyAccessToken = d.access_token;
    spotifyExpiresAt = Date.now() + (d.expires_in*1000);
  }catch(e){
    console.error(e);
  }
}

// Helper that auto-refreshes tokens on 401 and retries once
async function spotifyFetch(endpoint, opts={}){
  if(!spotifyAccessToken) throw new Error('No Spotify token');
  if(Date.now() > spotifyExpiresAt - 60000) await refreshSpotifyToken();
  let res = await fetch(endpoint, { ...opts, headers: { ...(opts.headers||{}), Authorization: 'Bearer '+spotifyAccessToken } });
  if(res.status === 401){
    await refreshSpotifyToken();
    res = await fetch(endpoint, { ...opts, headers: { ...(opts.headers||{}), Authorization: 'Bearer '+spotifyAccessToken } });
  }
  return res;
}

let notifiedNoPlayback = false;
let notifiedPremium = false;

async function fetchCurrentTrack(){
  if(!spotifyAccessToken) return;
  try{
    const res = await spotifyFetch('https://api.spotify.com/v1/me/player/currently-playing');
    if(res.status === 204){
      if(!notifiedNoPlayback){
        toast('No active playback. Open Spotify and start a song on any device.', 'error');
        notifiedNoPlayback = true;
      }
      return;
    }
    if(res.status === 403){
      if(!notifiedPremium){ toast('Playback controls require Spotify Premium.', 'error'); notifiedPremium=true; }
      return;
    }
    if(!res.ok) throw new Error('Playback fetch failed: '+res.status);
    const data = await res.json();
    if(!data || !data.item) return;
    updateSpotifyUI(data);
  }catch(e){
    console.error(e);
  }
}

function updateSpotifyUI(data){
  const title = document.getElementById('spotify-title');
  const artist = document.getElementById('spotify-artist');
  const albumImg = document.getElementById('spotify-album');
  const playBtn = document.getElementById('sp-play');
  if(!title || !artist || !albumImg || !playBtn) return; // guard if UI not rendered
  const isPlaying = data.is_playing;
  title.textContent = data.item?.name || '';
  artist.textContent = (data.item?.artists||[]).map(a=>a.name).join(', ');

  const img = data.item?.album?.images?.[1] || data.item?.album?.images?.[0];
  if(img) albumImg.src = img.url;

  playBtn.textContent = isPlaying ? '⏸' : '▶';
}

async function spotifyTogglePlay(){
  if(!spotifyAccessToken) return;
  try{
    const endpoint = 'https://api.spotify.com/v1/me/player/' + (document.getElementById('sp-play').textContent === '▶' ? 'play':'pause');
    const res = await spotifyFetch(endpoint,{ method:'PUT' });
    if(res.status === 403){ if(!notifiedPremium){ toast('Playback controls require Spotify Premium.','error'); notifiedPremium=true; } return; }
    if(res.status === 204 || res.ok){ fetchCurrentTrack(); }
  }catch(e){ console.error(e); }
}

async function spotifyNext(){
  if(!spotifyAccessToken) return;
  try{
    const res = await spotifyFetch('https://api.spotify.com/v1/me/player/next',{ method:'POST' });
    if(res.status === 403){ if(!notifiedPremium){ toast('Next/Previous require Spotify Premium.','error'); notifiedPremium=true; } return; }
    setTimeout(fetchCurrentTrack,1000);
  }catch(e){ console.error(e); }
}

async function spotifyPrev(){
  if(!spotifyAccessToken) return;
  try{
    const res = await spotifyFetch('https://api.spotify.com/v1/me/player/previous',{ method:'POST' });
    if(res.status === 403){ if(!notifiedPremium){ toast('Next/Previous require Spotify Premium.','error'); notifiedPremium=true; } return; }
    setTimeout(fetchCurrentTrack,1000);
  }catch(e){ console.error(e); }
}

async function checkDevices(){
  try{
    const res = await spotifyFetch('https://api.spotify.com/v1/me/player/devices');
    if(!res.ok) return;
    const data = await res.json();
    const hasActive = (data.devices||[]).some(d=>d.is_active);
    if(!hasActive){ toast('Open Spotify and play a song on any device, then return here.', 'error'); }
  }catch(e){ console.error(e); }
}

const input = document.getElementById('message-input');
input.addEventListener('input', function() {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 140) + 'px';
});

document.getElementById('send-btn').addEventListener('click', sendMessage);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

const spotifyLoginBtn = document.getElementById('spotify-login-btn');
if(spotifyLoginBtn){
  spotifyLoginBtn.addEventListener('click', () => {
    window.location.href = (API_BASE||'') + '/spotify-login';
  });
}

// Paste button functionality
document.addEventListener('DOMContentLoaded', () => {
  const pasteBtn = document.querySelector('.input-action-btn');
  if(pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        const input = document.getElementById('message-input');
        if(input) {
          input.value += text;
          input.dispatchEvent(new Event('input'));
          toast('Pasted from clipboard', 'success');
        }
      } catch(e) {
        toast('Paste failed', 'error');
      }
    });
  }
});

const spPlay = document.getElementById('sp-play');
const spNext = document.getElementById('sp-next');
const spPrev = document.getElementById('sp-prev');
if(spPlay) spPlay.addEventListener('click', spotifyTogglePlay);
if(spNext) spNext.addEventListener('click', spotifyNext);
if(spPrev) spPrev.addEventListener('click', spotifyPrev);

function toast(msg,type='error'){
  const c=document.getElementById('toast-container');
  if(!c) return;
  const t=document.createElement('div');
  t.className='toast toast-'+type;
  t.setAttribute('role','alert');
  t.textContent=msg;
  c.appendChild(t);
  setTimeout(()=>{ t.classList.add('show'); },10);
  setTimeout(()=>{ t.classList.add('hide'); setTimeout(()=>t.remove(),400); }, 4200);
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;

  const welcome = document.querySelector('.welcome-card');
  if (welcome) welcome.remove();

  input.value = '';
  input.style.height = 'auto';

  addMessage(text, 'user');
  showTyping();

  try {
    const response = await callAPI(text);
    hideTyping();
    addMessage(response, 'bot');
  } catch (error) {
    hideTyping();
    addMessage('I encountered an error. Please try again.', 'bot');
    toast('API error: '+(error.message||'Unknown'));
    console.error('API Error:', error);
  }
}

async function callAPI(prompt) {
  const sendBtn = document.getElementById('send-btn');
  sendBtn.classList.add('sending');

  const url = (API_BASE||'') + '/chat';
  const payload = { prompt };

  try {
    const headers = { 'Content-Type': 'application/json' };
    let response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (response.status === 405) {
      response = await fetch(`${url}?q=${encodeURIComponent(prompt)}`);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const text = data.text || data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response available.';
    return text;
  } finally {
    sendBtn.classList.remove('sending');
  }
}

function addMessage(text, role) {
  const messagesDiv = document.getElementById('messages');
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;
  messageDiv.setAttribute('aria-label', role==='user'? 'User message':'Bot response');
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'user' ? '👤' : '🤖';
  const content = document.createElement('div');
  content.className = 'message-content';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.setAttribute('role','article');
  bubble.setAttribute('tabindex','0');
  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (role === 'bot') {
    let i = 0; const speed = 12;
    (function typeWriter(){
      if (i < text.length) { bubble.textContent += text.charAt(i++); messagesDiv.scrollTop = messagesDiv.scrollHeight; setTimeout(typeWriter, speed); }
    })();
  } else {
    bubble.textContent = text;
  }

  content.appendChild(bubble);
  content.appendChild(time);
  messageDiv.appendChild(avatar);
  messageDiv.appendChild(content);
  messagesDiv.appendChild(messageDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function showTyping() {
  const messagesDiv = document.getElementById('messages');
  const typing = document.createElement('div');
  typing.id = 'typing';
  typing.className = 'typing-indicator';
  typing.setAttribute('aria-label','Bot is typing');
  typing.innerHTML = `
    <div class="typing-bubble" role="status" aria-live="polite">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>`;
  messagesDiv.appendChild(typing);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function hideTyping() {
  const typing = document.getElementById('typing');
  if (typing) typing.remove();
}

// Paste button functionality (already in HTML, just wire it up)
document.addEventListener('DOMContentLoaded', () => {
  const pasteBtn = document.querySelector('.input-action-btn');
  if(pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        const input = document.getElementById('message-input');
        if(input) {
          input.value += text;
          input.dispatchEvent(new Event('input'));
          toast('Pasted from clipboard', 'success');
        }
      } catch(e) {
        toast('Paste failed', 'error');
      }
    });
  }
});
