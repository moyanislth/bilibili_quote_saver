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

  if (message?.type === 'GET_CAPTURES') {
    chrome.storage.local.get({ [STORAGE_KEY]: [] }).then((result) => {
      sendResponse({ captures: result[STORAGE_KEY] || [] });
    });
    return true;
  }

  if (message?.type === 'DELETE_CAPTURE') {
    deleteCapture(message.id).then(() => sendResponse({ success: true }));
    return true;
  }

  if (message?.type === 'CLEAR_CAPTURES') {
    chrome.storage.local.set({ [STORAGE_KEY]: [] }).then(() => sendResponse({ success: true }));
    return true;
  }

  return undefined;
});

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
    return { active: Boolean(response?.active) };
  } catch {
    return { active: false };
  }
}

async function toggleRecordingOnTab(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_CAPTURE_SESSION' });

    if (!response?.success) {
      const reason = response?.reason || 'no_subtitle_found';
      await notifyTab(tabId, false, '当前页面没有可记录的字幕');
      return { success: false, reason, active: false };
    }

    if (response.active) {
      await notifyTab(tabId, true, '开始记录字幕');
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

async function saveCapture(capture) {
  const result = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
  const captures = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
  const record = {
    id: crypto.randomUUID(),
    ...capture
  };

  const nextCaptures = [record, ...captures].slice(0, MAX_CAPTURES);
  await chrome.storage.local.set({ [STORAGE_KEY]: nextCaptures });
  return record;
}

async function deleteCapture(id) {
  const result = await chrome.storage.local.get({ [STORAGE_KEY]: [] });
  const captures = Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
  const nextCaptures = captures.filter((item) => item.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEY]: nextCaptures });
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
