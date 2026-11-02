/* ============================================================
 * FFmpeg Studio - 前端逻辑
 * 单一事实来源：所有命令由 build() 在前端构建并实时预览，
 * 后端原样执行，保证"所见即所跑"。
 * ============================================================ */

let OUTPUT_DIR = "";
let currentFeature = null;
let currentTaskId = null;
let eventSource = null;
const paramRefs = {};      // key -> element
const outputDirty = {};    // 输出框是否被用户手动改过

/* ---------------- 功能定义 ---------------- */
const VIDEO_FILTER = "视频文件|*.mp4;*.mkv;*.avi;*.mov;*.flv;*.webm;*.ts;*.wmv|所有文件 (*.*)|*.*";
const AUDIO_FILTER = "音频文件|*.mp3;*.aac;*.wav;*.flac;*.ogg;*.m4a|所有文件 (*.*)|*.*";
const IMAGE_FILTER = "图片文件|*.png;*.jpg;*.jpeg;*.webp;*.bmp|所有文件 (*.*)|*.*";
const M3U8_FILTER = "播放列表|*.m3u8;*.m3u|所有文件 (*.*)|*.*";
const DEFAULT_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                   "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/* drawtext 需要真实字体文件路径；启动时由 /api/fonts 用本机实际存在的字体覆盖 */
let FONT_LIST = [
  { key: "msyh", path: "C:/Windows/Fonts/msyh.ttc", label: "微软雅黑" },
  { key: "simhei", path: "C:/Windows/Fonts/simhei.ttf", label: "黑体" },
  { key: "simsun", path: "C:/Windows/Fonts/simsun.ttc", label: "宋体" },
  { key: "arial", path: "C:/Windows/Fonts/arial.ttf", label: "Arial" }
];

async function loadFonts() {
  try {
    const r = await fetch("/api/fonts").then(x => x.json());
    if (r.ok && r.fonts && r.fonts.length) FONT_LIST = r.fonts;
  } catch (e) { /* 接口异常时沿用上面的默认列表 */ }
}

function fontPath(key) {
  const f = FONT_LIST.find(x => x.key === key) || FONT_LIST[0];
  return f ? f.path : "C:/Windows/Fonts/arial.ttf";
}

/** drawtext 的文字走临时文件：内联进 filtergraph 时，同时出现单引号与冒号/百分号会
 *  让引号配对错位、吞掉后面的参数，写入文件可绕开全部转义问题，也顺带支持多行 */
async function writeTextFile(text) {
  const r = await fetch("/api/textfile", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: String(text == null ? "" : text) })
  }).then(x => x.json());
  if (!r.ok) throw new Error(r.error || "写入文字失败");
  return fpath(r.path);
}

