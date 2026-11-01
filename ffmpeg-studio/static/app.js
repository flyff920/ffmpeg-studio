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

function genOutput(feature, inputPath) {
  if (!feature.outExt) return "";
  const name = inputPath ? stem(inputPath) : "output";
  return `${OUTPUT_DIR}\\${name}${feature.tag}.${feature.outExt}`;
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
function renderNav(filter = "") {
  const nav = $("#feature-nav");
  nav.innerHTML = "";
  const groups = {};
  FEATURES.forEach(f => {
    if (filter && !f.name.includes(filter) && !f.desc.includes(filter)) return;
    (groups[f.group] = groups[f.group] || []).push(f);
  });
  Object.entries(groups).forEach(([g, items]) => {
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
  } else if (p.type === "filelist") {
    wrap.innerHTML = `
      <textarea data-key="${p.key}" placeholder="每行一个文件路径，按顺序合并"></textarea>
      <div style="margin-top:6px"><button class="btn btn-mini btn-browse-multi" data-filter="${esc(p.filter || '')}">＋ 添加文件（可多选）</button></div>`;
  } else if (p.type === "select") {
    wrap.innerHTML = `<select data-key="${p.key}">${p.options.map(o => {
      const v = typeof o === "object" ? o.value : o, l = typeof o === "object" ? o.label : o;
      return `<option value="${esc(v)}" ${v === p.default ? "selected" : ""}>${esc(l)}</option>`;
    }).join("")}</select>`;
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
  const inputKey = f.params.find(p => p.type === "file");
  const inputPath = inputKey ? getValue(f, inputKey.key) : "";
  outEl.value = genOutput(f, inputPath);
}

function onParamChange() {
  if (!currentFeature) return;
  // 输入变化时若输出未手动改过则跟随刷新
  const f = currentFeature;
  if (f.outExt && !outputDirty[f.id]) autoFillOutput(f);
  updatePreview();
}

/* ---------------- 命令预览 ---------------- */
let previewArgv = null;
let previewError = null;

function updatePreview() {
  const f = currentFeature;
  const box = $("#command-preview");
  previewArgv = null; previewError = null;
  if (!f) { box.innerHTML = '<span class="cmd-empty">请先选择功能…</span>'; return; }

  const v = collectValues(f);
  const missing = f.params.filter(p => p.required && !v[p.key] && !(p.type === "savefile" && autoFillable(f)));
  if (missing.length) {
    box.innerHTML = `<span class="cmd-empty">待填写：${missing.map(m => esc(m.label)).join("、")}</span>`;
    return;
  }
  const r = f.build(v);
  if (r.error) { previewError = r.error; box.innerHTML = `<span class="cmd-empty">⚠ ${esc(r.error)}</span>`; return; }
  if (!r.argv.length) { box.innerHTML = '<span class="cmd-empty">ffprobe -v quiet -print_format json -show_format -show_streams &lt;输入文件&gt;</span>'; previewArgv = []; return; }

  previewArgv = r.argv;
  const display = ["ffmpeg", "-hide_banner", "-y", ...r.argv].map(q).join(" ");
  box.innerHTML = highlightCmd(display);
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
async function runCurrent() {
  const f = currentFeature;
  if (!f) return;
  $("#log-console").classList.remove("hidden");
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

  if (!previewArgv || previewError) { log(previewError || "请先补全必填参数", "#ef4b5f"); return; }

  const v = collectValues(f);
  let argv = previewArgv;

  // concat copy 模式：先生成列表文件
  if (f.needsConcatList && f.needsConcatList(v)) {
    const files = (v.files || "").split("\n").map(s => s.trim()).filter(Boolean);
    const r = await fetch("/api/concat-list", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files }) }).then(r => r.json());
    if (!r.ok) { log("生成合并列表失败: " + r.error, "#ef4b5f"); return; }
    argv = argv.map(a => a === "{LIST}" ? r.path : a);
    log(`已生成合并列表: ${r.path}（${r.count} 个文件）`, "#8a99ad");
  }

  const display = ["ffmpeg", "-hide_banner", "-y", ...argv].map(q).join(" ");
  log("$ " + display, "#7cc7ff");

  const r = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ argv, display }) }).then(r => r.json());
  if (!r.ok) { log("启动失败: " + r.error, "#ef4b5f"); return; }

  currentTaskId = r.id;
  $("#btn-run").classList.add("hidden");
  $("#btn-stop").classList.remove("hidden");
  setStatus("⏳ 执行中…", "running");

  if (eventSource) eventSource.close();
  eventSource = new EventSource(`/api/stream/${r.id}`);
  eventSource.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "log") {
      // 进度行刷新显示
      const body = $("#log-body");
      if (/^frame=|^size=/.test(msg.line)) {
        const lines = body.textContent.split("\n");
        if (/^frame=|^size=/.test(lines[lines.length - 2] || "")) lines.splice(lines.length - 2, 1);
        body.textContent = lines.join("\n");
      }
      log(msg.line);
    } else if (msg.type === "exit") {
      eventSource.close(); eventSource = null;
      currentTaskId = null;
      $("#btn-run").classList.remove("hidden");
      $("#btn-stop").classList.add("hidden");
      if (msg.code === 0) {
        setStatus("✅ 执行成功", "success");
        log("\n✅ 任务完成！", "#22b07d");
        if (v.output) log(`📁 输出文件: ${v.output}`, "#22b07d");
      } else {
        setStatus(`❌ 执行失败 (退出码 ${msg.code})`, "error");
        log(`\n❌ FFmpeg 退出码: ${msg.code}，请检查上方红色错误信息`, "#ef4b5f");
      }
    }
  };
  eventSource.onerror = () => {
    if (eventSource) { eventSource.close(); eventSource = null; }
    if (currentTaskId) {
      setStatus("连接中断", "error");
      $("#btn-run").classList.remove("hidden");
      $("#btn-stop").classList.add("hidden");
      currentTaskId = null;
    }
  };
}

async function stopCurrent() {
  if (!currentTaskId) return;
  await fetch("/api/stop", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: currentTaskId }) });
  log("\n⏹ 用户手动停止任务", "#f5a623");
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
})();
