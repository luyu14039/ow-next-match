# GitHub Pages 部署

仓库：https://github.com/luyu14039/ow-next-match

目标网站：https://luyu14039.github.io/ow-next-match/

在 Settings → Pages 中将 Source 设置为 GitHub Actions。推送 main 或手动运行 Deploy OW LAB 后，工作流安装锁定依赖并准备 OCR、测试、按 Pages 的 base_path 构建、检查完整资源，再上传 dist 发布。测试失败时本次更新不部署。

启用 Pages 后使用 GitHub Actions 自带令牌，不在源代码中配置个人令牌。首次启用后若之前的运行失败，手动重新运行工作流。

上线验收：直接打开项目子目录并刷新；检查图头和模型计算；导入合成截图、校对并确认，刷新后历史和保留的原图仍在；验证 JSON 导出和恢复；检查 OCR 资源返回真实文件而非 HTML；查看手机与电脑可读性。

玩家记录保存在各自浏览器中，本地与 Pages 地址不共享记录。迁移通过 JSON 备份，换自定义域名时再次迁移。

当前公开版本准备不等于已通过线上验收；以 Actions 结果和实际网站测试为准。源码和测试资料使用合成内容，个人资料不发布。

依据：[Vite 部署说明](https://vite.dev/guide/static-deploy.html)、[GitHub Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