const FEATURES = [
/* ==================== 视频处理 ==================== */
{
  id: "convert", group: "视频处理", icon: "🔄", name: "格式转换",
  desc: "将音视频文件转换为其他容器格式，可指定编解码器",
  tag: "_converted", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "选择要转换的源文件。FFmpeg 支持几乎所有主流音视频格式（MP4、MKV、AVI、MOV、FLV、WebM、TS 等）。" },
    { key: "format", label: "输出格式", type: "select", flag: "容器", default: "mp4",
      options: ["mp4","mkv","avi","mov","webm","flv","ts"],
      help: "输出文件的<b>容器格式</b>。容器只是「包装盒」，真正决定画质和体积的是内部的编解码器。MP4 兼容性最好，MKV 支持的字幕/音轨最多。" },
    { key: "vcodec", label: "视频编码", type: "radio", flag: "-c:v", default: "libx264",
      options: [
        { value: "copy", label: "copy（直接复制）" },
        { value: "libx264", label: "H.264 (libx264)" },
        { value: "libx265", label: "H.265 (libx265)" },
        { value: "libvpx-vp9", label: "VP9" },
        { value: "none", label: "去除视频流" }
      ],
      help: "<b>copy</b>：不重新编码，速度极快、零画质损失，只换容器；<b>H.264</b>：兼容性最好；<b>H.265</b>：同画质体积小约 40%，但编码慢；<b>VP9</b>：Google 开源编码，适合 WebM。" },
    { key: "acodec", label: "音频编码", type: "radio", flag: "-c:a", default: "copy",
      options: [
        { value: "copy", label: "copy（直接复制）" },
        { value: "aac", label: "AAC" },
        { value: "libmp3lame", label: "MP3" },
        { value: "libopus", label: "Opus" },
        { value: "flac", label: "FLAC（无损）" },
        { value: "none", label: "去除音频流" }
      ],
      help: "<b>AAC</b> 是 MP4 的标配；<b>MP3</b> 兼容性最广；<b>Opus</b> 低码率音质最好（适合语音）；<b>FLAC</b> 无损但体积大。" },
    { key: "crf", label: "CRF 质量", type: "range", flag: "-crf", default: 23, min: 0, max: 51, advanced: true,
      help: "<b>恒定质量因子</b>（0-51）：数值越小画质越高、文件越大。18 视觉无损，23 是默认值，28 明显压缩。仅在重新编码（非 copy）时生效。" },
    { key: "preset", label: "编码速度", type: "select", flag: "-preset", default: "medium", advanced: true,
      options: ["ultrafast","fast","medium","slow","veryslow"],
      help: "编码速度与压缩率的权衡：<b>越慢同画质下文件越小</b>，但耗时更长。日常用 medium 即可，追求极致压缩选 slow/veryslow。" },
    { key: "abitrate", label: "音频码率", type: "select", flag: "-b:a", default: "128k", advanced: true,
      options: ["64k","96k","128k","192k","256k","320k"],
      help: "音频每秒数据量。语音 64k 足够，音乐建议 128k-192k，追求音质选 320k。仅重新编码音频时生效。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "转换结果保存路径。留空时会根据输入文件名自动生成到 outputs 目录。" }
  ],
  build(v) {
    const a = ["-i", v.input];
    if (v.vcodec === "none") a.push("-vn");
    else {
      a.push("-c:v", v.vcodec);
      if ((v.vcodec === "libx264" || v.vcodec === "libx265")) {
        a.push("-crf", String(v.crf), "-preset", v.preset);
      }
    }
    if (v.acodec === "none") a.push("-an");
    else {
      a.push("-c:a", v.acodec);
      if (v.acodec !== "copy" && v.acodec !== "flac") a.push("-b:a", v.abitrate);
    }
    a.push(v.output);
    return { argv: a };
  }
},
{
  id: "compress", group: "视频处理", icon: "🗜️", name: "视频压缩",
  desc: "通过 H.264 重编码显著减小视频体积",
  tag: "_compressed", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "要压缩的视频文件。压缩本质是降低码率/分辨率，画质会有一定损失。" },
    { key: "crf", label: "压缩强度 (CRF)", type: "range", flag: "-crf", default: 28, min: 18, max: 40,
      help: "<b>核心参数</b>：数值越大压缩越狠、画质越低。23 接近原画质，28 是体积/画质的平衡点，35+ 画质明显劣化但体积很小。" },
    { key: "preset", label: "编码速度", type: "select", flag: "-preset", default: "medium",
      options: ["ultrafast","fast","medium","slow","veryslow"],
      help: "同 CRF 下，preset 越慢压缩率越高（文件更小）。不赶时间建议 slow。" },
    { key: "scaleW", label: "缩放宽度", type: "number", flag: "-vf scale", placeholder: "留空则不缩放，如 1280",
      help: "等比缩小分辨率是<b>最有效的压缩手段</b>。例如 4K 视频缩到 1280 宽，体积可缩小 80%+。高度自动按原始比例计算（-2 保证为偶数）。" },
    { key: "abitrate", label: "音频码率", type: "select", flag: "-b:a", default: "96k", advanced: true,
      options: ["64k","96k","128k","192k"],
      help: "压缩场景下音频用 96k AAC 对大多数人已足够清晰。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "压缩结果保存路径，固定输出为 MP4 格式。" }
  ],
  build(v) {
    const a = ["-i", v.input, "-c:v", "libx264", "-crf", String(v.crf), "-preset", v.preset];
    if (v.scaleW && Number(v.scaleW) > 0) a.push("-vf", `scale=${v.scaleW}:-2`);
    a.push("-c:a", "aac", "-b:a", v.abitrate, v.output);
    return { argv: a };
  }
},
{
  id: "cut", group: "视频处理", icon: "✂️", name: "视频剪辑",
  desc: "按时间段截取视频片段，支持无损快剪",
  tag: "_cut", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "要截取的视频文件。" },
    { key: "start", label: "开始时间", type: "text", flag: "-ss", default: "00:00:00", placeholder: "如 00:01:30 或 90",
      help: "截取的起始时间点。支持 <b>HH:MM:SS</b> 格式或直接写秒数（如 90 表示 1 分 30 秒），也支持小数（90.5）。" },
    { key: "end", label: "结束时间", type: "text", flag: "-to", placeholder: "如 00:03:00（与时长二选一）",
      help: "截取的结束时间点。<b>注意：与「时长」只需填写一个</b>，同时填写时以结束时间为准。" },
    { key: "duration", label: "时长", type: "text", flag: "-t", placeholder: "如 00:01:30 或 90",
      help: "从开始时间往后截取的时长。例如开始 00:01:00、时长 30，即截取 1:00-1:30 这段。" },
    { key: "mode", label: "剪辑模式", type: "radio", default: "copy",
      options: [
        { value: "copy", label: "⚡ 无损快剪（秒开）" },
        { value: "reencode", label: "🎯 精确剪辑（重编码）" }
      ],
      help: "<b>无损快剪</b>：-c copy 直接复制流，速度极快且无画质损失，但切点只能落在关键帧上，可能有几秒偏差；<b>精确剪辑</b>：重新编码，切点精确到帧，速度慢但准确。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "截取片段的保存路径。" }
  ],
  build(v) {
    const a = [];
    const t = [];
    if (v.start) t.push("-ss", v.start);
    if (v.end) t.push("-to", v.end);
    else if (v.duration) t.push("-t", v.duration);
    if (v.mode === "copy") {
      a.push(...t, "-i", v.input, "-c", "copy");
    } else {
      a.push("-i", v.input, ...t, "-c:v", "libx264", "-crf", "18", "-c:a", "aac");
    }
    a.push(v.output);
    return { argv: a };
  }
},
{
  id: "scale", group: "视频处理", icon: "📐", name: "缩放 / 裁剪画面",
  desc: "调整视频分辨率或裁剪画面区域",
  tag: "_scaled", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "要处理的视频文件。" },
    { key: "mode", label: "处理模式", type: "radio", default: "scale",
      options: [
        { value: "scale", label: "缩放（scale）" },
        { value: "crop", label: "裁剪（crop）" }
      ],
      help: "<b>缩放</b>：整体改变分辨率；<b>裁剪</b>：从画面中切出一块矩形区域（去黑边、去水印区域常用）。" },
    { key: "width", label: "目标宽度", type: "number", flag: "scale/crop", default: 1280,
      help: "缩放模式：目标宽度像素，填 -2 表示按高度等比自动计算；裁剪模式：保留区域的宽度。" },
    { key: "height", label: "目标高度", type: "number", flag: "scale/crop", default: -2,
      help: "缩放模式常用 <b>-2</b>：按宽度等比缩放且保证高度为偶数（H.264 编码要求）。裁剪模式：保留区域的高度。" },
    { key: "cropX", label: "裁剪起点 X", type: "number", default: 0, advanced: true,
      help: "仅裁剪模式：从画面左边起第 X 个像素开始保留。可用表达式如 (in_w-640)/2 表示水平居中。" },
    { key: "cropY", label: "裁剪起点 Y", type: "number", default: 0, advanced: true,
      help: "仅裁剪模式：从画面顶部起第 Y 个像素开始保留。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "处理结果的保存路径。" }
  ],
  build(v) {
    let vf;
    if (v.mode === "scale") vf = `scale=${v.width}:${v.height}`;
    else vf = `crop=${v.width}:${v.height}:${v.cropX}:${v.cropY}`;
    return { argv: ["-i", v.input, "-vf", vf, "-c:v", "libx264", "-crf", "20", "-c:a", "copy", v.output] };
  }
},
{
  id: "rotate", group: "视频处理", icon: "🔃", name: "旋转 / 翻转",
  desc: "旋转 90/180 度或水平、垂直翻转画面",
  tag: "_rotated", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "手机竖拍变横、画面颠倒等场景的修复工具。" },
    { key: "dir", label: "变换方式", type: "radio", flag: "-vf", default: "transpose=1",
      options: [
        { value: "transpose=1", label: "顺时针 90°" },
        { value: "transpose=2", label: "逆时针 90°" },
        { value: "transpose=1,transpose=1", label: "180°" },
        { value: "hflip", label: "水平镜像" },
        { value: "vflip", label: "垂直翻转" }
      ],
      help: "transpose 是 FFmpeg 的旋转滤镜；hflip/vflip 分别是水平/垂直镜像。<b>注意</b>：旋转属于像素级操作，必须重新编码，会按 CRF 18 高质量输出。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "处理结果的保存路径。" }
  ],
  build(v) {
    return { argv: ["-i", v.input, "-vf", v.dir, "-c:v", "libx264", "-crf", "18", "-c:a", "copy", v.output] };
  }
},
{
  id: "speed", group: "视频处理", icon: "⏩", name: "变速播放",
  desc: "视频加速 / 慢放，音调同步处理",
  tag: "_speed", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "要变速的视频文件。" },
    { key: "factor", label: "速度倍率", type: "range", flag: "setpts/atempo", default: 2, min: 0.5, max: 4, step: 0.25, unit: "x",
      help: "<b>2x</b> 表示两倍速（时长减半），<b>0.5x</b> 表示慢放（时长翻倍）。视频用 setpts 滤镜、音频用 atempo 滤镜同步变速，音调会随速度自然变化。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "处理结果的保存路径。" }
  ],
  build(v) {
    const s = Number(v.factor);
    return { argv: ["-i", v.input, "-filter_complex",
      `[0:v]setpts=PTS/${s}[v];[0:a]atempo=${s}[a]`,
      "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "20", v.output] };
  }
},
{
  id: "watermark", group: "视频处理", icon: "🖼️", name: "添加图片水印",
  desc: "将 PNG/JPG 图片叠加到视频任意角落",
  tag: "_watermarked", outExt: "mp4",
  params: [
    { key: "input", label: "视频文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "要加水印的视频。" },
    { key: "wm", label: "水印图片", type: "file", required: true, filter: IMAGE_FILTER,
      help: "建议用<b>透明背景 PNG</b>，效果最好。水印尺寸若需缩放，可先在其他工具中处理好。" },
    { key: "pos", label: "水印位置", type: "radio", default: "br",
      options: [
        { value: "tl", label: "左上" }, { value: "tr", label: "右上" },
        { value: "bl", label: "左下" }, { value: "br", label: "右下" },
        { value: "center", label: "居中" }
      ],
      help: "水印叠加在画面的哪个位置，配合边距微调。" },
    { key: "margin", label: "边距 (px)", type: "number", default: 20,
      help: "水印距离画面边缘的像素距离，对居中模式无效。" },
    { key: "opacity", label: "不透明度", type: "range", default: 0.8, min: 0.1, max: 1, step: 0.05, advanced: true,
      help: "1 为完全不透明，0.5 半透明。通过 colorchannelmixer 滤镜调整水印图的 alpha 通道实现。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "处理结果的保存路径。加水印必须重编码视频，默认 CRF 18 高质量。" }
  ],
  build(v) {
    const m = Number(v.margin) || 20;
    const posMap = {
      tl: `${m}:${m}`, tr: `W-w-${m}:${m}`,
      bl: `${m}:H-h-${m}`, br: `W-w-${m}:H-h-${m}`,
      center: "(W-w)/2:(H-h)/2"
    };
    return { argv: ["-i", v.input, "-i", v.wm, "-filter_complex",
      `[1:v]format=rgba,colorchannelmixer=aa=${v.opacity}[wm];[0:v][wm]overlay=${posMap[v.pos]}[v]`,
      "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-crf", "18", "-c:a", "copy", v.output] };
  }
},
{
  id: "text_watermark", group: "视频处理", icon: "🔤", name: "添加文字水印",
  desc: "把署名、版权、账号等文字直接印在画面角落",
  tag: "_textwm", outExt: "mp4",
  needsTextFile: true,
  params: [
    { key: "input", label: "视频文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "要加文字水印的视频。文字会被<b>烧进画面</b>变成像素，任何播放器、任何网站都能看到，也没法关掉；如果需要保留可开关的独立字幕轨，请用「字幕封装」。" },
    { key: "text", label: "水印文字", type: "text", required: true, default: "© 2026 你的名字", multiline: true,
      placeholder: "如 © 2026 张三　　或　　@yourname",
      help: "中文、英文、数字以及 © · ¥ 等符号都支持，<b>可以多行</b>（回车换行会原样印成两行）。文字会先写入一个临时文本文件再交给 FFmpeg，所以冒号、百分号、单引号这些平时最容易报错的字符可以随便写。" },
    { key: "font", label: "字体", type: "select", dynamic: "fonts", default: "msyh",
      help: "只能选<b>本机已安装</b>的字体（列表实时探测）。<b>微软雅黑</b>中文最清晰通用；纯英文水印用 Arial / Segoe UI 更秀气；「粗体」字重更粗，压在复杂背景上更醒目。" },
    { key: "size", label: "字号 (px)", type: "number", default: 40,
      help: "以 <b>1080p 画面</b>为基准的像素高度，40 大约是一行小字、56 是中等标题。4K 素材不用手动翻倍——下面「随分辨率缩放」开着时会按画面高度自动换算。" },
    { key: "pos", label: "水印位置", type: "radio", default: "br",
      options: [
        { value: "tl", label: "左上" }, { value: "tr", label: "右上" },
        { value: "bl", label: "左下" }, { value: "br", label: "右下" },
        { value: "center", label: "居中" }
      ],
      help: "文字放在哪个角。<b>右下 / 左下</b>最不影响观看；居中会挡住主体，一般只用于样片打标。" },
    { key: "margin", label: "边距 (px)", type: "number", default: 24,
      help: "文字距离画面边缘的像素距离，对「居中」无效。竖屏视频建议调到 40 以上，避免被平台裁切掉。" },
    { key: "color", label: "文字颜色", type: "color", default: "#FFFFFF",
      help: "点右侧色块直接取色。<b>白色</b>最百搭；如果压在浅色/高亮画面上看不清，把下面的「描边宽度」调到 2~3 即可。" },
    { key: "autoscale", label: "随分辨率缩放", type: "switch", default: true, advanced: true,
      help: "开启后字号按 <b>画面高度 ÷ 1080</b> 自动换算：同一套参数用在 720p 和 4K 上，水印占画面的比例基本一致。关闭则按填写的像素数硬写。" },
    { key: "border", label: "描边宽度 (px)", type: "number", default: 2, advanced: true,
      help: "文字外圈的描边宽度，<b>0 表示不描边</b>。作用是让文字在浅色、杂乱的背景上依然清晰，白字配 2px 黑边是最稳的组合。" },
    { key: "bordercolor", label: "描边颜色", type: "color", default: "#000000", advanced: true,
      help: "描边颜色，与文字颜色反差越大越好（白字黑边、黑字白边）。" },
    { key: "box", label: "半透明底衬", type: "switch", default: false, advanced: true,
      help: "在文字背后铺一块半透明黑色色块，类似字幕条。适合水印正好落在花哨画面上、连描边也压不住的情况。" },
    { key: "opacity", label: "不透明度", type: "range", default: 1, min: 0.1, max: 1, step: 0.05, advanced: true,
      help: "1 为完全不透明，0.3 左右是「隐约可见」的淡水印。降低不透明度也能减轻对画面的干扰。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "结果保存路径。烧录文字必须重新编码，默认 CRF 18 保持高画质。" }
  ],
  build(v) {
    const m = Number(v.margin) || 0;
    const base = Number(v.size) || 40;
    // 随分辨率缩放：按 1080p 为基准换算，用表达式让 FFmpeg 按实际画面高度计算
    const fsx = v.autoscale ? `h*${base}/1080` : String(base);
    const posMap = {
      tl: [`${m}`, `${m}`],
      tr: [`w-text_w-${m}`, `${m}`],
      bl: [`${m}`, `h-text_h-${m}`],
      br: [`w-text_w-${m}`, `h-text_h-${m}`],
      center: ["(w-text_w)/2", "(h-text_h)/2"]
    };
    const [px, py] = posMap[v.pos] || posMap.br;
    let fc = `drawtext=fontfile='${fpath(fontPath(v.font))}'` +
             `:textfile='{TEXTFILE}'` +
             `:expansion=none` +
             `:fontcolor=${v.color}:fontsize=${fsx}` +
             `:x=${px}:y=${py}` +
             `:alpha=${v.opacity}`;
    if (Number(v.border) > 0) fc += `:borderw=${Number(v.border)}:bordercolor=${v.bordercolor}`;
    if (v.box) fc += `:box=1:boxcolor=black@0.4:boxborderw=10`;
    return { argv: ["-i", v.input, "-vf", fc,
      "-map", "0:v", "-map", "0:a?", "-c:v", "libx264", "-crf", "18", "-c:a", "copy", v.output] };
  }
},
/* ==================== 音频处理 ==================== */
{
  id: "extract_audio", group: "音频处理", icon: "🎵", name: "提取音频",
  desc: "从视频中分离音轨，导出为 MP3/AAC 等格式",
  tag: "_audio", outExt: "mp3",
  params: [
    { key: "input", label: "输入视频", type: "file", required: true, filter: VIDEO_FILTER,
      help: "从该视频文件中提取音轨（-vn 丢弃视频流）。" },
    { key: "format", label: "音频格式", type: "radio", default: "mp3",
      options: [
        { value: "mp3", label: "MP3" }, { value: "aac", label: "AAC(m4a)" },
        { value: "wav", label: "WAV(无损)" }, { value: "flac", label: "FLAC(无损)" }
      ],
      help: "<b>MP3</b> 兼容性最好；<b>WAV/FLAC</b> 无损但体积大（WAV 不压缩）。如果源音轨本身就是 AAC，选 AAC 也无法避免重编码，想无损提取原始音轨请直接用对应扩展名并让编码器选 copy——本功能固定重编码以保证稳定。" },
    { key: "bitrate", label: "音频码率", type: "select", flag: "-b:a", default: "192k", advanced: true,
      options: ["96k","128k","192k","256k","320k"],
      help: "仅对 MP3/AAC 生效。音乐建议 192k 以上；WAV/FLAC 为无损格式，忽略此参数。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "音频保存路径，扩展名需与所选格式一致（自动生成）。" }
  ],
  build(v) {
    const codecMap = { mp3: "libmp3lame", aac: "aac", wav: "pcm_s16le", flac: "flac" };
    const a = ["-i", v.input, "-vn", "-c:a", codecMap[v.format]];
    if (v.format === "mp3" || v.format === "aac") a.push("-b:a", v.bitrate);
    a.push(v.output);
    return { argv: a };
  }
},
{
  id: "volume", group: "音频处理", icon: "🔊", name: "音量调整",
  desc: "放大或减小视频/音频的音量",
  tag: "_vol", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "支持视频或纯音频文件。视频流会直接复制不损失画质，仅重编码音频。" },
    { key: "vol", label: "音量倍数", type: "range", flag: "-af volume", default: 1.5, min: 0.1, max: 5, step: 0.1, unit: "x",
      help: "<b>1.0 为原始音量</b>，2.0 放大一倍，0.5 减半。注意放大过多会产生削波失真，建议配合试听微调。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "处理结果的保存路径。" }
  ],
  build(v) {
    return { argv: ["-i", v.input, "-c:v", "copy", "-af", `volume=${v.vol}`, "-c:a", "aac", "-b:a", "192k", v.output] };
  }
},
{
  id: "mux", group: "音频处理", icon: "🎼", name: "音视频合成",
  desc: "为无声视频配上外部音频（配音/配乐）",
  tag: "_muxed", outExt: "mp4",
  params: [
    { key: "video", label: "视频文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "画面来源。视频流直接复制（-c:v copy），不重编码、不损失画质。" },
    { key: "audio", label: "音频文件", type: "file", required: true, filter: AUDIO_FILTER,
      help: "声音来源，可以是 MP3/WAV/AAC 等任意音频，将重编码为 AAC 以保证 MP4 兼容。" },
    { key: "shortest", label: "以最短的为准", type: "switch", flag: "-shortest", default: true,
      help: "开启后，输出时长以两者中较短者为准（音频播完或视频播完即结束）。关闭则按视频长度，音频不足部分静音。" },
    { key: "replace", label: "丢弃视频原声", type: "switch", default: true,
      help: "开启后输出只含新音频；关闭则会同时保留视频原声和新音频（双音轨，播放器可切换）。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "合成结果的保存路径。" }
  ],
  build(v) {
    const a = ["-i", v.video, "-i", v.audio];
    if (v.replace) a.push("-map", "0:v", "-map", "1:a");
    else a.push("-map", "0", "-map", "1:a");
    a.push("-c:v", "copy", "-c:a", "aac", "-b:a", "192k");
    if (v.shortest) a.push("-shortest");
    a.push(v.output);
    return { argv: a };
  }
},
/* ==================== 图像与 GIF ==================== */
{
  id: "gif", group: "图像与 GIF", icon: "🎞️", name: "视频转 GIF",
  desc: "截取视频片段转为动图，可调帧率与宽度",
  tag: "", outExt: "gif",
  params: [
    { key: "input", label: "输入视频", type: "file", required: true, filter: VIDEO_FILTER,
      help: "截取其中一段转换为 GIF 动图。" },
    { key: "start", label: "开始时间", type: "text", flag: "-ss", default: "00:00:00", placeholder: "如 00:00:05",
      help: "GIF 的起始时间点。" },
    { key: "duration", label: "时长", type: "text", flag: "-t", default: "5", placeholder: "秒数，如 5",
      help: "GIF 时长（秒）。<b>建议 3-10 秒</b>，太长的 GIF 体积会非常大。" },
    { key: "fps", label: "帧率", type: "range", flag: "fps=", default: 15, min: 5, max: 30, unit: "fps",
      help: "每秒帧数。15fps 流畅且体积适中；表情包 10fps 够用；追求丝滑可上 25-30fps（体积成倍增长）。" },
    { key: "width", label: "宽度 (px)", type: "number", flag: "scale=", default: 480,
      help: "GIF 宽度，高度等比自动计算。480 适合聊天表情，720 适合文章插图。lanczos 算法保证缩放质量。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "GIF 保存路径。" }
  ],
  build(v) {
    const a = [];
    if (v.start) a.push("-ss", v.start);
    if (v.duration) a.push("-t", v.duration);
    a.push("-i", v.input, "-vf", `fps=${v.fps},scale=${v.width}:-1:flags=lanczos`, "-loop", "0", v.output);
    return { argv: a };
  }
},
{
  id: "screenshot", group: "图像与 GIF", icon: "📸", name: "视频截图",
  desc: "在指定时间点截取一张高清画面",
  tag: "_shot", outExt: "png",
  params: [
    { key: "input", label: "输入视频", type: "file", required: true, filter: VIDEO_FILTER,
      help: "要截图的视频文件。" },
    { key: "time", label: "截图时间点", type: "text", flag: "-ss", default: "00:00:01", placeholder: "如 00:01:23",
      help: "在该时间点截取一帧。-ss 放在 -i 之前，利用关键帧快速定位，大文件也能秒截。" },
    { key: "format", label: "图片格式", type: "radio", default: "png",
      options: [{ value: "png", label: "PNG（无损）" }, { value: "jpg", label: "JPG（小体积）" }],
      help: "PNG 无损画质，适合插图与存档；JPG 体积小，-q:v 2 接近视觉无损。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "图片保存路径。" }
  ],
  build(v) {
    const a = ["-ss", v.time || "00:00:01", "-i", v.input, "-frames:v", "1"];
    if (v.format === "jpg") a.push("-q:v", "2");
    a.push(v.output);
    return { argv: a };
  }
},
/* ==================== 网页视频下载 ==================== */
{
  id: "tsmerge", group: "网页视频下载", icon: "🧩", name: "TS 分片合并",
  desc: "把 001.ts、002.ts… 上百个分片按顺序拼成一个完整 MP4",
  tag: "_merged", outExt: "mp4",
  params: [
    { key: "dir", label: "分片文件夹", type: "dir", required: true,
      placeholder: "选择存放 001.ts / 002.ts 的文件夹",
      help: "选整个文件夹就行，不用一个个挑文件。程序会自动识别分片类型（.ts / .m4s / .mp4 / .flv…），并按文件名里的数字做<b>自然排序</b>——001 → 002 → 010，而不是字典序的 001 → 010 → 002，几百个分片也不会乱序。" },
    { key: "mode", label: "合并模式", type: "radio", default: "copy",
      options: [
        { value: "copy", label: "⚡ 无损拼接（推荐）" },
        { value: "reencode", label: "🔧 重新编码（修复卡顿）" }
      ],
      help: "<b>无损拼接</b>：把码流原样搬运，画质零损失，几百个分片通常几十秒完成；<b>重新编码</b>：当分片时间戳不连续、拼完卡顿/花屏/进度条乱跳时用，会逐帧重编码，慢一些但能重建连续时间戳。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "合并后的 MP4 保存路径，默认按文件夹名自动命名到 outputs 目录。" }
  ],
  scanDir: true,
  needsTsList() { return true; },
  build(v) {
    const list = "{TSLIST}";
    if (v.mode === "reencode") {
      return { argv: ["-f", "concat", "-safe", "0", "-i", list, "-fflags", "+genpts",
                      "-c:v", "libx264", "-crf", "20", "-preset", "medium",
                      "-c:a", "aac", "-b:a", "192k",
                      "-movflags", "+faststart", v.output] };
    }
    return { argv: ["-f", "concat", "-safe", "0", "-i", list, "-c", "copy",
                    "-avoid_negative_ts", "make_zero",
                    "-movflags", "+faststart", v.output] };
  }
},
{
  id: "m3u8dl", group: "网页视频下载", icon: "📥", name: "M3U8 下载",
  desc: "把 m3u8 播放列表（含加密流）直接下载成可播放的 MP4",
  tag: "_download", outExt: "mp4",
  params: [
    { key: "url", label: "播放列表地址", type: "url", required: true,
      placeholder: "https://…/index.m3u8 或本地 .m3u8 文件路径（可多行，每行一个视频）",
      help: "m3u8 是一个<b>文本清单</b>，里面按顺序记录了成百上千个 .ts 分片地址。填进来就相当于让 FFmpeg 照着清单把分片全部下载、按序拼接、封装成 MP4。<br><br>链接可以粘贴多行（每行一个视频），会依次下载并自动加序号；也支持直接选<b>本地的 .m3u8 文件</b>（配合「TS 分片合并」用）。" },
    { key: "quality", label: "清晰度", type: "select", default: "highest",
      options: [
        { value: "highest", label: "最高画质（自动挑最大码率）" },
        { value: "auto", label: "自动（清单里的第一档）" }
      ],
      help: "如果链接是<b>主列表</b>（master，内含 1080P / 720P 多档），这里决定挑哪一档。<b>最高画质</b>会先读取清单、比较各档码率再取最大的那一路；如果你的清单本身只有一个清晰度，这项没有影响。" },
    { key: "mode", label: "处理方式", type: "radio", default: "copy",
      options: [
        { value: "copy", label: "⚡ 原画直存（不重编码）" },
        { value: "reencode", label: "🎯 转 H.264（兼容最好）" }
      ],
      help: "<b>原画直存</b>：分片里的码流直接搬进 MP4，速度只受网速限制，画质无损；<b>转 H.264</b>：有些站点用 HEVC / H.265 编码，部分播放器、剪辑软件、旧设备不认，转成 H.264 后到处能播，代价是要重编码、耗时更长。" },
    { key: "referer", label: "Referer", type: "text", advanced: true,
      placeholder: "如 https://www.example.com/",
      help: "很多网站用<b>防盗链</b>保护视频：只允许从自己站点的页面发起的请求读取分片。<b>直接下载报 403 时先填这个</b>——打开播放该视频的网页，把浏览器地址栏里的<b>协议 + 域名</b>（如 <code>https://www.example.com/</code>）填进来即可。" },
    { key: "cookie", label: "Cookie", type: "text", advanced: true,
      placeholder: "需要登录才给看的视频才填",
      help: "需要登录才能看的视频，把浏览器的 Cookie 整段粘贴进来（F12 → 网络 → 任意请求 → 请求头 → Cookie）。填了就能带上你的登录态去取分片。<b>请只用于你有权访问的内容。</b>" },
    { key: "ua", label: "User-Agent", type: "text", advanced: true, default: DEFAULT_UA,
      help: "伪装成浏览器发出的请求。默认已填 Chrome 的 UA，大多数站点够用；个别平台校验特定的 UA（如手机端），可以改成对应的值。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "下载后的 MP4 保存路径。填了多个链接时，会自动变成 <code>名字_001.mp4</code>、<code>名字_002.mp4</code>。" }
  ],
  needsM3U8: true,
  multiUrl: true,
  build(v) {
    const urls = (v.url || "").split("\n").map(s => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
    if (!urls.length) return { error: "请填写播放列表地址" };
    const a = ["-protocol_whitelist", "file,http,https,tcp,tls,crypto"];
    if (v.ua) a.push("-user_agent", v.ua);
    const hs = [];
    if (v.referer) hs.push("Referer: " + v.referer);
    if (v.cookie) hs.push("Cookie: " + v.cookie);
    if (hs.length) a.push("-headers", hs.join("\r\n") + "\r\n");
    a.push("-allowed_extensions", "ALL");
    a.push("-i", urls[0]);
    if (v.mode === "reencode") {
      a.push("-c:v", "libx264", "-crf", "20", "-preset", "medium",
             "-c:a", "aac", "-b:a", "192k");
    } else {
      a.push("-c", "copy");
    }
    a.push("-movflags", "+faststart", v.output);
    return { argv: a };
  }
},
/* ==================== 组合工具 ==================== */
{
  id: "concat", group: "组合工具", icon: "🔗", name: "视频合并",
  desc: "将多个视频按顺序拼接为一个文件",
  tag: "_merged", outExt: "mp4",
  params: [
    { key: "files", label: "文件列表", type: "filelist", required: true, filter: VIDEO_FILTER,
      help: "每行一个文件路径，按从上到下的顺序合并。可用「添加文件」按钮多选追加。" },
    { key: "mode", label: "合并模式", type: "radio", default: "copy",
      options: [
        { value: "copy", label: "⚡ 无损拼接（同格式）" },
        { value: "reencode", label: "🎯 重编码拼接（跨格式）" }
      ],
      help: "<b>无损拼接</b>：使用 concat demuxer，要求所有文件编码参数完全一致，速度极快无损；<b>重编码拼接</b>：使用 concat 滤镜，支持不同格式/分辨率混拼，但速度慢且要求所有视频都含音轨。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "合并结果的保存路径。" }
  ],
  needsConcatList(v) { return v.mode === "copy"; },
  build(v, listPath) {
    const files = (v.files || "").split("\n").map(s => s.trim()).filter(Boolean);
    if (files.length < 2) return { error: "至少需要 2 个文件才能合并" };
    if (v.mode === "copy") {
      return { argv: ["-f", "concat", "-safe", "0", "-i", listPath || "{LIST}", "-c", "copy", v.output] };
    }
    const a = [];
    files.forEach(f => a.push("-i", f));
    const n = files.length;
    const ins = files.map((_, i) => `[${i}:v][${i}:a]`).join("");
    a.push("-filter_complex", `${ins}concat=n=${n}:v=1:a=1[v][a]`,
           "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-crf", "20", "-c:a", "aac");
    a.push(v.output);
    return { argv: a };
  }
},
{
  id: "probe", group: "组合工具", icon: "🔍", name: "媒体信息查看",
  desc: "用 FFprobe 解析文件的编码、分辨率、时长等元数据",
  tag: "", outExt: "",
  params: [
    { key: "input", label: "媒体文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "调用 ffprobe -show_format -show_streams 解析容器与每条流的详细信息（编码器、分辨率、码率、时长、帧率等），结果以 JSON 形式展示在日志区。" }
  ],
  isProbe: true,
  build() { return { argv: [] }; }
},
/* ==================== 视频处理（增强） ==================== */
{
  id: "enhance", group: "视频处理", icon: "🎨", name: "画面调节",
  desc: "调整亮度、对比度、饱和度与伽马（eq 滤镜）",
  tag: "_enhanced", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "要调色的视频。eq 滤镜是 FFmpeg 最常用的画面校正工具，可修复偏暗、灰蒙蒙、色彩过艳等问题。" },
    { key: "brightness", label: "亮度", type: "range", flag: "brightness", default: 0, min: -1, max: 1, step: 0.05,
      help: "0 为原始亮度，正数提亮、负数压暗。<b>范围 -1 到 1</b>，建议微调 ±0.2 以内，幅度过大容易出现死白或死黑。" },
    { key: "contrast", label: "对比度", type: "range", flag: "contrast", default: 1, min: 0, max: 2, step: 0.05,
      help: "1 为原始对比度，大于 1 反差更强、画面更通透，小于 1 更灰更柔和。配合亮度一起调效果最自然。" },
    { key: "saturation", label: "饱和度", type: "range", flag: "saturation", default: 1, min: 0, max: 3, step: 0.1,
      help: "1 为原始饱和度，0 是黑白，2 以上色彩浓艳。人像建议 0.9-1.1，风景可到 1.3。" },
    { key: "gamma", label: "伽马", type: "range", flag: "gamma", default: 1, min: 0.1, max: 4, step: 0.1, advanced: true,
      help: "影响中间调的明暗分布：大于 1 提亮暗部（保留高光），小于 1 压暗中间调。修偏暗素材比单纯拉亮度更自然。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "调色结果的保存路径，CRF 20 输出保证画质。" }
  ],
  build(v) {
    const f = `eq=brightness=${v.brightness}:contrast=${v.contrast}:saturation=${v.saturation}:gamma=${v.gamma}`;
    return { argv: ["-i", v.input, "-vf", f, "-c:v", "libx264", "-crf", "20", "-c:a", "copy", v.output] };
  }
},
{
  id: "denoise", group: "视频处理", icon: "🧹", name: "降噪 / 去隔行",
  desc: "去除画面噪点、消除隔行扫描的横纹",
  tag: "_clean", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "老片修复、夜间拍摄噪点多的素材、以及电视录制产生的隔行横纹视频。" },
    { key: "denoise", label: "降噪强度", type: "radio", default: "light",
      options: [
        { value: "none", label: "不降噪" },
        { value: "light", label: "轻度 (hqdn3d 4:3:6:4.5)" },
        { value: "strong", label: "强力 (hqdn3d 8:6:12:9)" }
      ],
      help: "hqdn3d 是高质量 3D 降噪器，四个参数分别是亮度/色度的空间与时间降噪强度。<b>降噪越强细节损失越多</b>，动画片可放心用强力，实拍建议轻度。" },
    { key: "deint", label: "去除隔行横纹", type: "switch", flag: "yadif", default: false,
      help: "开启后用 yadif 反交错。仅对<b>隔行扫描</b>素材（老 DVD、电视录制）有效；逐行素材开启反而会损失纵向分辨率。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "处理结果的保存路径。" }
  ],
  build(v) {
    const parts = [];
    if (v.deint) parts.push("yadif");
    if (v.denoise === "light") parts.push("hqdn3d=4:3:6:4.5");
    if (v.denoise === "strong") parts.push("hqdn3d=8:6:12:9");
    const a = ["-i", v.input];
    if (parts.length) a.push("-vf", parts.join(","));
    a.push("-c:v", "libx264", "-crf", "20", "-c:a", "copy", v.output);
    return { argv: a };
  }
},
{
  id: "sharpen", group: "视频处理", icon: "🔎", name: "锐化 / 模糊",
  desc: "提升画面清晰度，或柔化磨皮、局部打码",
  tag: "_sharp", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "锐化适合压缩后变糊的素材；模糊适合做背景虚化、隐私遮挡或柔化皮肤。" },
    { key: "mode", label: "处理方式", type: "radio", default: "unsharp",
      options: [
        { value: "unsharp", label: "锐化 (unsharp)" },
        { value: "blur", label: "模糊 (boxblur)" }
      ],
      help: "unsharp 是反锐化掩模，通过增强边缘对比提升观感清晰度；boxblur 是方框模糊，半径越大越糊。" },
    { key: "amount", label: "锐化强度", type: "range", flag: "unsharp", default: 1.0, min: 0.2, max: 3, step: 0.1,
      help: "1.0 为适中，2 以上边缘会出现白色描边（光晕）。压缩视频建议 0.8-1.5，过高反而显脏。" },
    { key: "radius", label: "模糊半径", type: "range", flag: "boxblur", default: 5, min: 1, max: 20,
      help: "模糊模式下生效，半径 5 轻微柔化，15 以上适合大面积遮挡。第二个参数（幂次）固定为 2。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "处理结果的保存路径。" }
  ],
  build(v) {
    const vf = v.mode === "unsharp" ? `unsharp=5:5:${v.amount}:5:5:0` : `boxblur=${v.radius}:2`;
    return { argv: ["-i", v.input, "-vf", vf, "-c:v", "libx264", "-crf", "19", "-c:a", "copy", v.output] };
  }
},
{
  id: "fps", group: "视频处理", icon: "🎞️", name: "帧率调整",
  desc: "统一帧率，解决音画不同步或播放卡顿",
  tag: "_fps", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "可变帧率（VFR）素材、手机录屏、游戏录像最容易出现音画不同步，统一到固定帧率即可解决。" },
    { key: "fps", label: "目标帧率", type: "select", flag: "fps=", default: "30",
      options: ["24","25","30","50","60","120"],
      help: "电影 24、国内视频 25、网络视频 30、游戏与运动画面 60。<b>降帧会丢画面</b>（但体积变小），升帧只是复制帧不会变流畅。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "处理结果的保存路径。" }
  ],
  build(v) {
    return { argv: ["-i", v.input, "-vf", `fps=${v.fps}`, "-c:v", "libx264", "-crf", "20", "-c:a", "copy", v.output] };
  }
},
{
  id: "reverse", group: "视频处理", icon: "⏪", name: "视频倒放",
  desc: "让视频和音频从尾到头倒着播放",
  tag: "_reverse", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "倒放会把整段视频读入内存后再输出，<b>文件越大越吃内存</b>，建议先剪辑成短片再倒放。" },
    { key: "audio", label: "音频同时倒放", type: "switch", flag: "areverse", default: true,
      help: "开启后音频也倒放（areverse）；关闭则保留正常音频，可能与画面对不上。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "倒放结果的保存路径。" }
  ],
  build(v) {
    const a = ["-i", v.input, "-vf", "reverse"];
    if (v.audio) a.push("-af", "areverse");
    a.push("-c:v", "libx264", "-crf", "18", "-c:a", "aac", v.output);
    return { argv: a };
  }
},
{
  id: "hwaccel", group: "视频处理", icon: "⚡", name: "硬件加速转码",
  desc: "用显卡编码，速度可达 CPU 的数倍",
  tag: "_hw", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "大批量转码、直播录制回压时最有用。显卡编码速度极快，但<b>同码率下画质略逊于 CPU（libx264）</b>。" },
    { key: "encoder", label: "硬件编码器", type: "radio", flag: "-c:v", default: "h264_nvenc",
      options: [
        { value: "h264_nvenc", label: "NVIDIA H.264" },
        { value: "hevc_nvenc", label: "NVIDIA H.265" },
        { value: "h264_qsv", label: "Intel QSV H.264" },
        { value: "hevc_qsv", label: "Intel QSV H.265" },
        { value: "h264_amf", label: "AMD AMF H.264" },
        { value: "hevc_amf", label: "AMD AMF H.265" }
      ],
      help: "按显卡品牌选择：N 卡用 NVENC，Intel 核显用 QSV，A 卡用 AMF。<b>选错会直接报错</b>，日志里会提示 encoder not found 或 device 初始化失败。" },
    { key: "quality", label: "质量参数", type: "range", flag: "cq/global_quality", default: 23, min: 15, max: 40,
      help: "数值越小画质越好、体积越大（含义同 CRF）。NVENC 对应 <b>-cq</b>，QSV 对应 <b>-global_quality</b>，AMF 对应 <b>-qp_i/-qp_p</b>，本工具会按编码器自动切换。" },
    { key: "preset", label: "NVENC 预设", type: "select", flag: "-preset", default: "p5", advanced: true,
      options: ["p1","p3","p5","p7"],
      help: "仅 NVIDIA 生效：p1 最快、p7 最慢但压缩率最高。<b>QSV / AMF 会忽略此参数</b>。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "转码结果的保存路径。" }
  ],
  build(v) {
    const a = ["-i", v.input, "-c:v", v.encoder];
    if (v.encoder.includes("nvenc")) {
      a.push("-preset", v.preset, "-rc", "vbr", "-cq", String(v.quality));
    } else if (v.encoder.includes("qsv")) {
      a.push("-global_quality", String(v.quality));
    } else {
      a.push("-qp_i", String(v.quality), "-qp_p", String(v.quality));
    }
    a.push("-c:a", "aac", "-b:a", "192k", v.output);
    return { argv: a };
  }
},
/* ==================== 字幕与叠加 ==================== */
{
  id: "sub_burn", group: "字幕与叠加", icon: "🅰️", name: "字幕烧录",
  desc: "把 SRT/ASS 字幕压进画面，任何播放器都能显示",
  tag: "_subbed", outExt: "mp4",
  params: [
    { key: "input", label: "视频文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "字幕烧录（hardcode）会把文字变成画面像素，兼容一切播放器与平台，代价是无法再关闭字幕，且必须重新编码。" },
    { key: "sub", label: "字幕文件", type: "file", required: true, filter: "字幕文件|*.srt;*.ass;*.ssa|所有文件 (*.*)|*.*",
      help: "支持 SRT、ASS、SSA。<b>ASS 的自带样式会被覆盖</b>为本工具指定的字号与边距（如需保留原样式请直接用命令行）。" },
    { key: "fontSize", label: "字号 (px)", type: "number", default: 24,
      help: "1080p 视频建议 22-28，4K 建议 40 以上。字号过小在手机上看不清。" },
    { key: "marginV", label: "距底部距离", type: "number", default: 30, advanced: true,
      help: "字幕距画面底部的像素距离，避开播放器进度条区域。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "烧录结果的保存路径。" }
  ],
  build(v) {
    const p = String(v.sub).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
    const style = `FontSize=${v.fontSize},MarginV=${v.marginV}`;
    return { argv: ["-i", v.input, "-vf", `subtitles=filename='${p}':force_style='${style}'`,
      "-c:v", "libx264", "-crf", "20", "-c:a", "copy", v.output] };
  }
},
{
  id: "sub_mux", group: "字幕与叠加", icon: "💬", name: "字幕封装（软字幕）",
  desc: "把字幕作为独立轨道嵌入容器，可随时开关",
  tag: "_submux", outExt: "mp4",
  extMap: ["container", { mp4: "mp4", mkv: "mkv" }],
  params: [
    { key: "input", label: "视频文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "软字幕不改变画面，播放器里可以自由开关。<b>视频流直接复制，不损失画质、速度极快</b>。" },
    { key: "sub", label: "字幕文件", type: "file", required: true, filter: "字幕文件|*.srt;*.ass;*.ssa|所有文件 (*.*)|*.*",
      help: "要嵌入的字幕文件，会作为一条独立字幕轨加入。" },
    { key: "container", label: "输出容器", type: "radio", default: "mp4",
      options: [
        { value: "mp4", label: "MP4（mov_text）" },
        { value: "mkv", label: "MKV（SRT/ASS）" }
      ],
      help: "MP4 只支持 mov_text 文本字幕，会<b>丢失字体与位置样式</b>；MKV 支持 SRT、ASS 甚至图形字幕，样式完整。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "封装结果的保存路径，扩展名会随容器自动切换。" }
  ],
  build(v) {
    const sc = v.container === "mkv" ? "srt" : "mov_text";
    return { argv: ["-i", v.input, "-i", v.sub, "-map", "0", "-map", "1",
      "-c", "copy", "-c:s", sc, v.output] };
  }
},
{
  id: "pip", group: "字幕与叠加", icon: "🖥️", name: "画中画",
  desc: "把一段视频缩小叠加到主视频的角落",
  tag: "_pip", outExt: "mp4",
  params: [
    { key: "main", label: "主视频", type: "file", required: true, filter: VIDEO_FILTER,
      help: "作为背景大画面的视频，其分辨率决定最终输出尺寸。" },
    { key: "pip", label: "画中画视频", type: "file", required: true, filter: VIDEO_FILTER,
      help: "叠加到角落的小画面，例如游戏画面、反应镜头、演示操作。" },
    { key: "pos", label: "叠加位置", type: "radio", default: "br",
      options: [
        { value: "tl", label: "左上" }, { value: "tr", label: "右上" },
        { value: "bl", label: "左下" }, { value: "br", label: "右下" }
      ],
      help: "小画面出现在哪个角落，配合边距微调。" },
    { key: "percent", label: "小画面宽度占比", type: "range", default: 30, min: 10, max: 50, step: 5, unit: "%",
      help: "按<b>画中画源自身宽度</b>的百分比缩放，高度等比。想精确控制到主视频的比例，可先把画中画视频裁成目标尺寸。" },
    { key: "margin", label: "边距 (px)", type: "number", default: 20,
      help: "小画面与画面边缘的距离。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "合成结果的保存路径。" }
  ],
  build(v) {
    const m = Number(v.margin) || 0;
    const posMap = {
      tl: `${m}:${m}`, tr: `W-w-${m}:${m}`,
      bl: `${m}:H-h-${m}`, br: `W-w-${m}:H-h-${m}`
    };
    const fc = `[1:v]scale=iw*${Number(v.percent) / 100}:-1[pip];[0:v][pip]overlay=${posMap[v.pos]}[v]`;
    return { argv: ["-i", v.main, "-i", v.pip, "-filter_complex", fc,
      "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-crf", "20", "-c:a", "copy", v.output] };
  }
},
{
  id: "stack", group: "字幕与叠加", icon: "🀫", name: "双画面拼接",
  desc: "左右或上下并排显示两段视频（对比/合拍）",
  tag: "_stack", outExt: "mp4",
  params: [
    { key: "a", label: "视频 A", type: "file", required: true, filter: VIDEO_FILTER,
      help: "左/上侧画面。两段视频会被<b>各自缩放并补边</b>到统一尺寸，避免拼接时高度不一致报错。" },
    { key: "b", label: "视频 B", type: "file", required: true, filter: VIDEO_FILTER,
      help: "右/下侧画面。建议两段视频时长接近，最终时长以较长者为准（不足部分黑屏）。" },
    { key: "layout", label: "排列方式", type: "radio", flag: "hstack/vstack", default: "h",
      options: [
        { value: "h", label: "左右并排（1280×720）" },
        { value: "v", label: "上下堆叠（1280×720）" }
      ],
      help: "hstack 水平拼接，vstack 垂直堆叠。输出统一为 1280×720，单侧画面 640×720（左右）或 1280×360（上下）。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "拼接结果的保存路径。" }
  ],
  build(v) {
    const w = 640, h = 720;                  // 左右并排时单侧尺寸
    const vw = 1280, vh = 360;               // 上下堆叠时单侧尺寸
    const tw = v.layout === "h" ? w : vw;
    const th = v.layout === "h" ? h : vh;
    const fit = (i) => `[${i}:v]scale=${tw}:${th}:force_original_aspect_ratio=decrease,` +
      `pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2,setsar=1[s${i}]`;
    const fc = `${fit(0)};${fit(1)};[s0][s1]${v.layout === "h" ? "hstack" : "vstack"}=inputs=2[v]`;
    return { argv: ["-i", v.a, "-i", v.b, "-filter_complex", fc,
      "-map", "[v]", "-map", "0:a?", "-c:v", "libx264", "-crf", "20", "-c:a", "aac", v.output] };
  }
},
/* ==================== 音频处理（后期） ==================== */
{
  id: "audio_cut", group: "音频处理", icon: "✂️", name: "音频剪辑",
  desc: "截取音频片段，或从视频中截取一段音轨",
  tag: "_acut", outExt: "mp3",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: AUDIO_FILTER,
      help: "可以是纯音频，也可以是视频（会自动丢弃视频流，只保留音频）。" },
    { key: "start", label: "开始时间", type: "text", flag: "-ss", default: "00:00:00", placeholder: "如 00:01:30",
      help: "截取起始点，支持 HH:MM:SS 或秒数。" },
    { key: "end", label: "结束时间", type: "text", flag: "-to", placeholder: "如 00:03:00（与时长二选一）",
      help: "截取结束点，与「时长」只需填一个。" },
    { key: "duration", label: "时长", type: "text", flag: "-t", placeholder: "如 00:01:30 或 90",
      help: "从开始时间往后的持续时长。" },
    { key: "mode", label: "剪辑模式", type: "radio", default: "copy",
      options: [
        { value: "copy", label: "⚡ 无损复制" },
        { value: "reencode", label: "🎯 重编码" }
      ],
      help: "无损复制速度极快且音质不变，但<b>输出扩展名必须与源编码匹配</b>（源是 AAC 就存 .m4a/.aac）；重编码则统一转为 MP3。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "音频片段的保存路径。" }
  ],
  build(v) {
    const t = [];
    if (v.start) t.push("-ss", v.start);
    if (v.end) t.push("-to", v.end);
    else if (v.duration) t.push("-t", v.duration);
    const a = [...t, "-i", v.input, "-vn"];
    if (v.mode === "copy") a.push("-c:a", "copy");
    else a.push("-c:a", "libmp3lame", "-b:a", "192k");
    a.push(v.output);
    return { argv: a };
  }
},
{
  id: "fade", group: "音频处理", icon: "🌗", name: "音频淡入淡出",
  desc: "首尾音量渐入渐出，接歌接片更自然",
  tag: "_fade", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "视频或音频均可。视频流直接复制不重编码，只处理音频。" },
    { key: "fadeIn", label: "淡入时长 (秒)", type: "number", default: 1,
      help: "从 0 秒开始音量从无到有的时长。0 表示不淡入。" },
    { key: "fadeOut", label: "淡出时长 (秒)", type: "number", default: 1,
      help: "结尾处音量渐弱的时长。" },
    { key: "outStart", label: "淡出开始时间 (秒)", type: "number", default: 8,
      help: "<b>关键参数</b>：淡出从第几秒开始。按你的视频总时长填写，例如 10 秒的视频、淡出 2 秒，这里填 8。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "处理结果的保存路径。" }
  ],
  build(v) {
    const af = [];
    if (Number(v.fadeIn) > 0) af.push(`afade=t=in:st=0:d=${v.fadeIn}`);
    if (Number(v.fadeOut) > 0) af.push(`afade=t=out:st=${v.outStart}:d=${v.fadeOut}`);
    const a = ["-i", v.input];
    if (af.length) a.push("-af", af.join(","));
    a.push("-c:v", "copy", "-c:a", "aac", "-b:a", "192k", v.output);
    return { argv: a };
  }
},
{
  id: "loudnorm", group: "音频处理", icon: "📏", name: "响度标准化",
  desc: "统一到广播级响度，多个视频音量不再忽大忽小",
  tag: "_loud", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "多段素材拼接后音量不一致、投稿平台要求统一响度时使用。使用 EBU R128 标准的 loudnorm 滤镜（单遍模式）。" },
    { key: "target", label: "目标响度", type: "radio", flag: "loudnorm I=", default: "-16",
      options: [
        { value: "-14", label: "-14 LUFS（流媒体）" },
        { value: "-16", label: "-16 LUFS（播客/视频）" },
        { value: "-23", label: "-23 LUFS（广播）" }
      ],
      help: "YouTube/Spotify 用 -14，B 站与多数视频平台用 -16，电视台标准 -23。<b>数值越负整体越轻</b>。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "处理结果的保存路径。" }
  ],
  build(v) {
    return { argv: ["-i", v.input, "-af", `loudnorm=I=${v.target}:TP=-1.5:LRA=11`,
      "-ar", "48000", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", v.output] };
  }
},
{
  id: "resample", group: "音频处理", icon: "🎚️", name: "采样率 / 声道",
  desc: "改变音频采样率与声道数，适配不同播放设备",
  tag: "_resample", outExt: "m4a",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "常见场景：把 48kHz 转成 44.1kHz 刻 CD、把立体声混成单声道减小体积、统一素材参数便于后续剪辑。" },
    { key: "rate", label: "采样率", type: "select", flag: "-ar", default: "48000",
      options: ["8000","22050","44100","48000","96000"],
      help: "每秒采样次数。CD 音质 44100，视频标准 48000，电话/语音 8000-22050。升采样不会提升音质。" },
    { key: "channels", label: "声道", type: "select", flag: "-ac", default: "2",
      options: ["1","2"],
      help: "1 = 单声道（体积小，适合语音），2 = 立体声。立体声转单声道会把左右声道混合。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "处理结果的保存路径（默认 m4a/AAC）。" }
  ],
  build(v) {
    return { argv: ["-i", v.input, "-vn", "-ar", v.rate, "-ac", v.channels,
      "-c:a", "aac", "-b:a", "192k", v.output] };
  }
},
{
  id: "pitch", group: "音频处理", icon: "🎹", name: "男女声变调",
  desc: "升降调而不改变时长（男声变女声、女声变男声）",
  tag: "_pitch", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "通过 asetrate 改变采样率来移调，再用 aresample 与 atempo 把速度拉回原样，实现<b>只变调不变速</b>。" },
    { key: "semi", label: "升降半音", type: "range", flag: "semitones", default: 3, min: -12, max: 12,
      help: "正值升调、负值降调。男声变女声一般 +4 到 +6 个半音，女声变男声 -4 到 -6。每次 1 个半音是一个钢琴键的距离。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "处理结果的保存路径。" }
  ],
  build(v) {
    const n = Number(v.semi);
    const factor = Math.pow(2, n / 12);
    const rate = Math.round(48000 * factor);
    const at = (1 / factor).toFixed(6);
    return { argv: ["-i", v.input, "-af", `asetrate=${rate},aresample=48000,atempo=${at}`,
      "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", v.output] };
  }
},
/* ==================== 组合工具（补充） ==================== */
{
  id: "metadata", group: "组合工具", icon: "🏷️", name: "元数据编辑",
  desc: "修改标题、作者、专辑等信息，或彻底清除元数据",
  tag: "_meta", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "元数据是文件里的「标签」，播放器与系统属性里看到的标题、作者就来自这里。全流程 -c copy 不重编码，秒完成。" },
    { key: "title", label: "标题", type: "text", placeholder: "留空则不修改",
      help: "写入 title 字段，播放器标题栏与资源管理器都会显示。" },
    { key: "artist", label: "作者 / 艺术家", type: "text", placeholder: "留空则不修改",
      help: "写入 artist 字段。" },
    { key: "album", label: "专辑", type: "text", placeholder: "留空则不修改", advanced: true,
      help: "写入 album 字段，音乐文件常用。" },
    { key: "comment", label: "备注", type: "text", placeholder: "留空则不修改", advanced: true,
      help: "写入 comment 字段，可用于写版权说明或来源。" },
    { key: "clear", label: "先清除全部原有元数据", type: "switch", flag: "-map_metadata -1", default: false,
      help: "开启后丢弃源文件的全部元数据（含拍摄设备、GPS、软件信息），<b>适合发布前脱敏</b>，再写入上面填的新值。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "处理结果的保存路径。" }
  ],
  build(v) {
    const a = ["-i", v.input, "-c", "copy"];
    if (v.clear) a.push("-map_metadata", "-1");
    if (v.title) a.push("-metadata", `title=${v.title}`);
    if (v.artist) a.push("-metadata", `artist=${v.artist}`);
    if (v.album) a.push("-metadata", `album=${v.album}`);
    if (v.comment) a.push("-metadata", `comment=${v.comment}`);
    a.push(v.output);
    return { argv: a };
  }
},
{
  id: "frames", group: "组合工具", icon: "🖼️", name: "导出图片序列",
  desc: "按固定间隔抽帧，批量导出 PNG/JPG 图片",
  tag: "_frames", outExt: "png", seq: "%04d",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "用于做缩略图、视频分镜、逐帧分析。输出文件名会自动带序号（如 video_frames_0001.png）。" },
    { key: "start", label: "开始时间", type: "text", flag: "-ss", default: "00:00:00", placeholder: "如 00:00:05",
      help: "从该时间点开始抽帧。" },
    { key: "duration", label: "抽帧时长", type: "text", flag: "-t", placeholder: "留空则整段视频",
      help: "限定抽帧的时间范围，留空表示处理全片。" },
    { key: "fps", label: "抽帧频率", type: "range", flag: "fps=", default: 1, min: 1, max: 30, unit: " 帧/秒",
      help: "每秒抽几帧。1 表示每秒一张（10 秒视频出 10 张），30 则接近逐帧导出，图片数量会暴涨。" },
    { key: "format", label: "图片格式", type: "radio", default: "png",
      options: [{ value: "png", label: "PNG（无损）" }, { value: "jpg", label: "JPG（小体积）" }],
      help: "分镜存档用 PNG，批量预览用 JPG 更省空间。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "图片序列的命名模板，<b>%04d 会被替换为 0001、0002…</b>，请勿删掉序号占位符。" }
  ],
  build(v) {
    const a = [];
    if (v.start) a.push("-ss", v.start);
    if (v.duration) a.push("-t", v.duration);
    a.push("-i", v.input, "-vf", `fps=${v.fps}`, v.output);
    return { argv: a };
  }
},
{
  id: "segment", group: "组合工具", icon: "🧩", name: "视频分段切割",
  desc: "按固定时长自动切成多个小文件",
  tag: "_part", outExt: "mp4", seq: "%03d",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "适合把长视频切成分集、拆分超长录播。采用 stream copy，<b>不重编码、速度快</b>，但切点会落在关键帧上（可能有几秒偏差）。" },
    { key: "seconds", label: "每段时长 (秒)", type: "number", default: 600,
      help: "每段的目标秒数，600 即 10 分钟一段。实际切点受关键帧间隔影响。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "分段命名模板，<b>%03d 会递增为 001、002…</b>，请保留占位符。" }
  ],
  build(v) {
    return { argv: ["-i", v.input, "-c", "copy", "-map", "0", "-f", "segment",
      "-segment_time", String(v.seconds), "-reset_timestamps", "1", v.output] };
  }
},
{
  id: "img2video", group: "组合工具", icon: "🌄", name: "图片转视频",
  desc: "把一张图片（或封面）转成可播放的视频",
  tag: "_imgvid", outExt: "mp4",
  params: [
    { key: "input", label: "图片文件", type: "file", required: true, filter: IMAGE_FILTER,
      help: "常见用途：把海报做成 10 秒视频发平台、给音频配一张封面图、制作静态背景板。" },
    { key: "duration", label: "时长 (秒)", type: "number", default: 10,
      help: "生成的视频长度。" },
    { key: "fps", label: "帧率", type: "select", flag: "-r", default: "30",
      options: ["24","25","30","60"],
      help: "静态图用 30 即可；平台要求 25 或 60 时按需选择。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "视频的保存路径。" }
  ],
  build(v) {
    return { argv: ["-loop", "1", "-i", v.input, "-t", String(v.duration), "-r", v.fps,
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-crf", "20",
      "-pix_fmt", "yuv420p", v.output] };
  }
},
{
  id: "record", group: "组合工具", icon: "⏺️", name: "屏幕录制",
  desc: "录制全屏或指定区域（Windows gdigrab）",
  tag: "_rec", outExt: "mp4",
  params: [
    { key: "region", label: "录制范围", type: "radio", default: "full",
      options: [
        { value: "full", label: "整个屏幕" },
        { value: "area", label: "指定区域" }
      ],
      help: "全屏录制用 desktop 输入；指定区域需要给出左上角坐标与宽高。<b>多显示器时全屏通常只录主屏</b>。" },
    { key: "x", label: "起点 X", type: "number", default: 0, placeholder: "0",
      help: "区域左上角的横坐标（像素）。" },
    { key: "y", label: "起点 Y", type: "number", default: 0, placeholder: "0",
      help: "区域左上角的纵坐标（像素）。" },
    { key: "w", label: "宽度", type: "number", default: 1280, placeholder: "1280",
      help: "录制区域宽度，建议为偶数。" },
    { key: "h", label: "高度", type: "number", default: 720, placeholder: "720",
      help: "录制区域高度，建议为偶数。" },
    { key: "framerate", label: "帧率", type: "select", flag: "-framerate", default: "30",
      options: ["15","24","30","60"],
      help: "屏幕录制 15-30 帧足够；录游戏或动画建议 60。<b>帧率越高文件越大</b>。2K/4K 全屏时若日志里 speed 低于 1.0x，说明编码跟不上采集，可降到 24/15 帧或改用硬件编码。" },
    { key: "encoder", label: "编码器", type: "radio", default: "libx264",
      options: [
        { value: "libx264", label: "CPU (libx264)" },
        { value: "h264_qsv", label: "Intel QSV 硬件" }
      ],
      help: "libx264 兼容性最好，但对 2K/4K 全屏来说 CPU 压力大。<b>Intel QSV</b> 用核显编码，几乎不占 CPU、帧率更稳，适合长时间录制。本机会自动检测是否可用。" },
    { key: "crf", label: "画质 (CRF)", type: "range", default: 23, min: 18, max: 35,
      help: "数值越小画质越好、文件越大。录屏内容以文字为主，<b>23-26</b> 已经足够清晰；录游戏画面可降到 20。" },
    { key: "duration", label: "录制时长 (秒)", type: "text", flag: "-t", placeholder: "留空则手动停止",
      help: "留空则一直录制，直到你点「停止任务」。填了时长就到点自动结束。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      filter: "MP4 视频|*.mp4|MKV 视频（抗中断）|*.mkv|所有文件 (*.*)|*.*",
      help: "录制文件的保存路径。<b>点「停止任务」时 FFmpeg 会先写完文件索引再退出</b>，所以停止后稍等一两秒，等日志出现「文件已正常收尾」再操作文件。如果录的是很长的内容、担心中途崩溃，可以存成 <b>.mkv</b>——它不需要写尾部索引，意外中断也不丢已录部分。" }
  ],
  build(v) {
    const a = ["-f", "gdigrab", "-framerate", v.framerate];
    if (v.region === "area") {
      a.push("-offset_x", String(v.x), "-offset_y", String(v.y),
             "-video_size", `${v.w}x${v.h}`);
    }
    a.push("-i", "desktop");
    if (v.duration) a.push("-t", v.duration);
    if (v.encoder === "h264_qsv") {
      a.push("-c:v", "h264_qsv", "-preset", "veryfast",
             "-global_quality", String(v.crf || 23));
    } else {
      a.push("-c:v", "libx264", "-preset", "ultrafast",
             "-crf", String(v.crf || 23), "-pix_fmt", "yuv420p");
    }
    a.push(v.output);
    return { argv: a };
  }
},

/* ==================== 特效与修复 ==================== */
{
  id: "chromakey", group: "特效与修复", icon: "🟩", name: "色键抠图",
  desc: "把绿幕/蓝幕抠掉，换成图片或视频背景",
  tag: "_keyed", outExt: "mp4",
  params: [
    { key: "input", label: "前景视频（带绿幕）", type: "file", required: true, filter: VIDEO_FILTER,
      help: "要抠像的视频。<b>拍摄要点</b>：幕布要均匀打光、别有褶皱阴影，人物离幕布远一点减少绿色溢色，抠出来边缘才干净。" },
    { key: "bg", label: "背景素材", type: "file", required: true,
      filter: "背景素材|*.png;*.jpg;*.jpeg;*.bmp;*.mp4;*.mov;*.mkv;*.webm|所有文件 (*.*)|*.*",
      help: "抠掉原背景后用来填充的画面。图片会循环静止播放；视频则与前景同步，按 <b>shortest</b> 规则取较短的那个长度。" },
    { key: "bgType", label: "背景素材类型", type: "radio", default: "image",
      options: [{ value: "image", label: "图片（循环静止）" }, { value: "video", label: "视频" }],
      help: "选图片时会自动加 <b>-loop 1</b>，让一张静图铺满整段视频；选视频则当作普通第二路输入。" },
    { key: "color", label: "抠除的颜色", type: "text", default: "0x00FF00", placeholder: "0x00FF00 或 blue",
      help: "要变成透明的颜色。<b>0x00FF00</b> 是纯绿，<b>0x0000FF</b> 是纯蓝。如果幕布不是标准色，用取色器取出十六进制值填进来更准。" },
    { key: "similarity", label: "颜色容差", type: "range", default: 0.12, min: 0.01, max: 0.6, step: 0.01,
      help: "越大判定为「背景色」的范围越宽，抠得越彻底，但人物边缘也会被吃掉。<b>建议 0.08-0.20</b>：边缘残留绿边就调大，人物缺角就调小。" },
    { key: "blend", label: "边缘羽化", type: "range", default: 0.05, min: 0, max: 0.5, step: 0.01,
      help: "抠像边缘的半透明过渡宽度，能让边缘更自然、减少锯齿。<b>0 是硬边</b>，0.05-0.1 比较自然。" },
    { key: "scaleBg", label: "背景缩放铺满画面", type: "switch", default: true,
      help: "背景素材尺寸和前景不一致时，先等比放大再居中裁剪，避免出现黑边或画面比例错位。" },
    { key: "w", label: "输出宽度", type: "number", default: 1920, advanced: true,
      help: "背景缩放的目标宽度，<b>应与前景视频宽度一致</b>（不确定可用「媒体信息查看」查一下）。" },
    { key: "h", label: "输出高度", type: "number", default: 1080, advanced: true,
      help: "背景缩放的目标高度，应与前景视频高度一致。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "合成结果的保存路径。" }
  ],
  build(v) {
    const a = ["-i", v.input];
    if (v.bgType === "image") a.push("-loop", "1", "-i", v.bg);
    else a.push("-i", v.bg);
    const fc = [];
    let bg = "1:v";
    if (v.scaleBg) {
      fc.push(`[1:v]scale=${v.w}:${v.h}:force_original_aspect_ratio=increase,crop=${v.w}:${v.h}[bg]`);
      bg = "bg";
    }
    fc.push(`[0:v]chromakey=${v.color}:${v.similarity}:${v.blend}[ck]`);
    fc.push(`[${bg}][ck]overlay=shortest=1[v]`);
    a.push("-filter_complex", fc.join(";"), "-map", "[v]", "-map", "0:a?",
      "-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-shortest", v.output);
    return { argv: a };
  }
},
{
  id: "lut", group: "特效与修复", icon: "🎨", name: "LUT 调色",
  desc: "套用 .cube 预设，一键电影感调色",
  tag: "_lut", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "要调色的视频。LUT（Look-Up Table）是一张「颜色映射表」，把每个像素的原色查表换成新颜色，是影视调色的标准做法。" },
    { key: "lut", label: "LUT 文件（.cube）", type: "file", required: true,
      filter: "3D LUT|*.cube;*.3dl;*.dat|所有文件 (*.*)|*.*",
      help: "常见的免费 LUT 站点（如 FreshLUTs、IWLTBAP）下载的 <b>.cube</b> 文件即可。注意分辨 <b>Rec.709</b> 与 <b>LOG</b> 版本——LOG 版是给灰片用的，直接套在普通视频上会发灰。" },
    { key: "strength", label: "调色强度", type: "range", default: 100, min: 0, max: 100, unit: "%",
      help: "100% 是完全套用 LUT。觉得太重时往下调，滤镜会用「原图 + 调色图」按比例混合，<b>保留一部分原始色彩</b>。" },
    { key: "interp", label: "插值算法", type: "select", default: "tetrahedral", advanced: true,
      options: [
        { value: "tetrahedral", label: "tetrahedral（推荐）" },
        { value: "trilinear", label: "trilinear（更快）" },
        { value: "prism", label: "prism" }
      ],
      help: "LUT 是离散采样表，像素落在采样点之间需要插值。<b>tetrahedral 精度最好</b>（影视工业标准），trilinear 速度更快但色彩过渡略糙。" },
    { key: "crf", label: "画质 (CRF)", type: "range", default: 18, min: 14, max: 30, advanced: true,
      help: "调色会放大色带和噪点，<b>建议 CRF ≤ 20</b> 以免二次压缩损失细节。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "调色结果的保存路径。" }
  ],
  build(v) {
    const lutExpr = `lut3d=file='${fpath(v.lut)}':interp=${v.interp}`;
    const s = Number(v.strength);
    const a = ["-i", v.input];
    if (s >= 100) {
      a.push("-vf", lutExpr);
    } else {
      const k = (s / 100).toFixed(2), inv = (1 - s / 100).toFixed(2);
      a.push("-filter_complex",
        `[0:v]split[a][b];[b]${lutExpr}[c];[a][c]blend=all_expr='A*${inv}+B*${k}'[v]`,
        "-map", "[v]", "-map", "0:a?");
    }
    a.push("-c:v", "libx264", "-crf", String(v.crf), "-preset", "medium", "-c:a", "copy", v.output);
    return { argv: a };
  }
},
{
  id: "deshake", group: "特效与修复", icon: "📳", name: "视频去抖动",
  desc: "单遍 deshake 抑制手持拍摄的轻微晃动",
  tag: "_deshake", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "手持设备拍摄、画面轻微抖动的视频。<b>deshake 是单遍处理</b>：速度快、无临时文件，但只能消掉小幅高频抖动，大幅晃动建议用「视频稳定（两遍）」。" },
    { key: "strength", label: "搜索强度", type: "radio", default: "medium",
      options: [
        { value: "light", label: "轻微（±16px）" },
        { value: "medium", label: "中等（±32px）" },
        { value: "strong", label: "强（±64px）" },
        { value: "insane", label: "极强（±128px）" }
      ],
      help: "每帧在多大范围内搜索匹配块。<b>范围越大能纠正的位移越大</b>，但计算量按面积增长，且可能把真实镜头运动误判为抖动。手机随手拍用「中等」即可。" },
    { key: "edge", label: "边缘填充方式", type: "select", default: "mirror",
      options: [
        { value: "mirror", label: "mirror（镜像延伸）" },
        { value: "clamp", label: "clamp（拉伸边缘）" },
        { value: "blank", label: "blank（黑边）" }
      ],
      help: "画面被平移后四周会露出空隙。<b>mirror</b> 最自然无痕迹；clamp 会把边缘像素拉伸；blank 直接黑边（最保守但难看）。" },
    { key: "blocksize", label: "匹配块大小", type: "select", default: "8", advanced: true,
      options: ["4", "8", "16"],
      help: "运动估计的块尺寸。小块对细节运动更敏感但噪声多，大块更稳但精度低。默认 8 是通用值。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "处理结果的保存路径。" }
  ],
  build(v) {
    const r = { light: 16, medium: 32, strong: 64, insane: 128 }[v.strength];
    return { argv: ["-i", v.input,
      "-vf", `deshake=rx=${r}:ry=${r}:edge=${v.edge}:blocksize=${v.blocksize}`,
      "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-c:a", "copy", v.output] };
  }
},
{
  id: "stabilize", group: "特效与修复", icon: "🎯", name: "视频稳定（两遍）",
  desc: "vidstab 先分析再补偿，效果远超单遍去抖",
  tag: "_stable", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "需要稳定的视频。<b>这是两遍处理</b>：第 1 遍只分析抖动轨迹（很快、不输出画面），第 2 遍按轨迹反向补偿并编码。总耗时约为单遍的 1.5 倍。" },
    { key: "shakiness", label: "抖动程度", type: "range", default: 5, min: 1, max: 10,
      help: "告诉算法画面有多抖。<b>1=几乎不抖，5=普通手持，10=剧烈晃动</b>。填小了纠正不足，填大了会过度矫正导致画面漂移。" },
    { key: "accuracy", label: "检测精度", type: "range", default: 9, min: 1, max: 15,
      help: "第 1 遍的运动搜索精度。数值越大越准但分析越慢，<b>9 是官方推荐值</b>，素材差可提到 15。" },
    { key: "smoothing", label: "平滑窗口", type: "range", default: 10, min: 1, max: 30,
      help: "用多少帧来计算平滑后的相机路径，实际窗口是 <b>2×值+1</b> 帧。越大越稳越「像摇臂」，但大于 30 会出现画面滞后感。" },
    { key: "zoom", label: "放大补偿", type: "range", default: 5, min: 0, max: 20, unit: "%",
      help: "补偿平移后会露出黑边，需要放大画面裁掉。<b>5% 适合大多数素材</b>；抖动特别大时调到 10-15，注意画质会略有损失（放大后重采样）。" },
    { key: "optzoom", label: "自动缩放", type: "select", default: "1", advanced: true,
      options: [
        { value: "0", label: "关闭（用上面的固定值）" },
        { value: "1", label: "静态最优（推荐）" },
        { value: "2", label: "动态最优（画面会轻微呼吸）" }
      ],
      help: "让算法自己算需要放大多少。静态最优取全程最小值、画面稳定；动态最优随抖动变化，更省画幅但会有轻微缩放呼吸感。" },
    { key: "sharpen", label: "补偿锐化", type: "switch", default: true, advanced: true,
      help: "稳定后的画面经过重采样会略微变糊，官方建议叠加 <b>unsharp</b> 恢复锐度，默认开启。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "稳定后视频的保存路径。中间轨迹文件会存到 outputs 目录（_vidstab_*.trf）。" }
  ],
  build(v) {
    const trf = `${OUTPUT_DIR}\\${"_vidstab_" + stem(v.input)}.trf`;
    const trfEsc = fpath(trf);
    const pass1 = ["-i", v.input,
      "-vf", `vidstabdetect=shakiness=${v.shakiness}:accuracy=${v.accuracy}:result='${trfEsc}'`,
      "-f", "null", "-"];
    let chain = `vidstabtransform=input='${trfEsc}':smoothing=${v.smoothing}:zoom=${v.zoom}:optzoom=${v.optzoom}:interpol=bicubic`;
    if (v.sharpen) chain += ",unsharp=5:5:0.8:3:3:0.4";
    const pass2 = ["-i", v.input, "-vf", chain,
      "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-c:a", "copy", v.output];
    return { steps: [
      { argv: pass1, note: "第 1 遍 · 逐帧分析抖动轨迹（不产生视频）" },
      { argv: pass2, note: "第 2 遍 · 按轨迹反向补偿、缩放裁边并编码" }
    ] };
  }
},
{
  id: "interp", group: "特效与修复", icon: "⏩", name: "视频补帧",
  desc: "运动补偿插帧，把 24/30 帧提升到 60/120 帧",
  tag: "_interp", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "需要提升流畅度的视频。原理是在相邻两帧之间<b>计算运动矢量并生成中间帧</b>，不是简单复制帧，所以慢动作和运镜会明显顺滑。" },
    { key: "fps", label: "目标帧率", type: "select", default: "60",
      options: ["30", "48", "60", "90", "120"],
      help: "输出帧率。24→60 观感提升最明显；<b>超过 60 帧收益递减且体积暴涨</b>，除非要做慢动作升格。" },
    { key: "mode", label: "插帧模式", type: "radio", default: "mci",
      options: [
        { value: "blend", label: "快速混合（快）" },
        { value: "mci", label: "运动补偿（标准）" },
        { value: "mci_hq", label: "运动补偿 + 场景检测（最佳）" }
      ],
      help: "<b>混合</b>只是把前后帧加权叠一起，速度快但快速运动会有重影；<b>运动补偿</b>会追踪物体轨迹生成真实中间帧，效果好但慢得多；<b>+场景检测</b>可避免镜头切换处生成鬼影。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "补帧结果的保存路径。<b>补帧非常吃 CPU</b>，1080p 一分钟素材可能需要几分钟到十几分钟。" }
  ],
  build(v) {
    let f = `minterpolate=fps=${v.fps}`;
    if (v.mode === "blend") f += ":mi_mode=blend";
    else if (v.mode === "mci") f += ":mi_mode=mci:mc_mode=obmc:me_mode=bidir:vsbmc=0";
    else f += ":mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=fdiff";
    return { argv: ["-i", v.input, "-vf", f,
      "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-c:a", "copy", v.output] };
  }
},
{
  id: "motionblur", group: "特效与修复", icon: "💫", name: "动态模糊",
  desc: "帧混合制造运动拖影，或让画面更柔和",
  tag: "_blur", outExt: "mp4",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "合成「运动模糊」的常用场景：给动画/游戏录屏加真实感、给 PPT 转场做柔和过渡、做残影特效。" },
    { key: "mode", label: "模糊方式", type: "radio", default: "blur",
      options: [
        { value: "blur", label: "三角权重（柔和）" },
        { value: "trail", label: "等权叠加（残影拖尾）" }
      ],
      help: "<b>三角权重</b>让最新的帧权重最高、越旧越淡，接近真实相机长曝光的拖影；<b>等权叠加</b>每帧权重相同，会出现明显的多重残影（适合赛博/故障风）。" },
    { key: "frames", label: "混合帧数", type: "range", default: 5, min: 2, max: 20,
      help: "同时参与混合的帧数，<b>等价于「快门时间」</b>。3-5 是自然动态模糊，8 以上开始明显拖尾，20 帧几乎完全糊成一片。" },
    { key: "crf", label: "画质 (CRF)", type: "range", default: 20, min: 15, max: 30, advanced: true,
      help: "帧混合会引入大量细碎纹理，压缩效率变低，建议 CRF 不超过 22。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "处理结果的保存路径。" }
  ],
  build(v) {
    const n = Number(v.frames);
    let f;
    if (v.mode === "trail") {
      f = `tmix=frames=${n}`;
    } else {
      const w = [];
      for (let i = 0; i < n; i++) w.push(String(1 + Math.min(i, n - 1 - i)));
      f = `tmix=frames=${n}:weights='${w.join(" ")}'`;
    }
    return { argv: ["-i", v.input, "-vf", f,
      "-c:v", "libx264", "-crf", String(v.crf), "-preset", "medium", "-c:a", "copy", v.output] };
  }
},

/* ==================== 专业编码与流媒体 ==================== */
{
  id: "av1", group: "专业编码与流媒体", icon: "🅰️", name: "AV1 编码",
  desc: "下一代开源编码，同画质比 H.265 再省 30% 体积",
  tag: "_av1", outExt: "mkv", extMap: ["container", { mkv: "mkv", mp4: "mp4", webm: "webm" }],
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "要转成 AV1 的视频。AV1 免专利、压缩率最高，<b>缺点是编码慢且部分老设备/播放器不支持</b>（B 站、YouTube 已全面支持）。" },
    { key: "encoder", label: "编码器", type: "radio", default: "libsvtav1",
      options: [
        { value: "libsvtav1", label: "SVT-AV1（推荐）" },
        { value: "libaom-av1", label: "libaom（参考实现）" },
        { value: "librav1e", label: "rav1e（Rust）" }
      ],
      help: "<b>SVT-AV1</b> 是 Intel/Netflix 联合开发，速度是 libaom 的数十倍，质量接近，日常首选；<b>libaom</b> 是 AOMedia 官方实现，最慢但极限压缩略好；<b>rav1e</b> 是 Rust 实现，速度居中、内存占用低。" },
    { key: "speed", label: "速度档位", type: "select", default: "2",
      options: [
        { value: "0", label: "极速（画质最低）" },
        { value: "1", label: "快速" },
        { value: "2", label: "均衡（推荐）" },
        { value: "3", label: "慢速" },
        { value: "4", label: "极致（数倍耗时）" }
      ],
      help: "编码速度与压缩率的权衡。<b>AV1 的档位差距极其夸张</b>：从极速到极致，同一素材耗时可能相差 10 倍以上，体积只小 10-20%。先用「均衡」试水。" },
    { key: "crf", label: "质量 (CRF)", type: "range", default: 32, min: 0, max: 63,
      help: "AV1 的 CRF 范围是 <b>0-63</b>（比 x264 的 0-51 宽）。<b>数值越小画质越高</b>：28 接近视觉无损，32 是默认平衡点，40 以上明显糊。" },
    { key: "container", label: "容器格式", type: "radio", default: "mkv",
      options: [
        { value: "mkv", label: "MKV（兼容最好）" },
        { value: "mp4", label: "MP4" },
        { value: "webm", label: "WebM（网页）" }
      ],
      help: "AV1 在三种容器里都能放。<b>MKV</b> 容错性最好、支持多音轨字幕；<b>MP4</b> 适合苹果/移动端；<b>WebM</b> 是网页 <video> 标签的原生格式。" },
    { key: "tenbit", label: "10-bit 色深", type: "switch", default: false, advanced: true,
      help: "10-bit 能显著减少渐变场景的色带，<b>但兼容性会下降</b>（部分老播放器黑屏），且编码更慢。普通视频保持关闭即可。" },
    { key: "acodec", label: "音频编码", type: "radio", default: "copy",
      options: [
        { value: "copy", label: "copy（保留原音频）" },
        { value: "libopus", label: "Opus" },
        { value: "aac", label: "AAC" }
      ],
      help: "AV1 视频配 <b>Opus</b> 是 WebM/流媒体的标准组合；MP4 容器建议 AAC 或直接 copy。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "AV1 文件的保存路径，扩展名会随容器自动切换。" }
  ],
  build(v) {
    const idx = Number(v.speed) || 0;
    const a = ["-i", v.input, "-c:v", v.encoder];
    if (v.encoder === "libsvtav1") {
      a.push("-preset", String([13, 11, 8, 6, 4][idx]));
    } else if (v.encoder === "libaom-av1") {
      a.push("-cpu-used", String([8, 6, 4, 2, 0][idx]), "-row-mt", "1", "-b:v", "0");
    } else {
      a.push("-speed", String([10, 8, 6, 4, 2][idx]));
    }
    a.push("-crf", String(v.crf));
    if (v.tenbit) a.push("-pix_fmt", "yuv420p10le");
    if (v.acodec === "copy") a.push("-c:a", "copy");
    else if (v.acodec === "libopus") a.push("-c:a", "libopus", "-b:a", "128k");
    else a.push("-c:a", "aac", "-b:a", "160k");
    a.push(v.output);
    return { argv: a };
  }
},
{
  id: "prores", group: "专业编码与流媒体", icon: "🎬", name: "ProRes 编码",
  desc: "剪辑软件友好的中间格式，Premiere/达芬奇直接拖",
  tag: "_prores", outExt: "mov",
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "要转成 ProRes 的视频。ProRes 是苹果的<b>帧内压缩</b>编码，每一帧独立解码，所以剪辑软件拖时间线几乎不卡——代价是体积很大（约为原片的 5-20 倍）。" },
    { key: "profile", label: "ProRes 档次", type: "select", default: "3",
      options: [
        { value: "0", label: "Proxy（代理，体积最小）" },
        { value: "1", label: "LT（轻量）" },
        { value: "2", label: "Standard（标准）" },
        { value: "3", label: "HQ（高质量，推荐）" },
        { value: "4", label: "4444（带 Alpha 透明）" },
        { value: "5", label: "4444 XQ（最高质量）" }
      ],
      help: "<b>HQ</b> 是影视交付的默认档，画质与体积平衡最好；<b>Proxy</b> 适合低配电脑剪辑时当代理素材；<b>4444</b> 带 Alpha 通道，用于需要透明的合成输出。" },
    { key: "audio", label: "音频编码", type: "radio", default: "pcm",
      options: [
        { value: "pcm", label: "PCM 16bit（剪辑标准）" },
        { value: "copy", label: "copy（保留原音频）" },
        { value: "none", label: "不要音频" }
      ],
      help: "剪辑流程统一用 <b>PCM 无损</b>，避免二次压缩；仅做转封装时可选 copy。" },
    { key: "output", label: "输出文件", type: "savefile", required: true, flag: "输出",
      help: "ProRes 文件的保存路径，固定为 .mov 容器。<b>注意预留磁盘空间</b>：1080p HQ 约 220 Mbps，10 分钟就近 16 GB。" }
  ],
  build(v) {
    const p = String(v.profile);
    const alpha = (p === "4" || p === "5");
    const a = ["-i", v.input, "-c:v", "prores_ks", "-profile:v", p,
      "-pix_fmt", alpha ? "yuva444p10le" : "yuv422p10le", "-vendor", "apl0"];
    if (v.audio === "pcm") a.push("-c:a", "pcm_s16le");
    else if (v.audio === "none") a.push("-an");
    else a.push("-c:a", "copy");
    a.push(v.output);
    return { argv: a };
  }
},
{
  id: "streaming", group: "专业编码与流媒体", icon: "📡", name: "HLS / DASH 切片",
  desc: "生成流媒体播放列表与分片，可挂到 Web 服务器点播",
  tag: "_stream", outExt: "m3u8", extMap: ["mode", { hls: "m3u8", dash: "mpd" }],
  params: [
    { key: "input", label: "输入文件", type: "file", required: true, filter: VIDEO_FILTER,
      help: "要切片成流媒体的视频。切片后由<b>一个播放列表文件</b>（.m3u8 / .mpd）+ <b>一堆小分片</b>（.ts / .m4s）组成，播放器按需加载分片，实现边下边播和清晰度切换。" },
    { key: "mode", label: "协议", type: "radio", default: "hls",
      options: [
        { value: "hls", label: "HLS（苹果 / 通用）" },
        { value: "dash", label: "DASH（MPEG 标准）" }
      ],
      help: "<b>HLS</b> 兼容性最好（iOS、Safari、智能电视、VLC 全支持），用 .ts 分片；<b>DASH</b> 是开放标准，用 .m4s 分片、码率切换更灵活，但要浏览器支持 MSE。" },
    { key: "segTime", label: "分片时长 (秒)", type: "number", default: 6,
      help: "每个分片多长。<b>HLS 官方建议 6 秒</b>（苹果要求 ≤10）；切片越短首屏越快、请求越多，直播场景常用 2-4 秒。" },
    { key: "encode", label: "编码方式", type: "radio", default: "reencode",
      options: [
        { value: "reencode", label: "重新编码 H.264（通用）" },
        { value: "copy", label: "直接复制（快，需源为 H.264）" }
      ],
      help: "<b>重新编码</b>兼容所有源，且能强制关键帧对齐分片边界；<b>直接复制</b>秒完成，但要求源视频本来就是 H.264+AAC，否则播放器可能报错。" },
    { key: "crf", label: "画质 (CRF)", type: "range", default: 20, min: 15, max: 30, advanced: true,
      help: "仅重新编码时生效。流媒体建议 20-23，兼顾画质与码率。" },
    { key: "output", label: "播放列表文件", type: "savefile", required: true, flag: "输出",
      help: "生成的 <b>.m3u8 / .mpd 播放列表</b>路径。分片会自动输出到<b>同目录</b>，文件名以它为前缀（如 视频_stream_seg_000.ts）。" }
  ],
  build(v) {
    const a = ["-i", v.input];
    if (v.encode === "copy") {
      a.push("-c", "copy");
    } else {
      a.push("-c:v", "libx264", "-crf", String(v.crf), "-preset", "veryfast",
             "-g", "60", "-keyint_min", "60", "-sc_threshold", "0",
             "-c:a", "aac", "-b:a", "128k");
    }
    const dir = dirname(v.output);
    const base = stem(v.output);
    if (v.mode === "hls") {
      a.push("-f", "hls", "-hls_time", String(v.segTime), "-hls_playlist_type", "vod",
             "-hls_segment_filename", `${dir}/${base}_seg_%03d.ts`, v.output);
    } else {
      a.push("-f", "dash", "-seg_duration", String(v.segTime),
             "-use_template", "1", "-use_timeline", "1",
             "-init_seg_name", `${base}_init_$RepresentationID$.m4s`,
             "-media_seg_name", `${base}_$RepresentationID$_$Number$.m4s`,
             v.output);
    }
    return { argv: a };
  }
}
];

/* ---------------- 工具函数 ---------------- */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function q(arg) {
  // 展示用引号
  return /[\s"&|<>()]/.test(arg) ? `"${arg}"` : arg;
}

function stem(p) {
  const base = p.split(/[\\/]/).pop() || "output";
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(0, i) : base;
}

/** 从路径 / URL / 文件夹里推一个像样的名字：index.m3u8 → 用它的文件夹名 */
const GENERIC_NAMES = ["index", "playlist", "master", "main", "video", "movie",
                       "media", "hls", "prog_index", "chunklist", "manifest"];
function smartStem(p) {
  const raw = String(p || "").replace(/^"|"$/g, "").replace(/[?#].*$/, "");
  let name = "";
  if (/^[a-z]+:\/\//i.test(raw)) {
    const m = raw.match(/^[a-z]+:\/\/([^/]+)(\/.*)?$/i);
    const host = (m ? m[1] : "").replace(/:\d+$/, "").replace(/^www\./i, "");
    const segs = (m && m[2] ? m[2] : "").split("/").filter(Boolean);
    name = segs.length ? stem(segs[segs.length - 1]) : "";
    if (!name || GENERIC_NAMES.includes(name.toLowerCase())) {
      const parent = segs.length >= 2 ? segs[segs.length - 2] : "";
      name = parent || host;
    }
    if (/^\d+\.\d+\.\d+\.\d+$/.test(name) || /localhost/i.test(name)) name = "video";
  } else {
    const parts = raw.split(/[\\/]/).filter(Boolean);
    const base = parts[parts.length - 1] || "";
    name = base ? stem(base) : "";
    if (!name || GENERIC_NAMES.includes(name.toLowerCase())) {
      name = parts.length >= 2 ? parts[parts.length - 2] : "";
    }
  }
  return name || "video";
}

function dirname(p) {
  const s = String(p).replace(/\\/g, "/");
  const i = s.lastIndexOf("/");
  return i > 0 ? s.slice(0, i) : ".";
}

/** 滤镜字符串内的 Windows 路径：D:\a\b.cube → D\:/a/b.cube（外层需再加单引号） */
function fpath(p) {
  return String(p).trim().replace(/^"|"$/g, "").replace(/\\/g, "/").replace(/:/g, "\\:");
}

/** 把 build() 的返回值统一成步骤数组，兼容单条命令与多遍处理 */
function normalizeSteps(r) {
  if (!r || r.error) return [];
  if (Array.isArray(r.steps)) return r.steps.filter(s => s && Array.isArray(s.argv) && s.argv.length);
  if (Array.isArray(r.argv) && r.argv.length) return [{ argv: r.argv }];
  return [];
}

/** 生成的输出扩展名（跟随容器等联动） */
function extFor(f, v) {
  if (!f.extMap) return null;
  const [key, map] = f.extMap;
  const val = typeof v === "object" ? v[key] : v;
  return map[val] || null;
}

function genOutput(feature, inputPath, extOverride) {
  const ext = extOverride || feature.outExt;
  if (!ext) return "";
  const name = inputPath ? smartStem(inputPath) : "output";
  if (feature.seq) {
    // 序列类输出：name_0001.png / name_001.mp4
    return `${OUTPUT_DIR}\\${name}${feature.tag}_${feature.seq}.${ext}`;
  }
  return `${OUTPUT_DIR}\\${name}${feature.tag}.${ext}`;
}

function highlightCmd(text) {
  return esc(text).split(" ").map(tok => {
    if (/^-/.test(tok)) return `<span class="cmd-flag">${tok}</span>`;
    if (/^[A-Za-z]:[\\/"]/.test(tok) || /\.(mp4|mkv|avi|mov|webm|mp3|aac|wav|flac|gif|png|jpg|txt)"?$/.test(tok))
      return `<span class="cmd-path">${tok}</span>`;
    return tok;
  }).join(" ");
}

/* ---------------- 导航渲染 ---------------- */
const GROUP_ORDER = ["视频处理", "音频处理", "特效与修复", "字幕与叠加", "图像与 GIF", "网页视频下载", "专业编码与流媒体", "组合工具"];

function renderNav(filter = "") {
  const nav = $("#feature-nav");
  nav.innerHTML = "";
  const groups = {};
  FEATURES.forEach(f => {
    if (filter && !f.name.includes(filter) && !f.desc.includes(filter)) return;
    (groups[f.group] = groups[f.group] || []).push(f);
  });
  const ordered = Object.keys(groups).sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  ordered.forEach(g => {
    const items = groups[g];
    const gd = document.createElement("div");
    gd.className = "nav-group";
    gd.innerHTML = `<div class="nav-group-title">${esc(g)}</div>`;
    items.forEach(f => {
      const el = document.createElement("div");
      el.className = "nav-item" + (currentFeature && currentFeature.id === f.id ? " active" : "");
      el.innerHTML = `<span class="ni-icon">${f.icon}</span><span>${esc(f.name)}</span>`;
      el.onclick = () => selectFeature(f.id);
      gd.appendChild(el);
    });
    nav.appendChild(gd);
  });
}

/* ---------------- 参数控件渲染 ---------------- */
function buildControl(f, p) {
  const wrap = document.createElement("div");
  const id = `${f.id}.${p.key}`;
  if (p.type === "file") {
    wrap.innerHTML = `
      <div class="file-input-group">
        <input type="text" data-key="${p.key}" placeholder="${esc(p.placeholder || '文件路径…')}" ${p.required ? 'data-required="1"' : ""}>
        <button class="btn btn-mini btn-browse" data-filter="${esc(p.filter || '所有文件 (*.*)|*.*')}">浏览…</button>
      </div>`;
  } else if (p.type === "savefile") {
    wrap.innerHTML = `
      <div class="file-input-group">
        <input type="text" data-key="${p.key}" data-output="1" placeholder="${esc(p.placeholder || '输出路径…（留空自动生成）')}">
        <button class="btn btn-mini btn-save" data-filter="${esc(p.filter || '所有文件 (*.*)|*.*')}">浏览…</button>
      </div>`;
  } else if (p.type === "dir") {
    wrap.innerHTML = `
      <div class="file-input-group">
        <input type="text" data-key="${p.key}" placeholder="${esc(p.placeholder || '文件夹路径…')}" ${p.required ? 'data-required="1"' : ""}>
        <button class="btn btn-mini btn-browse-dir">📁 选择文件夹</button>
      </div>
      <div class="param-note" data-note="${p.key}"></div>`;
  } else if (p.type === "url") {
    wrap.innerHTML = `
      <textarea data-key="${p.key}" rows="3" placeholder="${esc(p.placeholder || '')}"></textarea>
      <div class="ctl-actions">
        <button class="btn btn-mini btn-pick-m3u8" data-filter="${esc(p.filter || M3U8_FILTER)}">选择本地 m3u8</button>
        <button class="btn btn-mini btn-m3u8-check">🔍 检测播放列表</button>
      </div>
      <div class="param-note" data-note="${p.key}"></div>`;
  } else if (p.type === "filelist") {
    wrap.innerHTML = `
      <textarea data-key="${p.key}" placeholder="每行一个文件路径，按顺序合并"></textarea>
      <div style="margin-top:6px"><button class="btn btn-mini btn-browse-multi" data-filter="${esc(p.filter || '')}">＋ 添加文件（可多选）</button></div>`;
  } else if (p.type === "select") {
    const opts = p.dynamic === "fonts"
      ? FONT_LIST.map(x => ({ value: x.key, label: x.label }))
      : p.options;
    wrap.innerHTML = `<select data-key="${p.key}">${opts.map(o => {
      const v = typeof o === "object" ? o.value : o, l = typeof o === "object" ? o.label : o;
      return `<option value="${esc(v)}" ${v === p.default ? "selected" : ""}>${esc(l)}</option>`;
    }).join("")}</select>`;
  } else if (p.type === "color") {
    const init = p.default || "#ffffff";
    wrap.innerHTML = `<div class="color-wrap">
      <input type="color" data-key="${p.key}" value="${init}">
      <span class="color-hex">${init.toUpperCase()}</span>
    </div>`;
  } else if (p.type === "radio") {
    wrap.innerHTML = `<div class="radio-cards" data-key="${p.key}">${p.options.map(o =>
      `<span class="radio-card ${o.value === p.default ? "checked" : ""}" data-value="${esc(o.value)}">${esc(o.label)}</span>`
    ).join("")}</div>`;
  } else if (p.type === "switch") {
    wrap.innerHTML = `<div class="switch-row">
      <label class="switch"><input type="checkbox" data-key="${p.key}" ${p.default ? "checked" : ""}><span class="slider"></span></label>
      <span class="switch-state">${p.default ? "开启" : "关闭"}</span></div>`;
  } else if (p.type === "range") {
    wrap.innerHTML = `<div class="range-wrap">
      <input type="range" data-key="${p.key}" min="${p.min}" max="${p.max}" step="${p.step || 1}" value="${p.default}">
      <span class="range-val">${p.default}${p.unit || ""}</span></div>`;
  } else if (p.type === "number") {
    wrap.innerHTML = `<input type="number" data-key="${p.key}" value="${p.default ?? ""}" placeholder="${esc(p.placeholder || "")}">`;
  } else if (p.multiline) {
    wrap.innerHTML = `<textarea class="text-plain" data-key="${p.key}" rows="2" placeholder="${esc(p.placeholder || "")}">${esc(p.default ?? "")}</textarea>`;
  } else {
    wrap.innerHTML = `<input type="text" data-key="${p.key}" value="${p.default ?? ""}" placeholder="${esc(p.placeholder || "")}">`;
  }
  return wrap;
}

function renderParams(f) {
  const panel = $("#params-panel");
  panel.innerHTML = "";
  Object.keys(paramRefs).forEach(k => delete paramRefs[k]);

  const basic = f.params.filter(p => !p.advanced);
  const adv = f.params.filter(p => p.advanced);

  const mkSection = (title, icon, params, collapsed) => {
    if (!params.length) return;
    const sec = document.createElement("div");
    sec.className = "param-section" + (collapsed ? " collapsed" : "");
    sec.innerHTML = `<div class="param-section-head"><h3>${icon} ${title}</h3><span class="sec-arrow">▾</span></div>
                     <div class="param-section-body"></div>`;
    sec.querySelector(".param-section-head").onclick = () => sec.classList.toggle("collapsed");
    const body = sec.querySelector(".param-section-body");
    params.forEach(p => {
      const row = document.createElement("div");
      row.className = "param-row";
      row.innerHTML = `
        <div class="param-label">
          <div class="pl-name">${esc(p.label)}${p.required ? '<span class="required">*</span>' : ""}</div>
          ${p.flag ? `<span class="pl-flag">${esc(p.flag)}</span>` : ""}
          ${p.help ? `<button class="help-toggle">💡 说明 <span>▸</span></button>` : ""}
        </div>
        <div class="param-control"></div>`;
      row.querySelector(".param-control").appendChild(buildControl(f, p));
      if (p.help) {
        const hb = document.createElement("div");
        hb.className = "help-box";
        hb.innerHTML = p.help;
        row.querySelector(".param-control").appendChild(hb);
        const tg = row.querySelector(".help-toggle");
        tg.onclick = () => {
          hb.classList.toggle("open");
          tg.querySelector("span").textContent = hb.classList.contains("open") ? "▾" : "▸";
        };
      }
      body.appendChild(row);
    });
    panel.appendChild(sec);
  };

  mkSection("基本参数", "⚙️", basic, false);
  mkSection("高级参数（可选）", "🔧", adv, true);

  // 收集引用并绑定事件
  panel.querySelectorAll("[data-key]").forEach(el => {
    const key = el.dataset.key;
    paramRefs[key] = el.closest(".radio-cards") || el;
    el.addEventListener("input", onParamChange);
    el.addEventListener("change", onParamChange);
  });

  // 颜色控件：色块变化时同步旁边的十六进制值
  panel.querySelectorAll('input[type="color"]').forEach(inp => {
    const hex = inp.closest(".color-wrap") && inp.closest(".color-wrap").querySelector(".color-hex");
    if (hex) inp.addEventListener("input", () => { hex.textContent = inp.value.toUpperCase(); });
  });

  // 单文件浏览
  panel.querySelectorAll(".btn-browse").forEach(btn => {
    btn.onclick = async () => {
      const r = await browseDialog({ mode: "open", filter: btn.dataset.filter });
      if (r && r.paths.length) {
        const inp = btn.closest(".file-input-group").querySelector("input");
        inp.value = r.paths[0];
        inp.dispatchEvent(new Event("input"));
      }
    };
  });
  // 保存路径浏览
  panel.querySelectorAll(".btn-save").forEach(btn => {
    btn.onclick = async () => {
      const inp = btn.closest(".file-input-group").querySelector("input");
      const r = await browseDialog({ mode: "save", filter: btn.dataset.filter });
      if (r && r.paths.length) {
        inp.value = r.paths[0];
        outputDirty[currentFeature.id] = true;
        inp.dispatchEvent(new Event("input"));
      }
    };
  });
  // 多选追加
  panel.querySelectorAll(".btn-browse-multi").forEach(btn => {
    btn.onclick = async () => {
      const r = await browseDialog({ mode: "open", multi: true, filter: btn.dataset.filter });
      if (r && r.paths.length) {
        const ta = panel.querySelector("textarea");
        ta.value = (ta.value ? ta.value.replace(/\n+$/, "") + "\n" : "") + r.paths.join("\n");
        ta.dispatchEvent(new Event("input"));
      }
    };
  });
  // 文件夹选择（TS 分片合并）
  panel.querySelectorAll(".btn-browse-dir").forEach(btn => {
    btn.onclick = async () => {
      const r = await browseDialog({ mode: "folder" });
      if (r && r.paths.length) {
        const inp = btn.closest(".file-input-group").querySelector("input");
        inp.value = r.paths[0];
        inp.dispatchEvent(new Event("input"));
        scanDirNow(f);
      }
    };
  });
  // 本地 m3u8 文件
  panel.querySelectorAll(".btn-pick-m3u8").forEach(btn => {
    btn.onclick = async () => {
      const r = await browseDialog({ mode: "open", filter: btn.dataset.filter });
      if (r && r.paths.length) {
        const ta = btn.closest(".param-control").querySelector("textarea");
        ta.value = (ta.value ? ta.value.replace(/\n+$/, "") + "\n" : "") + r.paths[0];
        ta.dispatchEvent(new Event("input"));
      }
    };
  });
  // 检测播放列表
  panel.querySelectorAll(".btn-m3u8-check").forEach(btn => {
    btn.onclick = () => checkM3U8(btn);
  });

  // radio 卡片
  panel.querySelectorAll(".radio-cards").forEach(group => {
    group.querySelectorAll(".radio-card").forEach(card => {
      card.onclick = () => {
        group.querySelectorAll(".radio-card").forEach(c => c.classList.remove("checked"));
        card.classList.add("checked");
        onParamChange();
      };
    });
  });
  // 开关文字
  panel.querySelectorAll(".switch input").forEach(sw => {
    sw.addEventListener("change", () => {
      sw.closest(".switch-row").querySelector(".switch-state").textContent = sw.checked ? "开启" : "关闭";
    });
  });
  // 滑块数值
  panel.querySelectorAll('input[type="range"]').forEach(rg => {
    rg.addEventListener("input", () => {
      const unit = rg.nextElementSibling;
      const p = f.params.find(x => x.key === rg.dataset.key);
      unit.textContent = rg.value + ((p && p.unit) || "");
    });
  });
  // 输出框手动修改标记
  panel.querySelectorAll("[data-output]").forEach(inp => {
    inp.addEventListener("input", () => { if (inp.value) outputDirty[f.id] = true; });
  });

  autoFillOutput(f);
  updatePreview();
  applyHwAvailability(f);

  // 分片文件夹：填完自动扫描，立刻告诉用户找到了多少分片
  if (f.scanDir && paramRefs["dir"]) {
    const el = paramRefs["dir"];
    let timer = null;
    el.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => scanDirNow(f), 700);
    });
    el.addEventListener("change", () => {
      clearTimeout(timer);
      timer = setTimeout(() => scanDirNow(f), 120);
    });
    if (el.value) scanDirNow(f);
  }
}

/* ---------------- 分片文件夹扫描 / 播放列表检测 ---------------- */
function fmtSize(n) {
  n = Number(n) || 0;
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + " GB";
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(0) + " KB";
  return n + " B";
}

function fmtDuration(sec) {
  sec = Math.round(Number(sec) || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = x => String(x).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

async function scanDirNow(f) {
  const note = document.querySelector('[data-note="dir"]');
  if (!note) return;
  const dir = getValue(f, "dir");
  note.className = "param-note";
  note.innerHTML = "";
  if (!dir) return;
  note.className = "param-note loading";
  note.textContent = "⏳ 扫描文件夹…";
  let r;
  try {
    r = await fetch("/api/scan-dir", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir }) }).then(x => x.json());
  } catch (e) {
    note.className = "param-note err";
    note.textContent = "⚠ 无法连接后端：" + e;
    return;
  }
  if (!note.isConnected) return;
  if (!r.ok) { note.className = "param-note err"; note.textContent = "⚠ " + r.error; return; }
  if (!r.count) {
    note.className = "param-note warn";
    note.innerHTML = "⚠ 这个文件夹里没找到分片文件" +
      (r.found_exts && r.found_exts.length ? `（目录里有 ${r.found_exts.map(esc).join(" ")}）` : "");
    return;
  }
  note.className = "param-note ok";
  note.innerHTML = `✅ 找到 <b>${r.count}</b> 个 <code>${esc(r.ext)}</code> 分片 · 共 ${fmtSize(r.total)}` +
                   ` · ${esc(r.first)} → ${esc(r.last)}`;
  if (r.m3u8) {
    const a = document.createElement("a");
    a.href = "#";
    a.className = "note-link";
    a.textContent = `目录里有 ${r.m3u8.split(/[\\/]/).pop()}，用它下载更稳 →`;
    a.onclick = ev => { ev.preventDefault(); jumpToM3u8(r.m3u8); };
    note.appendChild(document.createElement("br"));
    note.appendChild(a);
  }
}

async function checkM3U8(btn) {
  const f = currentFeature;
  const note = btn.closest(".param-control").querySelector(".param-note");
  const v = collectValues(f);
  const url = String(v.url || "").split("\n").map(s => s.trim()).filter(Boolean)[0];
  if (!url) {
    note.className = "param-note err";
    note.textContent = "⚠ 请先填写播放列表地址";
    return;
  }
  note.className = "param-note loading";
  note.textContent = "⏳ 正在读取播放列表…（大清单可能要几秒）";
  let r;
  try {
    const headers = [v.referer ? "Referer: " + v.referer : "", v.cookie ? "Cookie: " + v.cookie : ""]
      .filter(Boolean).join("\r\n");
    r = await fetch("/api/m3u8-resolve", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, headers, ua: v.ua, quality: v.quality }) }).then(x => x.json());
  } catch (e) {
    note.className = "param-note err";
    note.textContent = "⚠ 无法连接后端：" + e;
    return;
  }
  if (!r.ok) { note.className = "param-note err"; note.textContent = "⚠ " + r.error; return; }

  const bits = [];
  if (r.is_master) {
    bits.push(`✅ 主列表：<b>${r.variant_count}</b> 档清晰度，当前选 <b>${esc((r.selected || {}).label || "")}</b>`);
  } else {
    bits.push(`✅ 分片列表：共 <b>${r.segments}</b> 个分片` +
              (r.duration ? ` · 时长约 ${fmtDuration(r.duration)}` : ""));
  }
  if (r.encrypted) {
    bits.push(r.encrypted === "AES-128"
      ? "🔐 AES-128 加密（FFmpeg 会自动解密）"
      : `🔐 ${esc(r.encrypted)} 加密（DRM 类加密无法解密，会下载失败）`);
  }
  note.className = "param-note ok";
  note.innerHTML = bits.join("<br>");
  if (r.is_master && v.quality !== "highest") {
    const tip = document.createElement("a");
    tip.href = "#";
    tip.className = "note-link";
    tip.textContent = "想要最高画质？切到「最高画质」再执行 →";
    tip.onclick = ev => {
      ev.preventDefault();
      const sel = document.querySelector('select[data-key="quality"]');
      if (sel) { sel.value = "highest"; sel.dispatchEvent(new Event("change")); }
      checkM3U8(btn);
    };
    note.appendChild(document.createElement("br"));
    note.appendChild(tip);
  }
}

