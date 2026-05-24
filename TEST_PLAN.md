# Bilibili Quote Saver — Test Plan

**Extension version:** 0.1.0  
**Date:** 2026-05-24  
**Platform:** Chrome (Manifest V3)  
**Source directory:** `D:\Projects\Ai\bilibili_quote_saver\extension\`

---

## Table of Contents

1. [Installation Verification Checklist](#1-installation-verification-checklist)
2. [Manual Test Scenarios](#2-manual-test-scenarios)
   - [2.1 Happy Path](#21-happy-path)
   - [2.2 Empty State / No Subtitles](#22-empty-state--no-subtitles)
   - [2.3 Edge Cases](#23-edge-cases)
   - [2.4 Error Cases](#24-error-cases)
   - [2.5 Stress Tests](#25-stress-tests)
   - [2.6 Cross-Page Scenarios](#26-cross-page-scenarios)
3. [Code-Level Edge Cases](#3-code-level-edge-cases)
4. [Unit-Test-Like Assertions by Function](#4-unit-test-like-assertions-by-function)
   - [4.1 content.js](#41-contentjs)
   - [4.2 background.js](#42-backgroundjs)
   - [4.3 popup.js](#43-popupjs)

---

## 1. Installation Verification Checklist

Run through these steps immediately after loading the extension into Chrome (via `chrome://extensions` > "Load unpacked").

| # | Check | Expected Result |
|---|-------|-----------------|
| 1.1 | Extension appears in `chrome://extensions` | Card titled "Bilibili Quote Saver", version 0.1.0 |
| 1.2 | Extension icon appears in toolbar | Default icon visible |
| 1.3 | Click the extension icon on any non-B站 tab | Popup opens, button says "开始记录", status is empty, capture list shows "还没有收藏内容" |
| 1.4 | Popup layout at min width | No horizontal scrollbar; header, toolbar, status, captures section all render cleanly at 380px |
| 1.5 | Keyboard shortcut registered | Go to `chrome://extensions/shortcuts` and verify "保存当前字幕" is bound to Ctrl+Shift+S (or Cmd+Shift+S on Mac) |
| 1.6 | Verify content script injection | Open DevTools on a B站 video page (`https://www.bilibili.com/video/*`), console should not show errors from content.js |
| 1.7 | Verify host permissions | Navigate to `https://www.bilibili.com/video/BV1xx411c7mD` and confirm the extension icon is active (not greyed out) |

---

## 2. Manual Test Scenarios

### 2.1 Happy Path

**Test 2.1.1 — Record a session and verify saved quote**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open a B站 video with Chinese subtitles enabled | Video plays, subtitles appear |
| 2 | Click the extension icon, then click "开始记录" | Popup shows "已开始记录字幕", button changes to "停止并汇总" |
| 3 | Let the video play for 10-15 seconds | Subtitles should change naturally |
| 4 | Click "停止并汇总" | Popup shows "已停止并汇总字幕", capture list now shows 1 card |
| 5 | Verify the capture card | Text displayed matches what was spoken; metadata shows title, time range, line count, date |
| 6 | Click "回到原视频" | A new tab opens at the video URL with `?t=<start_seconds>` parameter |
| 7 | Click "复制字幕" | Status shows "已复制字幕"; paste into a text editor to confirm content |
| 8 | Reload the popup (close and reopen) | Capture card persists |

**Test 2.1.2 — Keyboard shortcut toggle**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open a B站 video, ensure subtitles visible | |
| 2 | Press Ctrl+Shift+S | A green toast "开始记录字幕" appears in top-right of video page |
| 3 | Wait for several subtitle changes | |
| 4 | Press Ctrl+Shift+S again | Green toast "已停止并汇总字幕" appears |
| 5 | Open popup | Verify capture was saved |

**Test 2.1.3 — Empty recording (start then stop immediately)**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open a B站 video | |
| 2 | Click "开始记录" | Status: "已开始记录字幕" |
| 3 | Immediately click "停止并汇总" (before any subtitle change) | Status: "已停止并汇总字幕"; capture is saved (should contain at least the subtitle visible at start) |

**Test 2.1.4 — Verify jump URL works correctly**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Record a session starting at approximately 1:23 | |
| 2 | Click "回到原视频" | URL in new tab includes `?t=83` (or closest second) |
| 3 | Verify video seeks to that position | Video starts playing near the 1:23 mark |

### 2.2 Empty State / No Subtitles

**Test 2.2.1 — Popup with no captures saved**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Fresh install (or after clearing all) | |
| 2 | Open popup | "0 条收藏" displayed; dashed border box with "还没有收藏内容，去 B 站开始录一段吧。" |

**Test 2.2.2 — Video with no subtitles available**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open a B站 video that has no subtitle track (e.g., a music video without CC) | |
| 2 | If subtitles are off, ensure they are off | |
| 3 | Click "开始记录" | Popup shows "当前页面没有可记录的字幕" (red error) or shows a red toast "当前页面没有可记录的字幕" on the video page |
| 4 | Button stays on "开始记录" | It did not toggle |

**Test 2.2.3 — Subtitles exist but are disabled**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open a B站 video with subtitles available, but click the "CC" button to disable them | |
| 2 | Click "开始记录" | Error: "当前页面没有可记录的字幕" |

**Test 2.2.4 — Clear all captures**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Popup has 3+ capture cards visible | |
| 2 | Click "清空" | Status: "已清空收藏"; capture list is now empty; count shows "0 条收藏" |
| 3 | Reload popup | Empty state persists |

