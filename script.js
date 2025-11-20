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
  const btn = document.getElementById('spotify-login-btn');
  if(btn) btn.hidden = true;
  const playerActive = document.querySelector('.spotify-player-active');
  if(playerActive) playerActive.hidden = false;
}

function deactivateSpotifyUI() {
  const btn = document.getElementById('spotify-login-btn');
  if(btn) btn.hidden = false;
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
  try {
    sessionStorage.removeItem('spotifySession');
  } catch(e) { console.error('Logout error', e); }
  deactivateSpotifyUI();
  toast('Spotify disconnected', 'success');
}

const API_BASE = (document.querySelector('meta[name="api-base"]')?.content || '').trim() || '';

window.addEventListener('load', () => {
  setTimeout(() => {
    document.getElementById('loading-screen').classList.add('hidden');
    document.getElementById('main-app').classList.add('visible');
  }, 2500);
  // Try restore existing session before handling redirect with new code
  restoreSpotifySession().then(() => handleSpotifyRedirect());
  // Restore chat history and theme
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
// Chat History Persistence
// ========================================

function saveChatMessage(text, role) {
  try {
    const history = JSON.parse(localStorage.getItem('chatHistory') || '[]');
    history.push({ text, role, timestamp: Date.now() });
    // Keep last 100 messages
    if(history.length > 100) history.shift();
    localStorage.setItem('chatHistory', JSON.stringify(history));
  } catch(e) { console.error('Save message error', e); }
}

function restoreChatHistory() {
  try {
    const history = JSON.parse(localStorage.getItem('chatHistory') || '[]');
    if(history.length > 0) {
      const welcome = document.querySelector('.welcome-card');
      if(welcome) welcome.remove();
      history.forEach(msg => addMessage(msg.text, msg.role, false));
    }
  } catch(e) { console.error('Restore history error', e); }
}

function viewChatHistory() {
  try {
    const history = JSON.parse(localStorage.getItem('chatHistory') || '[]');
    if(history.length === 0) {
      toast('No chat history available', 'warning');
      return;
    }
    
    const historyInfo = `📜 Chat History\n\n` +
      `Total messages: ${history.length}\n` +
      `First message: ${new Date(history[0].timestamp).toLocaleString()}\n` +
      `Last message: ${new Date(history[history.length - 1].timestamp).toLocaleString()}\n\n` +
      `Recent messages:\n` +
      history.slice(-5).map((msg, i) => 
        `${i + 1}. [${msg.role.toUpperCase()}] ${msg.text.substring(0, 50)}${msg.text.length > 50 ? '...' : ''}`
      ).join('\n');
    
    alert(historyInfo);
    toast('📜 Viewing history', 'success');
  } catch(e) { 
    console.error('View history error', e);
    toast('Failed to load history', 'error');
  }
}

function clearChatHistory() {
  if(confirm('Clear all chat messages? This cannot be undone.')) {
    localStorage.removeItem('chatHistory');
    const messagesDiv = document.getElementById('messages');
    messagesDiv.innerHTML = '';
    // Re-add welcome card
    messagesDiv.innerHTML = `
      <div class="welcome-card" aria-label="Welcome message">
        <div class="welcome-icon-modern">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="url(#welcomeGradient)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <defs>
              <linearGradient id="welcomeGradient" x1="0" y1="0" x2="24" y2="24">
                <stop stop-color="#667eea"/>
                <stop offset="1" stop-color="#764ba2"/>
              </linearGradient>
            </defs>
          </svg>
        </div>
        <h2 class="welcome-title">Welcome to Anand AI</h2>
        <p class="welcome-desc">Your intelligent assistant powered by advanced AI. Ask me anything, and I'll do my best to help!</p>
        <div class="quick-actions">
          <div class="quick-action-chip" data-prompt="Give me 5 creative project ideas for a web developer">💡 Get Ideas</div>
          <div class="quick-action-chip" data-prompt="Explain how to analyze user data effectively with privacy in mind">📊 Analyze Data</div>
          <div class="quick-action-chip" data-prompt="Help me write engaging content for a tech blog">✍️ Write Content</div>
        </div>
      </div>`;
    attachQuickActionListeners();
    toast('Chat cleared', 'success');
  }
}

// ========================================
// Theme Management
// ========================================

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
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