function jumpToM3u8(path) {
  selectFeature("m3u8dl");
  const el = paramRefs["url"];
  if (!el) return;
  el.value = path;
  el.dispatchEvent(new Event("input"));
  updatePreview();
}

/* 硬件编码器可用性检测：本机不支持的会标灰 */
let HW_STATUS = null;
const HW_CODECS = ["h264_nvenc", "hevc_nvenc", "h264_qsv", "hevc_qsv", "h264_amf", "hevc_amf"];
async function applyHwAvailability(f) {
  const group = document.querySelector('.radio-cards[data-key="encoder"]');
  if (!group) return;
  const cards = [...group.querySelectorAll(".radio-card")];
  // 只标记真正的硬件编码器，CPU 编码器不参与可用性判断
  const hwCards = cards.filter(c => HW_CODECS.includes(c.dataset.value));
  if (!hwCards.length) return;
  hwCards.forEach(c => { if (!c.dataset.orig) c.dataset.orig = c.textContent; });
  if (!HW_STATUS) {
    hwCards.forEach(c => { c.textContent = c.dataset.orig + " …"; });
    try {
      const r = await fetch("/api/hw-encoders").then(r => r.json());
      HW_STATUS = r.ok ? r.encoders : {};
    } catch (e) { HW_STATUS = {}; }
    if (currentFeature !== f) return;
  }
  hwCards.forEach(c => {
    const ok = HW_STATUS[c.dataset.value];
    c.textContent = c.dataset.orig + (ok ? " ✓" : " ✕ 本机不可用");
    c.classList.toggle("unavailable", !ok);
    c.title = ok ? "该编码器在本机可用" : "本机未检测到该编码器，执行会报错；可改用 CPU 编码";
  });

  // 当前选中的是硬件编码器但不可用时，自动切到第一个可用的
  const checked = group.querySelector(".radio-card.checked");
  if (checked && HW_CODECS.includes(checked.dataset.value) && !HW_STATUS[checked.dataset.value]) {
    const firstOk = hwCards.find(c => HW_STATUS[c.dataset.value]);
    if (firstOk) {
      checked.classList.remove("checked");
      firstOk.classList.add("checked");
      updatePreview();
    }
  }
}

