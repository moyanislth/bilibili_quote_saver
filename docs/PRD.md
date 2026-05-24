# Bilibili Quote Saver — Product Requirements Document

> **Current version:** 0.1.0  
> **Target next major version:** 1.0.0  
> **Author:** Product  
> **Last updated:** 2026-05-24

---

## 1. Product Vision

Bilibili Quote Saver lets users capture, organize, and revisit subtitles from B站 videos with a single keystroke. No more pausing, rewinding, or typing by hand. The product evolves from a subtitle-capture utility into a full personal knowledge base for B站 video content.

---

## 2. Scoring Framework — 8 Evaluation Dimensions

Each dimension is scored 1-10.

### 2.1 字幕捕获准确性 (Subtitle Capture Accuracy)

| Level | Description |
|-------|-------------|
| **10分** | Captures every subtitle line with 100% accuracy. Handles multi-line subtitles, split-second transitions, overlapping subtitles (dual-language), and special characters. Zero false positives from UI text. |
| **5分** | Captures most subtitle lines. Occasional misses when subtitles transition quickly (< 200 ms). Rarely picks up a non-subtitle UI element. |
| **1分** | Fails to capture anything reliable. Picks up random UI text, misses all subtitles, or triggers on button labels. |

**Current score: 6**

- Strong selector cascade with 10 fallback selectors works for current B站 layout.
- Deduplication and merge logic handles line transitions decently.
- Scored down because: only works when CC subtitles are rendered in DOM — no fallback for videos without visible subtitles. The merge algorithm (`getOverlapLength`) can produce garbled output when two consecutive subtitles have accidental character overlap. The scoring system in `pickBestSubtitle()` is heuristic and could rank a wrong element higher.

**Target for 1.0.0: 8**

- Add Web Speech API fallback for videos without CC subtitles.
- Improve merge algorithm with punctuation-aware boundaries.
- Add confidence scoring per capture line.

---

### 2.2 字幕可用性 (Subtitle Availability Coverage)

| Level | Description |
|-------|-------------|
| **10分** | Works on every B站 video: CC subtitles, auto-generated subtitles, and videos with no subtitles at all (via on-device STT). Also works on B站 live streams and short-form videos. |
| **5分** | Works reliably on videos with CC subtitles. Works partially on auto-generated subtitles. Does not work on videos without any subtitle track. |
| **1分** | Only works on a specific subset of videos with exactly the right DOM structure. Breaks on any layout variation. |

**Current score: 3**

- The extension is entirely dependent on CC subtitles being present and rendered in the DOM.
- B站 auto-generated subtitles (AI字幕) have a different DOM structure that may not match the selectors.
- Live streams and short-form videos (`/video/` path only) are not supported.
- No fallback mechanism whatsoever if subtitles are absent.

**Target for 1.0.0: 7**

- Web Speech API integration covers videos without CC subtitles.
- Add selectors for B站 auto-generated (AI) subtitle DOM structure.
- Expand manifest matches to cover live room pages (`live.bilibili.com`).

---

### 2.3 交互流畅度 (Interaction Flow)

| Level | Description |
|-------|-------------|
| **10分** | Single-button toggle, clear state at a glance, keyboard shortcut and popup toggle both work seamlessly. Toast feedback is instant and non-intrusive. Recording indicator is visible but not distracting. User can toggle without losing their place in the video. |
| **5分** | Works but requires checking the popup to confirm state. The toggle button text changes, but the state is ambiguous if popup is closed. Recording indicator is present but could be missed. |
| **1分** | Confusing toggle — no indicator, no feedback. User has to open popup to know if recording is active. Toggle frequently fails silently. |

**Current score: 6**

- Keyboard shortcut (`Ctrl+Shift+S`) and popup button both work.
- Toast notifications provide good feedback (green for success, red for errors).
- Recording indicator dot pulses in the page — good design.
- Scored down because: the indicator disappears when popup is opened (the popup only shows "停止并汇总" text, no visual indicator). The user cannot see recording duration. No way to pause/resume a session — only stop. Toggle button text "开始记录" vs "停止并汇总" is clear but could use an icon.

**Target for 0.2.x: 7**

- Add recording duration display in popup header when session is active.
- Change toggle button to use icon + text for better visual clarity.
- Add a session timer / live subtitle preview in the popup.

---

### 2.4 数据管理 (Data Management)

