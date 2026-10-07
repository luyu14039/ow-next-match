# 架构

React + TypeScript + Vite 的纯前端单页应用，无后端服务。

| 目录 / 文件 | 作用 |
| --- | --- |
| src/App.tsx | 工作台、位置范围、分析和历史 |
| src/ImportDrawer.tsx | 批量导入、人工校对与保存 |
| src/ocr.ts | 同源 OCR 资源、行检测与 Worker 生命周期 |
| src/models.ts | 七个数学模型实例及顺序评分 |
| src/replay.worker.ts | 长记录回放计算 |
| src/storage.ts | IndexedDB 的记录、设置及图片存储 |
| src/synthetic.ts | 可复现的科普模拟 |
| src/styles | 界面、动效及字号 |
| public/artwork | 原创图头及来源说明 |
| public/ocr | 安装时生成的本地识别资源 |
| tests/fixtures | 明确标记的合成回归资料 |
| tools/reference_models.py | 独立 Python 数学参考实现 |
| .github/workflows/pages.yml | 测试、构建与 Pages 部署 |

图头与 OCR 资源从 import.meta.env.BASE_URL 解析，计算 Worker 由 Vite 处理。分析和历史不改变页面路由。Pages 项目路径由部署流程提供。

存储按来源隔离；数据库名为 ow-next-match。正常代码更新不主动删除记录。换地址、清理网站数据或更换设备前导出 JSON。
