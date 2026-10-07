# 研究依据与成熟界面参考

检索与核对日期：2026-10-04。以下以论文原始页面、作者资料和产品官方文档为依据。会议录收录意味着有正式出版记录；不据此声称某篇论文“最流行”或已经在守望预测中有效。未进行引用量排名。

## 1. 近期方法：新在哪里，能不能使用

| 研究 | 时间与状态 | 贡献方向 | 本项目的处理 |
| --- | --- | --- | --- |
| [Tracking The Best Expert Privately](https://proceedings.mlr.press/v267/asi25a.html) | ICML 2025 正式会议录 | 动态专家跟踪与差分隐私的遗憾分析 | 用于介绍“最合适的专家会变”；实施经典 Fixed-Share，不复现其隐私算法或继承保证 |
| [Optimal Learning in Games under Delayed Feedback](https://proceedings.mlr.press/v300/zhuang26a.html) | AISTATS 2026 正式会议录 | 在有延迟反馈的博弈中，用多份 OFTRL 改善对延迟的依赖 | 适合“延迟知道结果会怎样”的策略模拟；单人胜负日志无收益矩阵，第一版预测区不直接套用 |
| [Near Optimal Convergence to Coarse Correlated Equilibrium in General-Sum Markov Games](https://proceedings.mlr.press/v331/yorulmaz26a.html) | L4DC 2026 正式会议录 | 自适应步长、OFTRL、自博弈下的 CCE 收敛 | 可做博弈学习科普拓展；需要状态、动作和收益，不能与一阶胜负 Markov 链混为一谈 |
| [Online Conformal Prediction via Universal Portfolio Algorithms](https://proceedings.mlr.press/v306/liu26y.html) | ICML 2026 正式会议录 | 将在线区间覆盖控制联系到通用投资组合算法，减少学习率调节 | 可研究下一局时长／连续残差的区间演示；不是直接输出二分类胜率的方法，第一版不声称已实现 |
| [Conformal Online Model Aggregation](https://proceedings.mlr.press/v337/gasparin26a.html) | UAI 2026 正式会议录 | 在线合并多个共形预测集合 | 可作为未来的不确定性实验；需要输入集合的覆盖保证等假设，不能把三个概率平均就叫 COMA |
| [Mean-Field Analysis and Optimal Control of a Dynamic Rating and Matchmaking System](https://arxiv.org/abs/2512.22038) | 2025-12-26 arXiv 预印本 | 大规模技能漂移、评级更新和匹配的平均场控制 | 与项目主题最接近的机制模拟方向；用于解释匹配与评分误差，不能把其控制方程当作暴雪的真实算法 |

前四个在线学习／博弈方向不要求神经网络。共形方法也能包裹简单数学预测器，但其覆盖对象通常是集合或区间，**覆盖率不是“这一局预测有 95% 概率正确”**。COMA 保证还依赖输入集合的覆盖条件以及错误和权重之间的相关性假设，不能省略。[论文原始说明](https://proceedings.mlr.press/v337/gasparin26a.html)

上述方向都有值得介绍的数学内容，但不能为了使用新名词硬套不具备的数据。建议第一版提供可靠的经典概率模型和在线聚合；“前沿观察”说明卡列出这些近期工作及适用条件。真正复现 OFTRL 或平均场控制作为第二版独立实验再设计，不能在第一版说明卡上标记“已实现”。

### 可选的后续科普实验，如何变成一个可玩的页面

以下是后续建议，未纳入第一版必要验收；用户选定后再实施。

| 实验 | 可调参数 | 输出 | 与守望日志的关系 |
| --- | --- | --- | --- |
| 延迟反馈猜硬币博弈 | 收益矩阵、反馈延迟 D、轮数、学习率 | 双方策略概率、累计收益和遗憾曲线；普通更新与 D+1 份交错更新比较 | 不使用个人日志，解释何时才会得到 50% 混合策略 |
| 匹配系统沙盒 | 玩家真实实力漂移、评级更新幅度、匹配范围 | 内部评级误差、对局公平程度和胜负样例 | 合成数据；解释技能变化和匹配的共同作用，不声称复原官方系统 |
| 在线不确定性实验 | 使用过去时长的简单预测器、目标长期覆盖比例 | 时长区间大小、长期覆盖、漂移后的恢复过程 | 可用日志中的过去时长；不把区间覆盖转换成下一局胜负概率 |

猜硬币演示可从收益矩阵 `[[1,-1],[-1,1]]` 开始，用已知矩阵与双方策略计算收益反馈。先实现明确的简单在线更新作教学对照，再按选定论文定义补充 OFTRL；不能只套一个 softmax 就宣称完成 2026 年算法复现。变更为不对称收益时，允许均衡概率偏离 50%，把“50% 需要哪些条件”做成看得见的实验。

这三类实验分别对应近期的延迟博弈学习、动态匹配和投资组合式在线覆盖方向。产品按钮在真正实现前不出现可点击的空壳，只在科普资料中列为待选方向。

## 2. 直接用于第一版的方法

| 方法 | 来源／依据 | 本项目中的边界 |
| --- | --- | --- |
| Beta–Bernoulli | 共轭贝叶斯二分类计数，公式在 [模型文档](MODELS.md) 完整给出 | 估计窗口内近似恒定的胜率，不识别匹配机制 |
| 一阶 Markov 链 | 条件转移计数与先验平滑，公式在 [模型文档](MODELS.md) 完整给出 | 只检验胜负的一阶依赖，不是博弈论文中的 Markov game |
| BOCPD | [Adams & MacKay, Bayesian Online Changepoint Detection, 2007](https://arxiv.org/abs/0710.3742) | 使用 Bernoulli 分段与显式重启分支，索引约定写清楚 |
| Hedge / 专家跟踪 | [Herbster & Warmuth, Tracking the Best Expert, 1998](https://mwarmuth.bitbucket.io/pubs/J39.pdf) | 使用可读的概率混合，不把经典算法包装成 2026 年新算法 |
| 近期变点扩展 | [Restarted Bayesian Online Change-point Detection for Non-Stationary Markov Decision Processes, 2023](https://proceedings.mlr.press/v232/alami23a.html) | 说明变点与非平稳环境仍是活跃方向；不复现强化学习环境或继承其遗憾界 |

“近期前沿”和“当前可实施”是两个维度。数学模型能否消化我们实际拥有的数据，比论文年代更能决定小项目的质量。

## 3. 50%、均衡和守望匹配的证据

暴雪官方说明把公平对局视为目标：理想情形下双方各有 50% 胜率。其匹配介绍涉及 MMR、双方对应位置的实力差异以及等待时间的权衡。官方还给出竞技职责队列中大多数对局的内部估计位于 45%–55% 的描述；这是官方特定模式的内部估计，不能直接用作本项目快速比赛的概率边界。[Weekly Recall: Meet Your Matchmaker](https://news.blizzard.com/en-us/article/24224365/weekly-recall-meet-your-matchmaker)

另一个官方解释明确区分了公平匹配与“强制把玩家胜率拉到 50%”，不支持依据连胜断言下一局会被系统安排输。[2023 年 Matchmaker Goals and Plans, Part 2](https://news.blizzard.com/en-us/article/23910161/overwatch-2-developer-blog-explaining-matchmaker-goals-and-plans-part-2)

这两篇是匹配理念与当时机制的证据，不作为跨版本不变的技术规格；本项目不重建官方隐藏分，也不把历史资料里的段位规则写死。

纳什均衡只在具体博弈及其策略／收益设定下有含义。例如对称 Matching Pennies 的混合均衡可以解释 50% 随机化；换一个收益矩阵就不一定是 50%。可参考 [MIT Networks 博弈论课程讲义](https://ocw.mit.edu/courses/14-15j-networks-spring-2018/f89a20089cfabf01fae234c0a9091a16_MIT14_15JS18_lec14.pdf)。

有效市场中的零超额收益也不等于每笔交易盈利概率为 50%：利润大小、交易成本和风险补偿都参与期望值。这里借用“难以从历史稳定获利”的直觉做科普，不将市场理论当作游戏下一局概率的定理。

## 4. 成熟产品案例

第二版首页以 Apple 应用设计为主要依据：[WWDC25 Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/)、[Apple Sports 官方介绍](https://www.apple.com/newsroom/2024/02/introducing-apple-sports-a-new-app-for-sports-fans/) 和 HIG 的 motion／segmented controls／buttons／sheets。逐项研究与链接见 [APPLE_RESEARCH.md](APPLE_RESEARCH.md)。下面三种分析工具继续用于分析和历史工作区参考，不再决定首页的信息量和常驻侧栏。

| 案例与官方链接 | 本轮观察方式 | 借鉴的具体组织方法 |
| --- | --- | --- |
| [Plausible 公开仪表盘](https://plausible.io/plausible.io)，[官方 Guided Tour](https://plausible.io/docs/guided-tour) | 实际打开演示并查看当前仪表盘 | 顶部紧凑指标、统一时间筛选、一个主图和下方明细；减少首屏巨大卡片 |
| [Linear Dashboards](https://linear.app/docs/dashboards)，[Insights](https://linear.app/docs/insights) | 阅读官方说明并查看官方页面中的产品截图 | 稳定侧栏、克制边界、指标／图表／列表组合、全局过滤和点击查看明细 |
| [Metabase Dashboard Interactivity](https://www.metabase.com/docs/latest/dashboards/interactive)，[Filters](https://www.metabase.com/docs/latest/dashboards/filters) | 官方交互文档；没有登录其产品 | 图表钻取、筛选与底层记录之间建立清晰关系 |

这些是布局与交互参考，不复制品牌标志、原始组件代码或网站截图到产品。第二版视觉、交互预览和静态稿见 [前端设计](DESIGN.md)。

## 5. 浏览器 OCR 依据

拟使用 [Tesseract.js 官方项目](https://github.com/naptha/tesseract.js) 的 WebAssembly／Worker 浏览器能力，加载简体中文与英文识别资源。第一版用已有 OCR 识别器，不训练 OCR 或胜负网络。

本轮实际预检使用的是 Windows 自带的 `Windows.Media.Ocr`，不是 Tesseract.js。两者精度、速度和坐标行为不可直接等同；真实的浏览器 OCR 需要在实施阶段对相同六图另外测试。