### 2.3 Edge Cases

**Test 2.3.1 — Very short subtitle (2-3 characters)**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Find or seek to a moment where subtitle is very short (e.g., "嗯", "是", "对") | |
| 2 | Start recording | |
| 3 | Wait for short subtitle to appear | |
| 4 | Stop and inspect | Short subtitle should be captured if it is >2 chars or contains Chinese punctuation (per `looksLikeSubtitle` logic) |

**Test 2.3.2 — Single-character subtitle should be ignored**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Find a moment where subtitle is a single character (e.g., "啊") | |
| 2 | Record session | Single-char subtitle should NOT appear in captured text |

**Test 2.3.3 — Very long subtitle (near 120 characters)**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Seek to a moment with a long subtitle line (>80 characters) | |
| 2 | Start recording, wait for it to appear | |
| 3 | Stop and inspect | Long subtitle is captured completely, not truncated |

**Test 2.3.4 — Subtitle longer than 120 characters**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | If a subtitle >120 chars exists (or simulate by manipulating DOM) | |
| 2 | Verify it is filtered out by `looksLikeSubtitle` (line 165: `compact.length > 120`) | The long text is ignored |

**Test 2.3.5 — Rapid start/stop**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open video page | |
| 2 | Click "开始记录" then "停止并汇总" in under 1 second | Operation completes; capture may be empty (expect error if no subtitle was visible) or contain the single current subtitle |
| 3 | Repeat 3 times in quick succession | Extension remains responsive; no duplicate captures; no crashes |

**Test 2.3.6 — Rapid subtitle changes (auto-generated vs. pre-made subtitles)**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open a video with frequent subtitle changes (e.g., rap, fast dialogue) | |
| 2 | Start recording, let it run for 30 seconds | |
| 3 | Stop and inspect | All distinct subtitles captured; deduplication merges overlapping text correctly; no garbled text |

**Test 2.3.7 — M3U8 / segmented video with changing video element**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open a B站 video that uses segmented loading | |
| 2 | Start recording, let it play past a segment boundary | Content script's MutationObserver re-binds to new video element; recording continues without interruption |

**Test 2.3.8 — Video with timestamp in URL already**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open a B站 video URL with existing `?t=120` | |
| 2 | Record a session | `buildCanonicalUrl` strips `?t=120`; saved URL is clean |
| 3 | Click "回到原视频" | New URL has only the session's start timestamp, not mixed |