| Level | Description |
|-------|-------------|
| **10分** | Full CRUD: view, search, filter by video, edit text inline, bulk export (JSON, TXT, Markdown), reorder, tag, organize into folders. Sync across devices via browser account. |
| **5分** | View list, delete individual items, clear all. Basic meta information shown (video title, timestamp). Can copy text. No search, no edit, no export beyond copy. |
| **1分** | Can only view captures with no actions. No delete, no copy, no metadata. |

**Current score: 4**

- Can view capture cards with video title, timestamp range, line count, and date.
- Actions: copy text, delete individual, clear all, jump to video.
- Scored down because: NO search, NO inline editing, NO export, NO filter/sort. Once a capture is saved, the only thing you can do is copy or delete it. 500 capture limit is reasonable but no warning before hitting it.

**Target for 0.2.x: 5**

- Add inline text editing (click to edit capture text in popup).
- Add basic search/filter bar to filter captures by text content.

**Target for 1.0.0: 7**

- Add export functionality: export all to JSON, TXT, or Markdown file.
- Add per-capture "pin" to protect from bulk clear.
- Add search with highlighting of matching text.

---

### 2.5 视觉与反馈 (Visual Design & Feedback)

| Level | Description |
|-------|-------------|
| **10分** | Polished, beautiful UI that feels native to Chrome. Dark mode fully implemented and aware of system preference. Smooth animations, clear visual hierarchy. Toast, indicator, popup — all consistent design language. Accessible (ARIA labels, keyboard navigable). |
| **5分** | Functional but basic. Dark mode works but may have minor contrast issues. Feedback exists but is text-heavy. No animations or micro-interactions. |
| **1分** | No styling, no dark mode, no feedback beyond raw text. Broken layout on some screen sizes. |

**Current score: 5**

- Clean, functional design with dark mode support via `prefers-color-scheme`.
- Toast and recording indicator are well-implemented.
- Scored down because: popup is purely text-driven. No visual indicator for recording state inside the popup (only text). No icon/logo. No loading states. No animation on state transitions. The 380px width is fine but the content area has no scrolling indicator when many captures exist.

**Target for 0.2.x: 6**

- Add a simple icon (SVG) for the recording toggle button.
- Add fade-in animation for new capture cards.
- Add a "recording active" visual bar at the top of the popup with timer.
- Improve the empty state with a small illustration or icon.

**Target for 1.0.0: 7**

- Full accessibility pass: ARIA labels, focus management, keyboard navigation in popup.
- Loading skeleton for capture list.

---

### 2.6 稳定性与容错 (Stability & Error Handling)

| Level | Description |
|-------|-------------|
| **10分** | Zero data loss under any scenario. Graceful handling of: page navigation during session, video element removal/swap, DOM mutations, tab close, extension reload. Comprehensive error messages. Auto-recovery from edge cases. |
| **5分** | Handles common scenarios. Some data loss possible in edge cases (navigating away mid-session, rapid toggling). Error messages are basic. Session abandonment is silent. |
| **1分** | Frequently loses data. Crashes on DOM changes. No error handling. Silent failures. |

**Current score: 5**

- SPA navigation detection (`detectUrlChange`) abandons session silently — no data loss but no warning either.
- `try/catch` wrapping on all message handlers prevents crashes from bubbling up.
- 30-item history buffer is reasonable.
- Scored down because: session is silently abandoned on SPA navigation with no toast/notification. Rapid toggling could cause race conditions (the `scanScheduled` flag is domain-wide, not session-scoped). If content script re-injects (e.g., after extension reload), the old toast timer could fire on a stale toast reference. No retry mechanism for storage operations.

**Target for 0.2.x: 6**

- Show a toast when session is auto-abandoned due to page navigation.
- Add a guard against rapid toggle clicks (debounce on toggle).
- Wrap `chrome.storage.local` operations in retry-on-failure logic.
- Clean up all timers on content script re-init.

**Target for 1.0.0: 7**

- Persist session state to storage so it survives page refresh and extension reload.
- Add data integrity checks (validate capture structure on read).

---

### 2.7 性能 (Performance)

| Level | Description |
|-------|-------------|
| **10分** | Zero perceptible impact on page performance. Subtitle scanning is efficient, no layout thrashing, no memory leaks. Popup opens instantly with 1000+ captures. |
| **5分** | Minor performance impact. Some redundant DOM queries. Popup may lag with 200+ captures. Acceptable for typical usage. |
| **1分** | Severe performance degradation. Frequent DOM scanning causes jank. Popup is unusable with many captures. Memory grows unbounded. |

**Current score: 6**

