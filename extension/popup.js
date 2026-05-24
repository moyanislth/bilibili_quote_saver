const capturesContainer = document.getElementById('captures');
const statusElement = document.getElementById('status');
const countLabel = document.getElementById('count-label');
const toggleButton = document.getElementById('toggle-capture');
const clearButton = document.getElementById('clear-all');
const searchInput = document.getElementById('search-input');
const storageUsageEl = document.getElementById('storage-usage');
const langSelect = document.getElementById('lang-select');
let livePreviewInterval = null;
let searchQuery = '';
let tagFilter = '';
let sortBy = 'newest';
const MAX_CAPTURES = 500;
let displayLimit = 30;
let searchDebounceTimer = null;

document.addEventListener('DOMContentLoaded', init);
toggleButton.addEventListener('click', handleToggleCapture);
clearButton.addEventListener('click', handleClearAll);
searchInput.addEventListener('input', handleSearchInput);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    searchInput.value = '';
    searchQuery = '';
    renderCaptures();
    searchInput.focus();
  }
});
document.getElementById('sort-select').addEventListener('change', handleSortChange);
if (langSelect) {
  langSelect.addEventListener('change', handleLangChange);
}

async function init() {
  try {
    await syncToggleButton();
    await renderCaptures();
    updateStorageUsage();
    initExportDropdown();
    initImportButton();
    initLangSelect();
    document.addEventListener('click', closeAllDropdowns);
  } catch {
    setStatus('加载失败', true);
  }
}

async function handleToggleCapture() {
  try {
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
      if (response?.reason === 'cooldown') {
        return;
      }
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
  } catch (error) {
    setStatus('操作失败：无法连接扩展程序', true);
    await syncToggleButton();
  }
}

async function handleClearAll() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_CAPTURES' });
  const captures = Array.isArray(response?.captures) ? response.captures : [];
  const pinnedCount = captures.filter(c => c.pinned).length;

  const msg = pinnedCount > 0
    ? `确定要清空所有未固定的收藏吗？（已固定${pinnedCount}条将被保留）`
    : '确定要清空所有收藏吗？此操作无法撤销。';

  if (!confirm(msg)) return;

  if (pinnedCount > 0) {
    await chrome.runtime.sendMessage({ type: 'CLEAR_UNPINNED_CAPTURES' });
  } else {
    await chrome.runtime.sendMessage({ type: 'CLEAR_CAPTURES' });
  }
  setStatus('已清空收藏');
  await renderCaptures();
}

async function syncToggleButton() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      toggleButton.textContent = '开始记录';
      stopLivePreview();
      return;
    }

    const response = await chrome.runtime.sendMessage({
      type: 'GET_TAB_RECORDING_STATE',
      tabId: tab.id
    });

    toggleButton.textContent = response?.active ? '停止并汇总' : '开始记录';

    if (response?.active) {
      startLivePreview(tab.id);
    } else {
      stopLivePreview();
    }
  } catch {
    toggleButton.textContent = '开始记录';
    stopLivePreview();
  }
}

