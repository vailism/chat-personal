const GEMINI_MODEL = 'gemini-2.0-flash';
const SPOTIFY_SCOPES = ['user-read-playback-state','user-modify-playback-state','user-read-currently-playing'];
let spotifyAccessToken = null;
let spotifyRefreshToken = null;
let spotifyExpiresAt = 0;

// Persist & restore Spotify session so button hides after reload
function persistSpotifySession(){
  try {
    sessionStorage.setItem('spotifySession', JSON.stringify({
      access_token: spotifyAccessToken,
      refresh_token: spotifyRefreshToken,
      expires_at: spotifyExpiresAt
    }));
  } catch(e){ console.error('Persist error', e); }
}
async function restoreSpotifySession(){
  const raw = sessionStorage.getItem('spotifySession');
  if(!raw) return;
  try {
    const data = JSON.parse(raw);
    if(data.access_token && data.expires_at){
      spotifyAccessToken = data.access_token;
      spotifyRefreshToken = data.refresh_token;
      spotifyExpiresAt = data.expires_at;
      // Refresh early if near expiry
      if(Date.now() > spotifyExpiresAt - 60000 && spotifyRefreshToken){
        await refreshSpotifyToken();
      }
      activateSpotifyUI();
      fetchCurrentTrack();
      setInterval(fetchCurrentTrack, 15000);
    }
  } catch(e){ console.error('Restore error', e); }
}
function activateSpotifyUI(){
  const connectBtn = document.getElementById('spotify-login-btn');
  if(connectBtn) connectBtn.hidden = true;
  const logoutBtn = document.getElementById('spotify-logout-btn');
  if(logoutBtn) logoutBtn.hidden = false;
  const playerActive = document.querySelector('.spotify-player-active');
  if(playerActive) playerActive.hidden = false;
}

function deactivateSpotifyUI() {
  const connectBtn = document.getElementById('spotify-login-btn');
  if(connectBtn) connectBtn.hidden = false;
  const logoutBtn = document.getElementById('spotify-logout-btn');
  if(logoutBtn) logoutBtn.hidden = true;
  const playerActive = document.querySelector('.spotify-player-active');
  if(playerActive) playerActive.hidden = true;
  const title = document.getElementById('spotify-title');
  const artist = document.getElementById('spotify-artist');
  const albumImg = document.getElementById('spotify-album');
  if(title) title.textContent = 'Not Connected';
  if(artist) artist.textContent = 'Connect to see your music';
  if(albumImg) albumImg.src = '';
}

function spotifyLogout() {
  spotifyAccessToken = null;
  spotifyRefreshToken = null;
  spotifyExpiresAt = 0;
  try { sessionStorage.removeItem('spotifySession'); } catch(e) { console.error('Logout error', e); }
  deactivateSpotifyUI();
  trackSpotify('logout');
  toast('Spotify disconnected', 'success');
}

const API_BASE = (document.querySelector('meta[name="api-base"]')?.content || '').trim() || '';

const LOADING_MAX_DURATION = 5000; // ms fallback
function hideLoadingScreen(){
  const ls = document.getElementById('loading-screen');
  const app = document.getElementById('main-app');
  if(ls && !ls.classList.contains('hidden')) ls.classList.add('hidden');
  if(app && !app.classList.contains('visible')) app.classList.add('visible');
}

// Fallback: force hide after max duration
setTimeout(hideLoadingScreen, LOADING_MAX_DURATION);

document.addEventListener('DOMContentLoaded', () => {
  // In case window 'load' waits for blocked resources
  setTimeout(hideLoadingScreen, 1200);
});

window.addEventListener('load', () => {
  setTimeout(hideLoadingScreen, 400); // quicker now
  restoreSpotifySession().then(() => handleSpotifyRedirect()).catch(()=>{});
  restoreChatHistory();
  restoreTheme();
  initializeFeatures();
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
    persistSpotifySession();
    activateSpotifyUI();
    await checkDevices();
    fetchCurrentTrack();
    setInterval(fetchCurrentTrack, 15000);
    // Remove code param from URL for cleanliness
    try { const u=new URL(location.href); u.searchParams.delete('code'); history.replaceState({},'',u.toString()); } catch(_e){}
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
    persistSpotifySession();
  }catch(e){
    console.error(e);
    // If refresh fails, log out
    spotifyLogout();
  }
}

