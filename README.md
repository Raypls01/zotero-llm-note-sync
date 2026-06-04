# LLM Note Auto-Sync

**Zotero 9 插件** — 自动将 [zotero-llm](https://github.com/MuiseDestiny/zotero-llm) 的 AI 对话追加到对应文献的已有笔记中。

## 功能

- ✅ **自动同步** — 检测 zotero-llm 新对话，追加到文献已有笔记
- ✅ **增量追加** — 只追加新消息，不重复处理已同步的内容
- ✅ **不干扰手动保存** — 使用独立追踪，不影响 zotero-llm 的 assistantNoteMap
- ✅ **后台轮询** — 可配置检查间隔（默认 60 秒）
- ✅ **灵活格式** — 支持追加到笔记末尾/开头，显示/隐藏模型名称和时间戳
- ✅ **GUI 设置** — 提供设置对话框和 Zotero 偏好面板
- ✅ **右键菜单** — 工具菜单中可手动触发"追加到笔记"操作

## 安装

1. 下载最新 [llm-note-sync.xpi](https://github.com/Raypls01/zotero-llm-note-sync/releases)
2. 在 Zotero 中：**工具 → 附加组件 → ⚙️ → Install Add-on From File...**
3. 选择下载的 `.xpi` 文件
4. 重启 Zotero

## 使用

安装后插件自动运行，无需额外配置。如需调整：

1. **工具 → zotero-llm 对话 → 追加到笔记** — 手动触发批量追加
2. **工具 → LLM Sync 设置** — 打开设置对话框，可配置：
   - 检查间隔（秒）
   - 追加位置（末尾/开头）
   - 是否显示模型名称
   - 是否显示对话日期标题

也可以从 Zotero 的 **工具 → 设置 → LLM Sync** 面板配置。

## 工作原理

插件每 N 秒查询 zotero-llm 的 `llm_for_zotero_chat_messages` 表，识别未处理的对话，将对话内容格式化为 HTML 后追加到文献的子笔记中。

- 如果文献已有笔记，追加到该笔记
- 如果文献没有笔记，自动创建新笔记
- 用独立 pref `extensions.zotero.llmnotesync.processedKeys` 追踪已处理内容

## 兼容性

- Zotero 9.0+
- 需要已安装 [zotero-llm](https://github.com/MuiseDestiny/zotero-llm) 插件

## 从源码构建

```bash
git clone https://github.com/Raypls01/zotero-llm-note-sync.git
cd zotero-llm-note-sync
python build_xpi.py
```

输出: `llm-note-sync.xpi`

## 许可证

[MIT](LICENSE)