async function renderCaptures(keepLimit = false) {
  try {
    if (!keepLimit) {
      displayLimit = 30;
    }

    const skeleton = document.getElementById('loading-skeleton');
    if (skeleton) skeleton.style.display = '';

    const response = await chrome.runtime.sendMessage({ type: 'GET_CAPTURES' });
    const captures = Array.isArray(response?.captures) ? response.captures : [];
    countLabel.textContent = `${captures.length} 条收藏`;
    capturesContainer.innerHTML = '';
    if (skeleton) skeleton.style.display = 'none';

    updateStorageWarning(captures.length);

    let filtered = captures;
    if (searchQuery) {
      filtered = filtered.filter((c) => c.text.toLowerCase().includes(searchQuery));
    }
    if (tagFilter) {
      filtered = filtered.filter((c) => c.tags && c.tags.some(t => t.toLowerCase() === tagFilter.toLowerCase()));
    }

    renderTagFilterBar();

    let sortFn;
    if (sortBy === 'newest') {
      sortFn = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
    } else if (sortBy === 'oldest') {
      sortFn = (a, b) => new Date(a.createdAt) - new Date(b.createdAt);
    } else if (sortBy === 'video') {
      sortFn = (a, b) => (a.videoTitle || '').localeCompare(b.videoTitle || '');
    }
    sortFn = sortFn || (() => 0);

    // Pinned captures always sort to top regardless of selected sort order
    const pinned = filtered.filter(c => c.pinned);
    const unpinned = filtered.filter(c => !c.pinned);
    pinned.sort(sortFn);
    unpinned.sort(sortFn);
    filtered = [...pinned, ...unpinned];

    const hasMore = filtered.length > 30 && filtered.length > displayLimit;
    const toRender = hasMore ? filtered.slice(0, displayLimit) : filtered;

    if (!toRender.length) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      emptyState.textContent = captures.length > 0 ? '无匹配结果' : '还没有收藏内容，去 B 站开始录一段吧。';
      capturesContainer.appendChild(emptyState);
      return;
    }

    toRender.forEach((capture, index) => {
      // Add a subtle separator between pinned and unpinned sections
      if (pinned.length > 0 && index === pinned.length) {
        const separator = document.createElement('div');
        separator.className = 'pinned-separator';
        capturesContainer.appendChild(separator);
      }
      capturesContainer.appendChild(createCaptureCard(capture, searchQuery));
    });

    if (hasMore) {
      const remaining = filtered.length - displayLimit;
      const showMoreBtn = document.createElement('button');
      showMoreBtn.className = 'secondary-button';
      showMoreBtn.textContent = `显示更多(${remaining}条)`;
      showMoreBtn.style.width = '100%';
      showMoreBtn.style.marginTop = '6px';
      showMoreBtn.addEventListener('click', () => {
        displayLimit += 30;
        renderCaptures(true);
      });
      capturesContainer.appendChild(showMoreBtn);
    }
  } catch {
    const skeleton = document.getElementById('loading-skeleton');
    if (skeleton) skeleton.style.display = 'none';
    countLabel.textContent = '0 条收藏';
    capturesContainer.innerHTML = '';
  }
}

function createCaptureCard(capture, query) {
  const card = document.createElement('article');
  card.className = 'capture-card';
  card.setAttribute('tabindex', '0');
  card.dataset.captureId = capture.id;
  if (capture.pinned) {
    card.classList.add('pinned');
  }

  const text = document.createElement('p');
  text.className = 'capture-text';
  if (query) {
    text.innerHTML = highlightText(capture.text, query);
  } else {
    text.textContent = capture.text;
  }
  text.title = '双击编辑字幕';

  text.addEventListener('dblclick', () => {
    if (text.querySelector('textarea')) return;

    const textarea = document.createElement('textarea');
    textarea.className = 'capture-text-edit';
    textarea.value = capture.text;
    textarea.rows = Math.min(capture.text.split('\n').length + 2, 15);

    const actions = document.createElement('div');
    actions.className = 'edit-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'secondary-button';
    saveBtn.textContent = '保存';
    saveBtn.addEventListener('click', () => commitEdit());

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'secondary-button';
    cancelBtn.textContent = '取消';
    cancelBtn.addEventListener('click', () => cancelEdit());

    actions.append(saveBtn, cancelBtn);
    text.replaceChildren(textarea, actions);

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.ctrlKey) commitEdit();
      if (e.key === 'Escape') cancelEdit();
    });

    textarea.addEventListener('blur', () => {
      // Delay to allow button clicks to fire first
      setTimeout(() => {
        if (text.querySelector('textarea')) cancelEdit();
      }, 150);
    });

    textarea.focus();

    function commitEdit() {
      const newText = textarea.value.trim();
      if (!newText || newText === capture.text) {
        cancelEdit();
        return;
      }
      capture.text = newText;
      if (query) {
        text.innerHTML = highlightText(newText, query);
      } else {
        text.textContent = newText;
      }
      chrome.runtime.sendMessage({ type: 'UPDATE_CAPTURE', id: capture.id, text: newText });
      setStatus('已保存编辑');
    }

    function cancelEdit() {
      if (query) {
        text.innerHTML = highlightText(capture.text, query);
      } else {
        text.textContent = capture.text;
      }
    }
  });

  const meta = document.createElement('p');
  meta.className = 'capture-meta';
  meta.textContent = buildMetaText(capture);

  // Tags
  const tagsEl = document.createElement('div');
  tagsEl.className = 'capture-tags' + ((capture.tags && capture.tags.length) ? '' : ' capture-tags-empty');
  tagsEl.title = '双击编辑标签';
  renderTagsInElement(tagsEl, capture);
  tagsEl.addEventListener('dblclick', () => {
    startTagEdit(tagsEl, capture);
  });

  const actions = document.createElement('div');
  actions.className = 'capture-actions';

  const jumpButton = document.createElement('button');
  jumpButton.className = 'secondary-button';
  jumpButton.textContent = '回到原视频';
  jumpButton.addEventListener('click', () => {
    chrome.tabs.create({ url: capture.jumpUrl || capture.videoUrl });
  });

  const deleteButton = document.createElement('button');
  deleteButton.className = 'secondary-button';
  deleteButton.textContent = '删除';
  deleteButton.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'DELETE_CAPTURE', id: capture.id });
    setStatus('已删除收藏');
    await renderCaptures();
  });

  const pinButton = document.createElement('button');
  pinButton.className = `pin-button${capture.pinned ? ' pinned' : ''}`;
  pinButton.textContent = capture.pinned ? '📌' : '📍';
  pinButton.title = capture.pinned ? '取消固定' : '固定到顶部';
  pinButton.addEventListener('click', async (e) => {
    e.stopPropagation();
    capture.pinned = !capture.pinned;
    await chrome.runtime.sendMessage({ type: 'UPDATE_CAPTURE', id: capture.id, pinned: capture.pinned });
    await renderCaptures();
  });

  actions.append(pinButton, jumpButton, deleteButton);
  card.append(text, meta, tagsEl, actions);
  return card;
}

