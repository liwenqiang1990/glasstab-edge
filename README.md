# GlassTab

GlassTab 是一个面向 Edge 自用场景的 MV3 新标签页扩展：

- 新标签页（macOS 风格）：Bing 每日壁纸（可切换最近 8 天）、本地图片或内置渐变；可调遮罩、模糊和图标尺寸
- 快捷方式：左侧 Dock 分组；优先抓高清满版图标（apple-touch-icon / manifest），透明 logo 自动配主色底；拖拽排序、拖到 Dock 换分组、右键菜单、删除撤销
- 书签：右侧抽屉按时间分组显示，支持搜索、标签筛选，可固定；浏览网页时点工具栏图标或右键收藏，可用 AI（千问 / 火山）生成一句话摘要
- WebDAV 同步：多台设备合并同步，不会再用旧数据覆盖新数据

## 配套扩展：GlassTab 恢复

浏览器规定一个扩展只能有一个工具栏按钮，所以「恢复最近关闭的标签页」做成了单独的小扩展，放在 `undo-tab/`：

- 左键图标：恢复最近关闭的页面（跳过空白新标签页）
- 右键图标：列出最近关闭的 6 个页面 / 窗口
- 快捷键：在 `edge://extensions/shortcuts` 给「恢复最近关闭的标签页」设置

加载方式同上，选择 `undo-tab` 目录即可。图标源文件在 `icons/source/`。

## 目录结构

- `tab.html` + `logic.js` + `styles/tab.css`：新标签页
- `popup.html` + `popup.js`：工具栏弹窗
- `options.html` + `options.js`：同步与 AI 设置
- `bookmarks.html` + `bookmarks.js`：全部书签
- `background.js`：收藏、摘要、同步调度
- `styles/ui.css`：弹窗 / 设置 / 书签页共用样式（跟随系统深浅色）
- `shared/`
  - `storage.js`：本地状态读写（含删除记录 tombstones）
  - `sync.js`：本地与远端的合并逻辑（纯函数）
  - `webdav.js`：WebDAV 读写（ETag / If-Match）
  - `wallpaper.js`：Bing 壁纸拉取与缓存、自定义壁纸
  - `assets.js`：IndexedDB（图标、壁纸图片）
  - `favicon.js`：图标发现（挑高清、不透明的候选）
  - `icon-style.js`：渲染时判断图标铺满还是配底色
  - `ai.js` / `icons.js` / `bookmark-view.js` / `utils.js`

## 使用方式

1. 在 Edge 打开 `edge://extensions`
2. 打开“开发人员模式”
3. 选择“加载解压缩的扩展”，指向仓库根目录

## WebDAV 同步

设置页填写 WebDAV 地址、用户名 / 密码、远端目录和文件名（坚果云需使用“第三方应用密码”）。

同步流程是 **拉取远端 → 合并 → 有差异才写回**：

- 书签、快捷方式按 id 合并，谁的 `updatedAt` 新用谁；两台设备收藏了同一网址会自动去重
- 删除会写入 tombstone 并同步到其他设备，已删除的条目不会被旧设备“带回来”（保留 180 天）
- 写回时带 `If-Match`，如果远端在这期间被别的设备改过，会重新拉取合并再写
- 全新安装的设备第一次同步时直接采用远端数据，默认快捷方式不会混进来
- 分组同样参与同步；图标有独立的 `iconUpdatedAt`，补抓图标不会盖掉别处改的名称
- 同步的设置：搜索引擎、图标尺寸、AI 设置；只存本机：WebDAV 账号、壁纸、当前分组、书签栏是否固定

开启“自动同步”后，以下时机会同步：数据变化后、打开新标签页 / 弹窗（距上次超过 1 分钟）、浏览器启动。

设置页“高级”里保留了两个强制操作：用远端覆盖本机、用本机覆盖远端。

v4 可以直接读取 v3 的备份文件；上传的备份里不再包含 WebDAV 用户名和密码。

## Edge 自用上架

如果你要走 Edge Add-ons 自用分发，建议流程：

1. 先本地 `加载解压缩的扩展` 自测
2. 确认权限说明、截图、图标、描述都齐全
3. 在 Partner Center 提交扩展
4. 可见性选 `Hidden`

`Hidden` 的含义是：

- 扩展不会在商店里被公开搜索和浏览
- 但你可以通过直达链接安装，适合自用或小范围分发



并提供一键打包脚本：

- [release/make-edge-package.sh](glasstab/release/make-edge-package.sh)

执行：

```bash
bash release/make-edge-package.sh
```

会在 `release/dist/` 下生成可上传到 Edge 商店的 zip 包。

## 说明

- 现在运行时已经不依赖外部 CDN
- logo、书签和设置都以本地存储为主，再按需同步到 WebDAV
- `host_permissions` 当前是全站点级，优先保证自用功能完整；如果后面要公开发布，可以再做一轮权限收敛
