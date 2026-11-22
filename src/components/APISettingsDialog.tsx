import { ExternalLink, LockKeyhole, X } from "lucide-react";

import { useWorkbenchContext } from "../hooks/WorkbenchContext";
export default function APISettingsDialog() {
  const { section, setSettings, ai, setAI, notify } = useWorkbenchContext();
  return (
    <section
      className="settings-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="modal-heading">
        <div>
          <p className="eyebrow">OPTIONAL AI ASSISTANT</p>
          <h2 id="settings-title">让 AI 帮你想一想。</h2>
        </div>
        <button
          className="icon-button"
          onClick={() => setSettings(false)}
          aria-label="关闭设置"
        >
          <X size={20} />
        </button>
      </div>
      <p>辅助比较变调夹候选。基础转谱、编配与导出无需 API Key。</p>
      <label>
        API 地址
        <input
          value={ai.endpoint}
          onChange={(e) => setAI({ ...ai, endpoint: e.target.value })}
        />
      </label>
      <label>
        模型名称
        <input
          value={ai.model}
          onChange={(e) => setAI({ ...ai, model: e.target.value })}
        />
      </label>
      <label>
        API Key
        <input
          type="password"
          autoComplete="off"
          value={ai.key}
          onChange={(e) => setAI({ ...ai, key: e.target.value })}
          placeholder="仅保留在当前页面内存"
        />
      </label>
      <div className="privacy-note">
        <LockKeyhole size={19} />
        <span>
          仅发送难度、数量与候选评分，不发送音频、文件名或音符序列。Key
          直接提交到你填写的服务地址，不保存、不进入项目文件。请求可能产生费用。
        </span>
      </div>
      <div className="dialog-actions">
        <button
          className="text-button"
          onClick={() => setAI({ ...ai, key: "" })}
        >
          清除 Key
        </button>
        <button
          className="button primary"
          onClick={() => {
            setSettings(false);
            notify("API 设置仅在本次页面会话内有效。");
          }}
        >
          完成设置
        </button>
      </div>
      <a
        className="muted"
        href="https://help.aliyun.com/zh/model-studio/get-api-key"
        target="_blank"
        rel="noreferrer"
      >
        获取百炼 API Key <ExternalLink size={12} />
      </a>
    </section>
  );
}