**Test 2.3.9 — Video title with special characters**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Find a video whose title contains special characters (e.g., quotes, emoji, `/`, `\`, `&`) | |
| 2 | Record a session | Title stored correctly; popup displays title without encoding errors |

**Test 2.3.10 — Non-Chinese subtitles (English, Japanese, etc.)**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open a B站 video with English or Japanese subtitles | |
| 2 | Start recording | Subtitles captured correctly; no encoding issues |

**Test 2.3.11 — Simultaneous split-screen / danmaku overlay**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open a video with heavy danmaku (弹幕) | |
| 2 | Start recording | `BLOCKED_TEXTS` filters out danmaku UI elements; subtitle text is clean (no "弹幕" or "发送" text) |

**Test 2.3.12 — Subtitle with repeated punctuation**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Find a moment where subtitle contains repeated punctuation (e.g., "！！！", "？？") | |
| 2 | Record | `cleanupMergedText` reduces repeats to single punctuation |

**Test 2.3.13 — History overflow (more than 30 subtitle changes)**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Record a long session with 50+ distinct subtitle changes | |
| 2 | Stop recording | All distinct subtitles should be captured (history caps at 30 but session items are separate); session items should contain the full set |

### 2.4 Error Cases

**Test 2.4.1 — Toggle recording on a non-B站 page**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `https://example.com` | |
| 2 | Open popup, click "开始记录" | Status shows "当前页面没有可记录的字幕" (red error) |
| 3 | Press Ctrl+Shift+S | Red toast "当前页面无法读取字幕" appears on the page |

**Test 2.4.2 — Toggle on a B站 page that is not a video (e.g., homepage)**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to `https://www.bilibili.com` (no `/video/` in URL) | |
| 2 | Click "开始记录" | Error: content script is not injected (host permissions only match `/video/*`). Background catches error, shows "当前页面无法读取字幕". |

**Test 2.4.3 — Toggle on a B站 music page (`https://music.bilibili.com`)**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to a B站 music page | |
| 2 | Click "开始记录" | Error: no content script injected, no video element found |

**Test 2.4.4 — Tab with video element but no subtitle container**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open a page that has a `<video>` element but no B站 subtitle DOM structure | |
| 2 | Click "开始记录" | `pickBestSubtitle` returns empty; session ends with `no_subtitle_found` error |

**Test 2.4.5 — Video paused while recording**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Start recording while video is playing | |
| 2 | Pause video for 10 seconds | |
| 3 | Resume, play for 10 more seconds | |
| 4 | Stop recording | Captured text should only include subtitle changes; duplicate entries for the same subtitle should be merged |

**Test 2.4.6 — `navigator.clipboard.writeText` denied/fails**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Revoke clipboard permission for the extension | |
| 2 | Open popup, click "复制字幕" | `navigator.clipboard.writeText` rejects; popup.js does not catch this error — verify the console has an unhandled promise rejection |
| 3 | Confirm status does NOT update to "已复制字幕" | The promise rejection means `setStatus` is never called (line 112 runs after await) |

*Note: This is a known gap — popup.js line 111 uses `await navigator.clipboard.writeText(...)` without try/catch.*

### 2.5 Stress Tests

**Test 2.5.1 — Record 500+ quotes (storage quota stress)**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Write a script (via DevTools console) that triggers 600 save operations, or manually record 500 sessions | |
| 2 | Open popup | "500 条收藏" shown (or 500); only most recent 500 are kept per `MAX_CAPTURES` |
| 3 | Verify no data corruption | All cards render; click "复制字幕" on a few to verify content integrity |

**Test 2.5.2 — Rapid toggle 50 times**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open B站 video, start recording | |
| 2 | Rapidly click "停止并汇总" then "开始记录" 50 times (or press Ctrl+Shift+S repeatedly) | |
| 3 | Verify no crashes, no duplicate captures | Extension remains functional; popup renders normally |

**Test 2.5.3 — Very long recording session (1 hour+)**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Start recording on a long video (>1 hour) | |
| 2 | Leave it running (can be playing or paused) | |
| 3 | After 1 hour, stop recording | Session captures all unique subtitles; no memory issues; computer doesn't slow down |

*Risk:* `state.session.items` array could grow very large. Although deduplication keeps it manageable, in a 1-hour video with a subtitle change every 3 seconds, that's ~1,200 items. This should be fine, but worth testing.

**Test 2.5.4 — Multiple rapid subtitle changes (subtitle every 1 second)**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Use a video with very rapid subtitle changes (e.g., karaoke-style) | |
| 2 | Start recording for 60 seconds | |
| 3 | Inspect session items | No gaps; all subtitles captured |

*Note:* The 800ms `rescanTimer` may miss subtitles that change faster than 800ms. This is a known limitation.

**Test 2.5.5 — Storage write failure (simulate quota exceeded)**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | In DevTools, use `chrome.storage.local.set({ captures: new Array(10000).fill("x") })` to fill storage | |
| 2 | Try recording a new quote | `chrome.storage.local.set` in `saveCapture` may throw. Currently no error handling — verify if the extension handles this gracefully |

### 2.6 Cross-Page Scenarios

**Test 2.6.1 — Switch tabs while recording**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Start recording on Tab A (B站 video) | |
| 2 | Switch to Tab B (non-B站, e.g., Gmail) | Recording continues on Tab A (content script is still active) |
| 3 | Wait 10 seconds, switch back to Tab A | Subtitles continued to be captured |
| 4 | Stop recording | All subtitles from the full period (including Tab A being backgrounded) are captured |

*Note:* Chrome may throttle timers on background tabs to 1-minute minimum intervals. The 800ms `setInterval` could be severely delayed. Verify whether this causes missed subtitles.

**Test 2.6.2 — Close tab while recording**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Start recording on Tab A | |
| 2 | Immediately close Tab A | |
| 3 | Open popup | No unsaved data remains (session is lost — this is expected behavior) |

**Test 2.6.3 — Navigate away from video while recording**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Start recording on a B站 video page | |
| 2 | Navigate (within the same tab) to another B站 video | Content script re-executes on new page load; old session is lost |
| 3 | Open popup | The old session data does not appear (expected: session is page-scoped) |

**Test 2.6.4 — Two B站 tabs recording simultaneously**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Open Tab A (B站 video 1), start recording | |
| 2 | Open Tab B (B站 video 2), start recording | Both show "已开始记录字幕" |
| 3 | Let both play for 20 seconds | |
| 4 | Stop recording on Tab A | Capture A is saved |
| 5 | Stop recording on Tab B | Capture B is saved |
| 6 | Verify both captures in popup | Two distinct capture cards with different video titles, timestamps, and content |

**Test 2.6.5 — Popup interaction while recording on background tab**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Start recording on Tab A (B站) | |
| 2 | Switch to Tab B (any page) | |
| 3 | Open popup (on Tab B) | Popup shows recording state of Tab B (which is not recording), so button says "开始记录" |
| 4 | Switch back to Tab A, open popup | Button now says "停止并汇总" |

**Test 2.6.6 — Service worker idle timeout**

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Leave Chrome idle for ~30 seconds after last interaction | Chrome may terminate the service worker (MV3 behavior) |
| 2 | Open popup | Popup should wake the service worker via `chrome.runtime.sendMessage` |
| 3 | Click "开始记录" | Extension resumes normal operation |

---

## 3. Code-Level Edge Cases

### 3.1 `document.title` format changes

- **Current assumption:** `document.title` ends with `_哔哩哔哩_bilibili`.
- **Code:** `line 280` — `document.title.replace(/_哔哩哔哩_bilibili$/, '')`
- **Risk:** If B站 changes their title format (e.g., adds a space, changes the suffix), the video title will include the raw suffix.
- **Impact:** Saved quotes may have ugly title suffixes.
- **Test:** Find or simulate a page where `document.title` does not match the expected regex. Verify `normalizeText` handles the fallback (line 280: `|| document.title`).

### 3.2 Video element inside a shadow DOM

- **Current assumption:** The `<video>` element and subtitle containers are in the light DOM.
- **Code:** `document.querySelector('video')` (line 77) and `document.querySelectorAll(selector)` (line 133) do not penetrate shadow roots.
- **Risk:** If B站 moves subtitle elements into a shadow DOM (e.g., for a new player), the extension will not find them.
- **Impact:** No subtitles captured. Silent failure (no error thrown).
- **Test:** Create a test page where subtitle elements are inside `attachShadow({mode: 'open'})` and verify content.js cannot find them.

### 3.3 `chrome.storage.local` quota exceeded

- **Current assumption:** Storage always succeeds.
- **Code:** `background.js` lines 109-119 (`saveCapture`) and lines 122-127 (`deleteCapture`) have no error handling on `chrome.storage.local.set()`.
- **Risk:** Chrome's `storage.local` has a ~10 MB quota. If a user stores many large subtitle captures, writes can fail silently.
- **Impact:** New captures are silently lost.
- **Test:** Fill storage to near-capacity, then attempt to save a new capture. Verify by checking `chrome.runtime.lastError` or catching the promise rejection. Currently the code does not handle this.

### 3.4 Two tabs recording simultaneously

- **Current assumption:** Each content script instance is isolated.
- **Code:** `state.session` is scoped per-content-script (IIFE), so per-tab.
- **Risk:** The background service worker is shared, but each `toggleRecordingOnTab(tabId)` call targets a specific tab via `chrome.tabs.sendMessage(tabId, ...)`. No shared mutable state for sessions.
- **Verdict:** Correct by design. No cross-tab session collision.
- **Test:** Already covered in Test 2.6.4.

### 3.5 `navigator.clipboard.writeText` fails

- **Current assumption:** Clipboard write always succeeds.
- **Code:** `popup.js` line 111: `await navigator.clipboard.writeText(capture.text || '')` — no try/catch.
- **Risk:** If clipboard permission is denied or `https` requirement not met, the promise rejects with an unhandled rejection.
- **Impact:** "复制字幕" button appears to do nothing; console shows unhandled promise rejection.
- **Test:** Test 2.4.6 covers this. Fix recommendation: wrap in try/catch and call `setStatus('复制失败', true)`.

### 3.6 Content script not injected (race condition)

- **Current assumption:** Content script is always injected on B站 video pages.
- **Code:** `manifest.json` uses `document_idle`. Theoretical race: user opens video page, immediately clicks extension before content script finishes loading.
- **Risk:** `chrome.tabs.sendMessage` will throw because there is no listener yet.
- **Impact:** Background catches the error (line 103), shows "当前页面无法读取字幕" toast.
- **Verdict:** Graceful degradation, but could confuse users who are on a valid video page.
- **Test:** Quickly open a B站 video and click the extension icon within 200ms.

### 3.7 `new URL(rawUrl)` throws on malformed URL

- **Current assumption:** `window.location.href` is always a valid URL.
- **Code:** `content.js` lines 421-425 and 428-433 call `new URL(rawUrl)`.
- **Risk:** Extremely unlikely in practice (browser pages always have valid URLs), but if the page URL is somehow invalid (e.g., `chrome-error://`), it throws.
- **Impact:** `stopSession()` would throw, preventing the capture from being saved.
- **Test:** This is a theoretical edge case — not easily testable in production.

### 3.8 `BLOCKED_TEXTS` misses a new UI string

- **Current assumption:** The 17 blocked strings cover all UI text that might appear inside subtitle containers.
- **Risk:** If B站 adds a new UI element (e.g., "字幕设置", "AI字幕"), it could be misidentified as a subtitle.
- **Test:** After any B站 UI update, review the blocked texts list. Monitor for unexpected text in captures.
- **Mitigation:** The `score` system prioritizes text near the subtitle position (78% viewport height), so most UI elements are excluded by position before the blocked-text check matters.

### 3.9 MutationObserver performance on heavy DOM changes

- **Current assumption:** The MutationObserver in `observeSubtitleChanges` watches `document.body` with `subtree: true`.
- **Risk:** B站 pages are highly dynamic (danmaku DOM updates, comments loading, ads). Every DOM mutation triggers `scanSubtitle()`, which does `querySelectorAll` for 10 selectors. This could cause performance issues on low-end machines.
- **Test:** Open a B站 video with heavy danmaku and scroll the comments section rapidly while recording. Monitor CPU usage in Chrome Task Manager.

### 3.10 `crypto.randomUUID()` availability

- **Current assumption:** Service workers have access to `crypto.randomUUID()`.
- **Code:** `background.js` line 113.
- **Risk:** `crypto.randomUUID()` is available in secure contexts (HTTPS) and Chrome 92+. Since the extension runs in a service worker context, this should be fine. But if it's not available, `saveCapture` will throw.
- **Test:** If possible, test in an older Chrome version or polyfill scenario.

### 3.11 Toast removal race condition

- **Current assumption:** Multiple `showToast` calls in quick succession are handled.
- **Code:** `content.js` lines 453-483 — the existing toast is removed before creating a new one, and the previous timer is cleared.
- **Risk:** If `showToast` is called twice very quickly (within the same microtask), the second call might remove the first before it's appended. However, line 455-457 removes the old element by ID, so this should be safe.
- **Test:** Test 2.3.5 (rapid start/stop) — verify toast displays correctly.

### 3.12 Video element rebinding race

- **Current assumption:** The MutationObserver in `bindVideo()` catches video element replacement.
- **Code:** Lines 76-92. `attachVideo()` checks `if (!video || state.video === video)` to avoid duplicate binding.
- **Risk:** If B站 replaces the video element rapidly (e.g., during ad transitions or quality switching), there's a brief window where `state.video` points to a detached element. `getCurrentTime()` would still return the last known `currentTime` of the detached element.
- **Test:** Record during a B站 video that has pre-roll ads. Verify capture still works after the ad ends and the main video starts.

### 3.13 Session deduplication edge cases

- **Edge case A:** Two subtitles with a shared overlap of exactly 2 characters (e.g., "你好世界" and "世界很大"). `getOverlapLength` returns 2, and `minLength` is 4, so 2 >= ceil(4*0.6)=3 is FALSE — they are NOT merged. Correct behavior.
- **Edge case B:** Two subtitles where one is a substring of the other (e.g., "今天天气很好" and "天气很好"). `currentText.includes(previousText)` catches this and returns `currentText`. Verified.
- **Edge case C:** Gap > 2 seconds between subtitles. `mergeSubtitleText` returns `''`, forcing a new item. Verified.
- **Test:** Find real subtitle transitions that match these patterns and verify the merged output.

---

## 4. Unit-Test-Like Assertions by Function

### 4.1 content.js

#### `init()`
| Input | Expected Output |
|-------|-----------------|
| (no params) | Calls `bindVideo()`, `observeSubtitleChanges()`, `scheduleRescan()` in sequence |
| Called multiple times (e.g., content script re-executes) | Duplicate observers and timers are created (potential leak). `init` is called once at IIFE execution time, so this is not a runtime concern. |

#### `bindVideo()`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| Page has one `<video>` element | Video element is found, `timeupdate`, `seeked`, `play` listeners attached |
| Page has zero `<video>` elements | `state.video` remains `null`; MutationObserver continues watching |
| Video element is dynamically added later | MutationObserver catches it, `state.video` is set, listeners attached |
| Same video element already bound (`state.video === video`) | No duplicate listeners (early return at line 78-80) |
| Video element replaced (new DOM node) | Old listeners lost; new listeners attached to new element |

#### `observeSubtitleChanges()`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| Called once | MutationObserver created on `document.body || document.documentElement` |
| Called twice (re-init during page lifecycle) | Previous observer disconnected, new one created |
| `document.body` is null | Falls back to `document.documentElement` |

#### `scheduleRescan()`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| Called once | `setInterval(scanSubtitle, 800)` registered |
| Called multiple times | Previous interval cleared, new one started |
| `state.rescanTimer` is null (first call) | No error — `clearInterval(null)` is a no-op |

#### `scanSubtitle()`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| `pickBestSubtitle()` returns a new subtitle | `state.currentSubtitle` updated, `pushHistory` called, `pushSessionItem` called |
| `pickBestSubtitle()` returns the same subtitle as before | No state change (line 121 guard) |
| `pickBestSubtitle()` returns empty string | Guard at line 117-119 prevents any action |
| Called while `state.session.active = false` | Subtitle is still pushed to history (via `pushHistory`), but not to session (via `pushSessionItem` guard at line 305-307) |
| Called while `state.session.active = true` | Subtitle is pushed to both history and session |

#### `pickBestSubtitle()`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| No matching elements for any selector | Returns `''` |
| One subtitle element on screen in correct position | Returns normalized text of that element |
| Multiple candidate elements | Returns the one with highest score |
| All candidates are invisible | Filtered out by `isVisible`; returns `''` |
| All candidates are UI controls | Filtered out by `looksLikeSubtitle` -> `isInsideControl`; returns `''` |
| Candidates at different vertical positions | The one closest to 78% viewport height scores highest |
| Candidate with very long text (>120 chars) | Filtered out by `looksLikeSubtitle` (line 165) |
| Candidate with exactly 120 chars | NOT filtered out |
| Single-character candidate (e.g., "啊") | Filtered out by `looksLikeSubtitle` unless contains Chinese punctuation |
| Two-character candidate with punctuation (e.g., "是吗？") | Allowed through |
| Element matching two different selectors | Scored twice with different selector-index bonuses; higher-index (earlier in list) scores higher |

#### `looksLikeSubtitle(text, node)`
| Input | Expected Output |
|-------|-----------------|
| Text length < 2 (compact) | `false` |
| Text length > 120 (compact) | `false` |
| Text is in `BLOCKED_TEXTS` (e.g., "字幕") | `false` |
| Node is inside a button/control | `false` |
| Node vertical center < 35% of viewport height | `false` |
| Node vertical center > 92% of viewport height | `false` |
| Valid subtitle text at correct position | `true` |
| 2-char text without punctuation | `false` (line 183-185) |
| 2-char text with Chinese punctuation (e.g., "！") | `true` |
| Text with whitespace that compacts to valid length | Normalized properly |

#### `isInsideControl(node)`
| Input | Expected Output |
|-------|-----------------|
| Node inside a `<button>` | `true` |
| Node inside `[role="button"]` | `true` |
| Node inside `.bpx-player-control-wrap` | `true` |
| Node inside `.bpx-player-ctrl-wrap` | `true` |
| Node with no matching ancestor | `false` |
| Non-Element node (text node passed directly) | `true` (early return at line 190-193) |

#### `isVisible(node)`
| Input | Expected Output |
|-------|-----------------|
| `display: none` | `false` |
| `visibility: hidden` | `false` |
| `opacity: 0` | `false` |
| Zero-width or zero-height bounding rect | `false` |
| Non-HTMLElement (SVG element, text node) | `false` |
| Normal visible element | `true` |
| `opacity: 0.5` | `true` (only exact 0 is filtered) |

#### `pushHistory(text)`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| New text different from last history entry | Entry added with `text`, `timestampSec`, `updatedAt` |
| Same text as last entry | No duplicate (guard at line 219-220) |
| History length > 30 | Oldest entry shifted out |
| Text with leading/trailing whitespace | Stored as-is (not normalized here; normalized at entry point) |

#### `toggleCaptureSession()`
| Scenario | Expected Output |
|----------|-----------------|
| `state.session.active === false` | Calls `startSession()` |
| `state.session.active === true` | Calls `stopSession()` |
| Return value of `startSession()` | `{ success: true, active: true }` |
| Return value of `stopSession()` when items exist | `{ success: true, active: false, capture: {...} }` |
| Return value of `stopSession()` when no items | `{ success: false, active: false, reason: 'no_subtitle_found' }` |

#### `startSession()`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| Called while currentSubtitle exists | Session active; current subtitle pushed as first session item |
| Called while currentSubtitle is empty | Session active; no initial item; `startedAt` and `startedTimestampSec` recorded |

#### `stopSession()`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| `state.session.items` has 3 distinct items | Returns capture with `text` containing all 3, joined by `\n`, `lineCount: 3` |
| `state.session.items` is empty | Returns `{ success: false, reason: 'no_subtitle_found' }` |
| Items have duplicates (same text consecutively) | Deduplicated; no consecutive identical texts in output |
| `state.currentSubtitle` exists | Final subtitle pushed before deduplication |
| `state.video.currentTime` is 0 (no video) | `getCurrentTime()` returns 0; `getFallbackTimestamp()` searches history for latest positive timestamp |

#### `pushSessionItem(text, force)`
| Input | Expected Output |
|-------|-----------------|
| `force = false`, `state.session.active = false` | No-op (guard) |
| `force = true`, `state.session.active = false` | Item pushed |
| `text` is empty/falsy | No-op |
| `text` same as last item in session | No duplicate |
| Valid text, session active, different from last | Item pushed with current timestamp |

#### `dedupeSessionItems(items)`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| `[]` (empty array) | Returns `[]` |
| `[{text: "你好"}, {text: "你好"}]` (consecutive duplicate) | Returns single merged item `[{text: "你好"}]` |
| `[{text: "今天天气"}, {text: "天气很好"}]` (overlap within 2s) | Returns `[{text: "今天天气很好"}]` (merged with cleanup) |
| `[{text: "你好"}, {text: "世界"}]` (no overlap) | Returns `[{text: "你好"}, {text: "世界"}]` |
| Items with `BLOCKED_TEXTS` values | Filtered out during dedup loop (line 331) |
| Items with gap > 2 seconds | Not merged; separate entries preserved |
| `[{text: ""}, {text: "你好"}]` (empty text) | Empty text filtered out |
| Items where one text includes the other | Returns the longer text (`currentText.includes(previousText)` logic) |

#### `mergeSubtitleText(prevText, currText, prevItem, currItem)`
| Input | Expected Output |
|-------|-----------------|
| `("ABC", "ABC", _, _)` (identical) | `"ABC"` |
| `("AB", "XAB")` (current includes previous) | `"XAB"` (currentText returned) |
| `("XAB", "AB")` (previous includes current) | `"XAB"` (previousText returned) |
| `("你好世界", "世界很大")` (overlap "世界", within 2s) | `"你好世界很大"` |
| `("你好世界", "世界很大")` (overlap "世界", but gap > 2s) | `""` (gapSeconds > 2) |
| `("你好", "世界")` (no overlap) | `""` |
| Either input is empty/falsy | `""` |

#### `getOverlapLength(prevText, currText)`
| Input | Expected Output |
|-------|-----------------|
| `("abcdef", "cdefgh")` | `4` (overlap "cdef") |
| `("abc", "def")` (no overlap) | `0` |
| `("ab", "bc")` (single char overlap) | `0` (minimum check length is 2) |
| `("abc", "abc")` (identical) | `3` |
| `("", "abc")` | `0` |

#### `cleanupMergedText(text)`
| Input | Expected Output |
|-------|-----------------|
| `" 你好   世界 "` | `"你好 世界"` (multiple spaces collapsed) |
| `"你好！！！"` | `"你好！"` (repeated punctuation collapsed) |
| `"你好吗？？"` | `"你好吗？"` (repeated question marks collapsed) |
| `"\n你好\n世界\n"` | `"你好 世界"` (newlines converted to spaces, trimmed) |
| `"你好世界"` (clean text) | `"你好世界"` (unchanged) |

#### `getCurrentTime()`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| `state.video` is a `<video>` with `currentTime = 123.7` | `123` (floor) |
| `state.video` is `null` | `0` |
| `state.video.currentTime` is `NaN` | `0` (after `Math.floor` yields NaN, `|| 0` yields 0) |

#### `getFallbackTimestamp()`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| `state.history` has items with `timestampSec >= 0` | Returns `timestampSec` of most recent item |
| `state.history` is empty | Returns `0` |
| All history items have `timestampSec = 0` | Returns `0` |

#### `buildCanonicalUrl(rawUrl)`
| Input | Expected Output |
|-------|-----------------|
| `"https://www.bilibili.com/video/BV1xx411c7mD?t=83&p=1"` | `"https://www.bilibili.com/video/BV1xx411c7mD?p=1"` (`t` removed, hash removed) |
| `"https://www.bilibili.com/video/BV1xx411c7mD#section"` | `"https://www.bilibili.com/video/BV1xx411c7mD"` (hash removed) |
| `"https://www.bilibili.com/video/BV1xx411c7mD"` | Same URL unchanged |

#### `buildJumpUrl(rawUrl, seconds)`
| Input | Expected Output |
|-------|-----------------|
| `("https://...", 83)` | `"https://...?t=83"` |
| `("https://...", 0)` | Same URL, no `?t=` parameter (line 430 guards `> 0`) |
| `("https://...?p=1", 83)` | `"https://...?p=1&t=83"` |

#### `normalizeText(text)`
| Input | Expected Output |
|-------|-----------------|
| `"  你好  世界  "` | `"你好 世界"` |
| `"你好\n世界"` | `"你好 世界"` |
| `"  "` (whitespace only) | `""` |
| `""` | `""` |

#### `formatTime(totalSeconds)`
| Input | Expected Output |
|-------|-----------------|
| `0` | `"00:00"` |
| `5` | `"00:05"` |
| `65` | `"01:05"` |
| `3661` | `"01:01:01"` |
| `-5` | `"00:00"` (clamped to 0) |
| `null` / `undefined` | `"00:00"` (coerced to 0) |

#### `showToast(message, success)`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| `("已开始记录字幕", true)` | Green toast with text, appended to body, removed after 1800ms |
| `("当前页面没有可记录的字幕", false)` | Red toast with text |
| Called twice in quick succession | Previous toast removed, timer cleared, new toast created |
| `document.body` is null at call time | Throws — `appendChild` on null. Unlikely in practice since content script runs at `document_idle`. |

### 4.2 background.js

#### `getActiveTab()`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| User has one window with one active tab | Returns that tab object |
| No windows open (edge case) | `tabs[0]` is `undefined`, returns `undefined` |
| Multiple windows, one active per window | Returns first result (current window only) |

#### `getRecordingState(tabId)`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| `tabId` is valid, content script responds `{ active: true }` | `{ active: true }` |
| `tabId` is valid, content script responds `{ active: false }` | `{ active: false }` |
| `tabId` is valid, content script not injected (no listener) | `catch` returns `{ active: false }` |
| `tabId` is falsy (`null`, `undefined`, `0`) | `{ active: false }` (early return) |
| Content script response is null/undefined | `Boolean(response?.active)` -> `false` |

#### `toggleRecordingOnTab(tabId)`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| Tab is recording, stop succeeds | Calls `saveCapture(response.capture)`, returns `{ success: true, active: false, capture: record }` |
| Tab is not recording, start succeeds | Returns `{ success: true, active: true }` |
| Content script returns `success: false` with reason | Returns `{ success: false, reason, active: false }`, shows red toast |
| `chrome.tabs.sendMessage` throws (no content script) | Catches error, returns `{ success: false, reason, active: false }`, shows red toast |
| `saveCapture` returns null (falsy) | Returns `{ success: true, active: false, capture: null }` but shows success toast "已停止记录" (still reports success because capture was saved — wait, line 99: `savedCapture ? '已停止并汇总字幕' : '已停止记录'` — this is correct) |

#### `saveCapture(capture)`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| Valid capture object, storage has 0 existing items | Saves with UUID, storage has 1 item |
| Valid capture object, storage has 500 items | Saves with UUID, storage has 500 items (oldest dropped per `slice(0, 500)`) |
| `capture` without `id` field | `crypto.randomUUID()` generates ID; spread adds remaining fields |
| `chrome.storage.local.get` returns non-array | Falls back to `[]` (line 111 guard) |
| `chrome.storage.local.set` fails (quota exceeded) | Promise rejection — **no catch handler** |
| Storage data is corrupted (e.g., `null`, `string`) | Guard at line 111: `Array.isArray(result[STORAGE_KEY]) ? ... : []` |

#### `deleteCapture(id)`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| `id` exists in storage | Item removed; storage updated |
| `id` does not exist in storage | All items remain; `filter` returns empty result; no error |
| Storage is empty | No crash; `filter` on empty array |
| `chrome.storage.local.set` fails | Promise rejection — **no catch handler** |

#### `notifyTab(tabId, success, message)`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| Tab exists, content script is listening | Toast appears on page |
| Tab has been closed | `catch` swallows error silently |
| `chrome.tabs.sendMessage` throws (no content script) | Caught, no rethrow; function returns `undefined` |

#### `chrome.runtime.onInstalled` handler
| Input / Scenario | Expected Output |
|------------------|-----------------|
| Extension installed for first time | Storage initialized to `{ captures: [] }` |
| Extension updated (re-triggers `onInstalled`) | Storage checked; if valid array, left intact; if corrupted, reset to `[]` |
| Storage has valid existing captures | Not modified (guard at line 6 checks `Array.isArray`) |

#### `chrome.commands.onCommand` handler
| Input | Expected Output |
|-------|-----------------|
| `command === 'save-current-subtitle'`, active tab found | `toggleRecordingOnTab(tab.id)` called |
| `command !== 'save-current-subtitle'` | Early return; nothing happens |
| `command === 'save-current-subtitle'`, no active tab (`tab?.id` is falsy) | Early return at line 20-22 |

### 4.3 popup.js

#### `init()`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| Popup loaded (DOMContentLoaded fires) | `syncToggleButton()` and `renderCaptures()` called |
| Background service worker is inactive (cold start) | `chrome.runtime.sendMessage` wakes the worker; slight delay but should succeed |

#### `handleToggleCapture()`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| Click while recording state = true | Sends `TOGGLE_FROM_POPUP`; on success, if `response.active === false`, calls `renderCaptures()` |
| Click while recording state = false | Sends `TOGGLE_FROM_POPUP`; on success, if `response.active === true`, status shows "已开始记录字幕" |
| Click with no active tab | Status: "未找到当前标签页" (error style) |
| `response.success === false` | Status: "当前页面没有可记录的字幕" (error style) |
| `response` is `undefined` (background worker error) | `response?.success` is `undefined`; falls into failure path |

#### `handleClearAll()`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| User clicks "清空", storage has items | Storage cleared; status shows "已清空收藏"; `renderCaptures()` shows empty state |
| User clicks "清空", storage already empty | Same result; no error |

#### `syncToggleButton()`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| Active tab is recording | Button text: "停止并汇总" |
| Active tab is not recording | Button text: "开始记录" |
| No active tab (`!tab?.id`) | Button text: "开始记录" |
| `GET_TAB_RECORDING_STATE` response is null/undefined | Button text: "开始记录" (`response?.active` is falsy) |

#### `renderCaptures()`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| 0 captures in storage | Shows empty state message |
| 3 captures in storage | Shows 3 capture cards; count label: "3 条收藏" |
| Storage returns non-array response | Falls back to `[]` (guard at line 68); shows empty state |
| Capture with very long text | Card renders with `white-space: pre-wrap`; text wraps; layout not broken |
| Capture with missing fields (e.g., no `videoTitle`) | `buildMetaText` uses fallback values; card renders |

#### `createCaptureCard(capture)`
| Input / Scenario | Expected Output |
|------------------|-----------------|
| Valid capture object | Card with text, meta, and 3 action buttons |
| Click "回到原视频" | `chrome.tabs.create({ url: capture.jumpUrl || capture.videoUrl })` — opens new tab |
| Click "复制字幕" | `navigator.clipboard.writeText(capture.text || '')` — copies to clipboard; status shows "已复制字幕" |
| Clipboard write fails | Promise rejection — **no error handling**; status not updated |
| Click "删除" | Sends `DELETE_CAPTURE`; status shows "已删除收藏"; `renderCaptures()` re-runs |
| `capture.text` is empty/null | `capture.text || ''` returns `''`; card shows empty text element |
| `capture.id` is missing | Delete button sends `{ id: undefined }`; `deleteCapture(undefined)` filters nothing; nothing is deleted |

#### `buildMetaText(capture)`
| Input | Expected Output |
|-------|-----------------|
| `{ videoTitle: "测试", timestampLabel: "01:23", endTimestampLabel: "02:34", lineCount: 5, createdAt: "2026-01-01T00:00:00Z" }` | `"测试 · 01:23 - 02:34 · 5 条字幕 · 2026-01-01 08:00"` (note: timezone-dependent) |
| `{ videoTitle: "测试", timestampLabel: "01:23", endTimestampLabel: undefined, lineCount: undefined, createdAt: undefined }` | `"测试 · 01:23 · 未知时间"` |
| `{}` (empty object) | `"未命名视频 · 00:00 · 未知时间"` |

#### `formatDate(value)`
| Input | Expected Output |
|-------|-----------------|
| `"2026-05-24T12:34:56Z"` | `"2026-05-24 12:34"` (local timezone applied) |
| `null` / `undefined` | `"未知时间"` |
| `"invalid"` | `"Invalid Date"` string (from `date.getFullYear()` on invalid date returns NaN; stringified as "Invalid Date") — potential issue |
| `""` | `"未知时间"` (truthiness check at line 143 catches empty string) |

#### `setStatus(message, isError)`
| Input | Expected Output |
|-------|-----------------|
| `("已开始记录字幕", false)` | Status text set; class = `"status success"` |
| `("出错了", true)` | Status text set; class = `"status error"` |
| `("", false)` | Status text cleared; class = `"status success"` |

---

## Appendix A: Security Considerations

| Concern | Assessment |
|---------|------------|
| Clipboard access | `navigator.clipboard.writeText` requires user gesture (click event). Popup click qualifies. No persistent clipboard access requested. |
| Host permissions | Limited to `www.bilibili.com` and `m.bilibili.com` with `/video/*` path. No broad `<all_urls>` permission. |
| Storage permission | `storage` permission is limited to the extension's own storage partition. No access to other extension data. |
| Content script scope | Only injected on video pages — not on homepage, search, or user pages. |
| Data exfiltration risk | No network requests made by the extension. All data stored locally. The "回到原视频" button opens a URL, but the URL is derived from `window.location.href` of the page the user is already on. |
| Cross-origin communication | No `externally_connectable` declared. Only the extension's own pages and content scripts communicate. |

## Appendix B: Known Limitations

1. **Background tab throttling:** Chrome throttles `setInterval` to 1-minute minimum on background tabs. Long recordings on non-visible tabs may miss subtitle changes.
2. **Shadow DOM:** Content script does not penetrate shadow roots. If B站 migrates their player to use shadow DOM, the extension will break.
3. **Storage error handling:** `saveCapture` and `deleteCapture` in `background.js` do not catch storage write failures.
4. **Clipboard error handling:** `popup.js` does not catch `navigator.clipboard.writeText` failures.
5. **Title parsing fragility:** The `_哔哩哔哩_bilibili` suffix removal assumes exact suffix format.
6. **Session data volatility:** Recording data is lost if the tab is closed or navigated away before stopping.
