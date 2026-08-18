/* ============ CLIENT CHAT CONTROLLER ============ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Что-то пошло не так');
  return data;
}

const chatBody = $('#chatBody');
const input = $('#chatInput');
const sendBtn = $('#sendBtn');
const attachPhotoBtn = $('#attachPhotoBtn');
const photoInput = $('#photoInput');
const recordVoiceBtn = $('#recordVoiceBtn');
const voiceRecordingBar = $('#voiceRecordingBar');
const voiceTimer = $('#voiceTimer');
const cancelVoiceBtn = $('#cancelVoiceBtn');
const sendVoiceBtn = $('#sendVoiceBtn');
const mediaPreviewBar = $('#mediaPreviewBar');
const mediaPreviewContent = $('#mediaPreviewContent');
const removeMediaBtn = $('#removeMediaBtn');
const chatInputRow = $('#chatInputRow');

let busy = false;
let mediaRecorder = null;
let audioChunks = [];
let recordStartTime = 0;
let recordTimerInterval = null;
let pendingAttachment = null;
let lastMessageCount = 0;

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtDay(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (sameDay) return 'Сегодня';
  if (d.toDateString() === yest.toDateString()) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ============ AUDIO PLAYER & AMPLIFIER ============ */
let sharedAudioCtx = null;
function getSharedAudioContext() {
  if (!sharedAudioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) sharedAudioCtx = new AudioCtx();
  }
  if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') {
    sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

function boostAudio(audioEl, gainVal = 2.5) {
  try {
    const ctx = getSharedAudioContext();
    if (!ctx || audioEl._boosted) return;
    audioEl._boosted = true;

    const source = ctx.createMediaElementSource(audioEl);
    const gainNode = ctx.createGain();
    gainNode.gain.value = gainVal;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-18, ctx.currentTime);
    compressor.knee.setValueAtTime(30, ctx.currentTime);
    compressor.ratio.setValueAtTime(8, ctx.currentTime);
    compressor.attack.setValueAtTime(0.003, ctx.currentTime);
    compressor.release.setValueAtTime(0.25, ctx.currentTime);

    source.connect(gainNode);
    gainNode.connect(compressor);
    compressor.connect(ctx.destination);
  } catch (e) {
    // MediaElementSource fallback
  }
}

function renderAudioPlayer(msg) {
  const durSec = msg.duration ? `${Math.floor(msg.duration / 60)}:${String(msg.duration % 60).padStart(2, '0')}` : '0:00';
  return `
    <div class="voice-bubble" data-audio-src="${escapeHtml(msg.media_url)}">
      <button type="button" class="voice-play-btn" aria-label="Воспроизвести">
        <svg class="icon-play" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>
        <svg class="icon-pause" viewBox="0 0 24 24" fill="currentColor" style="display:none;"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
      </button>
      <div class="voice-track">
        <div class="voice-waveform">
          <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
        </div>
        <div class="voice-meta">
          <span class="voice-time-label">${durSec}</span>
        </div>
      </div>
      <audio src="${escapeHtml(msg.media_url)}" preload="metadata" crossorigin="anonymous" style="display:none;"></audio>
    </div>
  `;
}

function bindAudioPlayers(root = document) {
  $$('.voice-bubble', root).forEach(box => {
    if (box._bound) return;
    box._bound = true;
    const audio = box.querySelector('audio');
    const playBtn = box.querySelector('.voice-play-btn');
    const iconPlay = box.querySelector('.icon-play');
    const iconPause = box.querySelector('.icon-pause');
    const timeLabel = box.querySelector('.voice-time-label');

    if (!audio || !playBtn) return;
    audio.volume = 1.0;

    const togglePlay = () => {
      getSharedAudioContext();
      boostAudio(audio, 2.5);

      $$('audio').forEach(a => { if (a !== audio) { a.pause(); a.currentTime = 0; } });
      if (audio.paused) {
        audio.play().catch(() => {});
      } else {
        audio.pause();
      }
    };

    playBtn.addEventListener('click', togglePlay);

    audio.addEventListener('play', () => {
      iconPlay.style.display = 'none';
      iconPause.style.display = 'block';
      box.classList.add('playing');
    });

    audio.addEventListener('pause', () => {
      iconPlay.style.display = 'block';
      iconPause.style.display = 'none';
      box.classList.remove('playing');
    });

    audio.addEventListener('ended', () => {
      iconPlay.style.display = 'block';
      iconPause.style.display = 'none';
      box.classList.remove('playing');
      audio.currentTime = 0;
    });

    audio.addEventListener('timeupdate', () => {
      const cur = Math.floor(audio.currentTime);
      const curStr = `${Math.floor(cur / 60)}:${String(cur % 60).padStart(2, '0')}`;
      timeLabel.textContent = curStr;
    });
  });
}

