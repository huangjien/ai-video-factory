import {
  BILIBILI_DESCRIPTION_MAX,
  BILIBILI_TAGS_MAX,
  BILIBILI_TAG_MAX,
  BILIBILI_TITLE_MAX,
  type BilibiliPackage,
} from "./schemas.js";

/** 分区 options worth naming, because the form's dropdown is a long tree and
 * "the right one" is not obvious. `suggested_category` maps onto these;
 * when it is null the uploader picks. */
const COMMON_CATEGORIES = [
  "科技",
  "计算机技术",
  "科学科普",
  "职场就业",
  "数码",
  "知识",
] as const;

export interface ChecklistInput {
  pkg: BilibiliPackage;
  /** Absolute path to the rendered video, so the uploader can find the file. */
  videoPath: string;
  /** Cover image path, when one has been generated. */
  coverPath?: string | undefined;
  /** Non-null when the package came from the deterministic fallback. */
  warning?: string | undefined;
}

/**
 * The manual-upload checklist — the actual deliverable of a packaging-only
 * command.
 *
 * Bilibili has no public upload API, so this file is the handoff between the
 * pipeline and the person with a browser. It names every field the form asks
 * for, fills the ones the pipeline knows, and explicitly marks the ones only
 * a human can decide (分区 confirmation, 转载 declaration, 播放权限).
 */
export function renderChecklist(input: ChecklistInput): string {
  const { pkg } = input;
  const lines: string[] = [];

  lines.push("# Bilibili 投稿清单（人工上传）");
  lines.push("");
  lines.push(
    "Bilibili 没有面向第三方工具的公开投稿 API（不同于 YouTube Data API v3），",
  );
  lines.push(
    "所以这条命令只负责把元数据准备好，最后一步需要在网页版投稿页手动填写。",
  );
  lines.push("");

  if (input.warning) {
    lines.push(`> ⚠️ ${input.warning}`);
    lines.push(">");
    lines.push("> 下面这份元数据是由 article.md 确定性推导出来的，未经 LLM 润色。");
    lines.push("");
  }

  lines.push("## 视频文件");
  lines.push("");
  lines.push("```");
  lines.push(input.videoPath);
  lines.push("```");
  lines.push("");

  lines.push("## 标题");
  lines.push("");
  lines.push(
    `字符数 ${[...pkg.title].length} / ${BILIBILI_TITLE_MAX}（超出会被截断）`,
  );
  lines.push("");
  lines.push("```");
  lines.push(pkg.title);
  lines.push("```");
  lines.push("");

  lines.push("## 简介");
  lines.push("");
  lines.push(
    `字符数 ${[...pkg.description].length} / ${BILIBILI_DESCRIPTION_MAX}`,
  );
  lines.push("");
  lines.push(pkg.description);
  lines.push("");

  lines.push("## 标签");
  lines.push("");
  if (pkg.tags.length === 0) {
    lines.push("⚠️ 没有匹配到标签，请手动补几个观众会搜的词。");
  } else {
    lines.push(
      `数量 ${pkg.tags.length} / ${BILIBILI_TAGS_MAX}（每个 ≤ ${BILIBILI_TAG_MAX} 字符）`,
    );
    lines.push("");
    lines.push(pkg.tags.join("、"));
  }
  lines.push("");

  lines.push("## 分区");
  lines.push("");
  if (pkg.suggested_category) {
    lines.push(`建议分区：**${pkg.suggested_category}**（请在表单下拉里核对）`);
  } else {
    lines.push("⚠️ 无法可靠推断分区，请在表单里自行选择。");
  }
  lines.push("");
  lines.push(`常见选项：${COMMON_CATEGORIES.join(" / ")}`);
  lines.push("");
  lines.push(
    "> 这里给的是分区名称而不是数字 tid：tid 填错不会报错，只会把视频投进" +
      "毫不相关的分区，而且要等发布后才发现。",
  );
  lines.push("");

  lines.push("## 封面");
  lines.push("");
  if (input.coverPath) {
    lines.push("```");
    lines.push(input.coverPath);
    lines.push("```");
    lines.push("");
    lines.push(
      "⚠️ 图上**没有标题字**——图像模型画文字只会画出乱码。请在投稿页的封面编辑器里手动打上标题。",
    );
  } else {
    lines.push("尚未生成封面图。可用下面这段提示词跑一次生图：");
    lines.push("");
    lines.push("```");
    lines.push(pkg.cover_prompt);
    lines.push("```");
  }
  lines.push("");

  lines.push("## 需要你自己决定的字段");
  lines.push("");
  lines.push("- **自制 / 转载**：本片由本流水线生成，通常选「自制」。转载他人素材需注明出处。");
  lines.push("- **分区**：见上，务必核对。");
  lines.push("- **播放权限**：建议先「仅自己可见」确认无误再改公开。");
  lines.push("- **字幕**：如需 CC 字幕，投稿页支持上传；本流水线只生成 `captions/*.srt`，未做样式化。");
  lines.push("- **相关推荐 / 动态**：投稿页可勾选，可留空。");
  lines.push("");

  return lines.join("\n");
}