function buildMetaText(capture) {
  const range = capture.endTimestampLabel
    ? `${capture.timestampLabel || '00:00'} - ${capture.endTimestampLabel}`
    : capture.timestampLabel || '00:00';
  const lineCount = capture.lineCount ? ` · ${capture.lineCount} 条字幕` : '';
  return `${capture.videoTitle || '未命名视频'} · ${range}${lineCount} · ${formatDate(capture.createdAt)}`;
}

function highlightText(text, query) {
  if (!query) return sanitizeHTML(text);
  const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
  return escaped.replace(regex, '<mark>$1</mark>');
}

function sanitizeHTML(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function formatStorageSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

function updateStorageWarning(count) {
  const warningEl = document.getElementById('storage-warning');
  if (!warningEl) return;

  if (count >= 490) {
    warningEl.className = 'storage-warning critical';
    warningEl.textContent = `⚠ 收藏数已达上限(${count}/${MAX_CAPTURES})，新收藏将替换最早的收藏`;
    warningEl.style.display = '';
  } else if (count >= 450) {
    warningEl.className = 'storage-warning warning';
    warningEl.textContent = `⚠ 收藏数接近上限(${count}/${MAX_CAPTURES})，旧收藏将被自动清理`;
    warningEl.style.display = '';
  } else {
    warningEl.style.display = 'none';
  }
}

async function updateStorageUsage() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_STORAGE_USAGE' });
    if (response) {
      storageUsageEl.textContent = `已用 ${formatStorageSize(response.bytesUsed)} / ${formatStorageSize(response.quotaBytes)}`;
    }
  } catch {
    // Silently fail
  }
}

function handleSortChange() {
  sortBy = document.getElementById('sort-select').value;
  renderCaptures();
}

function handleSearchInput() {
  searchQuery = searchInput.value.trim().toLowerCase();
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    searchDebounceTimer = null;
    renderCaptures();
  }, 250);
}

function handleLangChange() {
  if (!langSelect) return;
  const lang = langSelect.value;
  chrome.storage.local.set({ subtitle_lang_pref: lang });
  setStatus(`字幕语言偏好已设为: ${lang}`);
}

async function initLangSelect() {
  if (!langSelect) return;
  try {
    const result = await chrome.storage.local.get({ subtitle_lang_pref: 'zh-CN' });
    langSelect.value = result.subtitle_lang_pref || 'zh-CN';
  } catch {
    langSelect.value = 'zh-CN';
  }
}

