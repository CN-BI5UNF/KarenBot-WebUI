# Changelog

## v0.1.1-alpha — 2026-11-13

首个公开发布版本。

- 与 `KarenBot-backend`、`KarenBot-GUI`、`KarenBot-WebUI` 的 v0.1.1-alpha 配套。
- 后端新增分模块更新器：同时检查 backend 与前端仓库，Latest 自动提示，Pre-release 仅允许手动选择并强制警告。
- 修复设置、聊天、容器、存储与人格页面的多处数据覆盖、竞态和交互问题。
- GUI 与 WebUI 的更新页支持组件化版本、Pre-release 标识和按组件重启提示。

## v0.0.1-dev — 2026-11-11

首个私有开发版。

- 从 KarenBot 主项目拆出浏览器前端 `webui/`。
- `webui/server.py` 改为基于 `backend.app.create_control_app()` 的薄入口。
- 保留无构建步骤的 HTML/CSS/ES Module 前端。
- 设置/提供商界面适配后端热应用结果。
- 与 `KarenBot-backend`、`KarenBot-GUI` 的 v0.0.1-dev 配套。