function getValue(f, key) {
  const p = f.params.find(x => x.key === key);
  const el = paramRefs[key];
  if (!el || !p) return undefined;
  if (p.type === "radio") {
    const c = el.querySelector(".radio-card.checked");
    return c ? c.dataset.value : p.default;
  }
  if (p.type === "switch") return el.checked;
  return el.value.trim ? el.value.trim() : el.value;
}

function collectValues(f) {
  const v = {};
  f.params.forEach(p => { v[p.key] = getValue(f, p.key); });
  return v;
}

function autoFillOutput(f) {
  if (!f.outExt || outputDirty[f.id]) return;
  const outEl = document.querySelector("[data-output]");
  if (!outEl) return;
  const inputKey = f.params.find(p => p.type === "file" || p.type === "dir" || p.type === "url");
  let inputPath = inputKey ? getValue(f, inputKey.key) : "";
  if (inputKey && inputKey.type === "url") {
    inputPath = String(inputPath || "").split("\n")[0].trim();
  }
  // 扩展名联动（如字幕封装随容器切换 mp4/mkv）
  let ext = null;
  if (f.extMap) {
    const [key, map] = f.extMap;
    ext = map[getValue(f, key)] || null;
  }
  outEl.value = genOutput(f, inputPath, ext);
}

function onParamChange(ev) {
  if (!currentFeature) return;
  const f = currentFeature;
  // 输出框自身的变化：立刻标记为「用户已手动指定」，避免被自动命名覆盖
  if (ev && ev.target && ev.target.hasAttribute && ev.target.hasAttribute("data-output")) {
    outputDirty[f.id] = !!ev.target.value;
    updatePreview();
    return;
  }
  // 输入变化时若输出未手动改过则跟随刷新
  if (f.outExt && !outputDirty[f.id]) autoFillOutput(f);
  updatePreview();
}

