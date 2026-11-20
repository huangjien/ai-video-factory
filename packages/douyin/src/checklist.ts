import {
  DOUYIN_DESCRIPTION_MAX,
  DOUYIN_TITLE_MAX,
  DOUYIN_TOPIC_MAX,
  DOUYIN_TOPICS_MAX,
  type DouyinPackage,
} from "./schemas.js";

export interface ChecklistInput {
  pkg: DouyinPackage;
  /** Absolute path to the vertical video, so the uploader can find the file. */
  videoPath: string;
  /** Cover image path, when one has been generated. */
  coverPath?: string | undefined;
  /** Non-null when the package came from the deterministic fallback. */
  warning?: string | undefined;
  /** Why the automated upload could not run — the API credentials are
   *  missing, the capability is not approved, the file is not vertical. */
  uploadBlocker?: string | undefined;
}

/**
 * The manual-upload checklist — the deliverable whenever the automated
 * upload cannot run.
 *
 * Douyin HAS an official publishing API, but it needs an approved app, so
 * until those credentials exist this file is the handoff between the
 * pipeline and the person with a browser. It names every field the form
 * asks for, fills the ones the pipeline knows, and marks the ones only a
 * human can decide.
 */
export function renderChecklist(input: ChecklistInput): string {
  const { pkg } = input;
  const lines: string[] = [];

  lines.push("# 抖音投稿清单（人工上传）");
  lines.push("");
  lines.push(
    "抖音开放平台提供了「内容发布」接口，但需要审核通过的应用凭据。",
  );
  lines.push(
    "在凭据就位之前（或上传失败时），这条命令只负责把元数据准备好，",
  );
  lines.push("最后一步需要在创作者中心手动上传。");
  lines.push("");

  if (input.uploadBlocker) {
    lines.push(`> ⚠️ 自动上传未执行：${input.uploadBlocker}`);
    lines.push("");
  }

  if (input.warning) {
    lines.push(`> ⚠️ ${input.warning}`);
    lines.push(">");
    lines.push(
      "> 下面这份元数据是由 article.md 确定性推导出来的，未经 LLM 润色。",
    );
    lines.push("");
  }

  lines.push("## 视频文件");
  lines.push("");
  lines.push("```");
  lines.push(input.videoPath);
  lines.push("```");
  lines.push("");
  lines.push(
    "> 必须是竖屏 1080×1920（抖音是竖屏优先的平台）。用 `video douyin` " +
      "生成的这一个已经是竖版；直接投横屏片会被加黑边，观感明显更差。",
  );
  lines.push("");

  lines.push("## 标题");
  lines.push("");
  lines.push(
    `字符数 ${[...pkg.title].length} / ${DOUYIN_TITLE_MAX}（超出会被截断）`,
  );
  lines.push("");
  lines.push("```");
  lines.push(pkg.title);
  lines.push("```");
  lines.push("");

  lines.push("## 文案");
  lines.push("");
  lines.push(
    `字符数 ${[...pkg.description].length} / ${DOUYIN_DESCRIPTION_MAX}`,
  );
  lines.push("");
  lines.push(pkg.description);
  lines.push("");

  lines.push("## 话题");
  lines.push("");
  if (pkg.topics.length === 0) {
    lines.push("⚠️ 没有匹配到话题，请手动补几个观众会搜的词。");
  } else {
    lines.push(
      `数量 ${pkg.topics.length} / ${DOUYIN_TOPICS_MAX}（每个 ≤ ${DOUYIN_TOPIC_MAX} 字符）`,
    );
    lines.push("");
    lines.push(pkg.topics.map((t) => `#${t}`).join(" "));
  }
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
  lines.push("- **封面**：见上，竖屏 3:4 封面框，主体居中偏上。");
  lines.push(
    "- **允许下载 / 允许合拍**：默认关；开了更容易被二次创作，但也会被搬运。",
  );
  lines.push("- **位置**：抖音可以挂 POI，创作者中心里能选。");
  lines.push(
    "- **作品可见性**：建议先「仅自己可见」确认无误再改公开。",
  );
  lines.push(
    "- **字幕**：如需 CC 字幕，本流水线只生成 `captions/*.srt`，未做样式化。",
  );
  lines.push("");

  return lines.join("\n");
}