// Helper that auto-refreshes tokens on 401 and retries once
async function spotifyFetch(endpoint, opts={}){
  if(!spotifyAccessToken) throw new Error('No Spotify token');
  if(Date.now() > spotifyExpiresAt - 60000) await refreshSpotifyToken();
  let res = await fetch(endpoint, { ...opts, headers: { ...(opts.headers||{}), Authorization: 'Bearer '+spotifyAccessToken } });
  if(res.status === 401){
    await refreshSpotifyToken();
    // Check if refresh worked
    if (!spotifyAccessToken || Date.now() > spotifyExpiresAt) {
      spotifyLogout();
      throw new Error('Spotify session expired. Please log in again.');
    }
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
  if(!title || !artist || !albumImg || !playBtn) return;
  
  const isPlaying = data.is_playing;
  title.textContent = data.item?.name || '';
  artist.textContent = (data.item?.artists||[]).map(a=>a.name).join(', ');

  const img = data.item?.album?.images?.[1] || data.item?.album?.images?.[0];
  if(img) albumImg.src = img.url;

  // Update play/pause button with SVG
  if(isPlaying) {
    playBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  } else {
    playBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  }
}

async function spotifyTogglePlay(){
  if(!spotifyAccessToken) return;
  try{
    // Check if currently playing by looking at button's SVG content
    const playBtn = document.getElementById('sp-play');
    const isPaused = playBtn.innerHTML.includes('M8 5v14l11-7z'); // play icon = paused state
    const endpoint = 'https://api.spotify.com/v1/me/player/' + (isPaused ? 'play' : 'pause');
    const res = await spotifyFetch(endpoint,{ method:'PUT' });
    if(res.status === 403){ if(!notifiedPremium){ toast('Playback controls require Spotify Premium.','error'); notifiedPremium=true; } return; }
    if(res.status === 204 || res.ok){ setTimeout(fetchCurrentTrack, 300); }
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
    trackSpotify('login_click');
    window.location.href = (API_BASE||'') + '/spotify-login';
  });
}

// Paste button functionality
const pasteBtn = document.getElementById('paste-btn');
if(pasteBtn) {
  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      const input = document.getElementById('message-input');
      if(input) {
        input.value += text;
        input.dispatchEvent(new Event('input'));
        toast('📋 Pasted from clipboard', 'success');
      }
    } catch(e) {
      toast('Paste failed', 'error');
    }
  });
}

// Spotify control buttons single declaration (with GA tracking integrated)
const spPlay = document.getElementById('sp-play');
const spNext = document.getElementById('sp-next');
const spPrev = document.getElementById('sp-prev');
if(spPlay) spPlay.addEventListener('click', ()=>{ 
  // Determine state for accurate GA event (icon path check heuristic)
  const isPaused = spPlay.innerHTML.includes('M8 5v14l11-7z');
  trackSpotify(isPaused ? 'play' : 'pause');
  spotifyTogglePlay(); 
});
if(spNext) spNext.addEventListener('click', ()=>{ trackSpotify('next'); spotifyNext(); });
if(spPrev) spPrev.addEventListener('click', ()=>{ trackSpotify('previous'); spotifyPrev(); });

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
    // If POST fails with 405 (Method Not Allowed) or 400 (Bad Request - possibly due to body parsing issues on some hosts), try GET fallback
    if (response.status === 405 || response.status === 400) {
      console.warn('POST failed, trying GET fallback');
      // Ensure we don't double-encode or send malformed query
      const getUrl = new URL(url);
      getUrl.searchParams.set('q', prompt);
      response = await fetch(getUrl.toString());
    }
    if (!response.ok) {
      // Try to parse error detail from JSON if possible
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errData = await response.json();
        if(errData.error) errorDetail += `: ${errData.error}`;
        if(errData.detail) errorDetail += ` (${errData.detail})`;
      } catch(e){}
      throw new Error(errorDetail);
    }
    const data = await response.json();
    const text = data.text || data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response available.';
    return text;
  } finally {
    sendBtn.classList.remove('sending');
  }
}