async function handleExport(format = 'json') {
  const response = await chrome.runtime.sendMessage({ type: 'GET_CAPTURES' });
  const captures = Array.isArray(response?.captures) ? response.captures : [];

  if (!captures.length) {
    setStatus('没有可导出的收藏', true);
    return;
  }

  let content, mimeType, extension;
  if (format === 'txt') {
    content = buildExportTxt(captures);
    mimeType = 'text/plain';
    extension = 'txt';
  } else if (format === 'markdown') {
    content = buildExportMarkdown(captures);
    mimeType = 'text/markdown';
    extension = 'md';
  } else {
    content = JSON.stringify(captures, null, 2);
    mimeType = 'application/json';
    extension = 'json';
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bilibili-quotes-${new Date().toISOString().slice(0, 10)}.${extension}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  setStatus('已导出收藏');
}

function buildExportTxt(captures) {
  const parts = captures.map((c) => {
    const range = c.endTimestampLabel
      ? `${c.timestampLabel || '00:00'} - ${c.endTimestampLabel}`
      : c.timestampLabel || '00:00';
    const lineCount = c.lineCount ? `${c.lineCount}条字幕` : '';
    const date = formatDate(c.createdAt).split(' ')[0];
    return `[${c.videoTitle || '未命名视频'}]\n时间: ${range} | ${lineCount} | ${date}\n${c.text || ''}`;
  });
  return parts.join('\n\n---\n\n');
}

function buildExportMarkdown(captures) {
  const parts = captures.map((c) => {
    const range = c.endTimestampLabel
      ? `${c.timestampLabel || '00:00'} - ${c.endTimestampLabel}`
      : c.timestampLabel || '00:00';
    const lineCount = c.lineCount ? `${c.lineCount} 条` : '';
    const date = formatDate(c.createdAt).split(' ')[0];
    const url = c.jumpUrl || c.videoUrl || '';
    const quoteLines = (c.text || '').split('\n').map((l) => `> ${l}`).join('\n');
    return `## ${c.videoTitle || '未命名视频'}\n- **时间:** ${range}\n- **字幕数:** ${lineCount}\n- **来源:** [回到原视频](${url})\n- **收藏于:** ${date}\n\n${quoteLines}`;
  });
  return `# Bilibili Quote Saver — 导出\n\n${parts.join('\n\n---\n\n')}`;
}

function initExportDropdown() {
  const toggle = document.getElementById('export-toggle');
  const menu = document.getElementById('export-menu');
  if (!toggle || !menu) return;

  toggle.addEventListener('click', () => {
    menu.classList.toggle('open');
  });

  menu.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      menu.classList.remove('open');
      handleExport(btn.dataset.format);
    });
  });
}

function initImportButton() {
  const importBtn = document.getElementById('import-btn');
  const importInput = document.getElementById('import-input');
  if (!importBtn || !importInput) return;

  importBtn.addEventListener('click', () => {
    importInput.click();
  });

  importInput.addEventListener('change', async () => {
    const file = importInput.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (!Array.isArray(data)) {
        setStatus('导入失败：无效的 JSON 格式（需要数组）', true);
        return;
      }

      // Validate structure
      const validItems = data.filter((item) => {
        return item && typeof item.id === 'string' && typeof item.text === 'string' && item.text.trim() && typeof item.videoTitle === 'string';
      });

      if (!validItems.length) {
        setStatus('导入失败：JSON 中没有有效的收藏数据', true);
        return;
      }

      if (validItems.length < data.length) {
        setStatus(`警告：${data.length - validItems.length} 条数据格式无效将被跳过`, true);
      }

      if (!confirm(`将导入${validItems.length}条收藏，是否继续？（重复ID将跳过）`)) {
        importInput.value = '';
        return;
      }

      const response = await chrome.runtime.sendMessage({
        type: 'IMPORT_CAPTURES',
        captures: validItems
      });

      if (response?.success) {
        setStatus(`已导入 ${response.imported} 条收藏`);
      } else {
        setStatus('导入失败', true);
      }

      await renderCaptures();
      updateStorageUsage();
    } catch (err) {
      setStatus('导入失败：文件格式错误', true);
    }

    importInput.value = '';
  });
}

function closeAllDropdowns(e) {
  document.querySelectorAll('.dropdown-menu.open').forEach((m) => {
    const dd = m.closest('.dropdown');
    if (dd && !dd.contains(e.target)) {
      m.classList.remove('open');
    }
  });
}

// ── Tag system ───────────────────────────────────────────────────────────────

function handleTagFilter(tag) {
  tagFilter = (tagFilter === tag) ? '' : tag;
  renderTagFilterBar();
  renderCaptures();
}

function renderTagFilterBar() {
  const bar = document.getElementById('tag-filter-bar');
  if (!bar) return;
  bar.innerHTML = '';
  if (tagFilter) {
    bar.style.display = 'flex';
    const label = document.createElement('span');
    label.className = 'tag-filter-label';
    label.textContent = '过滤: ';
    bar.appendChild(label);

    const chip = document.createElement('span');
    chip.className = 'tag-chip tag-filter-chip';
    chip.textContent = '#' + tagFilter;
    chip.addEventListener('click', () => {
      tagFilter = '';
      renderTagFilterBar();
      renderCaptures();
    });
    bar.appendChild(chip);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'tag-filter-clear';
    clearBtn.textContent = '✕';
    clearBtn.addEventListener('click', () => {
      tagFilter = '';
      renderTagFilterBar();
      renderCaptures();
    });
    bar.appendChild(clearBtn);
  } else {
    bar.style.display = 'none';
  }
}

