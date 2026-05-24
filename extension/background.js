const STORAGE_KEY = 'captures';
const MAX_CAPTURES = 500;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ [STORAGE_KEY]: [] }).then((result) => {
    if (!Array.isArray(result[STORAGE_KEY])) {
      return chrome.storage.local.set({ [STORAGE_KEY]: [] });
    }
    return undefined;
  });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'save-current-subtitle') {
    return;
  }

  const tab = await getActiveTab();
  if (!tab?.id) {
    return;
  }

  await toggleRecordingOnTab(tab.id);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'TOGGLE_FROM_POPUP') {
    toggleRecordingOnTab(message.tabId)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          success: false,
          reason: error instanceof Error ? error.message : 'toggle_failed'
        });
      });
    return true;
  }

  if (message?.type === 'GET_TAB_RECORDING_STATE') {
    getRecordingState(message.tabId)
      .then(sendResponse)
      .catch(() => sendResponse({ active: false }));
    return true;
  }

  if (message?.type === 'GET_SESSION_PREVIEW') {
    chrome.tabs.sendMessage(message.tabId, { type: 'GET_SESSION_PREVIEW' })
      .then(sendResponse)
      .catch(() => sendResponse({ items: [] }));
    return true;
  }

  if (message?.type === 'GET_CAPTURES') {
    chrome.storage.local.get({ [STORAGE_KEY]: [] }).then((result) => {
      const captures = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
      const validCaptures = captures.filter(validateCapture);
      if (validCaptures.length < captures.length) {
        console.warn(`[BQS] Filtered out ${captures.length - validCaptures.length} invalid capture(s) on read`);
      }
      sendResponse({ captures: validCaptures });
    });
    return true;
  }

  if (message?.type === 'DELETE_CAPTURE') {
    deleteCapture(message.id).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message?.type === 'CLEAR_CAPTURES') {
    withRetry(() => chrome.storage.local.set({ [STORAGE_KEY]: [] })).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message?.type === 'CLEAR_UNPINNED_CAPTURES') {
    withRetry(async () => {
      const result = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
      const captures = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
      const nextCaptures = captures.filter((item) => item.pinned);
      await chrome.storage.local.set({ [STORAGE_KEY]: nextCaptures });
    }).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message?.type === 'GET_STORAGE_USAGE') {
    chrome.storage.local.getBytesInUse(null).then((bytesUsed) => {
      sendResponse({ bytesUsed, quotaBytes: 10485760 });
    });
    return true;
  }

  if (message?.type === 'UPDATE_CAPTURE') {
    updateCapture(message.id, { text: message.text, pinned: message.pinned, tags: message.tags }).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message?.type === 'IMPORT_CAPTURES') {
    importCaptures(message.captures).then(sendResponse);
    return true;
  }

  if (message?.type === 'FETCH_SUBTITLE_API') {
    fetchSubtitleFromAPI(message.bvid)
      .then(sendResponse)
      .catch(() => sendResponse({ subtitles: null }));
    return true;
  }

  if (message?.type === 'SAVE_CAPTURE') {
    // Fire-and-forget: page is unloading, no response expected
    saveCapture(message.capture).catch(() => {});
    return undefined;
  }

  return undefined;
});

function validateCapture(c) {
  if (!c || typeof c.id !== 'string' || !c.id) {
    console.warn('[BQS] Invalid capture: missing or invalid id', c?.id);
    return false;
  }
  if (typeof c.text !== 'string' || !c.text.trim()) {
    console.warn('[BQS] Invalid capture: missing or empty text', c?.id);
    return false;
  }
  if (typeof c.videoTitle !== 'string') {
    console.warn('[BQS] Invalid capture: missing or invalid videoTitle', c?.id);
    return false;
  }
  return true;
}

async function importCaptures(imports) {
  return withRetry(async () => {
    const result = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
    const captures = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    const existingIds = new Set(captures.map((c) => c.id));
    let imported = 0;

    for (const item of imports) {
      if (!existingIds.has(item.id) && validateCapture(item)) {
        captures.push(item);
        existingIds.add(item.id);
        imported++;
      }
    }

    // Cap at MAX_CAPTURES, keep newest
    if (captures.length > MAX_CAPTURES) {
      captures.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      captures.length = MAX_CAPTURES;
    }

    await chrome.storage.local.set({ [STORAGE_KEY]: captures });
    return { success: true, imported };
  });
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0];
}

