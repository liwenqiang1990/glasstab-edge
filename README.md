# GlassTab

GlassTab 现在是一个面向 Edge 自用场景的 MV3 扩展，核心能力包括：

- Shortcut 自动抓取站点 logo，并保存到本地
- 支持手动上传自定义 logo
- 浏览网页时可通过扩展弹窗或右键菜单加入书签
- 支持火山 / 千问这类 OpenAI 兼容接口做一句话网页摘要
- 所有数据和配置可通过 WebDAV 备份与恢复

## 当前结构

- `tab.html` + [`logic.js`](/mnt/d/Program Files/glasstab/logic.js): 新标签页主页
- [`popup.html`](/mnt/d/Program Files/glasstab/popup.html) + [`popup.js`](/mnt/d/Program Files/glasstab/popup.js): 浏览页面时的快捷入口
- [`options.html`](/mnt/d/Program Files/glasstab/options.html) + [`options.js`](/mnt/d/Program Files/glasstab/options.js): AI / WebDAV 设置页
- [`background.js`](/mnt/d/Program Files/glasstab/background.js): 书签、摘要、自动备份等后台逻辑
- [`shared`](/mnt/d/Program Files/glasstab/shared): 存储、资产、favicon、AI、WebDAV 共用模块

## 使用方式

1. 在 Edge 打开 `edge://extensions`
2. 打开“开发人员模式”
3. 选择“加载解压缩的扩展”
4. 指向当前目录 `/mnt/d/Program Files/glasstab`

加载后：

- 新标签页会进入 GlassTab 主界面
- 浏览任意网页时点击扩展图标，可以加入书签或生成 AI 摘要
- 点击“打开设置”进入 AI / WebDAV 配置页

## AI 配置

设置页支持两类 provider：

- 千问 / DashScope
- 火山 / ARK

要求：

- 接口必须兼容 OpenAI Chat Completions
- 你需要自己填写 `API Key`
- `Model / Endpoint ID` 需要按自己的账号实际可用值填写

## WebDAV 备份

设置页可配置：

- `WebDAV 地址`
- `远端目录`
- `备份文件名`
- `用户名 / 密码`
- `自动备份`

当前备份内容包括：

- shortcuts
- bookmarks
- AI 设置
- WebDAV 设置
- 本地图标资产

## Edge 自用上架

如果你要走 Edge Add-ons 自用分发，建议流程：

1. 先本地 `加载解压缩的扩展` 自测
2. 确认权限说明、截图、图标、描述都齐全
3. 在 Partner Center 提交扩展
4. 可见性选 `Hidden`

`Hidden` 的含义是：

- 扩展不会在商店里被公开搜索和浏览
- 但你可以通过直达链接安装，适合自用或小范围分发

仓库里已经补了两份上架资料：

- [docs/EDGE_STORE_SUBMISSION.md](/mnt/d/Program Files/glasstab/docs/EDGE_STORE_SUBMISSION.md)
- [docs/EDGE_STORE_COPY.md](/mnt/d/Program Files/glasstab/docs/EDGE_STORE_COPY.md)

并提供一键打包脚本：

- [release/make-edge-package.sh](/mnt/d/Program Files/glasstab/release/make-edge-package.sh)

执行：

```bash
bash release/make-edge-package.sh
```

会在 `release/dist/` 下生成可上传到 Edge 商店的 zip 包。

## 说明

- 现在运行时已经不依赖外部 CDN
- logo、书签和设置都以本地存储为主，再按需同步到 WebDAV
- `host_permissions` 当前是全站点级，优先保证自用功能完整；如果后面要公开发布，可以再做一轮权限收敛