/* ---------------- 命令预览 ---------------- */
let previewSteps = [];
let previewError = null;

function cmdLine(argv) {
  // headers 之类含换行的参数，展示成 \n 字面量，避免把预览框撑成多行
  return ["ffmpeg", "-hide_banner", "-y", ...argv]
    .map(a => q(String(a).replace(/\r?\n/g, "\\n"))).join(" ");
}

/** 预览用：把运行时才生成的列表路径换成人话，不暴露占位符 */
function displayArgv(argv) {
  return argv.map(a => {
    if (a === "{TSLIST}" || a === "{LIST}") return "<合并列表 · 运行时自动生成>";
    return String(a).replace("textfile='{TEXTFILE}'", "textfile='<水印文字 · 运行时写入>'");
  });
}

function updatePreview() {
  const f = currentFeature;
  const box = $("#command-preview");
  previewSteps = []; previewError = null;
  if (!f) { box.innerHTML = '<span class="cmd-empty">请先选择功能…</span>'; return; }

  const v = collectValues(f);
  const missing = f.params.filter(p => p.required && !v[p.key] && !(p.type === "savefile" && autoFillable(f)));
  if (missing.length) {
    box.innerHTML = `<span class="cmd-empty">待填写：${missing.map(m => esc(m.label)).join("、")}</span>`;
    return;
  }
  const r = f.build(v);
  if (r && r.error) { previewError = r.error; box.innerHTML = `<span class="cmd-empty">⚠ ${esc(r.error)}</span>`; return; }

  const steps = normalizeSteps(r);
  if (!steps.length) {
    // 探测功能没有 ffmpeg 命令
    box.innerHTML = '<span class="cmd-empty">ffprobe -v quiet -print_format json -show_format -show_streams &lt;输入文件&gt;</span>';
    return;
  }
  previewSteps = steps;
  box.classList.toggle("multi", steps.length > 1);
  const prelude = f.needsM3U8
    ? `<span class="cmd-step">执行前会先读取该播放列表${v.quality === "highest" ? "，并自动选码率最高的一路" : ""}</span>\n`
    : "";
  box.innerHTML = prelude + steps.map((s, i) => {
    const head = steps.length > 1
      ? `<span class="cmd-step">步骤 ${i + 1}/${steps.length}${s.note ? " · " + esc(s.note) : ""}</span>\n`
      : "";
    return head + highlightCmd(cmdLine(displayArgv(s.argv)));
  }).join("\n\n");
}

