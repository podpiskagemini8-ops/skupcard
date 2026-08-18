/* ============ ROMEO ADMIN CONTROLLER ============ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

let activeChatUserId = null;
let allChats = [];
let pollingTimer = null;
let mediaRecorder = null;
let audioChunks = [];
let recordStartTime = 0;
let recordTimerInterval = null;
let pendingAttachment = null; // { type: 'image' | 'voice', dataUrl: string, duration?: number }

// Elements
const chatListEl = $('#chatList');
const searchInput = $('#searchInput');
const chatPlaceholder = $('#chatPlaceholder');
const chatView = $('#chatView');
const acMessages = $('#acMessages');
const adminSendForm = $('#adminSendForm');
const adminInput = $('#adminInput');
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
const backToListBtn = $('#backToListBtn');
const adminSidebar = $('#adminSidebar');
const adminChat = $('#adminChat');

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function avatarLetter(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ============ AUDIO PLAYER HELPER & AMPLIFIER ============ */
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

function renderAudioMessage(msg) {
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

      // Pause all other audio players
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

/* ============ RENDER MESSAGES ============ */
function renderMessageItem(msg) {
  const isRomeo = msg.sender === 'buyer';
  const time = fmtTime(msg.created_at);

  let bodyContent = '';
  if (msg.type === 'image' && msg.media_url) {
    bodyContent = `
      <div class="msg-image-wrap">
        <img src="${escapeHtml(msg.media_url)}" alt="Фото" class="chat-image-clickable">
      </div>
      ${msg.text ? `<p class="msg-caption">${escapeHtml(msg.text)}</p>` : ''}
    `;
  } else if (msg.type === 'voice' && msg.media_url) {
    bodyContent = renderAudioMessage(msg);
  } else {
    bodyContent = `<p>${escapeHtml(msg.text)}</p>`;
  }

  return `
    <div class="ac-msg ${isRomeo ? 'ac-msg-romeo' : 'ac-msg-client'}">
      <div class="ac-msg-bubble">
        <span class="ac-msg-sender">${isRomeo ? 'Ромео' : 'Клиент'}</span>
        ${bodyContent}
        <span class="ac-msg-time">${time}</span>
      </div>
    </div>
  `;
}

let lastRenderedChatListHash = '';
let activeChatLoadedUserId = null;
let activeChatLastMessageCount = 0;

/* ============ LOAD CHATS ============ */
async function loadChats() {
  try {
    const { chats } = await api('/api/admin/chats');
    allChats = chats || [];
    const hash = JSON.stringify(allChats.map(c => `${c.id}-${c.last_message}-${c.last_message_time}`));
    if (hash !== lastRenderedChatListHash) {
      lastRenderedChatListHash = hash;
      renderChatList();
    }
    $('#chatCount').textContent = allChats.length;
  } catch (e) {
    if (e.message && (e.message.includes('запрещён') || e.message.includes('авторизован') || e.message.includes('401') || e.message.includes('403'))) {
      clearInterval(pollingTimer);
      location.href = '/#auth=login';
    }
  }
}

function renderChatList() {
  const filter = (searchInput.value || '').trim().toLowerCase();
  const filtered = allChats.filter(c =>
    (c.name || '').toLowerCase().includes(filter) ||
    (c.login || '').toLowerCase().includes(filter)
  );

  if (!filtered.length) {
    chatListEl.innerHTML = `<div class="chat-list-empty">Нет подходящих диалогов</div>`;
    return;
  }

  chatListEl.innerHTML = filtered.map(c => {
    const activeClass = c.id === activeChatUserId ? 'active' : '';
    let previewText = c.last_message || 'Новый диалог';
    if (c.last_type === 'image') previewText = '📷 Фотография';
    if (c.last_type === 'voice') previewText = '🎤 Голосовое сообщение';
    const time = fmtTime(c.last_message_time || c.created_at);

    return `
      <div class="chat-item ${activeClass}" data-user-id="${c.id}">
        <div class="ci-avatar">${avatarLetter(c.name)}</div>
        <div class="ci-info">
          <div class="ci-row">
            <strong class="ci-name">${escapeHtml(c.name)}</strong>
            <span class="ci-time">${time}</span>
          </div>
          <div class="ci-row">
            <span class="ci-preview">${escapeHtml(previewText)}</span>
            <span class="ci-login">@${escapeHtml(c.login)}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  $$('.chat-item', chatListEl).forEach(item => {
    item.addEventListener('click', () => {
      const userId = Number(item.dataset.userId);
      selectChat(userId);
    });
  });
}

/* ============ SELECT & LOAD ACTIVE CHAT ============ */
async function selectChat(userId) {
  if (activeChatUserId !== userId) {
    activeChatUserId = userId;
    activeChatLoadedUserId = null;
    activeChatLastMessageCount = 0;
  }

  chatPlaceholder.style.display = 'none';
  chatView.style.display = 'flex';

  // For mobile view: switch view
  document.body.classList.add('mobile-chat-open');

  // Find user data
  const chatInfo = allChats.find(c => c.id === userId);
  if (chatInfo) {
    $('#activeUserName').textContent = chatInfo.name;
    $('#activeUserLogin').textContent = `@${chatInfo.login}`;
    $('#activeUserAvatar').textContent = avatarLetter(chatInfo.name);
  }

  // Update active class in sidebar
  $$('.chat-item', chatListEl).forEach(item => {
    item.classList.toggle('active', Number(item.dataset.userId) === userId);
  });

  await refreshActiveMessages(true);
  adminInput.focus();
}

async function refreshActiveMessages(shouldScroll = false) {
  if (!activeChatUserId) return;
  try {
    const { user, messages = [] } = await api(`/api/admin/chats/${activeChatUserId}/messages`);
    if (user) {
      $('#activeUserName').textContent = user.name;
      $('#activeUserLogin').textContent = `@${user.login}`;
      $('#activeUserAvatar').textContent = avatarLetter(user.name);
    }

    if (activeChatLoadedUserId !== activeChatUserId) {
      // First load of this chat
      activeChatLoadedUserId = activeChatUserId;
      activeChatLastMessageCount = messages.length;
      if (!messages.length) {
        acMessages.innerHTML = `<div class="chat-list-empty">Сообщений пока нет. Напишите клиенту первым!</div>`;
      } else {
        acMessages.innerHTML = messages.map(renderMessageItem).join('');
        bindAudioPlayers(acMessages);
      }
      acMessages.scrollTop = acMessages.scrollHeight;
    } else {
      // Only append new messages if count increased
      if (messages.length > activeChatLastMessageCount) {
        // Remove empty placeholder if present
        const emptyEl = $('.chat-list-empty', acMessages);
        if (emptyEl) emptyEl.remove();

        const newMessages = messages.slice(activeChatLastMessageCount);
        newMessages.forEach(msg => {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = renderMessageItem(msg);
          const el = wrapper.firstElementChild;
          acMessages.appendChild(el);
          bindAudioPlayers(el);
        });
        activeChatLastMessageCount = messages.length;
        acMessages.scrollTop = acMessages.scrollHeight;
      }
    }
  } catch (e) {
    console.error('Ошибка обновления сообщений:', e);
  }
}

/* ============ SEND MESSAGE (TEXT / PHOTO / VOICE) ============ */
async function sendMessage() {
  if (!activeChatUserId) return;

  const text = adminInput.value.trim();
  if (!text && !pendingAttachment) return;

  const btn = $('#adminSubmitBtn');
  btn.disabled = true;

  try {
    let payload = { text, type: 'text' };

    if (pendingAttachment) {
      // Upload media first
      const { url } = await api('/api/upload', {
        method: 'POST',
        body: JSON.stringify({ data: pendingAttachment.dataUrl })
      });
      payload.type = pendingAttachment.type;
      payload.media_url = url;
      if (pendingAttachment.duration) payload.duration = pendingAttachment.duration;
    }

    await api(`/api/admin/chats/${activeChatUserId}/messages`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    adminInput.value = '';
    clearPendingAttachment();
    await refreshActiveMessages(true);
    await loadChats();
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
    adminInput.focus();
  }
}

/* ============ ATTACHMENTS & VOICE RECORDING ============ */
function setPendingAttachment(att) {
  pendingAttachment = att;
  mediaPreviewBar.style.display = 'flex';
  if (att.type === 'image') {
    mediaPreviewContent.innerHTML = `<img src="${att.dataUrl}" alt="Превью" class="mp-thumb"> <span>Прикреплено фото</span>`;
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

// Photo attachment
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
    mediaRecorder.start(200);
    recordStartTime = Date.now();
    startRecordingTimer();

    voiceRecordingBar.style.display = 'flex';
    adminSendForm.style.display = 'none';
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
  adminSendForm.style.display = 'flex';
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
      await sendMessage();
    };
    reader.readAsDataURL(audioBlob);
  };

  if (typeof mediaRecorder.requestData === 'function') {
    try { mediaRecorder.requestData(); } catch (e) {}
  }
  mediaRecorder.stop();
  stopRecordingTimer();
  voiceRecordingBar.style.display = 'none';
  adminSendForm.style.display = 'flex';
});

/* ============ QUICK TEMPLATES ============ */
$$('.quick-templates .q-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    adminInput.value = btn.dataset.text || '';
    adminInput.focus();
  });
});

/* ============ MOBILE NAVIGATION ============ */
backToListBtn.addEventListener('click', () => {
  document.body.classList.remove('mobile-chat-open');
});

/* ============ INITIALIZE ============ */
async function initAdmin() {
  try {
    const { user } = await api('/api/me');
    if (!user || user.role !== 'admin') {
      location.href = '/#auth=login';
      return;
    }
    $('#adminName').textContent = `${user.name}`;
  } catch (e) {
    location.href = '/#auth=login';
    return;
  }

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    location.href = '/';
  });

  searchInput.addEventListener('input', renderChatList);
  adminSendForm.addEventListener('submit', (e) => {
    e.preventDefault();
    sendMessage();
  });

  initLightbox();
  await loadChats();

  // Polling every 2.5 seconds
  pollingTimer = setInterval(async () => {
    await loadChats();
    if (activeChatUserId) {
      await refreshActiveMessages(false);
    }
  }, 2500);
}

document.addEventListener('DOMContentLoaded', initAdmin);
