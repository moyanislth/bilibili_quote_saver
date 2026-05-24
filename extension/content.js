(function () {
  const SUBTITLE_SELECTORS = [
    '.bpx-player-subtitle-panel-text',
    '.bpx-player-subtitle-panel-item-text',
    '.bpx-player-subtitle-panel-item',
    '.bpx-player-subtitle-item-text',
    '.bpx-player-subtitle-panel-ai-text',
    '.bpx-player-subtitle-ai-wrapper .bpx-player-subtitle-panel-text',
    '[class*="subtitle-panel"][class*="ai"] [class*="text"]',
    '.bilibili-player-video-subtitle .subtitle-item-text',
    '.bilibili-player-video-subtitle',
    '[class*="subtitle"] [class*="text"]',
    '[class*="subtitle"]'
  ];

  const BLOCKED_TEXTS = new Set([
    '字幕',
    '关闭字幕',
    '开启字幕',
    '自动字幕',
    '弹幕',
    '发送',
    '点赞',
    '投币',
    '收藏',
    '分享',
    '播放',
    '暂停',
    '全屏',
    '退出全屏',
    '倍速',
    '画质',
    '设置'
  ]);

  const RESCAN_INTERVAL_MS = 2000;
  const TOAST_DURATION_MS = 3000;
  const BUFFER_DURATION_SEC = 30;

  const state = {
    currentSubtitle: '',
    subtitleUpdatedAt: 0,
    history: [],
    buffer: [],
    observer: null,
    videoObserver: null,
    rescanTimer: null,
    video: null,
    toastTimer: null,
    debounceTimer: null,
    session: {
      active: false,
      startedAt: 0,
      startedTimestampSec: 0,
      items: [],
      lastToggledAt: 0
    },
    lastVideoUrl: '',
    lastSessionEndedAt: 0,
    sttActive: false,
    subtitleCache: null,
    subtitleCacheBvid: ''
  };

  let scanScheduled = false;
  let indicatorStyleInjected = false;

  init();

  window.addEventListener('beforeunload', () => finalizeAndSave());

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'TOGGLE_CAPTURE_SESSION') {
      sendResponse(toggleCaptureSession());
      return true;
    }

    if (message?.type === 'GET_CAPTURE_STATE') {
      sendResponse({ active: state.session.active, startedAt: state.session.active ? state.session.startedAt : 0 });
      return true;
    }

    if (message?.type === 'GET_SESSION_PREVIEW') {
      sendResponse({ items: state.session.items.slice(-5) });
      return true;
    }

    if (message?.type === 'STT_RESULT') {
      handleSTTResult(message.text);
      return undefined;
    }

    if (message?.type === 'SHOW_TOAST') {
      showToast(message.payload?.message || '操作完成', Boolean(message.payload?.success));
    }

    return undefined;
  });

  function init() {
    bindVideo();
    observeSubtitleChanges();
    scheduleRescan();
    updateRecordingIndicator(false);
    state.lastVideoUrl = window.location.href;
    fetchSubtitleCache();
    restoreSessionIfExists();
  }

  async function persistSessionState() {
    try {
      await chrome.storage.session.set({ bqs_session: {
        active: state.session.active,
        startedAt: state.session.startedAt,
        startedTimestampSec: state.session.startedTimestampSec,
        items: state.session.items,
        videoUrl: window.location.href
      }});
    } catch { /* storage.session may not be available */ }
  }

  async function clearPersistedSession() {
    try {
      await chrome.storage.session.remove('bqs_session');
    } catch { /* ignore */ }
  }

  async function restoreSessionIfExists() {
    try {
      const result = await chrome.storage.session.get('bqs_session');
      const saved = result?.bqs_session;
      if (!saved?.active) return;
      if (saved.videoUrl !== window.location.href) {
        await clearPersistedSession();
        return;
      }
      state.session.active = true;
      state.session.startedAt = saved.startedAt;
      state.session.startedTimestampSec = saved.startedTimestampSec;
      state.session.items = saved.items || [];
      updateRecordingIndicator(true);
      showToast('录制已恢复（页面刷新前已捕获的字幕已保留）', true);
    } catch { /* ignore */ }
  }

  function extractBvid(url) {
    // Try URL path first (standard /video/BVxxx format)
    const match = url.match(/\/video\/(BV[a-zA-Z0-9]+)/);
    if (match) return match[1];

    // Try window.__INITIAL_STATE__ (handles short URLs / embedded players)
    try {
      if (window.__INITIAL_STATE__?.videoData?.bvid) {
        return window.__INITIAL_STATE__.videoData.bvid;
      }
    } catch {
      // ignore
    }

    // Try <meta> tags (og:url may contain canonical URL)
    const meta = document.querySelector('meta[property="og:url"], meta[name="og:url"]');
    if (meta) {
      const metaMatch = meta.content?.match(/\/video\/(BV[a-zA-Z0-9]+)/);
      if (metaMatch) return metaMatch[1];
    }

    // Scan all meta tags for a BV pattern as last resort
    const allMetas = document.querySelectorAll('meta');
    for (const m of allMetas) {
      const content = m.getAttribute('content') || '';
      const bvMatch = content.match(/BV[a-zA-Z0-9]+/);
      if (bvMatch) return bvMatch[0];
    }

    return null;
  }

  async function fetchSubtitleCache() {
    const bvid = extractBvid(window.location.href);
    if (!bvid) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: 'FETCH_SUBTITLE_API', bvid });
      if (response?.subtitles) {
        state.subtitleCache = response.subtitles;
        state.subtitleCacheBvid = bvid;
      }
    } catch {
      // API unavailable — DOM scraping is the fallback
    }
  }

  // ---------------------------------------------------------------------------
  // Throttled scanning — coalesce all trigger sources into one scan per frame
  // ---------------------------------------------------------------------------

  function requestScan() {
    if (scanScheduled) return;
    scanScheduled = true;
    requestAnimationFrame(() => {
      scanScheduled = false;
      scanSubtitle();
    });
  }

  /**
   * Detect SPA navigation by comparing the current URL against the last known URL.
   * If the URL changed during an active session the session is silently abandoned
   * to prevent cross-video data corruption (mixing subtitles from two videos).
   */
  function detectUrlChange() {
    const currentUrl = window.location.href;
    if (!state.lastVideoUrl) {
      state.lastVideoUrl = currentUrl;
      return;
    }
    if (state.lastVideoUrl === currentUrl) {
      return;
    }

    const wasActive = state.session.active;
    const capturedCount = state.session.items.length;

    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }

    state.currentSubtitle = '';
    state.subtitleUpdatedAt = 0;
    state.history = [];
    state.buffer = [];

    if (state.session.active) {
      state.session.active = false;
      state.session.startedAt = 0;
      state.session.startedTimestampSec = 0;
      state.session.items = [];
      updateRecordingIndicator(false);
      stopSTTIfActive();
    }

    state.lastVideoUrl = currentUrl;
    state.subtitleCache = null;
    state.subtitleCacheBvid = '';
    fetchSubtitleCache();

    if (wasActive) {
      showToast(`页面视频切换，录制已中断（已捕获 ${capturedCount} 条字幕）`, false);
    }
  }

  // ---------------------------------------------------------------------------
  // Video binding
  // ---------------------------------------------------------------------------

  function bindVideo() {
    const attachVideo = () => {
      const video = document.querySelector('video');
      if (!video || state.video === video) {
        return;
      }

      // Clean up event listeners on the previous video element before rebinding
      if (state.video) {
        state.video.removeEventListener('timeupdate', requestScan);
        state.video.removeEventListener('seeked', requestScan);
        state.video.removeEventListener('play', requestScan);
      }

      state.video = video;
      video.addEventListener('timeupdate', requestScan, { passive: true });
      video.addEventListener('seeked', requestScan, { passive: true });
      video.addEventListener('play', requestScan, { passive: true });
      requestScan();
    };

    attachVideo();

    if (state.videoObserver) {
      state.videoObserver.disconnect();
    }

    state.videoObserver = new MutationObserver(() => attachVideo());
    state.videoObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  function observeSubtitleChanges() {
    if (state.observer) {
      state.observer.disconnect();
    }

    state.observer = new MutationObserver(() => requestScan());
    state.observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  function scheduleRescan() {
    if (state.rescanTimer) {
      clearInterval(state.rescanTimer);
    }

    state.rescanTimer = window.setInterval(requestScan, RESCAN_INTERVAL_MS);
  }

  function commitSubtitle(text) {
    if (!text) return;
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
    pushHistory(text);
    pushSessionItem(text);
    pushBuffer(text);
  }

  function pushBuffer(text) {
    const currentTime = getCurrentTime();
    const cutoff = currentTime - BUFFER_DURATION_SEC;
    while (state.buffer.length && state.buffer[0].timestampSec < cutoff) {
      state.buffer.shift();
    }
    const lastItem = state.buffer[state.buffer.length - 1];
    if (lastItem?.text === text) return;
    state.buffer.push({ text, timestampSec: currentTime, updatedAt: Date.now() });
  }

  // ---------------------------------------------------------------------------
  // Subtitle extraction
  // ---------------------------------------------------------------------------

  function scanSubtitle() {
    detectUrlChange();

    const subtitle = pickBestSubtitle();
    if (!subtitle) {
      return;
    }

    if (subtitle !== state.currentSubtitle) {
      state.currentSubtitle = subtitle;
      state.subtitleUpdatedAt = Date.now();

      if (state.debounceTimer) {
        clearTimeout(state.debounceTimer);
        state.debounceTimer = null;
      }

      // Commit immediately if the text ends with sentence-ending punctuation
      if (/[。！？]$/.test(subtitle)) {
        commitSubtitle(subtitle);
        return;
      }

      // Debounce: wait for the text to stabilize before committing
      state.debounceTimer = setTimeout(() => {
        state.debounceTimer = null;
        commitSubtitle(state.currentSubtitle);
      }, 500);
    }
  }

  /**
   * Try selectors in order of specificity and return the first batch of valid
   * candidates.  This avoids running querySelectorAll across all 8 selectors
   * every time — in practice the first selector matches on modern B站 layouts.
   */
  function pickBestSubtitle() {
    for (const selector of SUBTITLE_SELECTORS) {
      const nodes = document.querySelectorAll(selector);
      const candidates = [];

      for (const node of nodes) {
        const text = normalizeText(node.textContent || '');
        if (!text || !isVisible(node) || !looksLikeSubtitle(text, node)) {
          continue;
        }

        const rect = node.getBoundingClientRect();
        const horizontalCenter = rect.left + rect.width / 2;
        const verticalCenter = rect.top + rect.height / 2;
        const centerDistance = Math.abs(horizontalCenter - window.innerWidth / 2) / Math.max(window.innerWidth / 2, 1);
        const targetY = window.innerHeight * 0.78;
        const verticalDistance = Math.abs(verticalCenter - targetY) / Math.max(window.innerHeight, 1);
        const score =
          Math.max(0, 4 - centerDistance * 6) +
          Math.max(0, 4 - verticalDistance * 20) +
          Math.min(text.length / 24, 2);

        candidates.push({ text, score });
      }

      if (candidates.length) {
        candidates.sort((left, right) => right.score - left.score);
        return candidates[0].text;
      }
    }

    return '';
  }

  function looksLikeSubtitle(text, node) {
    const compact = text.replace(/\s+/g, '');
    if (compact.length < 2 || compact.length > 120) {
      return false;
    }

    if (BLOCKED_TEXTS.has(compact)) {
      return false;
    }

    if (isInsideControl(node)) {
      return false;
    }

    const rect = node.getBoundingClientRect();
    const verticalCenter = rect.top + rect.height / 2;
    if (verticalCenter < window.innerHeight * 0.35 || verticalCenter > window.innerHeight * 0.92) {
      return false;
    }

    if (compact.length <= 2 && !/[，。？！、“”]/.test(compact)) {
      return false;
    }

    return true;
  }

  function isInsideControl(node) {
    if (!(node instanceof Element)) {
      return true;
    }

    return Boolean(
      node.closest(
        'button, [role="button"], .bpx-player-control-wrap, .bpx-player-control-bottom, .bpx-player-control-top, .bpx-player-ctrl-wrap, .bpx-player-control-btn, .bilibili-player-video-control-wrap'
      )
    );
  }

  function isVisible(node) {
    if (!(node instanceof HTMLElement)) {
      return false;
    }

    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }

    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // ---------------------------------------------------------------------------
  // History & session
  // ---------------------------------------------------------------------------

  function pushHistory(text) {
    const currentTime = getCurrentTime();
    const lastItem = state.history[state.history.length - 1];
    if (lastItem?.text === text) {
      return;
    }

    state.history.push({
      text,
      timestampSec: currentTime,
      updatedAt: Date.now()
    });

    if (state.history.length > 30) {
      state.history.shift();
    }
  }

  function toggleCaptureSession() {
    if (Date.now() - state.session.lastToggledAt < 300) {
      return { success: false, reason: 'cooldown' };
    }
    const result = state.session.active ? stopSession() : startSession();
    state.session.lastToggledAt = Date.now();
    return result;
  }

  function startSession() {
    scanSubtitle();

    state.session.active = true;
    state.session.startedAt = Date.now();
    state.session.items = [];

    // Pre-populate from retroactive buffer (last N seconds, not before previous session end)
    const currentTime = getCurrentTime();
    const cutoff = Math.max(currentTime - BUFFER_DURATION_SEC, state.lastSessionEndedAt);
    const buffered = state.buffer.filter((item) => item.timestampSec >= cutoff);
    let bufferedCount = 0;

    if (buffered.length) {
      state.session.items = buffered.map((item) => ({ ...item }));
      state.session.startedTimestampSec = buffered[0].timestampSec;
      bufferedCount = buffered.length;
    } else {
      state.session.startedTimestampSec = currentTime;
    }

    if (state.currentSubtitle) {
      pushSessionItem(state.currentSubtitle, true);
    }

    updateRecordingIndicator(true);
    persistSessionState();
    return {
      success: true,
      active: true,
      bufferedCount,
      bufferDuration: BUFFER_DURATION_SEC
    };
  }

  function stopSession() {
    scanSubtitle();

    if (state.currentSubtitle) {
      pushSessionItem(state.currentSubtitle, true);
    }

    const items = dedupeSessionItems(state.session.items);
    const endTimestampSec = state.video ? getCurrentTime() : getFallbackTimestamp();
    const startedTimestampSec = state.session.startedTimestampSec;

    state.session.active = false;
    state.session.startedAt = 0;
    state.session.startedTimestampSec = 0;
    state.session.items = [];
    updateRecordingIndicator(false);
    clearPersistedSession();
    stopSTTIfActive();
    state.lastSessionEndedAt = endTimestampSec;

    // Prefer API data for perfect, unfragmented text
    let text;
    let lineCount;
    let mode = 'session';

    if (state.subtitleCache?.length) {
      const apiEntries = state.subtitleCache.filter(
        (entry) => entry.from >= startedTimestampSec && entry.from <= endTimestampSec
      );
      if (apiEntries.length) {
        text = apiEntries.map((entry) => entry.content).join('\n');
        lineCount = apiEntries.length;
        mode = 'api';
      }
    }

    // Fallback to DOM-scraped items
    if (!text) {
      if (!items.length) {
        // Trigger STT as last resort
        if (!state.sttActive) {
          state.sttActive = true;
          chrome.runtime.sendMessage({ type: 'STT_START_REQUEST', lang: 'zh-CN' })
            .catch(() => {});
        }
        const hint = '该视频暂无可用字幕，正在尝试语音识别…';
        return {
          success: false,
          active: false,
          reason: 'no_subtitle_found',
          hint
        };
      }
      text = items.map((item) => item.text).join('\n');
      lineCount = items.length;
    }

    const videoTitle = normalizeText(document.title.replace(/_哔哩哔哩_bilibili$/, '')) || document.title;
    const videoUrl = buildCanonicalUrl(window.location.href);
    const jumpUrl = buildJumpUrl(videoUrl, startedTimestampSec);

    return {
      success: true,
      active: false,
      capture: {
        mode,
        text,
        lineCount,
        videoTitle,
        videoUrl,
        jumpUrl,
        timestampSec: startedTimestampSec,
        timestampLabel: formatTime(startedTimestampSec),
        endTimestampSec,
        endTimestampLabel: formatTime(endTimestampSec),
        createdAt: new Date().toISOString()
      }
    };
  }

  function finalizeAndSave() {
    if (!state.session.active) return;
    const result = stopSession();
    if (result?.capture) {
      chrome.runtime.sendMessage({ type: 'SAVE_CAPTURE', capture: result.capture }).catch(() => {});
    }
  }

  function pushSessionItem(text, force = false) {
    if (!state.session.active && !force) {
      return;
    }

    if (!text) {
      return;
    }

    const items = state.session.items;
    const lastItem = items[items.length - 1];
    if (lastItem?.text === text) {
      return;
    }

    items.push({
      text,
      timestampSec: getCurrentTime(),
      updatedAt: Date.now()
    });
  }

  function handleSTTResult(text) {
    if (!text || !state.session.active) return;
    state.session.items.push({
      text,
      timestampSec: getCurrentTime(),
      updatedAt: Date.now()
    });
  }

  function stopSTTIfActive() {
    if (state.sttActive) {
      state.sttActive = false;
      chrome.runtime.sendMessage({ type: 'STT_STOP_REQUEST' }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // Deduplication
  // ---------------------------------------------------------------------------

  function dedupeSessionItems(items) {
    const merged = [];

    for (const item of items) {
      const text = normalizeText(item?.text || '');
      if (!text || BLOCKED_TEXTS.has(text)) {
        continue;
      }

      const currentItem = {
        ...item,
        text
      };

      if (!merged.length) {
        merged.push(currentItem);
        continue;
      }

      const lastItem = merged[merged.length - 1];
      const mergedText = mergeSubtitleText(lastItem.text, currentItem.text, lastItem, currentItem);

      if (mergedText) {
        lastItem.text = mergedText;
        lastItem.updatedAt = currentItem.updatedAt;
        continue;
      }

      merged.push(currentItem);
    }

    return merged.map((item) => ({
      ...item,
      text: cleanupMergedText(item.text)
    }));
  }

  function mergeSubtitleText(previousText, currentText, previousItem, currentItem) {
    if (!previousText || !currentText) {
      return '';
    }

    if (previousText === currentText) {
      return previousText;
    }

    if (currentText.includes(previousText)) {
      return currentText;
    }

    if (previousText.includes(currentText)) {
      return previousText;
    }

    const gapSeconds = Math.abs((currentItem?.timestampSec || 0) - (previousItem?.timestampSec || 0));
    const playbackRate = state.video?.playbackRate || 1;
    if (gapSeconds > 2 / playbackRate) {
      return '';
    }

    const overlapLength = getOverlapLength(previousText, currentText);
    const minLength = Math.min(previousText.length, currentText.length);
    if (overlapLength >= Math.max(2, Math.ceil(minLength * 0.6))) {
      return previousText + currentText.slice(overlapLength);
    }

    return '';
  }

  function getOverlapLength(previousText, currentText) {
    const maxLength = Math.min(previousText.length, currentText.length);
    for (let length = maxLength; length >= 2; length -= 1) {
      if (previousText.slice(-length) === currentText.slice(0, length)) {
        return length;
      }
    }

    return 0;
  }

  function cleanupMergedText(text) {
    return text
      .replace(/\s+/g, ' ')
      .replace(/([，。！？!?；;：:])\1+/g, '$1')
      .replace(/^[\s\n]+|[\s\n]+$/g, '');
  }

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  function getCurrentTime() {
    return state.video ? Math.floor(state.video.currentTime || 0) : 0;
  }

  function getFallbackTimestamp() {
    const fresh = [...state.history].reverse().find((item) => item.timestampSec >= 0);
    return fresh?.timestampSec || 0;
  }

  function buildCanonicalUrl(rawUrl) {
    const url = new URL(rawUrl);
    url.hash = '';
    url.searchParams.delete('t');
    return url.toString();
  }

  function buildJumpUrl(rawUrl, seconds) {
    const url = new URL(rawUrl);
    if (seconds > 0) {
      url.searchParams.set('t', String(seconds));
    }
    return url.toString();
  }

  function normalizeText(text) {
    return text.replace(/\s+/g, ' ').replace(/^[\s\n]+|[\s\n]+$/g, '');
  }

  function formatTime(totalSeconds) {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds || 0));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const seconds = safeSeconds % 60;

    if (hours > 0) {
      return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
    }

    return [minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
  }

  // ---------------------------------------------------------------------------
  // Recording indicator — a small floating badge when session is active
  // ---------------------------------------------------------------------------

  function updateRecordingIndicator(active) {
    const existing = document.getElementById('bqs-recording-indicator');
    if (!active) {
      if (existing) {
        existing.remove();
      }
      return;
    }
    if (existing) {
      return;
    }
    if (!document.body) {
      return;
    }

    if (!indicatorStyleInjected) {
      const styleEl = document.createElement('style');
      styleEl.textContent =
        '@keyframes bqs-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.5;transform:scale(1.3)}}';
      document.head.appendChild(styleEl);
      indicatorStyleInjected = true;
    }

    const indicator = document.createElement('div');
    indicator.id = 'bqs-recording-indicator';
    indicator.setAttribute('role', 'status');
    indicator.setAttribute('aria-label', '录制中，字幕正在被记录');

    const dot = document.createElement('span');
    Object.assign(dot.style, {
      display: 'inline-block',
      width: '8px',
      height: '8px',
      borderRadius: '50%',
      background: '#ff4444',
      animation: 'bqs-pulse 1.5s ease-in-out infinite'
    });

    const label = document.createTextNode(' 录制中');
    indicator.appendChild(dot);
    indicator.appendChild(label);

    Object.assign(indicator.style, {
      position: 'fixed',
      bottom: '80px',
      left: '20px',
      zIndex: '2147483647',
      padding: '8px 14px',
      borderRadius: '20px',
      background: 'rgba(0, 0, 0, 0.75)',
      color: '#fff',
      fontSize: '13px',
      fontWeight: '600',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      pointerEvents: 'none',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      letterSpacing: '0.3px',
      backdropFilter: 'blur(4px)'
    });

    document.body.appendChild(indicator);
  }

  // ---------------------------------------------------------------------------
  // Toast notifications
  // ---------------------------------------------------------------------------

  function showToast(message, success) {
    const existing = document.getElementById('bqs-toast');
    if (existing) {
      existing.remove();
    }

    const toast = document.createElement('div');
    toast.id = 'bqs-toast';
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    toast.textContent = message;

    Object.assign(toast.style, {
      position: 'fixed',
      top: '70px',
      right: '20px',
      zIndex: '2147483647',
      padding: '10px 16px',
      borderRadius: '10px',
      background: success ? 'rgba(22, 163, 74, 0.92)' : 'rgba(220, 38, 38, 0.92)',
      color: '#fff',
      fontSize: '14px',
      lineHeight: '20px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
      cursor: 'pointer',
      transition: 'opacity 0.3s ease'
    });

    toast.addEventListener('click', () => {
      toast.remove();
      if (state.toastTimer) {
        clearTimeout(state.toastTimer);
        state.toastTimer = null;
      }
    });

    document.body.appendChild(toast);

    if (state.toastTimer) {
      clearTimeout(state.toastTimer);
    }

    state.toastTimer = window.setTimeout(() => {
      toast.style.opacity = '0';
      window.setTimeout(() => {
        toast.remove();
      }, 300);
    }, TOAST_DURATION_MS);
  }
})();
