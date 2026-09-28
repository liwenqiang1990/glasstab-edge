# Edge 商店：4.0.0 更新提交清单

- 商店地址：https://microsoftedge.microsoft.com/addons/detail/glasstab/niefnchmfpbhjfdngohlnkpihkdjgehd
- 线上版本：3.0.0（Productivity 分类）
- 本次版本：4.0.0
- 提交方式：在 Partner Center 里**更新原有条目**，不要新建（扩展 ID 和安装链接保持不变，已安装用户会自动升级）

## 1. 提交前

- [ ] 在 Edge 里加载仓库目录自测：新标签页、弹窗收藏、书签页、设置、WebDAV 同步、AI 摘要各走一遍
- [x] 隐私政策已发布：https://liwenqiang1990.github.io/glasstab-edge/privacy-policy.html（源文件 `docs/privacy-policy.html`，GitHub Pages 从 main 分支 /docs 发布）
- [ ] 运行 `bash release/make-edge-package.sh`，得到 `release/dist/glasstab-edge-v4.0.0.zip`

## 2. Partner Center 操作步骤

1. 登录 https://partner.microsoft.com/dashboard/microsoftedge/overview ，进入 GlassTab
2. 点「Update」创建新提交
3. **Packages**：上传 `glasstab-edge-v4.0.0.zip`
4. **Availability**：保持原来的可见性（Hidden / Public）和市场
5. **Properties**：
   - Category：Productivity（不变）
   - Website / Support contact：可填 GitHub 地址或邮箱
6. **隐私（Privacy）**：每个权限的理由、远程代码、数据使用量、隐私策略 URL、三项证明，逐项照抄第 4 节
7. **Store listings**（中文、英文各一份，文案见 `release/STORE_COPY.md`）：
   - Description：粘贴详细描述
   - Store logo：`release/assets/v4/store-logo-300.png`
   - Small promotional tile：`release/assets/v4/promo-small-440x280.png`
   - Large promotional tile（可选）：`release/assets/v4/promo-large-1400x560.png`
   - Screenshots：`release/assets/v4/01~06`，共 6 张，1280×800
   - Search terms：见文案文档
8. **Notes for certification**：粘贴第 5 节的英文说明
9. 提交，等审核（通常几个工作日）

## 3. 与 3.0.0 相比的权限变化

| 权限 | 变化 | 用途 |
|---|---|---|
| `favicon` | 新增 | 在搜索建议里显示历史记录和标签页的网站图标 |
| `history` | 新增，**可选**（`optional_permissions`） | 新标签页搜索历史记录；用户首次点击「同时搜索浏览历史」时才请求 |
| 其余（storage、unlimitedStorage、tabs、activeTab、scripting、contextMenus、全站点访问） | 不变 | 同 3.0.0 |

## 4. 隐私页（Privacy）填写内容

### 4.1 权限理由（每项限 1000 字符，只有审核人员可见）

表单只列必需权限；`history` 是可选权限（`optional_permissions`），不会出现在这里，它的用途写在第 5 节的审核备注里。

**storage**
```
Stores the user's shortcuts, shortcut groups, bookmarks (title, URL, AI summary, tags, notes) and settings locally with chrome.storage.local, so the new tab page, the toolbar popup and the options page share the same data. Nothing is sent to the developer.
```

**unlimitedStorage**
```
Site icons and wallpapers are cached locally in IndexedDB as image data so the new tab page loads instantly and works offline. With many shortcuts and bookmarks plus a high-resolution wallpaper, this can exceed the default storage quota.
```

**tabs**
```
Reads the title, URL and favicon of the active tab when the user clicks "Save to bookmarks" in the popup, and lists the user's open tabs (title and URL) in the new tab search box so the user can switch to a tab that is already open. Tab data is only used locally.
```

**activeTab**
```
Grants temporary access to the current page only when the user invokes the extension (the toolbar popup or the "Save to GlassTab bookmarks" context menu item), so it can read the page's title, description and text for the optional one-sentence AI summary.
```

**scripting**
```
Used with activeTab to run a small function in the current page, only after the user clicks save or summarize, that extracts the page title, meta description, headings and visible text. The text is sent only to the AI endpoint configured by the user, and only when the user has enabled AI summaries.
```

**contextMenus**
```
Adds one "Save to GlassTab bookmarks" item to the page right-click menu so users can bookmark the current page without opening the popup.
```

**favicon**
```
Shows small site icons next to open-tab and browsing-history results in the new tab search suggestions, using the browser's built-in favicon cache (chrome-extension://<id>/_favicon/). No network request is made for this.
```

