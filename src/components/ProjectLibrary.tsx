import { Guitar, Headphones, Music2, Piano, Pin, Upload } from "lucide-react";
import { useRef, useEffect, useState } from "react";
import type { MusicProject, ProjectCardStyle } from "../../packages/contracts";
import {
  listProjects,
  removeProject,
  saveProject,
} from "../../packages/storage";
import { nativeHost } from "../edition";
import { useWorkbenchContext } from "../hooks/WorkbenchContext";

const icons = {
  music: Music2,
  guitar: Guitar,
  piano: Piano,
  headphones: Headphones,
};
const iconLabels = {
  music: "音符",
  guitar: "吉他",
  piano: "钢琴",
  headphones: "耳机",
};
const colors = { sage: "苔绿", sand: "暖砂", blue: "雾蓝", plum: "浅梅" };
const defaults: ProjectCardStyle = {
  icon: "music",
  color: "sage",
  tags: [],
  pinned: false,
};

export default function ProjectLibrary() {
  const c = useWorkbenchContext();
  const [editing, setEditing] = useState<MusicProject>();
  const [tag, setTag] = useState("");
  const [saving, setSaving] = useState(false);
  const tags = [
    ...new Set(c.projects.flatMap((p) => p.card?.tags ?? [])),
  ].sort();
  const projects = [...c.projects]
    .filter((p) => !tag || p.card?.tags.includes(tag))
    .sort(
      (a, b) =>
        Number(!!b.card?.pinned) - Number(!!a.card?.pinned) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  const refresh = async () => c.setProjects(await listProjects());
  async function apply(project: MusicProject) {
    setSaving(true);
    try {
      const isCurrent = c.project.id === project.id;
      const data = isCurrent
        ? { ...c.project, name: project.name, card: project.card }
        : project;
      await saveProject(data);
      if (isCurrent) c.edit(data, false);
      await refresh();
      setEditing(undefined);
    } catch (error) {
      c.notify(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className="project-library">
      <header className="section-title">
        <div>
          <h1>我的作品</h1>
          <p>保存、整理与继续创作</p>
        </div>
        <button
          className="button primary"
          onClick={() => c.projectInput.current?.click()}
        >
          <Upload size={16} />
          导入项目
        </button>
      </header>
      {!!tags.length && (
        <label className="project-filter">
          按标签筛选
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">全部作品</option>
            {tags.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
      )}
      <div className="project-grid">
        {projects.map((p) => {
          const style = p.card ?? defaults,
            Icon = icons[style.icon];
          return (
            <article
              key={p.id}
              className="project-card compact-card"
              data-color={style.color}
            >
              <header>
                <span className="project-art">
                  <Icon size={23} />
                </span>
                {style.pinned && <Pin size={15} aria-label="已置顶" />}
              </header>
              <h2 title={p.name}>{p.name}</h2>
              <p>
                {p.piano
                  ? p.arrangement
                    ? "钢琴 · 吉他"
                    : "钢琴"
                  : p.arrangement
                    ? "吉他"
                    : "音符工程"}{" "}
                · {Math.floor(p.duration / 60)}:
                {String(Math.floor(p.duration) % 60).padStart(2, "0")}
              </p>
              {!!style.tags.length && (
                <ul className="project-tags">
                  {style.tags.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              )}
              <small>{new Date(p.updatedAt).toLocaleDateString("zh-CN")}</small>
              <div className="project-card-actions">
                <button
                  className="button primary small"
                  onClick={() => c.openProject(p)}
                >
                  继续创作
                </button>
                <button
                  className="button secondary small"
                  onClick={() => setEditing(p)}
                >
                  编辑卡片
                </button>
              </div>
            </article>
          );
        })}
      </div>
      {!projects.length && (
        <div className="empty-panel">
          {tag ? "没有此标签的作品。" : "生成或编辑后的作品会保存在这里。"}
        </div>
      )}
      {editing && (
        <CardDialog
          project={editing}
          close={() => setEditing(undefined)}
          saving={saving}
          save={apply}
          remove={async () => {
            if (!window.confirm("删除此作品及关联录音？")) return;
            await removeProject(editing.id);
            c.clearProjectAudio(editing.id);
            await refresh();
            setEditing(undefined);
            c.notify(
              nativeHost()
                ? "作品已从本机删除。"
                : "作品及其关联录音已从此浏览器删除。",
            );
          }}
        />
      )}
    </section>
  );
}

function CardDialog({
  project,
  close,
  save,
  remove,
  saving,
}: {
  project: MusicProject;
  close: () => void;
  save: (p: MusicProject) => Promise<void>;
  remove: () => Promise<void>;
  saving: boolean;
}) {
  const [name, setName] = useState(project.name),
    [card, setCard] = useState(project.card ?? defaults),
    [labels, setLabels] = useState(card.tags.join("，"));
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="global-settings"
      aria-labelledby="card-editor"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <h2 id="card-editor">编辑作品卡片</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save({
            ...project,
            name: name.trim(),
            card: {
              ...card,
              tags: [
                ...new Set(
                  labels
                    .split(/[,，]/)
                    .map((t) => t.trim().slice(0, 20))
                    .filter(Boolean),
                ),
              ].slice(0, 6),
            },
          });
        }}
      >
        <label>
          作品名称
          <input
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="settings-fields">
          <label>
            图标
            <select
              value={card.icon}
              onChange={(e) =>
                setCard({
                  ...card,
                  icon: e.target.value as ProjectCardStyle["icon"],
                })
              }
            >
              {Object.entries(iconLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            配色
            <select
              value={card.color}
              onChange={(e) =>
                setCard({
                  ...card,
                  color: e.target.value as ProjectCardStyle["color"],
                })
              }
            >
              {Object.entries(colors).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          标签
          <input
            value={labels}
            onChange={(e) => setLabels(e.target.value)}
            maxLength={140}
            placeholder="用逗号分隔，最多六个"
          />
        </label>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={card.pinned}
            onChange={(e) => setCard({ ...card, pinned: e.target.checked })}
          />
          置顶
        </label>
        <div className="settings-actions">
          <button
            type="button"
            className="text-button"
            onClick={() => void remove()}
          >
            删除作品
          </button>
          <button type="button" className="button secondary" onClick={close}>
            取消
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={!name.trim() || saving}
          >
            保存
          </button>
        </div>
      </form>
    </dialog>
  );
}
