(function () {
  const SUBTITLE_SELECTORS = [
    '.bpx-player-subtitle-panel-text',
    '.bpx-player-subtitle-panel-item-text',
    '.bpx-player-subtitle-panel-item',
    '.bpx-player-subtitle-item-text',
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

  const state = {
    currentSubtitle: '',
    subtitleUpdatedAt: 0,
    history: [],
    observer: null,
    rescanTimer: null,
    video: null,
    toastTimer: null,
    session: {
      active: false,
      startedAt: 0,
      startedTimestampSec: 0,
      items: []
    }
  };

  init();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'TOGGLE_CAPTURE_SESSION') {
      sendResponse(toggleCaptureSession());
      return true;
    }

    if (message?.type === 'GET_CAPTURE_STATE') {
      sendResponse({ active: state.session.active });
      return true;
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
  }

  function bindVideo() {
    const attachVideo = () => {
      const video = document.querySelector('video');
      if (!video || state.video === video) {
        return;
      }

      state.video = video;
      video.addEventListener('timeupdate', scanSubtitle, { passive: true });
      video.addEventListener('seeked', scanSubtitle, { passive: true });
      video.addEventListener('play', scanSubtitle, { passive: true });
      scanSubtitle();
    };

    attachVideo();
    const observer = new MutationObserver(() => attachVideo());
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function observeSubtitleChanges() {
    if (state.observer) {
      state.observer.disconnect();
    }

    state.observer = new MutationObserver(() => scanSubtitle());
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

    state.rescanTimer = window.setInterval(scanSubtitle, 800);
  }

  function scanSubtitle() {
    const subtitle = pickBestSubtitle();
    if (!subtitle) {
      return;
    }

    if (subtitle !== state.currentSubtitle) {
      state.currentSubtitle = subtitle;
      state.subtitleUpdatedAt = Date.now();
      pushHistory(subtitle);
      pushSessionItem(subtitle);
    }
  }

  function pickBestSubtitle() {
    const candidates = [];

    SUBTITLE_SELECTORS.forEach((selector, index) => {
      document.querySelectorAll(selector).forEach((node) => {
        const text = normalizeText(node.textContent || '');
        if (!text || !isVisible(node) || !looksLikeSubtitle(text, node)) {
          return;
        }

        const rect = node.getBoundingClientRect();
        const horizontalCenter = rect.left + rect.width / 2;
        const verticalCenter = rect.top + rect.height / 2;
        const centerDistance = Math.abs(horizontalCenter - window.innerWidth / 2) / Math.max(window.innerWidth / 2, 1);
        const targetY = window.innerHeight * 0.78;
        const verticalDistance = Math.abs(verticalCenter - targetY) / Math.max(window.innerHeight, 1);
        const score =
          18 - index +
          Math.max(0, 4 - centerDistance * 6) +
          Math.max(0, 4 - verticalDistance * 20) +
          Math.min(text.length / 24, 2);

        candidates.push({ text, score });
      });
    });

    if (!candidates.length) {
      return '';
    }

    candidates.sort((left, right) => right.score - left.score);
    return candidates[0].text;
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
    return state.session.active ? stopSession() : startSession();
  }

  function startSession() {
    scanSubtitle();

    state.session.active = true;
    state.session.startedAt = Date.now();
    state.session.startedTimestampSec = getCurrentTime();
    state.session.items = [];

    if (state.currentSubtitle) {
      pushSessionItem(state.currentSubtitle, true);
    }

    return {
      success: true,
      active: true
    };
  }

  function stopSession() {
    scanSubtitle();

    if (state.currentSubtitle) {
      pushSessionItem(state.currentSubtitle, true);
    }

    const items = dedupeSessionItems(state.session.items);
    const endTimestampSec = getCurrentTime() || getFallbackTimestamp();
    const startedTimestampSec = state.session.startedTimestampSec;

    state.session.active = false;
    state.session.startedAt = 0;
    state.session.startedTimestampSec = 0;
    state.session.items = [];

    if (!items.length) {
      return {
        success: false,
        active: false,
        reason: 'no_subtitle_found'
      };
    }

    const videoTitle = normalizeText(document.title.replace(/_哔哩哔哩_bilibili$/, '')) || document.title;
    const videoUrl = buildCanonicalUrl(window.location.href);
    const jumpUrl = buildJumpUrl(videoUrl, startedTimestampSec);
    const mergedText = items.map((item) => item.text).join('\n');

    return {
      success: true,
      active: false,
      capture: {
        mode: 'session',
        text: mergedText,
        lineCount: items.length,
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
    if (gapSeconds > 2) {
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

  function showToast(message, success) {
    const existing = document.getElementById('bqs-toast');
    if (existing) {
      existing.remove();
    }

    const toast = document.createElement('div');
    toast.id = 'bqs-toast';
    toast.textContent = message;
    toast.style.position = 'fixed';
    toast.style.top = '20px';
    toast.style.right = '20px';
    toast.style.zIndex = '2147483647';
    toast.style.padding = '10px 14px';
    toast.style.borderRadius = '10px';
    toast.style.background = success ? 'rgba(22, 163, 74, 0.92)' : 'rgba(220, 38, 38, 0.92)';
    toast.style.color = '#fff';
    toast.style.fontSize = '14px';
    toast.style.lineHeight = '20px';
    toast.style.boxShadow = '0 8px 24px rgba(0,0,0,0.18)';
    toast.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif';
    document.body.appendChild(toast);

    if (state.toastTimer) {
      clearTimeout(state.toastTimer);
    }

    state.toastTimer = window.setTimeout(() => {
      toast.remove();
    }, 1800);
  }
})();