function addMessage(text, role, saveToHistory=true) {
  const messagesDiv = document.getElementById('messages');
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${role}`;
  messageDiv.setAttribute('aria-label', role==='user'? 'User message':'Bot response');
  
  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  
  // Use image avatars instead of emojis
  const avatarImg = document.createElement('img');
  avatarImg.src = role === 'user' ? 'screenshot.png' : 'c.jpg';
  avatarImg.alt = role === 'user' ? 'User avatar' : 'Bot avatar';
  avatarImg.style.width = '100%';
  avatarImg.style.height = '100%';
  avatarImg.style.objectFit = 'cover';
  avatarImg.style.borderRadius = 'var(--radius-md)';
  avatar.appendChild(avatarImg);
  
  const content = document.createElement('div');
  content.className = 'message-content';
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.setAttribute('role','article');
  bubble.setAttribute('tabindex','0');
  
  // Add message actions
  const actions = document.createElement('div');
  actions.className = 'message-actions';
  const copyBtn = document.createElement('button');
  copyBtn.className = 'msg-action-btn';
  copyBtn.setAttribute('aria-label', 'Copy message');
  copyBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M8 4v12a2 2 0 002 2h8a2 2 0 002-2V7.242a2 2 0 00-.602-1.43L16.083 2.57A2 2 0 0014.685 2H10a2 2 0 00-2 2z" stroke="currentColor" stroke-width="2"/><path d="M16 18v2a2 2 0 01-2 2H6a2 2 0 01-2-2V9a2 2 0 012-2h2" stroke="currentColor" stroke-width="2"/></svg>`;
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(text).then(() => {
      toast('📋 Message copied', 'success');
    }).catch(() => {
      toast('Copy failed', 'error');
    });
  });
  actions.appendChild(copyBtn);
  content.appendChild(actions);
  
  const time = document.createElement('div');
  time.className = 'message-time';
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Save to history if needed
  if(saveToHistory) {
    saveChatMessage(text, role);
    trackMessage(role, text.length);
  }

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

// ========================================
// Chat History Persistence (Enhanced)
// ========================================

const CHAT_STORAGE_KEY = 'chatHistory';
let chatStorageMode = 'local'; // fallback to session if local blocked

function getChatHistory(){
  try {
    const raw = (chatStorageMode==='local'? localStorage.getItem(CHAT_STORAGE_KEY): sessionStorage.getItem(CHAT_STORAGE_KEY)) || '[]';
    return JSON.parse(raw);
  } catch(e){
    console.error('History parse error, resetting', e);
    clearCorruptHistory();
    return [];
  }
}
function setChatHistory(arr){
  try {
    const raw = JSON.stringify(arr);
    if(chatStorageMode==='local') localStorage.setItem(CHAT_STORAGE_KEY, raw);
    else sessionStorage.setItem(CHAT_STORAGE_KEY, raw);
  } catch(e){
    console.warn('Primary storage failed, switching to sessionStorage', e);
    chatStorageMode='session';
    try { sessionStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(arr)); } catch(e2){ console.error('Session storage also failed', e2); }
  }
}
function clearCorruptHistory(){
  try { localStorage.removeItem(CHAT_STORAGE_KEY); } catch(_){ }
  try { sessionStorage.removeItem(CHAT_STORAGE_KEY); } catch(_){ }
}

function saveChatMessage(text, role) {
  try {
    const history = getChatHistory();
    history.push({ text, role, timestamp: Date.now() });
    if(history.length > 200) history.splice(0, history.length - 200); // keep last 200
    setChatHistory(history);
  } catch(e) { console.error('Save message error', e); }
}

function restoreChatHistory() {
  try {
    const history = getChatHistory();
    if(history.length > 0) {
      const welcome = document.querySelector('.welcome-card');
      if(welcome) welcome.remove();
      history.forEach(msg => addMessage(msg.text, msg.role, false));
      // Provide quick toast feedback
      toast(`🔄 Restored ${history.length} messages`, 'success');
    }
  } catch(e) { console.error('Restore history error', e); }
}

function viewChatHistory() {
  try {
    const history = getChatHistory();
    if(history.length === 0){ toast('No chat history', 'warning'); return; }
    showHistoryPanel(history);
  } catch(e){ console.error('View history error', e); toast('Failed to load history', 'error'); }
}

function clearChatHistory() {
  if(confirm('Clear all chat messages? This cannot be undone.')) {
    clearCorruptHistory();
    setChatHistory([]);
    const messagesDiv = document.getElementById('messages');
    if(messagesDiv){ messagesDiv.innerHTML=''; }
    // Re-add welcome card
    if(messagesDiv){ messagesDiv.innerHTML = `\n      <div class="welcome-card" aria-label="Welcome message">\n        <div class="welcome-icon-modern">\n          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">\n            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="url(#welcomeGradient)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>\n            <defs>\n              <linearGradient id="welcomeGradient" x1="0" y1="0" x2="24" y2="24">\n                <stop stop-color="#667eea"/>\n                <stop offset="1" stop-color="#764ba2"/>\n              </linearGradient>\n            </defs>\n          </svg>\n        </div>\n        <h2 class="welcome-title">Welcome to Anand AI</h2>\n        <p class="welcome-desc">Your intelligent assistant powered by advanced AI. Ask me anything, and I'll do my best to help!</p>\n        <div class="quick-actions">\n          <div class="quick-action-chip" data-prompt="Give me 5 creative project ideas for a web developer">💡 Get Ideas</div>\n          <div class="quick-action-chip" data-prompt="Explain how to analyze user data effectively with privacy in mind">📊 Analyze Data</div>\n          <div class="quick-action-chip" data-prompt="Help me write engaging content for a tech blog">✍️ Write Content</div>\n        </div>\n      </div>`; }
    attachQuickActionListeners();
    toast('Chat cleared', 'success');
    hideHistoryPanel();
  }
}