- `requestAnimationFrame`-coalesced scanning is a good pattern — only one scan per frame regardless of trigger source.
- MutationObserver is used (not polling) for DOM change detection.
- 2-second periodic rescan as safety net is reasonable.
- Scored down because: `pickBestSubtitle()` iterates all 10 selectors via `querySelectorAll` on every scan — even though comment says "first selector matches on modern B站 layouts," it still runs all of them. The popup renders ALL captures into DOM at once with no virtualization. No `WeakRef` usage — observer references could theoretically prevent GC of detached DOM subtrees.

**Target for 0.2.x: 7**

- Break out of selector loop early once a match is found (`if (candidates.length) break` — currently the loop continues through all selectors).
- Virtualize capture list in popup (render only first 20, lazy-load on scroll).
- Add a capture count cap notification before reaching 500.

**Target for 1.0.0: 7**

- Implement pagination or virtual scrolling in the popup.
- Use `IntersectionObserver` instead of `getBoundingClientRect` in `isVisible()`.

---

### 2.8 安全与隐私 (Security & Privacy)

| Level | Description |
|-------|-------------|
| **10分** | Minimum permissions required. No data leaves the device. All storage is local. No tracking, no analytics, no network requests. Clear privacy policy. User fully controls their data with import/export. |
| **5分** | Only local storage. Reasonable permissions. No external connections. But no data export capability — user cannot easily back up or transfer their data. |
| **1分** | Requests excessive permissions. Sends data to external servers. No transparency about data handling. |

**Current score: 7**

- Minimal permissions: only `storage` and `tabs`.
- Host permissions scoped to `www.bilibili.com` and `m.bilibili.com`.
- All data stored in `chrome.storage.local` — never leaves the device.
- No network requests, no analytics, no tracking.
- Scored down because: Cannot export data — user has no way to back up captures. No data size monitoring — `chrome.storage.local` has a ~10 MB quota but there is no warning. If the content script is injected on a page that matches but isn't a video page (e.g., B站 home page), it still runs observers.

**Target for 0.2.x: 7**

- Add user-facing storage usage indicator (current usage / quota).

**Target for 1.0.0: 8**

- Add data export feature for user backups.
- Add import feature for restore/migration.
- Verify content script only activates on actual video pages (check for `video` element before initializing observers).

---

### Score Summary

| Dimension | Current | 0.2.x Target | 1.0.0 Target |
|-----------|---------|--------------|--------------|
| 字幕捕获准确性 | 6 | 6 | 8 |
| 字幕可用性 | 3 | 3 | 7 |
| 交互流畅度 | 6 | 7 | 8 |
| 数据管理 | 4 | 5 | 7 |
| 视觉与反馈 | 5 | 6 | 7 |
| 稳定性与容错 | 5 | 6 | 7 |
| 性能 | 6 | 7 | 7 |
| 安全与隐私 | 7 | 7 | 8 |
| **Average** | **5.25** | **5.88** | **7.38** |

---

## 3. Version Planning

### 3.1 Version 0.2.x — Bug Fixes & Minor UX Polish

These are small, low-risk iterations targeting the biggest pain points with minimal code change.

#### 0.2.0 — Quality-of-Life Release

1. **Inline text editing in popup**
   - Double-click on capture text to make it editable (contenteditable or textarea swap).
   - Save on blur or Enter (Ctrl+Enter for multiline).
   - Files: `popup.js`, `popup.css`

2. **Recording duration display**
   - In the popup, when recording is active, show "Recording: 00:32" with a live timer.
   - The popup already queries `GET_TAB_RECORDING_STATE` — add elapsed time to the response.
   - Files: `background.js` (add elapsed time to response), `popup.js`, `popup.html`, `popup.css`

3. **Export captures (basic)**
   - Add "导出" button in toolbar.
   - Export all captures as JSON file download via `Blob` + `URL.createObjectURL`.
   - Files: `popup.js`

#### 0.2.1 — Stability & Feedback

4. **Toast on session abandonment**
   - When `detectUrlChange()` abandons a session, call `showToast()` with a warning.
   - Files: `content.js`

5. **Rapid-toggle guard**
   - Debounce the `TOGGLE_CAPTURE_SESSION` handler (300 ms cooldown).
   - Files: `content.js`

6. **Selector loop early break**
   - In `pickBestSubtitle()`, break out of the selector loop once a match is found.
   - Current code iterates all 10 selectors even after a match.
   - Files: `content.js` (line ~211-239)

