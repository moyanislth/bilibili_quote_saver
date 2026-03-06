# Bilibili Quote Saver

一个面向 B 站视频观看场景的浏览器插件 MVP。

目标很简单：当用户想摘录一段话时，不再需要暂停、回放、手打，而是直接用快捷键开始记录，结束时自动汇总这段时间内的字幕。

## MVP 范围

-   运行在 `Chrome / Edge` 的 `Manifest V3` 插件
-   识别 B 站视频页并读取当前视频基础信息
-   尝试从页面可见字幕区域提取实时字幕
-   通过快捷键开始/停止记录字幕片段
-   使用 `chrome.storage.local` 本地存储收藏记录
-   在插件弹窗中查看、复制、删除和回跳收藏内容

## 当前实现

-   快捷键：`Ctrl+Shift+S`（Mac 为 `Command+Shift+S`）
-   交互方式：
    -   第一次按下：开始记录当前时间点之后的字幕
    -   第二次按下：停止记录，并汇总这段时间内出现的字幕
-   收藏字段：
    -   `text`
    -   `mode`
    -   `lineCount`
    -   `videoTitle`
    -   `videoUrl`
    -   `jumpUrl`
    -   `timestampSec`
    -   `timestampLabel`
    -   `endTimestampSec`
    -   `endTimestampLabel`
    -   `createdAt`
-   内容脚本会同时使用：
    -   视频播放时间
    -   字幕区域 DOM 扫描
    -   最近字幕历史缓冲
    -   会话式字幕汇总
    -   页面内 toast 提示

## 目录结构

```text
extension/
  manifest.json
  background.js
  content.js
  popup.html
  popup.js
  popup.css
```

## 本地加载

1. 打开浏览器扩展管理页
2. 开启“开发者模式”
3. 选择“加载已解压的扩展程序”
4. 选择 `extension` 目录

## 使用方式

1. 打开任意 B 站视频页
2. 确保视频存在可见字幕
3. 播放到想开始摘录的位置时，按 `Ctrl+Shift+S`
4. 继续观看，插件会在后台记录这段时间出现的字幕
5. 到结束位置后，再按一次 `Ctrl+Shift+S`
6. 页面右上角会提示“已停止并汇总字幕”
7. 点击插件图标，在弹窗中查看这段字幕汇总

## 已知限制

-   第一版依赖页面现有字幕；没有字幕的视频暂不支持
-   B 站页面结构如果变化，字幕选择器可能需要更新
-   某些视频的字幕是逐词或逐片段刷新，汇总结果可能仍然偏碎
-   当前只做本地保存，未实现账号同步与 AI 清洗