// History panel (inline overlay)
function ensureHistoryPanel(){
  let panel = document.getElementById('history-panel');
  if(!panel){
    panel = document.createElement('div');
    panel.id='history-panel';
    panel.setAttribute('role','dialog');
    panel.setAttribute('aria-label','Chat History');
    panel.style.position='fixed';
    panel.style.top='90px';
    panel.style.right='24px';
    panel.style.width='360px';
    panel.style.maxHeight='60vh';
    panel.style.overflow='auto';
    panel.style.padding='16px';
    panel.style.background='var(--glass)';
    panel.style.backdropFilter='blur(20px)';
    panel.style.WebkitBackdropFilter='blur(20px)';
    panel.style.border='1px solid var(--glass-border)';
    panel.style.borderRadius='var(--radius-lg)';
    panel.style.boxShadow='var(--shadow-lg)';
    panel.style.zIndex='500';
    panel.style.display='none';
    panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><strong>📜 History</strong><button id="history-close" style="background:var(--surface);border:1px solid var(--glass-border);border-radius:8px;padding:4px 8px;color:var(--text-secondary);cursor:pointer;font-size:12px;">Close</button></div><div id="history-content" style="font-size:13px;line-height:1.4;color:var(--text-secondary);"></div>';
    document.body.appendChild(panel);
    const close = panel.querySelector('#history-close');
    close.addEventListener('click', hideHistoryPanel);
  }
  return panel;
}
function showHistoryPanel(history){
  const panel = ensureHistoryPanel();
  const content = panel.querySelector('#history-content');
  content.innerHTML = '';
  const meta = document.createElement('div');
  meta.style.marginBottom='8px';
  meta.textContent = `Messages: ${history.length} | First: ${new Date(history[0].timestamp).toLocaleString()} | Last: ${new Date(history[history.length-1].timestamp).toLocaleString()}`;
  content.appendChild(meta);
  history.slice().reverse().slice(0,100).forEach(item => {
    const row = document.createElement('div');
    row.style.marginBottom='6px';
    row.textContent = `[${item.role}] ${new Date(item.timestamp).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} - ${item.text.slice(0,120)}${item.text.length>120?'…':''}`;
    content.appendChild(row);
  });
  panel.style.display='block';
  trackHistoryOpen(history.length);
  toast('📜 History opened','success');
}
function hideHistoryPanel(){
  const panel=document.getElementById('history-panel');
  if(panel) panel.style.display='none';
}

// ========================================
// Theme Management
// ========================================

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  trackThemeChange(newTheme);
  toast(`${newTheme === 'light' ? '☀️' : '🌙'} ${newTheme.charAt(0).toUpperCase() + newTheme.slice(1)} mode activated`, 'success');
}

function restoreTheme() {
  const savedTheme = localStorage.getItem('theme');
  if(savedTheme) {
    document.documentElement.setAttribute('data-theme', savedTheme);
  } else {
    // Default to dark theme
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const defaultTheme = prefersDark ? 'dark' : 'dark'; // Force dark as default
    document.documentElement.setAttribute('data-theme', defaultTheme);
  }
}

// ========================================
// Keyboard Shortcuts
// ========================================

document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + K: Focus input
  if((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    document.getElementById('message-input').focus();
    toast('💬 Input focused', 'success');
  }
  // Ctrl/Cmd + L: Clear chat
  if((e.ctrlKey || e.metaKey) && e.key === 'l') {
    e.preventDefault();
    clearChatHistory();
  }
  // Escape: Blur input
  if(e.key === 'Escape') {
    document.getElementById('message-input').blur();
  }
});

// ========================================
// Voice Input
// ========================================

