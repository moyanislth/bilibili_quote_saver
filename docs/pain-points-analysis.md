# Bilibili Quote Saver — Pain Points Analysis

> **Author:** UX Research Analysis  
> **Date:** 2026-05-24  
> **Version:** 0.1.0 (current codebase)

---

## Overview

This document catalogues every identifiable pain point in the current extension, organized by user scenario. Each entry includes severity, root cause analysis, and solution directions. The goal is to provide a clear roadmap for the next major version.

**Severity key:**

- **Critical** — renders the extension unusable in a common scenario; data loss or silent failure.
- **High** — significant friction that causes user frustration, confusion, or data quality issues in frequent scenarios.
- **Medium** — notable inconvenience or missing capability that users will encounter regularly.
- **Low** — edge case or polish issue; affects a minority of users but worth tracking.

---

## 1. Core Capture Mechanism

### 1.1 No capture without CC subtitles

| Field | Value |
|---|---|
| **Scenario** | User opens a Bilibili video that has no CC/subtitle track at all (e.g., a user-uploaded clip, a music video, or a video where the uploader disabled subtitles). The extension silently does nothing. |
| **Why it hurts** | The extension's sole capture mechanism is DOM scraping of rendered subtitle elements. If no subtitle `<div>` exists on the page, `pickBestSubtitle()` returns empty, the session captures zero items, and `stopSession()` returns `{ success: false, reason: 'no_subtitle_found' }`. The user sees only a red toast "当前页面没有可记录的字幕" despite pressing the keyboard shortcut correctly. The user has no path to capture anything. |
| **Severity** | **Critical** |
| **Solution direction** | Integrate the Web Speech API (`SpeechRecognition`) as a fallback capture mode. When DOM subtitles are absent, fall back to real-time speech-to-text from the video's audio track. Also explore Bilibili's internal subtitle API (`api.bilibili.com/x/web-interface/view?bvid=...`) which may return subtitle URLs even when the player UI does not show them. |

### 1.2 Retroactive capture impossible

| Field | Value |
|---|---|
| **Scenario** | User is 5 minutes into a video, hears an interesting quote, and presses Ctrl+Shift+S. The session starts at the current time. The quote they wanted is already lost — the extension only captures subtitles _after_ the session begins. |
| **Why it hurts** | The shortest path to "save what I just heard" requires a time machine. The user's natural impulse ("I want to save that!") cannot be satisfied. This is the single most common mental model mismatch — users expect a "save" button to save _what they're seeing_, not to _start recording future subtitles_. |
| **Severity** | **Critical** |
| **Solution direction** | Maintain a rolling subtitle history buffer (e.g., last 60 seconds of subtitle text in memory, kept regardless of session state). When the user triggers capture, include the buffered pre-session content. Alternatively, implement a "quote mode" where the user selects text directly from the video page. The `history` array (currently capped at 30 and only populated during a session) should be decoupled from session state. |

### 1.3 Fragmented text due to word-by-word subtitle refresh (逐词刷新)

| Field | Value |
|---|---|
| **Scenario** | Bilibili's AI subtitles often update character-by-character or word-by-word as each word is spoken. The extension's `MutationObserver` fires on every DOM change, capturing partial text fragments. Even with the merge/dedup logic (`mergeSubtitleText`, `getOverlapLength`), many fragments remain unmerged because the gap between updates is < 2 seconds but the overlap ratio drops below 60%. The final captured text reads like: "我今天 今天天气 天气真 真好" instead of "今天天气真好". |
| **Why it hurts** | The core value proposition is "save clean subtitles." Fragmented text destroys that value. The user must manually reconstruct sentences. The dedup logic (`gapSeconds > 2`) is too simplistic — it doesn't account for the fact that B站's streaming subtitles may refresh every 200-500ms, not every 2+ seconds. |
| **Severity** | **High** |
| **Solution direction** | (1) Add a debounce/deglitch window: collect subtitle text changes over a 500-800ms window before committing a history entry. (2) Improve the merge algorithm to use Levenshtein distance or character-level diffing rather than simple suffix/prefix overlap. (3) Add a sentence-boundary detector: if accumulated text ends with a Chinese sentence-ending punctuation mark (。！？), treat it as a complete sentence and don't merge further. |

### 1.4 Session items lost on page navigation

