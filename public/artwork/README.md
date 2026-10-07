# 对局手记图头素材

文件：[match-journal-masthead.png](match-journal-masthead.png)，1536 × 1024，约 1.42 MB。2026-10-04 使用内置 `image_gen` 生成；本项目直接使用 PNG，不请求外部资源。素材是原创抽象静物，未使用玩家截图、游戏角色、Apple 图标或品牌标志。

## 用法

在单页工作台的标题区右侧作为装饰图片使用。图片不包含标题；标题、副标题与四栏范围选择均是可访问的网页文字。图片空 `alt`，外层 `aria-hidden`，没有指针交互。CSS 使用水平和垂直渐隐让背景融入页面，正文面保持白色；移动端调整图片尺寸与标题折行。

玻璃片与环线是装饰，不对应胜负、真实概率或模型状态，不能据图中的上升形态理解为下一局必胜。正式前端接入时可单独优化分发格式与体积；审阅稿保留原始生成像素。

## 生成方式与原始提示词

方式：内置 `image_gen`，非 CLI/API 脚本；非透明背景。生成后完整复制到项目，源文件保留。以下为实际生成提示词。

```text
Use case: stylized-concept.
Asset type: original abstract editorial masthead artwork for a small Overwatch match-history probability journal website, used in a short wide header behind live HTML text.
Primary request: a refined tactile sculpture of five rounded rectangular frosted glass plates gently staggered into a shallow ascending arc, framed by one exceptionally thin brushed-silver open orbital ring. Subtle cobalt-blue edge refraction on two plates, tiny warm orange accent on a single edge. Beautiful substantial material detail, softly rounded bevels, elegant precise geometry, calm apple-like product photography sensibility.
Scene/backdrop: seamless very pale cool gray (#f3f5f8) studio background with a soft ground shadow.
Composition/framing: wide landscape image, about 3:2 aspect, all of the sculpture compactly placed in the right 45 percent; left 55 percent is calm mostly empty background for real webpage title text. Sculptural cluster centered vertically, entire sculpture visible with ample breathing room, not cropped. Shallow three-quarter angle, premium still-life macro photography / realistic 3D render.
Lighting/mood: bright diffuse studio light, crisp translucent edge highlights, controlled reflections, subtle depth. Not shiny neon.
Materials/textures: milky translucent glass, satin pearl white, refined silver, tiny blue accent. Two narrow curved hairline traces give a suggestion of probability and motion without literal charts.
Constraints: no text, no letters, no numerals, no logos, no watermark, no game characters, no weapon, no website screenshot, no UI, no starbursts, no gradient blobs, no purple glow, no busy scattered decoration. Avoid generic wallpaper swirls. Strong clear sculptural object.
```
