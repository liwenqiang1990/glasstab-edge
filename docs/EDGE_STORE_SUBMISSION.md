# Edge 商店上架清单

这个项目当前适合走 Microsoft Edge Add-ons 的 `Hidden` 可见性发布。

`Hidden` 的含义：

- 不会在商店公开搜索和浏览中出现
- 但可以通过直达链接安装
- 适合你现在这种“自用 / 小范围分发”场景

## 1. 提交前检查

提交前先确认：

- [manifest.json](/mnt/d/Program Files/glasstab/manifest.json) 的 `version` 已递增
- 扩展在 `edge://extensions` 里重新加载后运行正常
- AI 设置、WebDAV、书签、shortcut、书签页都至少走过一遍
- 所有图标、截图、文案已经准备好

## 2. 建议准备的商店素材

至少准备：

- 扩展图标：`300x300`
- 小图标：`44x44`
- 宣传图：可选
- 截图 3-5 张

建议截图内容：

1. 新标签页主页
2. 浏览器弹窗页
3. 独立书签页
4. 设置页
5. WebDAV / AI 配置页

## 3. 权限说明模板

提交时建议主动写清楚这些权限用途：

- `storage` / `unlimitedStorage`
  用于本地保存 shortcuts、bookmarks、logo 资产、AI 设置与 WebDAV 设置。

- `tabs` / `activeTab`
  用于读取当前标签页标题和 URL，在用户主动操作时添加书签或生成网页摘要。

- `scripting`
  用于在用户当前页提取标题、描述和正文摘要，发送给 AI 做一句话总结。

- `contextMenus`
  用于在网页右键菜单中提供“保存到 GlassTab 书签”。

- `host_permissions: http://*/*, https://*/*`
  用于：
  1. 自动抓取站点 favicon / logo
  2. 调用用户配置的 AI 接口
  3. 访问用户配置的 WebDAV 服务

如果以后要公开发布，而不是 `Hidden`，建议再做一轮权限收敛。

## 4. 提交步骤

1. 注册 Edge 扩展开发者账号
2. 进入 Partner Center
3. 新建扩展提交
4. 上传 zip 包
5. 填写中英文描述、分类、截图、隐私信息
6. `Availability` 里选择 `Hidden`
7. 提交审核

## 5. 打包方式

仓库里已经提供打包脚本：

- [release/make-edge-package.sh](/mnt/d/Program Files/glasstab/release/make-edge-package.sh)

在项目根目录执行：

```bash
bash release/make-edge-package.sh
```

默认会在 `release/dist/` 下生成 zip。

## 6. 当前建议上传内容

打包脚本只会带这些运行时文件：

- `manifest.json`
- `metadata.json`
- `icon.png`
- `background.js`
- `tab.html`
- `logic.js`
- `popup.html`
- `popup.js`
- `options.html`
- `options.js`
- `bookmarks.html`
- `bookmarks.js`
- `shared/`
- `libs/`

不会带这些开发残留：

- `App.tsx`
- `components/`
- `constants.ts`
- `main.js`
- `start.html`
- `types.ts`
- `vite.config.ts`
- `tsconfig.json`
- `package.json`

## 7. 提交后注意事项

- 每次重新提交新版本都要先改 `manifest.json` 的 `version`
- AI / WebDAV 属于用户自行配置的能力，商店文案里不要暗示默认就能用
- 审核如果问到全站点权限，直接按本文件第 3 节解释