| Field | Value |
|---|---|
| **Scenario** | User starts a recording session on one video, then clicks a recommended video in the sidebar (SPA navigation). `detectUrlChange()` detects the URL change and silently abandons the session — `state.session.active = false`, `state.session.items = []`. All captured content is lost without warning. |
| **Why it hurts** | Zero feedback. The user thinks recording is still happening (the indicator badge was removed but they may not notice). They stop the session on the new video and get an empty capture — or worse, partially corrupted data if the timing is unlucky. |
| **Severity** | **Critical** |
| **Solution direction** | (1) Show a confirmation dialog when navigation occurs during an active session. (2) Auto-finalize the session before clearing: save whatever was captured so far, then start fresh on the new page. (3) At minimum, show a warning toast "录制已中断：页面导航导致录制已停止". |

---

## 2. Subtitle Detection & Reliability

### 2.1 Fragile DOM selector heuristic

| Field | Value |
|---|---|
| **Scenario** | B站 redesigns its video player layout (as it does frequently). The class names `.bpx-player-subtitle-panel-text`, `bpx-player-subtitle-panel-item`, etc. change. The extension's 11 CSS selectors all fail to match. No subtitles are ever detected. |
| **Why it hurts** | The extension is completely dependent on B站's internal DOM structure, which is not a public API. Any layout change can silently break subtitle detection. There are no tests or fallback mechanisms. Users will blame the extension and abandon it. |
| **Severity** | **Critical** (catastrophic when it happens, but not daily) |
| **Solution direction** | (1) Use Bilibili's public API (`api.bilibili.com/x/web-interface/view?bvid=...` followed by the subtitle URL from the response) to fetch subtitle data server-side, bypassing DOM scraping entirely. (2) Maintain a crowdsourced selector registry with automatic validation. (3) Add a "manual selection" mode where the user clicks on the subtitle area to teach the extension which element to watch. |

### 2.2 Position-based subtitle filtering is fragile

| Field | Value |
|---|---|
| **Scenario** | On some B站 layouts (especially embedded players, or when the user has dev tools open, or on ultrawide monitors), subtitle elements land outside the hardcoded vertical boundaries (`window.innerHeight * 0.35` to `0.92`). `looksLikeSubtitle()` filters them out as false negatives. |
| **Why it hurts** | Users on non-standard viewports silently lose subtitle detection. The position heuristic assumes a very specific layout: subtitles are always in the bottom 65% but not in the bottom 8% of the viewport. This is brittle across screen sizes, zoom levels, and sidebar states. |
| **Severity** | **Medium** |
| **Solution direction** | (1) Replace position-based filtering with CSS-property-based detection: subtitle elements typically have specific font sizes, text alignment, z-index stacking, and parent element patterns. (2) Use a machine-learning-lite approach: collect positive samples (confirmed subtitle elements) and build a feature vector for classification. (3) Add a "sensitivity" setting in the popup. |

### 2.3 Canvas-rendered or WebGL subtitles invisible to DOM

| Field | Value |
|---|---|
| **Scenario** | If B站 uses a canvas-based subtitle renderer (increasingly common for advanced players), subtitle text exists only as pixels on a `<canvas>` element. The extension's `querySelectorAll` and `MutationObserver` cannot detect any text. |
| **Why it hurts** | Complete blind spot. The extension returns "no subtitle found" despite subtitles being visible on screen. |
| **Severity** | **High** |
| **Solution direction** | (1) Use the Web Speech API as a fallback — it works on any video regardless of how subtitles are rendered. (2) Explore B站's subtitle API directly. (3) In the worst case, use OCR via a canvas snapshot, but this is heavyweight and introduces permission/performance concerns. |

### 2.4 No subtitle track selection support

| Field | Value |
|---|---|
| **Scenario** | A B站 video offers both Chinese and English subtitles. The user has English subtitles turned on. The extension captures English text. But the user actually wanted Chinese. There is no way to specify a language preference. |
| **Why it hurts** | The extension captures whatever the DOM shows, which is whatever subtitle track the user selected in the player. Users don't realize this and may get unexpected language output. There is no UI to select or switch subtitle tracks from within the extension. |
| **Severity** | **Medium** |
| **Solution direction** | (1) Use B站's subtitle API to enumerate available subtitle tracks and let the user pick from the popup. (2) Show a subtitle track indicator in the capture card metadata. (3) Store the subtitle language alongside each capture. |

