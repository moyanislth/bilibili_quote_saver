const capturesContainer = document.getElementById('captures');
const statusElement = document.getElementById('status');
const countLabel = document.getElementById('count-label');
const toggleButton = document.getElementById('toggle-capture');
const clearButton = document.getElementById('clear-all');

document.addEventListener('DOMContentLoaded', init);
toggleButton.addEventListener('click', handleToggleCapture);
clearButton.addEventListener('click', handleClearAll);

async function init() {
  await syncToggleButton();
  await renderCaptures();
}

async function handleToggleCapture() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    setStatus('未找到当前标签页', true);
    return;
  }

  setStatus('正在切换记录状态…');
  const response = await chrome.runtime.sendMessage({
    type: 'TOGGLE_FROM_POPUP',
    tabId: tab.id
  });

  if (!response?.success) {
    setStatus('当前页面没有可记录的字幕', true);
    await syncToggleButton();
    return;
  }

  if (response.active) {
    setStatus('已开始记录字幕');
  } else {
    setStatus(response.capture ? '已停止并汇总字幕' : '已停止记录');
    await renderCaptures();
  }

  await syncToggleButton();
}

async function handleClearAll() {
  await chrome.runtime.sendMessage({ type: 'CLEAR_CAPTURES' });
  setStatus('已清空收藏');
  await renderCaptures();
}

async function syncToggleButton() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    toggleButton.textContent = '开始记录';
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: 'GET_TAB_RECORDING_STATE',
    tabId: tab.id
  });

  toggleButton.textContent = response?.active ? '停止并汇总' : '开始记录';
}

async function renderCaptures() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_CAPTURES' });
  const captures = Array.isArray(response?.captures) ? response.captures : [];
  countLabel.textContent = `${captures.length} 条收藏`;
  capturesContainer.innerHTML = '';

  if (!captures.length) {
    const emptyState = document.createElement('div');
    emptyState.className = 'empty-state';
    emptyState.textContent = '还没有收藏内容，去 B 站开始录一段吧。';
    capturesContainer.appendChild(emptyState);
    return;
  }

  captures.forEach((capture) => {
    capturesContainer.appendChild(createCaptureCard(capture));
  });
}

function createCaptureCard(capture) {
  const card = document.createElement('article');
  card.className = 'capture-card';

  const text = document.createElement('p');
  text.className = 'capture-text';
  text.textContent = capture.text;

  const meta = document.createElement('p');
  meta.className = 'capture-meta';
  meta.textContent = buildMetaText(capture);

  const actions = document.createElement('div');
  actions.className = 'capture-actions';

  const jumpButton = document.createElement('button');
  jumpButton.className = 'secondary-button';
  jumpButton.textContent = '回到原视频';
  jumpButton.addEventListener('click', () => {
    chrome.tabs.create({ url: capture.jumpUrl || capture.videoUrl });
  });

  const copyButton = document.createElement('button');
  copyButton.className = 'secondary-button';
  copyButton.textContent = '复制字幕';
  copyButton.addEventListener('click', async () => {
    await navigator.clipboard.writeText(capture.text || '');
    setStatus('已复制字幕');
  });

  const deleteButton = document.createElement('button');
  deleteButton.className = 'secondary-button';
  deleteButton.textContent = '删除';
  deleteButton.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'DELETE_CAPTURE', id: capture.id });
    setStatus('已删除收藏');
    await renderCaptures();
  });

  actions.append(jumpButton, copyButton, deleteButton);
  card.append(text, meta, actions);
  return card;
}

function buildMetaText(capture) {
  const range = capture.endTimestampLabel
    ? `${capture.timestampLabel || '00:00'} - ${capture.endTimestampLabel}`
    : capture.timestampLabel || '00:00';
  const lineCount = capture.lineCount ? ` · ${capture.lineCount} 条字幕` : '';
  return `${capture.videoTitle || '未命名视频'} · ${range}${lineCount} · ${formatDate(capture.createdAt)}`;
}

function setStatus(message, isError = false) {
  statusElement.textContent = message;
  statusElement.className = `status ${isError ? 'error' : 'success'}`;
}

function formatDate(value) {
  if (!value) {
    return '未知时间';
  }

  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}