7. **Recording active state in popup header**
   - Add a red dot + "Recording" label next to the toggle button when session is active.
   - Files: `popup.html`, `popup.css`, `popup.js`

#### 0.2.2 — Data Management Basics

8. **Search/filter captures**
   - Add a search input field in the popup toolbar.
   - Filter captures by text content match (case-insensitive).
   - Files: `popup.html`, `popup.css`, `popup.js`

9. **Storage usage indicator**
   - Query `chrome.storage.local.getBytesInUse()` and show it near the count label.
   - Warn when approaching the 10 MB quota (~8 MB threshold).
   - Files: `popup.js`, `popup.html`

10. **Auto-generated subtitle selector support**
    - Add CSS selectors for B站's AI subtitle DOM structure.
    - Research needed: inspect actual DOM of a video with AI subtitles enabled.
    - Files: `content.js`

---

### 3.2 Version 1.0.0 — Major Feature Release

This is the transformative release that addresses the product's biggest gap: **subtitle availability coverage**.

#### Feature 1: Web Speech API Fallback (Speech-to-Text)

**Problem:** The extension only works when CC subtitles are rendered in the DOM. Many B站 videos have no subtitles at all, or only auto-generated subtitles with a different DOM structure.

**Solution:** Use the Web Speech API (`SpeechRecognition`) as a fallback when no DOM subtitles are detected. This runs entirely on-device, requires no API keys, and works on any video with audio.

**Implementation:**
- In `content.js`, when `pickBestSubtitle()` returns empty for 5+ consecutive scans, activate a `SpeechRecognition` instance.
- Pipe recognized text through the same session pipeline (`pushSessionItem`).
- Show a toast "正在使用语音识别捕获字幕" when STT fallback activates.
- Handle `SpeechRecognition` lifecycle: start on session start, stop on session stop, restart on error.
- Add an `endpointer` sensitivity setting (default: "medium") to balance accuracy vs. latency.

**Constraints:**
- Web Speech API requires a secure context (`https://www.bilibili.com` qualifies) and user gesture to start — already satisfied by the keyboard shortcut / popup button click.
- It is speech *recognition*, not speaker identification — fine for our use case.
- `SpeechRecognition` may stop unexpectedly (silence, noise, etc.) — needs auto-restart logic.
- Chrome's implementation returns interim results — use `isFinal === true` for committed text.

**Fallback hierarchy:**
1. CC subtitle DOM capture (current) — highest accuracy
2. B站 AI subtitle DOM capture (0.2.2 selector add) — medium accuracy
3. Web Speech API STT — lowest accuracy but broadest coverage

#### Feature 2: Retroactive Capture Buffer

**Problem:** Users often realize they want to capture something *after* it was said. Current implementation only captures forward from the moment recording starts.

**Solution:** Maintain a rolling buffer of the last 30 seconds of subtitles. When the user starts recording, pre-populate the session with buffered subtitles.

**Implementation:**
- `state.buffer = []` — ring buffer of subtitle entries with timestamps, capped at 30 seconds.
- On every `scanSubtitle()` hit, push to buffer and evict entries older than 30 seconds.
- On `startSession()`, copy buffer items into `session.items` (with dedup).
- Buffer is always active (even outside a session) — minimal cost since it piggybacks on existing scans.

**UX:**
- When session starts, toast shows "已开始记录（包含前30秒字幕）" if buffer had content.
- No new UI needed — works transparently.

#### Feature 3: Full Export System

**Problem:** Users cannot back up or share their captures. Data is trapped in `chrome.storage.local`.

**Solution:** Export to multiple formats, with a format picker dialog.

**Formats:**

- **JSON** — Full data fidelity. `{ version: 1, exportedAt: "...", captures: [...] }`
- **Plain text (.txt)** — All texts concatenated with video title and timestamp headers. `[Video Title - 00:00]\n字幕内容\n`
- **Markdown (.md)** — Organized with headings, links, and code blocks for each capture.

```markdown
# Bilibili Quote Saver Export

## [Video Title](videoUrl)
- 时间: 00:00 - 01:30
- 收藏于: 2026-05-24

```
字幕内容
```
```

**Implementation:**
- Add a modal/select in `popup.html` with format options.
- Generate file via `Blob` + `URL.createObjectURL` + `<a download>`.
- All format conversion logic in `popup.js` — no new background messages needed.
- File name: `bilibili-quotes-{date}.json` etc.

#### Feature 4: In-Popup Text Editing & Organization

**Builds on 0.2.0's inline editing:**

