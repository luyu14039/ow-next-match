# 本地 OCR 资源

此目录由 `npm ci` 的 postinstall 或 `npm run prepare:ocr` 准备。不要只复制 Worker 而遗漏 core 和 traineddata；构建时整个目录会进入 dist，运行时从站点同源地址加载。没有 CDN 和云端识别请求。

Worker 与三个 LSTM core JS/WASM 组合文件来自 tesseract.js / tesseract.js-core；中文与英文的 best_int 语言包来自 @tesseract.js-data/chi_sim、@tesseract.js-data/eng。复制的资源约 16.5 MB，首次识别才加载。JS 文件已嵌入 WASM，无需重复复制独立 wasm。

生成文件不进 Git。部署应上传 npm run build 生成的整个 dist，保留目录层级、MIME 和资源许可文件。训练语言包是通用 OCR 字符识别数据，不是本项目胜负预测的训练集。