async function getRecordingState(tabId) {
  if (!tabId) {
    return { active: false };
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'GET_CAPTURE_STATE' });
    return { active: Boolean(response?.active), startedAt: response?.active ? response.startedAt : 0 };
  } catch {
    return { active: false };
  }
}

async function toggleRecordingOnTab(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_CAPTURE_SESSION' });

    if (!response?.success) {
      const reason = response?.reason || 'no_subtitle_found';
      if (reason !== 'cooldown') {
        const hintMsg = response?.hint || '当前页面没有可记录的字幕';
        await notifyTab(tabId, false, hintMsg);
      }
      return { success: false, reason, active: false };
    }

    if (response.active) {
      const bufferedCount = response.bufferedCount || 0;
      const startMsg = bufferedCount > 0
        ? `开始记录（含前${response.bufferDuration || 30}秒${bufferedCount}条字幕）`
        : '开始记录字幕';
      await notifyTab(tabId, true, startMsg);
      return { success: true, active: true };
    }

    const savedCapture = response.capture ? await saveCapture(response.capture) : null;
    await notifyTab(tabId, true, savedCapture ? '已停止并汇总字幕' : '已停止记录');
    return { success: true, active: false, capture: savedCapture };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'toggle_failed';
    await notifyTab(tabId, false, '当前页面无法读取字幕');
    return { success: false, reason, active: false };
  }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry(fn, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries - 1) {
        await delay(100 * Math.pow(2, attempt));
      }
    }
  }
  throw lastError;
}

async function saveCapture(capture) {
  return withRetry(async () => {
    const result = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
    const captures = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    const record = {
      id: crypto.randomUUID(),
      tags: [],
      ...capture
    };

    const nextCaptures = [record, ...captures].slice(0, MAX_CAPTURES);
    await chrome.storage.local.set({ [STORAGE_KEY]: nextCaptures });
    return record;
  });
}

async function deleteCapture(id) {
  return withRetry(async () => {
    const result = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
    const captures = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    const nextCaptures = captures.filter((item) => item.id !== id);
    await chrome.storage.local.set({ [STORAGE_KEY]: nextCaptures });
  });
}

async function updateCapture(id, updates) {
  return withRetry(async () => {
    const result = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
    const captures = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
    // Remove undefined keys to prevent overwriting fields not being updated
    const cleanUpdates = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) {
        cleanUpdates[key] = value;
      }
    }
    const nextCaptures = captures.map((item) => {
      if (item.id !== id) return item;
      const newItem = { ...item, ...cleanUpdates };
      if (cleanUpdates.text !== undefined) {
        newItem.lineCount = cleanUpdates.text.split('\n').length;
      }
      return newItem;
    });
    await chrome.storage.local.set({ [STORAGE_KEY]: nextCaptures });
  });
}

async function fetchSubtitleFromAPI(bvid) {
  const headers = { Referer: 'https://www.bilibili.com/' };
  const viewRes = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, { headers });
  if (!viewRes.ok) return { subtitles: null };
  const viewData = await viewRes.json();
  const subtitles = viewData?.data?.subtitle?.subtitles;
  if (!subtitles?.length) return { subtitles: null };

  // Respect user's language preference
  let target;
  const langPref = await chrome.storage.local.get({ subtitle_lang_pref: 'zh-CN' });
  const preferredLang = langPref.subtitle_lang_pref || 'zh-CN';

  if (preferredLang && preferredLang !== 'auto') {
    target = subtitles.find((s) => s.lan === preferredLang);
  }

  // Fallback: Chinese, then auto-generated Chinese, then first available
  if (!target) {
    target = subtitles.find(
      (s) => s.lan === 'zh-CN' || s.lan_doc?.includes('中文') || s.lan_doc?.includes('汉语')
    ) || subtitles[0];
  }

  let subtitleUrl = target.subtitle_url;
  if (subtitleUrl.startsWith('//')) subtitleUrl = 'https:' + subtitleUrl;
  if (!subtitleUrl.startsWith('http')) subtitleUrl = 'https:' + subtitleUrl;

  const subRes = await fetch(subtitleUrl, { headers });
  if (!subRes.ok) return { subtitles: null };
  const subData = await subRes.json();
  const entries = (subData.body || []).map((entry) => ({
    from: entry.from,
    to: entry.to,
    content: entry.content
  }));

  return { subtitles: entries };
}

async function notifyTab(tabId, success, message) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'SHOW_TOAST',
      payload: {
        success,
        message
      }
    });
  } catch {
    return;
  }
}