/* ============ LIGHTBOX ============ */
function initLightbox() {
  const lb = $('#lightbox');
  const lbImg = $('#lightboxImg');
  const close = () => { lb.classList.remove('open'); lb.setAttribute('aria-hidden', 'true'); };

  $('#lightboxClose').addEventListener('click', close);
  $('#lightboxBackdrop').addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  document.addEventListener('click', e => {
    const img = e.target.closest('.chat-image-clickable');
    if (img) {
      lbImg.src = img.dataset.fullSrc || img.src;
      lb.classList.add('open');
      lb.setAttribute('aria-hidden', 'false');
    }
  });
}

const renderedMsgIds = new Set();

/* ============ RENDER MESSAGES ============ */
function addMsg(msg, scroll = true) {
  if (msg.id && renderedMsgIds.has(msg.id)) return;
  if (msg.id) renderedMsgIds.add(msg.id);

  const isUser = msg.sender === 'user';
  const el = document.createElement('div');
  el.className = isUser ? 'msg msg-user' : 'msg msg-buyer';

  let body = '';
  if (msg.type === 'image' && msg.media_url) {
    body = `
      <div class="msg-image-wrap">
        <img src="${escapeHtml(msg.media_url)}" alt="Фото" class="chat-image-clickable">
      </div>
      ${msg.text ? `<p class="msg-caption">${escapeHtml(msg.text)}</p>` : ''}
    `;
  } else if (msg.type === 'voice' && msg.media_url) {
    body = renderAudioPlayer(msg);
  } else {
    body = `<p>${escapeHtml(msg.text)}</p>`;
  }

  el.innerHTML = isUser
    ? `<div class="bubble">${body}<span class="m-time">${fmtTime(msg.created_at)}</span></div>`
    : `<span class="m-avatar">Р</span><div class="bubble">${body}<span class="m-time">${fmtTime(msg.created_at)}</span></div>`;

  chatBody.appendChild(el);
  bindAudioPlayers(el);
  if (scroll) chatBody.scrollTop = chatBody.scrollHeight;
}

/* ============ SEND MESSAGE ============ */
async function send() {
  const text = input.value.trim();
  if ((!text && !pendingAttachment) || busy) return;

  busy = true;
  sendBtn.disabled = true;

  try {
    let payload = { text, type: 'text' };

    if (pendingAttachment) {
      const { url } = await api('/api/upload', {
        method: 'POST',
        body: JSON.stringify({ data: pendingAttachment.dataUrl })
      });
      payload.type = pendingAttachment.type;
      payload.media_url = url;
      if (pendingAttachment.duration) payload.duration = pendingAttachment.duration;
    }

    input.value = '';
    clearPendingAttachment();

    const { message } = await api('/api/messages', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    addMsg(message, true);
    lastMessageCount++;
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
    sendBtn.disabled = false;
    input.focus();
  }
}

/* ============ ATTACHMENTS & VOICE RECORDING ============ */
function setPendingAttachment(att) {
  pendingAttachment = att;
  mediaPreviewBar.style.display = 'flex';
  if (att.type === 'image') {
    mediaPreviewContent.innerHTML = `<img src="${att.dataUrl}" alt="Превью" class="mp-thumb"> <span>Фото прикреплено</span>`;
  } else if (att.type === 'voice') {
    mediaPreviewContent.innerHTML = `<span>🎤 Голосовое (${att.duration} сек)</span>`;
  }
}

function clearPendingAttachment() {
  pendingAttachment = null;
  mediaPreviewBar.style.display = 'none';
  mediaPreviewContent.innerHTML = '';
}

removeMediaBtn.addEventListener('click', clearPendingAttachment);

// Photos
attachPhotoBtn.addEventListener('click', () => photoInput.click());
photoInput.addEventListener('change', () => {
  const file = photoInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    setPendingAttachment({ type: 'image', dataUrl: e.target.result });
  };
  reader.readAsDataURL(file);
  photoInput.value = '';
});