function autoFillable(f) {
  const outEl = document.querySelector("[data-output]");
  return outEl && outEl.value;
}

/* ---------------- 功能选择 ---------------- */
function selectFeature(id) {
  const f = FEATURES.find(x => x.id === id);
  if (!f) return;
  currentFeature = f;
  $("#feature-icon").textContent = f.icon;
  $("#feature-name").textContent = f.name;
  $("#feature-desc").textContent = f.desc;
  renderNav($("#feature-search").value.trim());
  renderParams(f);
  // 批量抽屉开着时，同步「当前功能」提示
  if (!$("#batch-drawer").classList.contains("hidden")) syncBatchFeature();
}

/* ---------------- 日志 ---------------- */
async function browseDialog(payload) {
  // 统一调用后端文件对话框；失败时弹窗提示原因
  try {
    const r = await fetch("/api/browse", { method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload) }).then(r => r.json());
    if (!r.ok) {
      alert("文件对话框打开失败：\n" + (r.error || "未知错误") +
            "\n\n您也可以直接把文件路径粘贴到输入框中。");
      return null;
    }
    return r;
  } catch (e) {
    alert("无法连接后端服务，请确认 FFmpeg Studio 已启动。\n" + e);
    return null;
  }
}

function log(line, cls) {
  const body = $("#log-body");
  if (cls) {
    const span = document.createElement("span");
    span.style.color = cls;
    span.textContent = line + "\n";
    body.appendChild(span);
  } else {
    body.textContent += line + "\n";
  }
  body.scrollTop = body.scrollHeight;
}

