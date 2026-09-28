# Edge 商店：4.0.0 更新提交清单

- 商店地址：https://microsoftedge.microsoft.com/addons/detail/glasstab/niefnchmfpbhjfdngohlnkpihkdjgehd
- 线上版本：3.0.0（Productivity 分类）
- 本次版本：4.0.0
- 提交方式：在 Partner Center 里**更新原有条目**，不要新建（扩展 ID 和安装链接保持不变，已安装用户会自动升级）

## 1. 提交前

- [ ] 在 Edge 里加载仓库目录自测：新标签页、弹窗收藏、书签页、设置、WebDAV 同步、AI 摘要各走一遍
- [ ] 隐私政策已发布成公开网址（内容见 `docs/privacy-policy.html`）
- [ ] 运行 `bash release/make-edge-package.sh`，得到 `release/dist/glasstab-edge-v4.0.0.zip`

## 2. Partner Center 操作步骤

1. 登录 https://partner.microsoft.com/dashboard/microsoftedge/overview ，进入 GlassTab
2. 点「Update」创建新提交
3. **Packages**：上传 `glasstab-edge-v4.0.0.zip`
4. **Availability**：保持原来的可见性（Hidden / Public）和市场
5. **Properties**：
   - Category：Productivity（不变）
   - Privacy policy URL：填隐私政策网址（3.0.0 没填，这次必须补上，因为扩展会读取网页内容和可选的浏览历史）
   - Website / Support contact：可填 GitHub 地址或邮箱
6. **Store listings**（中文、英文各一份，文案见 `docs/EDGE_STORE_COPY.md`）：
   - Description：粘贴详细描述
   - Store logo：`release/assets/v4/store-logo-300.png`
   - Small promotional tile：`release/assets/v4/promo-small-440x280.png`
   - Large promotional tile（可选）：`release/assets/v4/promo-large-1400x560.png`
   - Screenshots：`release/assets/v4/01~06`，共 6 张，1280×800
   - Search terms：见文案文档
7. **Notes for certification**：粘贴下方英文说明
8. 提交，等审核（通常几个工作日）

## 3. 与 3.0.0 相比的权限变化

| 权限 | 变化 | 用途 |
|---|---|---|
| `favicon` | 新增 | 在搜索建议里显示历史记录和标签页的网站图标 |
| `history` | 新增，**可选**（`optional_permissions`） | 新标签页搜索历史记录；用户首次点击「同时搜索浏览历史」时才请求 |
| 其余（storage、unlimitedStorage、tabs、activeTab、scripting、contextMenus、全站点访问） | 不变 | 同 3.0.0 |

## 4. Notes for certification（粘贴到提交表单）

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

No remote code is loaded. The developer runs no servers and collects no data. Privacy policy: <隐私政策网址>
```

## 5. 配套扩展「GlassTab 恢复」（可选，单独上架）

`undo-tab/` 是一个独立的扩展，需要在 Partner Center 里**新建**一个条目提交，不能放进 GlassTab 的更新里。需要的话再单独准备素材。