---

## 3. User Experience & Workflow

### 3.1 No editing capability

| Field | Value |
|---|---|
| **Scenario** | User captures a 3-minute session. The merged text has a few errors: a duplicated line, a missing sentence boundary, an extraneous character from the merge logic. They cannot edit the text in the extension. The only options are "copy" (copies the flawed text) or "delete" (loses everything). |
| **Why it hurts** | The user must copy the text to an external editor, fix it there, and has no way to save the corrected version back into the extension. The capture list is full of "almost right" text that the user hesitates to use. Over time, trust in the extension's output erodes. |
| **Severity** | **High** |
| **Solution direction** | (1) Add an inline edit button on capture cards that turns the text area into a contenteditable `<div>` or `<textarea>`. (2) Auto-save edits on blur. (3) Show an "edited" indicator on modified captures. |

### 3.2 No search or filter in the popup

| Field | Value |
|---|---|
| **Scenario** | After a week of use, the user has 40+ captures across many videos. They want to find a specific quote about "machine learning" from a specific video. They must scroll through every card, reading each one. |
| **Why it hurts** | The popup has no search bar, no filter by video title, no date range filter, no tag system. The user's capture collection becomes an unorganized pile. The only organization is reverse chronological order (newest first). |
| **Severity** | **High** |
| **Solution direction** | (1) Add a search input that filters captures by text content and video title. (2) Group captures by video. (3) Add date-based separators ("Today", "This Week", "Earlier"). (4) Implement tagging. |

### 3.3 No bulk operations

| Field | Value |
|---|---|
| **Scenario** | User has 30 captures from a video they no longer care about. They must delete each one individually (click delete, confirm, wait for re-render, repeat). |
| **Why it hurts** | Each deletion triggers `DELETE_CAPTURE` → `renderCaptures()` which re-renders the entire list. For 30 items, that's 30 round-trips to `chrome.storage.local` and 30 full re-renders. The only alternative is "clear all" which nukes everything. |
| **Severity** | **Medium** |
| **Solution direction** | (1) Add multi-select mode with checkbox selection. (2) Add "select all" and "deselect all" controls. (3) Add "delete selected" and "export selected" bulk actions. (4) Batch delete operations server-side in a single storage write. |

### 3.4 No export functionality

| Field | Value |
|---|---|
| **Scenario** | User wants to save their captured quotes to a notes app (Notion, Obsidian, Roam), a text file, or a markdown document. The only export path is copy-paste each card individually. |
| **Why it hurts** | The extension is a data silo. Captures cannot leave the extension except via clipboard (one at a time). Users who want to build a knowledge base from B站 videos will hit this wall quickly. |
| **Severity** | **High** |
| **Solution direction** | (1) Add "Export all" button with format options: JSON, Markdown, Plain Text, CSV. (2) Add "Export selected" for bulk operations. (3) Add a copy-all button that copies all visible (or filtered) captures as formatted text. (4) Consider direct integration with note-taking apps via their APIs. |

### 3.5 Session has no preview before saving

| Field | Value |
|---|---|
| **Scenario** | User presses Ctrl+Shift+S to stop recording. The extension immediately finalizes the session, saves it to storage, and shows a quick toast. The user cannot review what was captured before it is committed. If the merge was bad or the session captured nothing useful, the user must delete the capture afterward. |
| **Why it hurts** | The save is irreversible without a manual delete step. There is no "discard" option. The user feels anxious about stopping a session because they don't know what they'll get. |
| **Severity** | **Medium** |
| **Solution direction** | (1) Show a preview modal/popup when stopping a session: display the merged text, line count, time range. Offer "Save", "Discard", and "Retry" buttons. (2) Include a "Copy without saving" option. |

### 3.6 Too-easy toast dismissal