**主机权限**
```
Needed for destinations that are chosen by the user and cannot be known in advance: (1) fetching the icon of any website the user adds as a shortcut or bookmark (reading the site's HTML for icon links and downloading the icon); (2) sending requests to the AI endpoint the user enters (e.g. Alibaba DashScope, Volcengine ARK, or any OpenAI-compatible URL); (3) syncing with the WebDAV server the user enters, which can be any domain, including self-hosted http servers; (4) loading wallpapers from Bing and Unsplash, and icon candidates from Google's favicon service, icon.horse, DuckDuckGo and the App Store. The extension never injects scripts into pages automatically and does not monitor browsing activity.
```

### 4.2 你在使用远程代码吗？

选「否，我没有使用远程代码」。理由（选填）：
```
All JavaScript is bundled in the package. Network requests only fetch data (JSON and images), never executable code.
```

### 4.3 数据使用量（会公开显示在商店页）

| 选项 | 勾选 | 原因 |
|---|---|---|
| 身份验证信息 | ✅ | 保存用户填写的 WebDAV 密码和 AI / Unsplash Key，并发送给用户自己配置的服务用于验证 |
| Web 历史记录 | ✅ | 书签（网址、标题、时间）会同步到 WebDAV；授权后读取浏览历史用于搜索，开启选项后少量历史标题会发给 AI |
| 网站内容 | ✅ | 生成摘要时，网页正文会发给用户配置的 AI 服务 |
| 个人身份信息、健康信息、财务和付款信息、个人通信、位置、用户活动 | ❌ | 不接触这些数据，也没有键盘、鼠标等监控 |

如实勾选：少勾而被审核发现与实际行为不符，会导致被拒甚至下架。以后如果新增了处理其他数据的功能，记得同步修改这里和隐私政策。

### 4.4 隐私策略 URL

```
https://liwenqiang1990.github.io/glasstab-edge/privacy-policy.html
```

### 4.5 我证明以下披露内容属实

三项全部勾选：
- 除已批准的用例外，不出售或传输用户数据给第三方（数据只发送到用户自己配置的服务，属于功能本身）
- 不将用户数据用于与单一用途无关的目的
- 不将用户数据用于信用评估或贷款

## 5. Notes for certification（粘贴到提交表单）

```
GlassTab 4.0.0 is an update to the existing listing (3.0.0). It overrides the new tab page and adds a toolbar popup for saving bookmarks.

HOW TO TEST (no account or API key required)
1. Open a new tab: wallpaper, clock, search box, shortcut grid (left dock = shortcut groups) and a bookmarks sidebar on the right.
2. Type in the search box (or press Ctrl+K): suggestions come from shortcuts, bookmarks and open tabs. The last row "同时搜索浏览历史" requests the optional "history" permission; after granting, browsing history is also searched locally.
3. Visit any website and click the GlassTab toolbar button, then "保存到书签" (Save to bookmarks). The page appears in the bookmarks sidebar on the new tab. Right-click on a page also offers "保存到 GlassTab 书签".
4. Right-click a shortcut to edit it; "选择图标…" (Choose icon) shows icon candidates from several sources.
5. Bottom-right image button: wallpaper settings (Bing / Unsplash / local image / built-in).

OPTIONAL FEATURES THAT NEED USER-SUPPLIED CREDENTIALS
- AI summary and AI search: users enter their own OpenAI-compatible endpoint and API key in Settings (e.g. Alibaba DashScope). Page text is sent only to that endpoint and only when the user clicks.
- WebDAV sync: users enter their own WebDAV server.
- Unsplash wallpapers: users enter their own Unsplash Access Key.
These are disabled by default; the rest of the extension works without them.

PERMISSIONS
- tabs, activeTab, scripting: read the current page's title/URL/text when the user saves it or requests a summary; list open tabs in new-tab search.
- contextMenus: "Save to GlassTab bookmarks" item.
- storage, unlimitedStorage: all data is stored locally (bookmarks, icons, wallpapers).
- favicon (new): show site icons in search suggestions.
- history (new, optional): requested at runtime only when the user enables history search; used locally only.
- Host access (http/https, unchanged): fetch website icons, reach the AI endpoint and WebDAV server configured by the user (arbitrary user-chosen domains), and load wallpapers from Bing/Unsplash.

No remote code is loaded. The developer runs no servers and collects no data. Privacy policy: https://liwenqiang1990.github.io/glasstab-edge/privacy-policy.html
```

## 6. 配套扩展「GlassTab 恢复」（可选，单独上架）

代码在仓库外的 `~/projects/glasstab-restore`。它是独立的扩展，需要在 Partner Center 里**新建**一个条目提交，不能放进 GlassTab 的更新里。需要的话再单独准备素材。
