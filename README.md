# 下一局 · OW LAB

在浏览器里记录守望先锋胜负，比较数学模型对下一局胜率的估计。

**[直接打开使用](https://luyu14039.github.io/ow-next-match/)**

无需登录应用。首页展示近五局、三个模型的下一局胜率，以及快速胜负记录；分析与历史在同一页。支持截图批量识别、手工胜负串、JSON / CSV 导入和备份恢复。

## 数据如何保存

记录与可选原图保存在当前浏览器的 IndexedDB 中，应用不上传游玩资料。不同浏览器、设备和地址之间没有自动同步；清除网站数据可能删除记录，请定期导出完整 JSON。首次打开是空数据集，“数学模拟”提供独立合成样例。

截图 OCR 在浏览器中执行，首次使用会下载所需 Worker、语言包和一种兼容的 WASM 包装文件，下载量随兼容版本、缓存与传输压缩而变化。截图需要人工校对，工具不检测重复截图或重叠区域；每次确认都会新增记录。

从本地地址迁移到 Pages：先在旧网页导出 JSON，再在新地址导入恢复。记录不会因网站地址变化自动迁移。

## 模型与范围

提供固定 50%、Beta 短窗、Beta 长窗、Markov、BOCPD、Hedge 和 Fixed-Share。默认三个显示模型可切换，固定 50% 始终作为分析基准。坦克、输出、辅助使用本位置的跨模式历史；“全部”使用所有位置、所有模式的独立序列，包含未指定位置。

历史比较严格按先预测、再评分、再更新的顺序执行。实际赛前检验需先锁定预测，再记录对应结果。项目是数学科普实验，不反演 MMR、不知道下一局队友，也不承诺预测优于 50%。

## 本地开发

需要 Node.js 24。

```sh
npm ci
npm run dev
```

安装自动准备同源 OCR 资源。开发地址为 http://127.0.0.1:5173/ 。

```sh
npm test
npm run build
node tools/check-build.mjs
npm run preview
```

生产预览地址为 http://127.0.0.1:4174/ 。部署使用完整 dist，不可只上传 index.html。

## 公开测试资料

本仓库不含个人截图、游玩记录或旧的个人测试历史。tests/fixtures 全部为合成资料，独立 Python 标准库模型计算参考结果，测试生产 TypeScript 实现的每一步预测与评分。

需要更新参考资料时执行：

```sh
python tools/generate-fixtures.py
npm test
```

- [模型公式与评价方法](docs/MODELS.md)
- [研究依据](docs/RESEARCH.md)
- [架构](docs/ARCHITECTURE.md)
- [GitHub Pages 部署与验收](docs/DEPLOYMENT.md)
- [首次线上验收记录](docs/ONLINE_QA.md)
- [依赖及素材来源](THIRD_PARTY.md)

GitHub 公开可见性不等于自动授予代码再许可权；项目自身许可证尚待维护者确定，第三方依赖许可见上述说明。