| Field | Value |
|---|---|
| **Scenario** | User stops a session. A green toast appears "已停止并汇总字幕" for 3 seconds, then fades. The user was looking at the video player, not the top-right corner. They miss the toast entirely and don't know the capture was saved. |
| **Why it hurts** | Toasts are non-blocking, auto-dismissing, and positioned at top-right (not where the user's eyes are after stopping a session). The user may press Ctrl+Shift+S again, starting a new session and potentially confusing themselves. |
| **Severity** | **Medium** |
| **Solution direction** | (1) Add a brief sound effect on capture complete (opt-in). (2) Make the toast persist until clicked. (3) Position the toast near the recording indicator (bottom-left) where the user was looking. (4) Flash the extension icon in the toolbar. |

### 3.7 No recording timer or progress indicator

| Field | Value |
|---|---|
| **Scenario** | User starts recording. The indicator shows a pulsing red dot and "录制中". But there's no timer showing how long they've been recording, no subtitle count, no visual feedback that subtitles are actually being captured. |
| **Why it hurts** | Users don't know if the extension is working. They may stop early out of uncertainty, or continue recording far past the relevant part because they forgot they were recording. |
| **Severity** | **Low** |
| **Solution direction** | (1) Add an elapsed time counter to the recording indicator (e.g., "录制中 · 01:23"). (2) Show a live subtitle count (e.g., "已捕获 12 条字幕"). (3) Briefly flash the indicator when new subtitles are captured. |

---

## 4. Technical & Integration Gaps

### 4.1 Web Speech API (SpeechRecognition) not used

| Field | Value |
|---|---|
| **Scenario** | User watches a B站 video with no CC subtitles, or with canvas-rendered subtitles, or with subtitles the DOM scraper can't find. The extension fails silently despite Chrome having a built-in, high-quality, Chinese-capable speech recognition engine available in the content script context. |
| **Why it hurts** | Chrome's `webkitSpeechRecognition` (part of the Web Speech API) supports `zh-CN` with reasonable accuracy for clear audio. It runs entirely in the browser — no API keys, no network calls, no cost. The extension currently ignores this entire capability. |
| **Severity** | **High** (missed opportunity) |
| **Solution direction** | (1) Add `SpeechRecognition` as an alternative capture source. Start it when DOM-based capture yields no results. (2) Handle the permission flow: `navigator.mediaDevices.getUserMedia` requires user gesture — tie this to the Ctrl+Shift+S shortcut which is a user-initiated event. (3) Handle the continuous mode limitations (speech recognition stops after ~30s of silence; needs restart). (4) Use interim results for real-time display, final results for capture. |

### 4.2 Bilibili subtitle API not consumed

| Field | Value |
|---|---|
| **Scenario** | B站 stores subtitle data server-side in JSON format. For any video with CC, the API endpoint `api.bilibili.com/x/web-interface/view?bvid=...` returns a subtitle URL. Fetching that URL yields a complete, clean, timestamped subtitle transcript. The extension ignores this entirely, instead scraping the DOM for rendered fragments. |
| **Why it hurts** | The DOM scraping approach is fragile, incomplete, and yields fragmented text. The server-side API would give the extension _perfect_ subtitle text with precise timestamps, multiple language tracks, and no fragmentation. |
| **Severity** | **High** (missed opportunity) |
| **Solution direction** | (1) In `content.js`, extract the BVID from the page URL or from embedded page data (`window.__INITIAL_STATE__`). (2) Send a message to `background.js` to fetch the subtitle data (to avoid CORS issues). (3) Parse the subtitle JSON and provide it to the user as a complete transcript. (4) Allow the user to select subtitle tracks (Chinese, English, etc.) from the API data. |

### 4.3 No mobile layout support despite manifest declaration

| Field | Value |
|---|---|
| **Scenario** | The `manifest.json` includes `https://m.bilibili.com/*` in both `host_permissions` and `content_scripts.matches`. However, the content script's subtitle selectors are built for the desktop video-player DOM. On mobile B站, the DOM structure is completely different — different class names, different subtitle rendering, no `.bpx-player-subtitle-panel-*` elements. |
| **Why it hurts** | A user who opens a mobile B站 video on their laptop (or uses responsive design mode) gets broken behavior. The extension declares mobile support but doesn't implement it. This is misleading. |
| **Severity** | **Medium** |
| **Solution direction** | (1) Add mobile-specific CSS selectors. (2) Detect `m.bilibili.com` and use a separate subtitle extraction pipeline. (3) Alternatively, note in the extension description that mobile is not supported and remove the mobile patterns from content_scripts. |

### 4.4 No offline or degraded-mode support

| Field | Value |
|---|---|
| **Scenario** | User is on a train with intermittent connectivity. The B站 page loads partially. Subtitles may be present in the DOM from cache, but extension-to-background communication fails or storage writes fail. |
| **Why it hurts** | If `chrome.storage.local` operations fail (rare but possible in degraded mode), captures are silently lost. The `saveCapture` function does not handle storage write errors gracefully. |
| **Severity** | **Low** |
| **Solution direction** | (1) Add try/catch in `saveCapture` with a user-visible error. (2) Consider an in-memory queue for failed saves with automatic retry. (3) Detect offline status and show a warning. |

### 4.5 500-capture limit is opaque

| Field | Value |
|---|---|
| **Scenario** | User has been collecting captures for months. They reach 500. New captures silently push out the oldest ones (`nextCaptures.slice(0, MAX_CAPTURES)`). The user has no idea their oldest captures are being deleted. |
| **Why it hurts** | Data loss without notification. The user only discovers missing captures when they scroll far back and find them gone. |
| **Severity** | **High** |
| **Solution direction** | (1) Show a storage meter in the popup ("245 / 500 captures used"). (2) Warn the user at 80% and 95% capacity. (3) Make the limit configurable. (4) When deleting old captures, move them to a "recently deleted" area or prompt the user. |

---

## 5. Accessibility

### 5.1 Screen reader blind spots

| Field | Value |
|---|---|
| **Scenario** | A visually impaired user opens the popup. The recording indicator on the video page is a `<div>` with no `role` or `aria-label`. The toast notification uses `aria-live="polite"` on the status bar in the popup, but the toast overlay on the video page (`#bqs-toast`) has no ARIA live region. Screen readers will not announce recording state changes or capture confirmations. |
| **Why it hurts** | The extension is partially or fully unusable with screen readers. Accessibility is not an afterthought — for some users it's the only way to interact. |
| **Severity** | **High** |
| **Solution direction** | (1) Add `role="status"` and `aria-live="polite"` to the toast element. (2) Add `aria-label="录制正在进行中"` and `role="status"` to the recording indicator. (3) Ensure all popup buttons have descriptive text (they do, but verify with `aria-label` where icons are used). (4) Test with NVDA/VoiceOver. |

### 5.2 Color-only status indicators

| Field | Value |
|---|---|
| **Scenario** | User is colorblind (deuteranopia, affecting ~6% of males). The recording indicator uses a red dot against a dark background — indistinguishable from the dark background. The popup status uses green/red text colors for success/error. The user cannot distinguish recording vs. not-recording, or success vs. error. |
| **Why it hurts** | The recording indicator is critical real-time feedback. If it's invisible to the user, they cannot know if the extension is working. |
| **Severity** | **High** |
| **Solution direction** | (1) Add a text label that always accompanies color cues: "REC" icon or text for recording, not just a red dot. (2) Use iconography in addition to color for status messages (checkmark, X, etc.). (3) Follow WCAG 2.1 success criterion 1.4.1 (Use of Color). |

### 5.3 Popup keyboard navigation gaps

| Field | Value |
|---|---|
| **Scenario** | User navigates the extension popup via keyboard (Tab, Shift+Tab, Enter). The capture cards render buttons ("回到原视频", "复制字幕", "删除") which are focusable. However, there is no visible focus ring styling. The `button:focus` state is not defined in CSS. |
| **Why it hurts** | Keyboard users cannot tell which element is focused. Navigation is purely by trial and error. |
| **Severity** | **Medium** |
| **Solution direction** | (1) Add `:focus-visible` outlines to all interactive elements. (2) Ensure tab order follows visual order (it does currently, but verify with dynamic card additions). (3) Test full keyboard flow. |

---

## 6. Performance & Storage

### 6.1 Full re-render on every capture change

| Field | Value |
|---|---|
| **Scenario** | User has 100 captures. They delete one. `renderCaptures()` clears the entire DOM and creates 99 new card elements. Each card has its own event listeners attached via `addEventListener`. This is repeated for every delete, every stop, every clear. |
| **Why it hurts** | Unnecessary DOM work and memory churn. With 500 captures, re-render takes noticeable time (hundreds of milliseconds to over a second). The popup feels sluggish. |
| **Severity** | **Low** (at current scale) |
| **Solution direction** | (1) Use a virtual list or windowed rendering for large capture lists. (2) Implement targeted DOM updates: remove only the deleted card's node instead of re-rendering all. (3) Use event delegation on the captures container instead of per-card listeners. |

### 6.2 No data syncing or backup

| Field | Value |
|---|---|
| **Scenario** | User clears browser data, reinstalls Chrome, or switches to a different computer. All 500 captures are gone. `chrome.storage.local` is per-profile, local to the machine. |
| **Why it hurts** | Captures are not portable. Users who invest time in building a quote collection have no backup or migration path. |
| **Severity** | **Medium** |
| **Solution direction** | (1) Add an "Export all" → "Import" flow for manual backup/restore. (2) Support `chrome.storage.sync` (limited to ~100KB, but useful for critical captures). (3) Optionally offer cloud sync via a companion service. |

---

## 7. Missing Features

### 7.1 No live stream support

| Field | Value |
|---|---|
| **Scenario** | User watches a B站 live stream (live.bilibili.com). The extension's content_scripts only match `www.bilibili.com/video/*` and `m.bilibili.com/video/*`. Live streams are at a different URL pattern. The extension does not load at all. |
| **Why it hurts** | B站 live streams often have real-time subtitles. Users who want to capture quotes from live content have no recourse. |
| **Severity** | **Medium** |
| **Solution direction** | (1) Add `https://live.bilibili.com/*` to `content_scripts.matches`. (2) Add live-stream-specific subtitle selectors (live stream DOM structure differs from video pages). (3) Handle the unique aspects of live streams (no video.currentTime, endless content). |

### 7.2 No notes or annotations

| Field | Value |
|---|---|
| **Scenario** | User captures a quote about "神经网络." They want to add a note: "This was mentioned in the context of backpropagation." There is no notes field on the capture card. |
| **Why it hurts** | The captured text lacks context. Over time, users forget why they saved a particular quote. Metadata (video title, timestamp) helps but is not sufficient for personal knowledge management. |
| **Severity** | **Medium** |
| **Solution direction** | (1) Add a notes field to each capture card, expandable via a "添加笔记" button. (2) Store notes alongside the capture data. (3) Include notes in search. |

### 7.3 No auto-tagging or smart grouping

| Field | Value |
|---|---|
| **Scenario** | User has captures from multiple videos about "machine learning", "history", and "cooking." All captures are in a single flat list. There is no way to group or categorize them without manual effort. |
| **Why it hurts** | As the capture collection grows, retrieval becomes harder. Users must rely on memory of which video contained which quote. |
| **Severity** | **Low** |
| **Solution direction** | (1) Auto-group captures by video. (2) Suggest tags based on video categories from B站's API. (3) Allow manual tagging with autocomplete from existing tags. |

---

## 8. Edge Cases

### 8.1 Video at non-standard playback speed

| Field | Value |
|---|---|
| **Scenario** | User watches at 2x speed. The `scanSubtitle()` function fires on every `timeupdate` event (which fires ~4 times per second regardless of speed). The merge logic uses `gapSeconds > 2` to decide whether two subtitle captures are from different sentences. At 2x speed, subtitle transitions happen twice as fast — the real gap between subtitle changes is ~1 second, which falls below the 2-second threshold, so the merge logic tries to merge unrelated subtitle fragments together. |
| **Why it hurts** | Playback speed directly affects subtitle timing, but the extension's merge logic assumes normal speed. The result is corrupted merged text at higher speeds. |
| **Severity** | **Medium** |
| **Solution direction** | (1) Read `video.playbackRate` and scale the merge threshold accordingly (e.g., `gapSeconds > 2 / playbackRate`). (2) Normalize subtitle change detection to subtitle timecodes rather than wall clock time. |

### 8.2 Very long video sessions (>3 hours)

| Field | Value |
|---|---|
| **Scenario** | User is recording a long lecture or movie (>3 hours). The session's `items` array grows without limit (no cap). The merging/dedup operates on an ever-growing array. The final merged text could be thousands of lines. |
| **Why it hurts** | (1) Potential memory issues in the content script. (2) The popup rendering of a single capture with thousands of lines creates an enormous DOM node (text is in a `<p>` with `white-space: pre-wrap`). (3) The `chrome.storage.local` write of a single capture with 100KB+ of text could hit storage quota issues. |
| **Severity** | **Low** |
| **Solution direction** | (1) Cap session duration to a reasonable maximum (e.g., 2 hours) with a warning. (2) Auto-split long sessions into multiple captures. (3) Implement pagination or "show full text" expand for large captures. |

### 8.3 User has multiple videos open in different tabs

| Field | Value |
|---|---|
| **Scenario** | User has two B站 video tabs open. They start recording on Tab A, then switch to Tab B and start recording there. The shortcut `chrome.commands.onCommand` sends to the active tab, so this works correctly. However, each content script is independent — there's no coordination. |
| **Why it hurts** | (1) The user may forget they have an active session in another tab. (2) No global indicator of active sessions across tabs. (3) The popup only shows state for the current tab. |
| **Severity** | **Low** |
| **Solution direction** | (1) Track active sessions per-tab in `background.js`. (2) Show a session count badge on the extension icon. (3) Warn when starting a new session if another tab has an active session. |

---

## 9. Summary of Critical Issues (Priority Order)

| # | Pain Point | Why It's Critical |
|---|---|---|
| 1 | No capture without CC subtitles | Extension is entirely non-functional in this common scenario |
| 2 | Retroactive capture impossible | Violates the user's primary mental model of "save what I just saw" |
| 3 | Session lost on navigation without warning | Silent data loss with zero user feedback |
| 4 | Fragile DOM selectors break on B站 layout changes | Extension breaks silently; no fallback |
| 5 | 500-capture limit causes silent data loss | No notification when old captures are deleted |

---

## 10. Key Technical Opportunities

### Web Speech API (SpeechRecognition)

- **Availability:** Chrome 25+, available in extension content script contexts.
- **Chinese support:** Yes, `lang: 'zh-CN'` with good accuracy for clear audio.
- **Key limitation:** Requires user gesture to start (satisfied by keyboard shortcut).
- **Key limitation:** Continuous mode stops after ~30s of silence; must be restarted.
- **Key limitation:** Accuracy degrades with background music, heavy accents, overlapping speech.
- **Recommendation:** Use as a fallback when DOM subtitles are unavailable. Not a replacement for CC-based capture.

### Bilibili Subtitle API

- **Endpoint:** `https://api.bilibili.com/x/web-interface/view?bvid={BVID}`
- **Response shape:** Returns `data.subtitle.subtitles[]` with `subtitle_url` (a relative URL to a JSON file containing the full transcript with per-sentence timestamps).
- **Advantages:** Perfect text, no fragmentation, multiple languages, precise timestamps, no DOM dependency.
- **Recommendation:** This should be the primary capture mechanism. DOM scraping is a fallback for videos where the API returns no subtitles.

### Hybrid Architecture (Recommended)

```
                  ┌─────────────────────┐
                  │  Bilibili API       │
                  │  (perfect text,     │
                  │   multi-language,   │  ← Primary source
                  │   precise times)    │
                  └─────────┬───────────┘
                            │
                  ┌─────────▼───────────┐
                  │  DOM Scraper        │
                  │  (real-time, works  │  ← Fallback #1
                  │   for live/stream)  │
                  └─────────┬───────────┘
                            │
                  ┌─────────▼───────────┐
                  │  Web Speech API     │
                  │  (works with NO     │  ← Fallback #2
                  │   subtitles at all) │
                  └─────────────────────┘
```

---

## 11. Appendix: Quick Wins (Low Effort, High Impact)

1. **Fix the merge algorithm** — Add Levenshtein-based merging and a debounce window. This alone would dramatically improve text quality with minimal code changes.

2. **Add search** — A simple text filter on `renderCaptures()` that hides cards not matching the query. One `<input>` field, ~20 lines of JavaScript.

3. **Add export (JSON + TXT)** — A single "Export" button that serializes all captures to a downloadable file. ~30 lines of code in background.js + a download trigger.

4. **Fix the 500-capture warning** — Show a storage meter and warn before silent deletion. ~15 lines of code.

5. **Improve toast feedback** — Make toast persist until clicked, add a short sound, or flash the extension icon.

6. **Add ARIA labels** — `role="status"` on toast, `aria-label` on indicator. < 10 lines of code.

7. **Scale merge threshold by playback speed** — Read `video.playbackRate` and adjust `gapSeconds`. ~3 lines of code.