function startTagEdit(container, capture) {
  if (container.querySelector('input')) return;

  const prevTags = [...(capture.tags || [])];
  container.innerHTML = '';
  container.classList.remove('capture-tags-empty');

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'tag-edit-input';
  input.value = prevTags.join(', ');
  input.placeholder = '标签1, 标签2, ...';
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { cancel(); }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (container.contains(input)) commit();
    }, 150);
  });

  container.appendChild(input);
  input.focus();
  input.select();

  function commit() {
    const raw = input.value.trim();
    const tags = raw ? raw.split(',').map((t) => t.trim()).filter(Boolean) : [];
    const uniqueTags = [...new Set(tags)];
    capture.tags = uniqueTags;
    chrome.runtime.sendMessage({ type: 'UPDATE_CAPTURE', id: capture.id, tags: uniqueTags });
    renderTagsInElement(container, capture);
    setStatus('已保存标签');
  }

  function cancel() {
    renderTagsInElement(container, capture);
  }
}

function renderTagsInElement(container, capture) {
  container.innerHTML = '';
  const tags = capture.tags || [];
  container.classList.toggle('capture-tags-empty', !tags.length);
  tags.forEach((tag) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.textContent = tag;
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      handleTagFilter(tag);
    });
    container.appendChild(chip);
  });
}

// ── Live subtitle preview ──────────────────────────────────────────────────

function startLivePreview(tabId) {
  if (livePreviewInterval) {
    clearInterval(livePreviewInterval);
  }

  const previewEl = document.getElementById('live-preview');
  if (previewEl) {
    previewEl.style.display = '';
  }

  const poll = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_SESSION_PREVIEW',
        tabId
      });
      const items = Array.isArray(response?.items) ? response.items : [];
      renderLivePreview(items);
    } catch {
      // Tab might have navigated away
    }
  };

  poll();
  livePreviewInterval = setInterval(poll, 1500);
}

function stopLivePreview() {
  if (livePreviewInterval) {
    clearInterval(livePreviewInterval);
    livePreviewInterval = null;
  }
  const previewEl = document.getElementById('live-preview');
  if (previewEl) {
    previewEl.style.display = 'none';
  }
  const itemsEl = document.getElementById('live-preview-items');
  if (itemsEl) {
    itemsEl.innerHTML = '';
  }
}

function renderLivePreview(items) {
  const itemsEl = document.getElementById('live-preview-items');
  if (!itemsEl) return;

  if (!items.length) {
    itemsEl.innerHTML = '<div class="live-preview-empty">等待字幕…</div>';
    return;
  }

  itemsEl.innerHTML = items.map((item) => {
    const time = formatTime(item.timestampSec);
    const escaped = (item.text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    return `<div class="live-preview-item"><span class="live-preview-time">${time}</span><span class="live-preview-text">${escaped}</span></div>`;
  }).join('');
}

// ── Keyboard navigation ────────────────────────────────────────────────────

// Enter copies focused card text; Delete/Backspace deletes the focused card
capturesContainer.addEventListener('keydown', (event) => {
  const card = event.target.closest('.capture-card');
  if (!card || event.target !== card) return;

  if (event.key === 'Enter') {
    event.preventDefault();
    const textEl = card.querySelector('.capture-text');
    if (textEl) {
      navigator.clipboard.writeText(textEl.textContent || '').catch(() => {});
      setStatus('已复制字幕');
    }
  }

  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    const captureId = card.dataset.captureId;
    if (captureId) {
      chrome.runtime.sendMessage({ type: 'DELETE_CAPTURE', id: captureId }).then(() => {
        setStatus('已删除收藏');
        renderCaptures();
      });
    }
  }
});

// J/K vim-style navigation between capture cards
document.addEventListener('keydown', (event) => {
  if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') return;

  if (event.key === 'j' || event.key === 'J') {
    event.preventDefault();
    const cards = capturesContainer.querySelectorAll('.capture-card');
    if (!cards.length) return;
    const focused = document.activeElement;
    const currentIndex = Array.from(cards).indexOf(focused);
    const nextIndex = Math.min(currentIndex + 1, cards.length - 1);
    if (currentIndex !== nextIndex) {
      cards[nextIndex].focus();
    }
  }

  if (event.key === 'k' || event.key === 'K') {
    event.preventDefault();
    const cards = capturesContainer.querySelectorAll('.capture-card');
    if (!cards.length) return;
    const focused = document.activeElement;
    const currentIndex = Array.from(cards).indexOf(focused);
    const prevIndex = Math.max(currentIndex - 1, 0);
    if (currentIndex !== prevIndex) {
      cards[prevIndex].focus();
    }
  }
});