function setStatus(text, cls) {
  const el = $("#log-status");
  el.textContent = text;
  el.className = "log-status" + (cls ? " " + cls : "");
}

/* ---------------- 执行 ---------------- */
let running = false;
let userStopped = false;   // 本次执行是否由用户主动停止
let stopPending = false;   // 已发出停止请求，正在等待收尾

function openLog() {
  $("#log-console").classList.remove("hidden");
  $("#log-toggle-arrow").textContent = "▾";
}

function setRunningUI(on, batch = false) {
  running = on;
  $("#btn-run").classList.toggle("hidden", on);
  $("#btn-stop").classList.toggle("hidden", !on);
  if (!on) {
    // 恢复停止按钮文案（执行中可能被改成「强制停止」）
    const sb = $("#btn-stop"); if (sb) sb.textContent = "⏹ 停止任务";
    const bb = $("#btn-batch-stop"); if (bb) bb.textContent = "⏹ 停止";
    stopPending = false;
  }
  if (batch) {
    $("#btn-batch-run").classList.toggle("hidden", on);
    $("#btn-batch-stop").classList.toggle("hidden", !on);
  }
  $("#btn-batch").disabled = on;
  $("#btn-batch-add").disabled = on;
  $("#btn-batch-clear").disabled = on;
  if (!on) syncBatchFeature();
}

/** 执行一条 ffmpeg 命令，resolve 退出码 */
function runStep(argv, cwd) {
  return new Promise(async resolve => {
    log("$ " + cmdLine(argv), "#7cc7ff");
    let r;
    try {
      r = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ argv, display: cmdLine(argv), cwd: cwd || "" }) }).then(x => x.json());
    } catch (e) {
      log("启动失败: " + e, "#ef4b5f"); resolve(-1); return;
    }
    if (!r.ok) { log("启动失败: " + r.error, "#ef4b5f"); resolve(-1); return; }

    currentTaskId = r.id;
    if (eventSource) eventSource.close();
    eventSource = new EventSource(`/api/stream/${r.id}`);
    eventSource.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "log") {
        // 进度行原地刷新，避免日志被上万行进度冲爆
        const body = $("#log-body");
        if (/^frame=|^size=/.test(msg.line)) {
          const lines = body.textContent.split("\n");
          if (/^frame=|^size=/.test(lines[lines.length - 2] || "")) lines.splice(lines.length - 2, 1);
          body.textContent = lines.join("\n");
        }
        log(msg.line);
      } else if (msg.type === "exit") {
        if (eventSource) { eventSource.close(); eventSource = null; }
        currentTaskId = null;
        if (msg.stopped) userStopped = true;
        resolve(msg.code);
      }
    };
    eventSource.onerror = () => {
      if (eventSource) { eventSource.close(); eventSource = null; }
      if (currentTaskId) { currentTaskId = null; resolve(-1); }
    };
  });
}

/** 顺序执行多遍处理，返回最后一个非零退出码（或 0） */
async function executeSteps(steps, cwd) {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (steps.length > 1) {
      log(`\n——— 步骤 ${i + 1}/${steps.length}${s.note ? " · " + s.note : ""} ———`, "#8a99ad");
    }
    const code = await runStep(s.argv, cwd);
    if (code !== 0) return code;
  }
  return 0;
}

/** 把 -i 后面的占位 URL 换成解析后的真实地址 */
function replaceInputArg(argv, from, to) {
  const out = argv.slice();
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i] === "-i" && out[i + 1] === from) { out[i + 1] = to; break; }
  }
  return out;
}

/** 多任务输出加序号：A.mp4 → A_001.mp4 */
function indexOutput(p, i) {
  const s = String(p);
  const n = "_" + String(i).padStart(3, "0");
  const cut = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
  const dot = s.lastIndexOf(".");
  if (dot > cut) return s.slice(0, dot) + n + s.slice(dot);
  return s + n;
}

/** 执行前解析播放列表：master → 选出目标清晰度的子列表；失败则回落原始地址 */
async function resolveForRun(v, url) {
  const headers = [v.referer ? "Referer: " + v.referer : "",
                   v.cookie ? "Cookie: " + v.cookie : ""].filter(Boolean).join("\r\n");
  let r = null;
  try {
    r = await fetch("/api/m3u8-resolve", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, headers, ua: v.ua, quality: v.quality }) }).then(x => x.json());
  } catch (e) { /* 网络异常，交给 FFmpeg 自己试 */ }
  if (!r || !r.ok) {
    log(`⚠ 预解析失败（${(r && r.error) || "无法连接"}），直接把原地址交给 FFmpeg`, "#f5a623");
    return url;
  }
  if (r.is_master) {
    log(`🔎 主列表 ${r.variant_count} 档清晰度 → 选中 ${r.selected ? r.selected.label : "默认档"}`, "#7cc7ff");
  } else {
    log(`🔎 分片列表：${r.segments} 个分片` + (r.duration ? `，时长约 ${fmtDuration(r.duration)}` : ""), "#7cc7ff");
  }
  if (r.encrypted === "AES-128") log("🔐 AES-128 加密：FFmpeg 会自动取密钥解密", "#7cc7ff");
  else if (r.encrypted) log(`⚠ 检测到 ${r.encrypted} 加密（DRM 类），FFmpeg 无法解密，大概率失败`, "#f5a623");
  return r.url || url;
}

