import { useEffect, useRef } from "react";
import { LockKeyhole, X } from "lucide-react";
import { useWorkbenchContext } from "../hooks/WorkbenchContext";
import { nativeHost, pagesEdition } from "../edition";
import { setPreference, textLabels, type TextSize } from "../preferences";

export default function APISettingsDialog({
  size,
  setSize,
}: {
  size: TextSize;
  setSize: (size: TextSize) => void;
}) {
  const c = useWorkbenchContext();
  const host = nativeHost();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const close = () => {
    setPreference("provider", {
      endpoint: c.ai.endpoint.trim(),
      model: c.ai.model.trim(),
    });
    c.setSettings(false);
  };
  return (
    <dialog
      ref={dialog}
      className="global-settings"
      aria-labelledby="settings-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header className="settings-header">
        <h2 id="settings-title">全局设置</h2>
        <button className="icon-button" aria-label="关闭设置" onClick={close}>
          <X size={20} />
        </button>
      </header>
      <section>
        <h3>显示</h3>
        <label>
          界面文字
          <select
            value={size}
            onChange={(e) => setSize(e.target.value as TextSize)}
          >
            {Object.entries(textLabels).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </section>
      {!pagesEdition && (
        <section>
          <h3>AI 变调夹建议</h3>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={c.useAI}
              onChange={(e) => c.setUseAI(e.target.checked)}
            />
            启用 AI 建议
          </label>
          <div className="settings-fields">
            <label>
              API 地址
              <input
                value={c.ai.endpoint}
                onChange={(e) => c.setAI({ ...c.ai, endpoint: e.target.value })}
              />
            </label>
            <label>
              模型名称
              <input
                value={c.ai.model}
                onChange={(e) => c.setAI({ ...c.ai, model: e.target.value })}
              />
            </label>
          </div>
          <label>
            API Key
            <input
              type="password"
              autoComplete="off"
              value={c.ai.key}
              onChange={(e) => c.setAI({ ...c.ai, key: e.target.value })}
              placeholder="仅保留在本次会话"
            />
          </label>
          <p className="settings-privacy">
            <LockKeyhole size={16} />
            开启后仅提交变调夹候选评分、音符数量与难度。请求可能产生费用。
          </p>
          <button
            className="button secondary small"
            onClick={() => c.setAI({ ...c.ai, key: "" })}
          >
            清除 Key
          </button>
        </section>
      )}
      {host && (
        <section>
          <h3>本地模型</h3>
          <p>
            {c.engineState?.message ?? "正在查看模型状态"}。目录变更后重启应用。
          </p>
          <button
            className="button secondary small"
            onClick={() => host.postMessage("choose-models")}
          >
            选择模型目录
          </button>
        </section>
      )}
      <section>
        <h3>关于弦作</h3>
        <p>
          {__APP_VERSION__} · {__BUILD_SHA__}
        </p>
        {host && (
          <div className="settings-actions">
            <button
              className="button secondary small"
              onClick={() => host.postMessage("open-data")}
            >
              打开数据目录
            </button>
            <button
              className="button secondary small"
              onClick={() => host.postMessage("quit")}
            >
              退出弦作
            </button>
          </div>
        )}
      </section>
      <footer>
        <button className="button primary" onClick={close}>
          完成设置
        </button>
      </footer>
    </dialog>
  );
}