- Add "pin" toggle per capture — pinned captures appear at top and are excluded from bulk clear.
- Add "tags" field (comma-separated, displayed as chips).
- Add sort options: by date (newest/oldest), by video title, by duration.
- Visual: Tags display as small colored chips in the capture card meta area.

**Files:** `popup.js`, `popup.html`, `popup.css`

#### Feature 5: Live Subtitle Preview in Popup

**Problem:** During recording, opening the popup gives no indication of what's being captured.

**Solution:** When the popup detects that recording is active, show the last 3-5 subtitle lines live (polling `content.js` for current session items).

**Implementation:**
- New message type: `GET_SESSION_PREVIEW` in `content.js` — returns last 5 session items.
- In popup, when session is active, poll this every 2 seconds and render a "Live Preview" section.
- This replaces the static capture list when recording is active.

**Files:** `content.js`, `popup.js`, `popup.html`

---

### 3.3 Version 1.1.0+ — Future Roadmap

#### 1.1.0 — Synchronization & Backup

- **Chrome Storage Sync API** — Sync captures across devices via `chrome.storage.sync` (limited to ~100 KB, so only text and metadata; store full data in local + sync lightweight index).
- **Auto-backup to local file** — Periodic (daily) export to `chrome.downloads.download`.
- **Capture deduplication across sessions** — If the same timestamp range from the same video is captured twice, offer to merge or skip.

#### 1.2.0 — AI & Enrichment