async function runCurrent() {
  const f = currentFeature;
  if (!f) return;
  openLog();
  $("#log-body").textContent = "";

  // 探测功能走 ffprobe
  if (f.isProbe) {
    const input = getValue(f, "input");
    if (!input) { log("请先选择媒体文件", "#ef4b5f"); return; }
    setStatus("解析中…", "running");
    log(`$ ffprobe -v quiet -print_format json -show_format -show_streams "${input}"`, "#7cc7ff");
    const r = await fetch("/api/probe", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: input }) }).then(r => r.json());
    if (r.ok) {
      log(JSON.stringify(r.data, null, 2));
      // 友好摘要
      const fmt = r.data.format || {};
      const vs = (r.data.streams || []).find(s => s.codec_type === "video");
      const as = (r.data.streams || []).find(s => s.codec_type === "audio");
      log("\n—————— 摘要 ——————", "#a9e5a3");
      log(`时长: ${Number(fmt.duration || 0).toFixed(2)} 秒   大小: ${(Number(fmt.size || 0) / 1048576).toFixed(2)} MB   总码率: ${(Number(fmt.bit_rate || 0) / 1000).toFixed(0)} kbps`, "#a9e5a3");
      if (vs) log(`视频: ${vs.codec_name}  ${vs.width}x${vs.height}  ${eval(vs.r_frame_rate || "0").toFixed(2)} fps`, "#a9e5a3");
      if (as) log(`音频: ${as.codec_name}  ${as.sample_rate} Hz  ${as.channels} 声道`, "#a9e5a3");
      setStatus("解析完成", "success");
    } else {
      log("解析失败: " + r.error, "#ef4b5f");
      setStatus("解析失败", "error");
    }
    return;
  }

  if (previewError || !previewSteps.length) {
    log(previewError || "请先补全必填参数", "#ef4b5f");
    return;
  }

  const v = collectValues(f);
  const steps = previewSteps.map(s => ({ ...s, argv: s.argv.slice() }));

  // concat copy 模式：先生成列表文件，替换所有步骤里的占位符
  if (f.needsConcatList && f.needsConcatList(v)) {
    const files = (v.files || "").split("\n").map(s => s.trim()).filter(Boolean);
    const r = await fetch("/api/concat-list", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }) }).then(r => r.json());
    if (!r.ok) { log("生成合并列表失败: " + r.error, "#ef4b5f"); return; }
    steps.forEach(s => { s.argv = s.argv.map(a => a === "{LIST}" ? r.path : a); });
    log(`已生成合并列表: ${r.path}（${r.count} 个文件）`, "#8a99ad");
  }

  // TS 分片合并：扫描文件夹，按序号生成 concat 列表
  if (f.needsTsList && f.needsTsList(v)) {
    setStatus("扫描分片…", "running");
    const r = await fetch("/api/ts-list", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dir: v.dir }) }).then(r => r.json());
    if (!r.ok) { log("扫描分片失败：" + r.error, "#ef4b5f"); setStatus("扫描失败", "error"); return; }
    steps.forEach(s => { s.argv = s.argv.map(a => a === "{TSLIST}" ? r.path : a); });
    log(`📂 已扫描 ${r.count} 个 ${r.ext} 分片（${fmtSize(r.total)}）`, "#7cc7ff");
    log(`   顺序：${r.first} → ${r.last}`, "#7cc7ff");
    log(`   列表文件：${r.path}`, "#8a99ad");
    if (r.m3u8) log(`💡 该目录还有 ${r.m3u8.split(/[\\/]/).pop()}，若合并后卡顿可改用「M3U8 下载」`, "#8a99ad");
  }

  // 文字水印：把文字写入临时文件，替换 argv 里的占位符
  if (f.needsTextFile) {
    try {
      const tp = await writeTextFile(v.text);
      steps.forEach(s => { s.argv = s.argv.map(a => String(a).replace("{TEXTFILE}", tp)); });
    } catch (e) {
      log("写入水印文字失败：" + e.message, "#ef4b5f");
      setStatus("准备失败", "error");
      return;
    }
  }

  // M3U8 下载：支持多行链接，逐条执行
  let jobs = null, tmplUrl = "";
  if (f.needsM3U8) {
    const urls = String(v.url || "").split("\n").map(s => s.trim()).filter(Boolean);
    if (!urls.length) { log("请填写播放列表地址", "#ef4b5f"); return; }
    tmplUrl = urls[0];
    jobs = urls.map((u, i) => ({
      url: u,
      output: urls.length === 1 ? v.output : indexOutput(v.output, i + 1)
    }));
    if (jobs.length > 1) log(`📥 共 ${jobs.length} 个播放列表，依次下载`, "#7cc7ff");
  }

  setRunningUI(true);
  setStatus(jobs ? "⏳ 解析播放列表…" : "⏳ 执行中…", "running");
  userStopped = false;
  stopPending = false;

  let code = 0;
  let lastOutput = v.output;
  if (jobs) {
    let okJobs = 0, failJobs = 0;
    for (let i = 0; i < jobs.length; i++) {
      if (userStopped) break;
      const job = jobs[i];
      lastOutput = job.output;
      if (jobs.length > 1) {
        log(`\n━━━ [${i + 1}/${jobs.length}] ${job.output.split(/[\\/]/).pop()} ━━━`, "#8a99ad");
        log(`🔗 ${job.url}`, "#8a99ad");
      }
      const src = await resolveForRun(v, job.url);
      if (userStopped) break;
      const jobSteps = steps.map(s => {
        const argv = replaceInputArg(s.argv, tmplUrl, src);
        argv[argv.length - 1] = job.output;
        return { argv, note: s.note };
      });
      code = await executeSteps(jobSteps, dirname(job.output));
      if (userStopped) break;
      if (code === 0) { okJobs++; log(`✅ 完成：${job.output}`, "#22b07d"); }
      else { failJobs++; log(`❌ 失败（退出码 ${code}），继续下一个`, "#ef4b5f"); }
    }
    if (jobs.length > 1) {
      const msg = `共 ${jobs.length} 个：成功 ${okJobs} 个` + (failJobs ? `，失败 ${failJobs} 个` : "");
      log("\n" + msg, failJobs ? "#f5a623" : "#22b07d");
      code = failJobs ? 1 : 0;
    }
  } else {
    code = await executeSteps(steps, v.output ? dirname(v.output) : "");
  }

  setRunningUI(false);
  stopPending = false;

  if (userStopped) {
    await finishStopped(lastOutput, code);
  } else if (code === 0) {
    setStatus("✅ 执行成功", "success");
    log("\n✅ 任务完成！", "#22b07d");
    if (!jobs && v.output) log(`📁 输出文件: ${v.output}`, "#22b07d");
  } else {
    setStatus(`❌ 执行失败 (退出码 ${code})`, "error");
    log(`\n❌ FFmpeg 退出码: ${code}，请检查上方红色错误信息`, "#ef4b5f");
  }
}

/** 用户主动停止后的收尾：检查文件是否完整可播 */
async function finishStopped(outputPath, code) {
  setStatus("⏹ 已停止", "warn");
  log("\n⏹ 任务已按你的操作停止", "#f5a623");
  if (!outputPath) return;

  // 停止后校验文件：能读出时长说明收尾正常
  let info = null;
  try {
    const r = await fetch("/api/probe", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: outputPath }) }).then(r => r.json());
    if (r.ok) info = r.data;
  } catch (e) { /* 忽略 */ }

  if (info && Number((info.format || {}).duration || 0) > 0) {
    const sec = Number(info.format.duration).toFixed(1);
    log(`✅ 文件已正常收尾，可播放（时长 ${sec} 秒）`, "#22b07d");
    log(`📁 输出文件: ${outputPath}`, "#22b07d");
  } else {
    // 强制结束或进程被外部终止时才会走到这里
    log("⚠ 输出文件可能不完整（未写入索引），请重新录制/处理后正常停止", "#ef4b5f");
    log("💡 提示：停止按钮第一次是「正常收尾」，等收尾完成文件才完整；连点两次才会强制结束。", "#8a99ad");
  }
}

async function stopCurrent() {
  if (!currentTaskId) return;
  const force = stopPending;   // 第二次点击 = 强制结束

  if (force) {
    log("\n🛑 强制结束进程（输出文件可能不完整）", "#ef4b5f");
  } else {
    userStopped = true;
    stopPending = true;
    setStatus("⏳ 正在收尾…", "running");
    log("\n⏹ 收到停止请求，正在让 FFmpeg 写完文件索引（稍等一下）…", "#f5a623");
    const btn = $("#btn-stop");
    if (btn) btn.textContent = "🛑 强制停止";
  }

  await fetch("/api/stop", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: currentTaskId, force }) });
}

/* ---------------- 批量队列 ---------------- */
const batchItems = [];      // {path, status: wait|run|ok|fail, out}
let batchStopFlag = false;

function batchableFeature(f) {
  return !!(f && !f.isProbe && f.params.some(p => p.type === "file"));
}

function batchName(p) {
  return String(p).split(/[\\/]/).pop();
}

function renderBatchList() {
  $("#batch-count").textContent = `${batchItems.length} 个文件`;
  const badge = $("#batch-badge");
  badge.textContent = batchItems.length;
  badge.classList.toggle("hidden", !batchItems.length);

  const list = $("#batch-list");
  if (!batchItems.length) {
    list.innerHTML = '<div class="empty-tip">队列为空<br><span style="font-size:12px;color:#8a99ad">点「＋ 添加文件」一次把多个素材加进来</span></div>';
    return;
  }
  const LBL = { wait: "待处理", run: "运行中…", ok: "✓ 成功", fail: "✕ 失败", stop: "⏹ 已停止" };
  list.innerHTML = batchItems.map((it, i) => `
    <div class="batch-item ${it.status}">
      <div class="batch-item-top">
        <span class="batch-idx">${i + 1}</span>
        <span class="batch-file" title="${esc(it.path)}">${esc(batchName(it.path))}</span>
        <span class="batch-status">${LBL[it.status]}</span>
      </div>
      <div class="batch-item-path">${esc(it.path)}</div>
      ${it.out ? `<div class="batch-item-out">→ ${esc(it.out)}</div>` : ""}
    </div>`).join("");
}

function syncBatchFeature() {
  const f = currentFeature;
  $("#batch-feature-name").textContent = f ? f.name : "—";
  const hint = $("#batch-hint");
  if (!batchableFeature(f)) {
    hint.innerHTML = '⚠ 当前功能没有单个输入文件，<b>无法批量处理</b>。请切到「格式转换」「视频压缩」「LUT 调色」等带输入文件的功能。';
    $("#btn-batch-add").disabled = true;
    $("#btn-batch-run").disabled = true;
  } else {
    hint.innerHTML = '队列中每个文件都会套用<b>当前页面上设置的参数</b>，输出自动命名为 <code>原文件名 + 后缀</code> 存到 outputs 目录。批量执行中可随时停止。';
    $("#btn-batch-add").disabled = false;
    $("#btn-batch-run").disabled = false;
  }
}

async function addBatchFiles() {
  const f = currentFeature;
  if (!batchableFeature(f)) { alert("当前功能不支持批量处理，请选择带输入文件的功能。"); return; }
  const p = f.params.find(x => x.type === "file");
  const r = await browseDialog({ mode: "open", multi: true, filter: p.filter || "" });
  if (!r || !r.paths) return;
  let added = 0;
  r.paths.forEach(path => {
    if (!batchItems.some(x => x.path === path)) { batchItems.push({ path, status: "wait", out: "" }); added++; }
  });
  renderBatchList();
  if (!added && r.paths.length) alert("这些文件已经在队列中了。");
}

async function runBatch() {
  const f = currentFeature;
  if (!batchableFeature(f)) { alert("当前功能不支持批量处理。"); return; }
  if (!batchItems.length) { alert("队列为空，请先添加文件。"); return; }
  if (previewError || !previewSteps.length) { alert("当前参数还不完整，请先在主界面补全必填项。"); return; }

  const baseVals = collectValues(f);
  const fileKey = f.params.find(x => x.type === "file").key;
  const outParam = f.params.find(x => x.type === "savefile");

  batchItems.forEach(it => { it.status = "wait"; it.out = ""; });
  batchStopFlag = false;
  userStopped = false;
  stopPending = false;

  // 文字水印：整批共用同一个文字文件
  let textPath = "";
  if (f.needsTextFile) {
    try { textPath = await writeTextFile(baseVals.text || ""); }
    catch (e) { alert("写入水印文字失败：" + e.message); return; }
  }
  renderBatchList();
  setRunningUI(true, true);
  setStatus("⏳ 批量执行中…", "running");
  openLog();
  log(`📚 批量队列开始：共 ${batchItems.length} 个文件 · 功能「${f.name}」`, "#7cc7ff");

  let okCount = 0, failCount = 0, stopCount = 0;
  for (let i = 0; i < batchItems.length; i++) {
    const it = batchItems[i];
    if (batchStopFlag) { it.status = "stop"; stopCount++; continue; }
    const v = { ...baseVals, [fileKey]: it.path };
    if (outParam) v[outParam.key] = genOutput(f, it.path, extFor(f, v));
    it.out = outParam ? v[outParam.key] : "";
    it.status = "run";
    renderBatchList();

    log(`\n━━━ [${i + 1}/${batchItems.length}] ${batchName(it.path)} ━━━`, "#8a99ad");
    if (it.out) log(`📁 输出: ${it.out}`, "#8a99ad");

    const steps = normalizeSteps(f.build(v));
    if (!steps.length) {
      it.status = "fail"; failCount++; renderBatchList();
      log("❌ 参数构建失败，已跳过", "#ef4b5f");
      continue;
    }
    if (textPath) steps.forEach(s => { s.argv = s.argv.map(a => String(a).replace("{TEXTFILE}", textPath)); });
    const code = await executeSteps(steps, it.out ? dirname(it.out) : "");
    if (userStopped) {
      it.status = "stop"; stopCount++;
      log("⏹ 该文件已按你的操作停止（输出已收尾）", "#f5a623");
    } else if (code === 0) { it.status = "ok"; okCount++; }
    else { it.status = "fail"; failCount++; log(`❌ 该文件失败（退出码 ${code}），继续下一个`, "#ef4b5f"); }
    renderBatchList();
  }

  setRunningUI(false, true);
  // 剩余未处理的文件标记为「已停止」
  if (batchStopFlag) {
    batchItems.forEach(it => { if (it.status === "wait") { it.status = "stop"; stopCount++; } });
    renderBatchList();
  }
  const parts = [`成功 ${okCount} 个`];
  if (failCount) parts.push(`失败 ${failCount} 个`);
  if (stopCount) parts.push(`已停止 ${stopCount} 个`);
  const msg = `批量${batchStopFlag ? "已停止" : "完成"}：` + parts.join("，");
  setStatus(msg, batchStopFlag ? "warn" : (failCount ? "error" : "success"));
  log("\n" + (batchStopFlag ? "⏹ " : (failCount ? "⚠ " : "✅ ")) + msg,
      batchStopFlag ? "#f5a623" : (failCount ? "#f5a623" : "#22b07d"));
}

function stopBatch() {
  batchStopFlag = true;
  log("\n⏹ 正在停止批量队列…", "#f5a623");
  stopCurrent();
}

/* ---------------- 批量抽屉 ---------------- */
function openBatch() {
  syncBatchFeature();
  renderBatchList();
  $("#batch-mask").classList.remove("hidden");
  $("#batch-drawer").classList.remove("hidden");
}
function closeBatch() {
  $("#batch-mask").classList.add("hidden");
  $("#batch-drawer").classList.add("hidden");
}

/* ---------------- 输出目录抽屉 ---------------- */
async function showOutputs() {
  $("#drawer-mask").classList.remove("hidden");
  $("#outputs-drawer").classList.remove("hidden");
  const r = await fetch("/api/outputs").then(r => r.json());
  const list = $("#outputs-list");
  if (!r.ok || !r.files.length) { list.innerHTML = '<div class="empty-tip">暂无输出文件</div>'; return; }
  list.innerHTML = r.files.map(f => `
    <div class="output-item">
      <div class="oi-name">📄 ${esc(f.name)}</div>
      <div class="oi-meta">${(f.size / 1048576).toFixed(2)} MB · ${new Date(f.mtime * 1000).toLocaleString()}</div>
      <div class="oi-path">${esc(f.path)}</div>
    </div>`).join("");
}

/* ---------------- 初始化 ---------------- */
(async function init() {
  const v = await fetch("/api/version").then(r => r.json());
  $("#ffmpeg-version").textContent = v.ok ? `FFmpeg ${v.version}` : "⚠ FFmpeg 未检测到";

  const o = await fetch("/api/outputs").then(r => r.json());
  if (o.ok) OUTPUT_DIR = o.dir;

  await loadFonts();
  renderNav();
  selectFeature("convert");

  $("#feature-search").addEventListener("input", e => renderNav(e.target.value.trim()));
  $("#btn-run").onclick = runCurrent;
  $("#btn-stop").onclick = stopCurrent;
  $("#btn-copy-cmd").onclick = () => {
    const text = $("#command-preview").textContent;
    navigator.clipboard.writeText(text).then(() => {
      const btn = $("#btn-copy-cmd");
      btn.textContent = "✅ 已复制";
      setTimeout(() => btn.textContent = "📋 复制命令", 1200);
    });
  };
  $("#btn-toggle-log").onclick = () => {
    const c = $("#log-console");
    c.classList.toggle("hidden");
    $("#log-toggle-arrow").textContent = c.classList.contains("hidden") ? "▸" : "▾";
  };
  $("#btn-clear-log").onclick = () => { $("#log-body").textContent = ""; setStatus("就绪"); };
  $("#btn-outputs").onclick = showOutputs;
  $("#btn-close-drawer").onclick = () => {
    $("#drawer-mask").classList.add("hidden");
    $("#outputs-drawer").classList.add("hidden");
  };
  $("#drawer-mask").onclick = $("#btn-close-drawer").onclick;

  // 批量队列
  $("#btn-batch").onclick = openBatch;
  $("#btn-close-batch").onclick = closeBatch;
  $("#batch-mask").onclick = closeBatch;
  $("#btn-batch-add").onclick = addBatchFiles;
  $("#btn-batch-run").onclick = runBatch;
  $("#btn-batch-stop").onclick = stopBatch;
  $("#btn-batch-clear").onclick = () => {
    if (!batchItems.length) return;
    if (!confirm("确定清空队列中的 " + batchItems.length + " 个文件吗？（不会删除源文件）")) return;
    batchItems.length = 0;
    renderBatchList();
  };
  renderBatchList();
})();
