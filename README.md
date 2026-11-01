# FFmpeg Studio

> 把 FFmpeg 的命令行能力，变成点几下就能用的可视化工具。

[![Python](https://img.shields.io/badge/Python-3.9%2B-3776ab?logo=python&logoColor=white)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.x-000000?logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-6.0%2B-007808?logo=ffmpeg&logoColor=white)](https://ffmpeg.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078d4?logo=windows&logoColor=white)](#)

FFmpeg 是音视频处理领域的瑞士军刀，但它的学习曲线劝退了绝大多数人——几十个滤镜、上百个参数、还要记住 `-ss` 到底该放在 `-i` 前面还是后面。

**FFmpeg Studio** 把这些能力包成了本地网页界面：选功能、填参数、点执行。**它对 FFmpeg 的原始功能没有任何修改或阉割**，每一条命令都完整展示、可复制，参数旁附中文说明，随时可以展开看它到底在做什么。

![主界面](docs/screenshot.png)

---

## ✨ 特性

| | 说明 |
|---|---|
| 🖱️ **纯点击操作** | 34 个常用功能全部可视化，不需要记任何命令 |
| ⌨️ **完整命令可见** | 底部实时生成整条 ffmpeg 命令，语法高亮、一键复制，**所见即所跑** |
| 💡 **参数自带解释** | 每个参数都有「💡 说明」，默认收起，点开即看作用、取值范围和取舍 |
| 📊 **实时日志** | SSE 流式回传 ffmpeg 输出，进度、错误一目了然，支持随时中止 |
| 📂 **原生文件对话框** | 「浏览…」直接弹 Windows 系统选择框，支持多选 |
| 🎛️ **高级参数折叠** | 常用参数与进阶参数分区，界面不堆砌，需要时再展开 |
| 🔒 **完全本地运行** | 数据不出本机，无网络请求、无遥测、无账号 |
| 🖥️ **硬件编码自动检测** | 打开硬件加速页时实测 NVENC/QSV/AMF 是否可用，不可用的直接标灰并自动切换 |

![执行效果](docs/screenshot-run.png)

---

## 🧰 内置功能

### 视频处理

| 功能 | 说明 | 核心参数 |
|---|---|---|
| 格式转换 | MP4 / MKV / AVI / MOV / WebM / FLV / TS 互转，可换编解码器或直接复制流 | `-c:v` `-c:a` `-crf` `-preset` |
| 视频压缩 | H.264 重编码大幅减小体积，支持分辨率缩放 | `-crf` `-preset` `-vf scale` |
| 视频剪辑 | 按开始/结束时间或时长截取，支持无损快剪与精确裁剪两种模式 | `-ss` `-to` `-t` `-c copy` |
| 缩放 / 裁剪 | 改变分辨率或裁出画面局部区域（去黑边、去水印区） | `-vf scale` `-vf crop` |
| 旋转 / 翻转 | 顺时针/逆时针 90°、180°、水平/垂直镜像 | `-vf transpose` `-vf hflip` |
| 变速播放 | 0.5x–4x 加速或慢放，视频与音频同步处理 | `setpts` `atempo` |
| 添加水印 | PNG/JPG 水印叠加到任意角落，可调边距与不透明度 | `overlay` `colorchannelmixer` |
| 画面调节 | 亮度、对比度、饱和度、伽马四维调色，修复偏暗发灰 | `eq` |
| 降噪 / 去隔行 | hqdn3d 降噪 + yadif 反交错，修复噪点与电视横纹 | `hqdn3d` `yadif` |
| 锐化 / 模糊 | unsharp 提升清晰度，boxblur 柔化磨皮或遮挡 | `unsharp` `boxblur` |
| 帧率调整 | 统一为固定帧率，解决音画不同步、播放卡顿 | `fps` |
| 视频倒放 | 画面与音频从尾到头倒放 | `reverse` `areverse` |
| 硬件加速转码 | NVENC / QSV / AMF 显卡编码，自动检测本机可用性 | `h264_nvenc` `-cq` |

### 字幕与叠加

| 功能 | 说明 | 核心参数 |
|---|---|---|
| 字幕烧录 | SRT/ASS 压进画面，兼容一切播放器，字号与边距可调 | `subtitles` `force_style` |
| 字幕封装 | 字幕作为独立轨道嵌入容器，播放器里可开关 | `-c:s mov_text/srt` |
| 画中画 | 小画面叠加到四角之一，位置与占比可调 | `overlay` `scale` |
| 双画面拼接 | 左右或上下并排显示两段视频（对比、合拍） | `hstack` `vstack` |

### 音频处理

| 功能 | 说明 | 核心参数 |
|---|---|---|
| 提取音频 | 从视频中分离音轨，导出 MP3 / AAC / WAV / FLAC | `-vn` `-c:a` `-b:a` |
| 音量调整 | 0.1x–5x 放大或减小音量，视频流不重编码 | `-af volume` |
| 音视频合成 | 给无声视频配上外部配音或背景音乐 | `-map` `-shortest` |
| 音频剪辑 | 截取音频片段，支持无损复制与重编码两种模式 | `-ss` `-to` `-c:a copy` |
| 音频淡入淡出 | 首尾音量渐入渐出，接歌接片更自然 | `afade` |
| 响度标准化 | EBU R128 统一响度，多段素材音量不再忽大忽小 | `loudnorm` |
| 采样率 / 声道 | 改变采样率与声道数，适配不同播放设备 | `-ar` `-ac` |
| 男女声变调 | 只变调不变速（男声↔女声） | `asetrate` `aresample` `atempo` |

### 图像与 GIF

| 功能 | 说明 | 核心参数 |
|---|---|---|
| 视频转 GIF | 截取片段转动图，可调帧率与宽度 | `fps=` `scale=` |
| 视频截图 | 在指定时间点截取一帧，PNG 无损或 JPG 小体积 | `-ss` `-frames:v` |

### 组合工具

| 功能 | 说明 | 核心参数 |
|---|---|---|
| 视频合并 | 多文件按顺序拼接，支持无损拼接与跨格式重编码拼接 | `concat demuxer` / `concat filter` |
| 媒体信息查看 | 用 ffprobe 解析编码、分辨率、时长、帧率、码率并给出中文摘要 | `ffprobe -show_streams` |
| 元数据编辑 | 修改标题/作者/专辑，或清除全部元数据脱敏 | `-metadata` `-map_metadata -1` |
| 导出图片序列 | 按固定间隔抽帧，批量导出 PNG/JPG | `fps=` `%04d` |
| 视频分段切割 | 按固定时长自动切成多个小文件（不重编码） | `-f segment` |
| 图片转视频 | 把一张图片转成可播放视频（封面配乐常用） | `-loop 1` |
| 屏幕录制 | 全屏或指定区域录制（Windows gdigrab） | `-f gdigrab` |

> 硬件编码器是否可用取决于你的显卡与驱动。打开「硬件加速转码」时工具会实际试编码一次，把不可用的选项标灰、并自动选中可用的那个：
>
> ![硬件编码器检测](docs/screenshot-hw.png)

---

## 🏗️ 架构

```
浏览器（单页前端）
   │  ① 参数表单 → build() 生成 argv 数组
   │  ② 同一份 argv 直接渲染成命令预览
   ▼
Flask 后端（127.0.0.1:8558）
   │  ③ 原样执行：ffmpeg -hide_banner -y + argv
   │  ④ SSE 流式回传 stderr 日志与退出码
   ▼
ffmpeg.exe / ffprobe.exe
```

**设计要点：命令只有一个来源。**

传统做法是「前端拼一份命令显示、后端再拼一份命令执行」，两边一旦不同步就会出现"预览和执行不一致"的坑。这里所有命令都由前端 `build()` 函数生成**唯一一份 argv**，既用于预览也直接提交执行，后端只负责 `subprocess` 调用，不做任何二次加工。

```
ffmpeg-studio/
├── app.py                  # Flask 后端：执行命令、SSE 日志、ffprobe、文件对话框
├── browse_dialog.ps1       # 原生文件选择框（PowerShell + WinForms，置顶显示）
├── static/
│   ├── index.html          # 页面骨架
│   ├── style.css           # 亮色主题
│   └── app.js              # 功能定义、参数渲染、命令构建、执行流程
├── uploads/                # 临时上传目录（不入库）
└── outputs/                # 输出文件目录（不入库）
```

---

## 🚀 快速开始

### 1. 准备 FFmpeg

下载 Windows 版 FFmpeg（推荐 [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) 的 `full_build`），解压后把 `bin` 目录加入系统 `PATH`。

本项目的默认路径写在 `app.py` 顶部，按需改成你自己的：

```python
FFMPEG_BIN = r"D:\Program Files\ffmpeg-9.0-full_build\bin\ffmpeg.exe"
FFPROBE_BIN = r"D:\Program Files\ffmpeg-9.0-full_build\bin\ffprobe.exe"
```

> 找不到时会回退到 `PATH` 里的 `ffmpeg` / `ffprobe`，所以不写死也能用。

验证安装：

```bash
ffmpeg -version
```

### 2. 安装依赖

```bash
python -m pip install flask
```

### 3. 启动

双击 `启动FFmpegStudio.bat`，或：

```bash
cd ffmpeg-studio
python app.py
```

浏览器会自动打开 <http://127.0.0.1:8558>（没自动打开就手动访问）。

---

## 📖 使用流程

1. 左侧选功能 → 右侧填参数
2. 点「浏览…」选文件，或直接把路径粘进输入框
3. 底部**完整命令预览**确认无误（想学习 FFmpeg 的话，这里是最好的教材）
4. 点「▶ 开始执行」，日志区实时滚动
5. 完成后到「📂 输出目录」查看结果文件

**输出路径**默认自动生成在 `outputs/` 下，文件名 = 原文件名 + 功能后缀；想改保存位置就点输出框旁的「浏览…」。

**参数说明**：每个参数下方的「💡 说明」点开就是中文解释，包括取值范围、副作用和推荐值。高级参数收在「高级参数（可选）」分区里，点标题展开。

---

## ❓ 常见问题

**Q：点「浏览…」没反应？**
对话框由 PowerShell 弹出，若被拦截会直接弹提示。你也可以绕过它——把文件路径直接粘贴到输入框，效果完全一样。

**Q：端口 8558 被占用？**
改 `app.py` 最后一行 `app.run(..., port=8558)` 换个端口。注意如果之前有残留进程，先结束它，否则新实例可能绑不上。

**Q：中文路径 / 带空格的路径能处理吗？**
可以。参数以数组形式传给 `subprocess`，不经过 shell 拼接，空格和中文都不会出问题。

**Q：为什么无损剪辑切点不准？**
`-c copy` 只能在关键帧上切，这是容器格式的限制，不是 bug。需要精确到帧就选「精确剪辑（重编码）」。

**Q：能处理 4K / 大文件吗？**
能，耗时取决于 CPU。建议压缩时用 `preset fast` 起步，追求体积再换 `slow`。

**Q：硬件加速里所有编码器都是灰色的？**
说明本机没有可用的 GPU 编码器（常见于集显较老、驱动未装、或是 N 卡但驱动过旧）。此时改用「视频压缩」的 CPU 编码即可，速度慢一些但画质更好。

**Q：字幕烧录报 `No such filter: 'subtitles'`？**
说明你下载的 FFmpeg 是精简版（没有 libass）。换用 gyan.dev 的 `full_build` 或 BtbN 的 `gpl-shared` 版本即可。

---

## ⚠️ 免责声明

本项目仅是 FFmpeg 的图形界面封装，不包含也不修改 FFmpeg 本身。请遵守当地法律法规与内容版权，仅处理你拥有合法权利的音视频文件。

---

## 📄 License

[MIT](LICENSE) © 2026 flyff920