- **One-click summarization** — Send capture text to a configurable LLM endpoint (API key stored in extension settings) to summarize or rewrite.
- **Smart tagging** — Auto-tag captures based on content keywords (e.g., #技术, #观点, #教程).
- **Translation** — Inline translation of captured subtitles (via browser's built-in translation API or user-configured API key).

#### 1.3.0 — Power User Features

- **Multiple video support in single session** — Allow recording across SPA navigation (currently session is abandoned on URL change). Keep the session alive across video changes within the same tab.
- **Advanced filter UI** — Filter by date range, video, tags, text content. Multi-select delete.
- **Batch operations** — Select multiple captures → delete, export, tag.
- **Custom keyboard shortcuts** — Allow users to customize the save shortcut via extension options page.
- **Options page** — `chrome.runtime.openOptionsPage` with settings: default export format, STT language, buffer duration, theme override.

#### 2.0.0 — Platform Expansion

- **Firefox port** — Port to Manifest V3 (Firefox supports MV3 since v109).
- **Safari port** — Xcode project, Safari Web Extension.
- **Other video platforms** — Support YouTube, NicoNico, etc. (content script per domain).
- **Mobile support** — B站 mobile web (`m.bilibili.com`) currently has host permission but content script may not work due to different DOM structure. Investigate and fix.

---

## 4. Tech Spikes

Research items needed before implementing major features.

### Spike 1: Web Speech API Feasibility in Content Scripts

**Objective:** Verify that `SpeechRecognition` can be instantiated and sustained in a Chrome extension content script context.

**Questions to answer:**
- Does `webkitSpeechRecognition` work inside a content script's isolated world?
- Does it require user gesture activation in the content script context? (The keyboard shortcut `onCommand` fires in the service worker, not content script — need to send message to content script which then creates the `SpeechRecognition` instance. Is the message considered a user gesture?)
- Does `SpeechRecognition` continue when the popup is closed? (Should be fine — content script runs in the tab.)
- What is the accuracy on Chinese (zh-CN) speech? (Chrome's built-in STT supports `zh-CN` — test on B站 content with music/noise.)
- How does STT interact with B站's own audio pipeline? (Is the audio from the video element accessible to STT, or does it require a microphone? This is critical: Web Speech API *receives from the default audio input* — typically the microphone, not the tab's audio output.)

**Key risk identified:** Web Speech API captures **microphone input**, not tab audio. This means the user would need to play the video through speakers and have a microphone pick it up. This is a significant UX downgrade and may not work at all in many environments (headless, no mic, background noise).

**Fallback if spike fails:** Instead of Web Speech API, investigate Chrome's `tabCapture` API or `MediaStream` from `chrome.tabCapture` combined with a `SpeechRecognition` wrapper. This is more complex but captures actual tab audio. Alternatively, investigate B站's internal subtitle API directly.

**Effort estimate:** 2-3 days for prototype + testing.

### Spike 2: B站 Internal Subtitle API Discovery

**Objective:** Find and reverse-engineer the API that B站's video player uses to fetch subtitle data, so we can access subtitles directly without DOM parsing.

**Approach:**
1. Open Chrome DevTools on a B站 video page with subtitles enabled.
2. Filter network requests for `subtitle`, `json`, `ai_subtitle`, `crc` etc.
3. Look for XHR/fetch calls that return subtitle data in the Network tab.
4. B站's video player fetches subtitle data as JSON (`subtitle/vtt` endpoint) — find the exact URL pattern and authentication requirements.
5. Check if these API endpoints require cookies, CSRF tokens, or `Referer` headers that a content script can provide.
6. Verify the response format (VTT, JSON, protobuf) and extract text + timing.
7. Determine if the API key (`cid` and `oid` parameters) can be extracted from the page or player state.

**Goal:** Create a `fetchSubtitleFromAPI(cid)` function in `content.js` that obtains the full subtitle track on page load, enabling pre-caching and retroactive buffer beyond 30 seconds.

**Effort estimate:** 3-5 days for discovery + prototype.

### Spike 3: Storage Quota Management

**Objective:** Understand and plan for `chrome.storage.local` quota limits and implement a strategy for large capture collections.

**Questions to answer:**
- What is the exact quota for `chrome.storage.local` in Chrome? (Approx. 10 MB, but can vary by browser.)
- How much storage does a typical capture use? (Character count × 2 bytes + JSON overhead.)
- Estimate: 500 captures × avg 200 chars × 2 bytes = ~200 KB for text alone. With metadata (video titles, timestamps, URLs), estimate ~500 KB-1 MB total. The 10 MB quota should be fine for 500+ captures.
- What happens when storage write fails due to quota? (The `set()` call throws — we need error handling.)
- Is `chrome.storage.sync` viable? (Quota: 102,400 bytes total, 8,192 bytes per item, max 512 items. Too small for our use case. Use `storage.local` only.)
- Can we use IndexedDB for larger storage? IndexedDB within extension service workers is available in MV3 and has much larger limits (typically > 50 MB). This would be a more scalable solution.

**Recommendation:** For 1.0.0, keep `chrome.storage.local` but add quota monitoring. For future versions (1.2+), migrate to IndexedDB for unlimited storage.

**Effort estimate:** 1 day for prototyping + measurement.

### Spike 4: Tab Audio Capture for STT

**Objective:** Determine the best approach to capture the video's audio output (not microphone input) for speech-to-text processing.

**Approach:**
1. Investigate `chrome.tabCapture` API — captures audio from a specific tab and returns a `MediaStream`.
2. Can `chrome.tabCapture` be called from a service worker and the stream passed to a content script? (Likely not directly — `MediaStream` cannot be transferred between contexts easily.)
3. Alternative: Use `chrome.tabCapture` in the background script, feed audio chunks to a Web Workers-based recognition pipeline, or stream audio via `OffscreenCanvas` + `AudioContext`.
4. Test `chrome.tabCapture.getMediaStreamId()` + `navigator.mediaDevices.getUserMedia()` in content script.

**Key constraint:** Chrome MV3 service workers cannot use `MediaStream` or `SpeechRecognition` directly — these are DOM APIs. They must be run in a document context (content script or offscreen document).

**Fallback:** Use an offscreen document (`chrome.offscreen`) with `tabCapture` + `SpeechRecognition` for the STT pipeline.

**Effort estimate:** 3-5 days for prototype.

---

## 5. Key Metrics & Success Criteria

| Metric | Current (0.1.0) | Target (1.0.0) |
|--------|-----------------|----------------|
| Capture success rate (videos with CC) | ~85% | > 95% |
| Capture success rate (all B站 videos) | ~30% | > 85% |
| User actions per capture (avg clicks) | 3 (toggle on, toggle off, copy) | 2 (toggle on, toggle off — copy optional) |
| Data loss incidents per session | ~5% (SPA nav) | < 1% |
| Export available | No | Yes (3 formats) |
| Storage quota warning | No | Yes |

---

## 6. Technical Constraints

- **Browser:** Chrome / Edge (Manifest V3). Firefox port deferred to 2.0.0.
- **Storage:** `chrome.storage.local` only (10 MB quota). IndexedDB evaluated for future.
- **Permissions:** Keep `storage` + `tabs` minimum. If `tabCapture` is needed for STT, must add permission and justify.
- **Dependencies:** Zero. No external libraries or frameworks. Pure vanilla JS.
- **Content script:** Runs in isolated world (`document_idle`). Cannot access page's JS variables or React state. Must rely on DOM observation.