// Voice recording
let timerCount = 0;
function startRecordingTimer() {
  timerCount = 0;
  voiceTimer.textContent = '0:00';
  clearInterval(recordTimerInterval);
  recordTimerInterval = setInterval(() => {
    timerCount++;
    const min = Math.floor(timerCount / 60);
    const sec = String(timerCount % 60).padStart(2, '0');
    voiceTimer.textContent = `${min}:${sec}`;
  }, 1000);
}

function stopRecordingTimer() {
  clearInterval(recordTimerInterval);
}

recordVoiceBtn.addEventListener('click', async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
        channelCount: 1
      }
    });
    audioChunks = [];

    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
      mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
                 MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' :
                 MediaRecorder.isTypeSupported('audio/ogg') ? 'audio/ogg' : '';
    }
    const options = mimeType ? { mimeType, audioBitsPerSecond: 128000 } : {};

    mediaRecorder = new MediaRecorder(stream, options);
    mediaRecorder.ondataavailable = e => { if (e.data && e.data.size > 0) audioChunks.push(e.data); };
    mediaRecorder.start(200); // 200ms timeslice to capture audio continuously
    recordStartTime = Date.now();
    startRecordingTimer();

    voiceRecordingBar.style.display = 'flex';
    chatInputRow.style.display = 'none';
  } catch (e) {
    alert('Не удалось получить доступ к микрофону. Проверьте разрешения браузера.');
  }
});

cancelVoiceBtn.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }
  stopRecordingTimer();
  voiceRecordingBar.style.display = 'none';
  chatInputRow.style.display = 'flex';
});

sendVoiceBtn.addEventListener('click', () => {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
  const duration = Math.max(1, Math.round((Date.now() - recordStartTime) / 1000));

  mediaRecorder.onstop = () => {
    const mime = mediaRecorder.mimeType || 'audio/webm';
    const audioBlob = new Blob(audioChunks, { type: mime });
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
    const reader = new FileReader();
    reader.onload = async () => {
      setPendingAttachment({ type: 'voice', dataUrl: reader.result, duration });
      await send();
    };
    reader.readAsDataURL(audioBlob);
  };

  if (typeof mediaRecorder.requestData === 'function') {
    try { mediaRecorder.requestData(); } catch (e) {}
  }
  mediaRecorder.stop();
  stopRecordingTimer();
  voiceRecordingBar.style.display = 'none';
  chatInputRow.style.display = 'flex';
});

function toast(text) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ============ POLLING & INIT ============ */
async function loadMessages(initial = false) {
  try {
    const { messages = [] } = await api('/api/messages');
    if (initial && messages.length) {
      $('#chatDate').textContent = fmtDay(messages[0].created_at);
    }
    messages.forEach(m => addMsg(m, !initial));
    lastMessageCount = messages.length;
  } catch (e) {
    console.error('Ошибка загрузки сообщений:', e);
  }
}

async function init() {
  try {
    const me = await api('/api/me');
    if (!me || !me.user) {
      location.href = '/#auth=login';
      return;
    }
    // If admin is visiting chat.html, redirect immediately to admin
    if (me.user.role === 'admin') {
      location.href = '/admin.html';
      return;
    }
  } catch (e) {
    location.href = '/#auth=login';
    return;
  }

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    location.href = '/';
  });

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

  initLightbox();
  await loadMessages(true);

  // Poll for new messages every 3 seconds
  setInterval(() => loadMessages(false), 3000);
}

document.addEventListener('DOMContentLoaded', init);