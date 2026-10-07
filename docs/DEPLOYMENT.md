# GitHub Pages 部署

仓库：https://github.com/luyu14039/ow-next-match

目标网站：https://luyu14039.github.io/ow-next-match/

在 Settings → Pages 中将 Source 设置为 GitHub Actions。推送 main 或手动运行 Deploy OW LAB 后，工作流安装锁定依赖并准备 OCR、测试、按 Pages 的 base_path 构建、检查完整资源，再上传 dist 发布。测试失败时本次更新不部署。

启用 Pages 后使用 GitHub Actions 自带令牌，不在源代码中配置个人令牌。首次启用后若之前的运行失败，手动重新运行工作流。

上线验收：直接打开项目子目录并刷新；检查图头和模型计算；导入合成截图、校对并确认，刷新后历史和保留的原图仍在；验证 JSON 导出和恢复；检查 OCR 资源返回真实文件而非 HTML；查看手机与电脑可读性。

玩家记录保存在各自浏览器中，本地与 Pages 地址不共享记录。迁移通过 JSON 备份，换自定义域名时再次迁移。

2026-10-07 已完成首次部署，Actions 的测试、构建、资源检查与发布均成功。正式 HTTPS 地址已验证模型计算、合成截图识别、导入保存、快速记录和刷新恢复，详细结果及验证范围见 [ONLINE_QA.md](ONLINE_QA.md)。源码和测试资料使用合成内容，个人资料不发布。

依据：[Vite 部署说明](https://vite.dev/guide/static-deploy.html)、[GitHub Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