function initializeVoiceInput() {
  const voiceBtn = document.getElementById('voice-btn');
  if(!voiceBtn) return;
  
  if('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';
    
    voiceBtn.addEventListener('click', () => {
      try {
        recognition.start();
        voiceBtn.classList.add('recording');
        toast('🎤 Listening...', 'success');
      } catch(e) {
        console.error('Voice recognition error', e);
        toast('Voice input already active', 'error');
      }
    });
    
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      document.getElementById('message-input').value = transcript;
      voiceBtn.classList.remove('recording');
      toast('✅ Voice captured', 'success');
      // Auto-focus input for editing
      document.getElementById('message-input').focus();
    };
    
    recognition.onerror = (e) => {
      voiceBtn.classList.remove('recording');
      if(e.error !== 'aborted' && e.error !== 'no-speech') {
        toast('Voice input error: ' + e.error, 'error');
      }
    };
    
    recognition.onend = () => {
      voiceBtn.classList.remove('recording');
    };
  } else {
    voiceBtn.style.display = 'none';
    console.warn('Speech recognition not supported');
  }
}

// ========================================
// Scroll to Bottom Button
// ========================================

function initializeScrollButton() {
  const scrollBtn = document.getElementById('scroll-to-bottom');
  const messagesDiv = document.getElementById('messages');
  
  if(!scrollBtn || !messagesDiv) return;
  
  // Show/hide based on scroll position
  messagesDiv.addEventListener('scroll', () => {
    const isNearBottom = messagesDiv.scrollHeight - messagesDiv.scrollTop - messagesDiv.clientHeight < 100;
    scrollBtn.hidden = isNearBottom;
  });
  
  // Scroll to bottom when clicked
  scrollBtn.addEventListener('click', () => {
    messagesDiv.scrollTo({
      top: messagesDiv.scrollHeight,
      behavior: 'smooth'
    });
  });
}

// ========================================
// Quick Action Chips
// ========================================

function attachQuickActionListeners() {
  document.querySelectorAll('.quick-action-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const prompt = chip.getAttribute('data-prompt');
      if(prompt) {
        const input = document.getElementById('message-input');
        input.value = prompt;
        input.focus();
        // Auto-send after a brief delay
        setTimeout(() => sendMessage(), 300);
      }
    });
  });
}

// ========================================
// Google Analytics Events (requires GA ID in HTML meta)
// ========================================

const GA_ID = document.querySelector('meta[name="ga-id"]')?.content || '';
function gaEvent(name, params={}){
  try {
    if(typeof gtag === 'function' && GA_ID){
      gtag('event', name, params);
    }
  } catch(e){ console.warn('GA event error', e); }
}

// Hook into existing actions
function trackMessage(role, length){ gaEvent('chat_message', { role, length }); }
function trackThemeChange(theme){ gaEvent('theme_toggle', { theme }); }
function trackSpotify(action){ gaEvent('spotify_action', { action }); }
function trackHistoryOpen(count){ gaEvent('history_open', { count }); }

// Integrations in existing functions
// Message send
document.getElementById('send-btn').addEventListener('click', () => {
  const text = input.value.trim();
  if(text) {
    trackMessage('user', text.length);
  }
});

// Theme toggle
const themeBtn = document.getElementById('theme-toggle-btn');
if(themeBtn) {
  themeBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    trackThemeChange(currentTheme === 'light' ? 'dark' : 'light');
  });
}

// Spotify actions (removed duplicate variable declarations; listeners already attached above)
const spotifyLogoutBtn = document.getElementById('spotify-logout-btn');
if(spotifyLogoutBtn) {
  spotifyLogoutBtn.addEventListener('click', () => {
    trackSpotify('logout');
  });
}

// ========================================
// Initialize All Features
// ========================================

function initializeFeatures() {
  initializeVoiceInput();
  initializeScrollButton();
  attachQuickActionListeners();
  
  // Clear chat button
  const clearBtn = document.getElementById('clear-chat-btn');
  if(clearBtn) clearBtn.addEventListener('click', clearChatHistory);
  
  // Theme toggle button
  const themeBtn = document.getElementById('theme-toggle-btn');
  if(themeBtn) themeBtn.addEventListener('click', toggleTheme);

  // History button
  const historyBtn = document.getElementById('history-btn');
  if(historyBtn) historyBtn.addEventListener('click', viewChatHistory);

  // Spotify logout button
  const spotifyLogoutBtn = document.getElementById('spotify-logout-btn');
  if(spotifyLogoutBtn) spotifyLogoutBtn.addEventListener('click', spotifyLogout);
}
