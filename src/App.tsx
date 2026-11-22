import {
  ArrowUpRight,
  BookOpen,
  Download,
  FolderHeart,
  Guitar,
  Headphones,
  Info,
  Layers3,
  Music2,
  Puzzle,
  Settings2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { validateProject } from "../packages/contracts";

import { del } from "idb-keyval";
import { listProjects, removeProject } from "../packages/storage";
import PluginCenter from "./components/PluginCenter";

import APISettingsDialog from "./components/APISettingsDialog";
import ScorePanel from "./components/ScorePanel";
import SourceControls from "./components/SourceControls";
import { errorMessage, useWorkbench } from "./hooks/useWorkbench";
import { WorkbenchContext } from "./hooks/WorkbenchContext";
export default function App() {
  const controller = useWorkbench();
  return (
    <WorkbenchContext.Provider value={controller}>
      <WorkbenchView controller={controller} />
    </WorkbenchContext.Provider>
  );
}
function WorkbenchView({
  controller,
}: {
  controller: ReturnType<typeof useWorkbench>;
}) {
  const {
    section,
    page,
    setSettings,
    message,
    setMessage,
    notify,
    projectInput,
    projects,
    notes,
    length,
    openProject,
    setProjects,
    ready,
    busy,
    useDemo,
    settings,
  } = controller;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            section("workbench");
          }}
        >
          <span className="brand-mark">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            弦作<small>STRINGCRAFT</small>
          </span>
        </a>
        <div className="sidebar-caption">你的音乐，新的可能</div>
        <nav aria-label="主导航">
          <button
            className={page === "workbench" ? "active" : ""}
            onClick={() => section("workbench")}
          >
            <Layers3 size={19} />
            音乐工作台
          </button>
          <button
            className={page === "projects" ? "active" : ""}
            onClick={() => section("projects")}
          >
            <FolderHeart size={19} />
            我的作品
          </button>
          <button
            className={page === "plugins" ? "active" : ""}
            onClick={() => section("plugins")}
          >
            <Puzzle size={19} />
            插件中心<span className="nav-badge">7</span>
          </button>
          <a href="docs/index.html" target="_blank" rel="noreferrer">
            <BookOpen size={19} />
            使用与开发文档
            <ArrowUpRight size={14} />
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-card">
            <span className="local-icon">
              <Guitar size={21} />
            </span>
            <strong>
              在自己的节奏里，
              <br />
              慢慢靠近音乐。
            </strong>
            <p>
              基础处理在浏览器完成
              <br />
              音乐和创作，由你掌握
            </p>
          </div>
          <a
            href="https://github.com/h0ll0w-AkuZr0guY/Stringcraft"
            target="_blank"
            rel="noreferrer"
          >
            GitHub 开源项目 <ArrowUpRight size={14} />
          </a>
          <span className="version">v0.1.0-preview · 为每一次练习而作</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            弦作 <span>/</span>{" "}
            {page === "workbench"
              ? "音乐工作台"
              : page === "projects"
                ? "我的作品"
                : "插件中心"}
          </div>
          <div className="topbar-actions">
            <span className="local-status">
              <i />
              本机处理
            </span>
            <button
              className="icon-button"
              title="API 设置"
              aria-label="API 设置"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={19} />
            </button>
            <a
              className="download-app"
              href="https://github.com/h0ll0w-AkuZr0guY/Stringcraft/releases"
              target="_blank"
              rel="noreferrer"
            >
              <Download size={15} />
              本地增强版
            </a>
          </div>
        </header>
        <main className="main-content">
          {message && (
            <div className="toast" role="status">
              <Info size={17} />
              <span>{message}</span>
              <button
                className="icon-button"
                onClick={() => setMessage("")}
                aria-label="关闭提示"
              >
                <X size={15} />
              </button>
            </div>
          )}
          {page === "plugins" ? (
            <PluginCenter notify={notify} />
          ) : page === "projects" ? (
            <>
              <div className="section-title">
                <div>
                  <p className="eyebrow">YOUR MUSICAL JOURNEY</p>
                  <h1>每一段旋律，都值得留下。</h1>
                  <p className="muted">
                    项目保存在当前浏览器。导出项目文件，可以备份并带到另一台设备。
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => projectInput.current?.click()}
                >
                  <Upload size={16} />
                  导入项目
                </button>
              </div>
              <div className="project-grid">
                {projects.map((p) => (
                  <article className="project-card" key={p.id}>
                    <span className="project-art">
                      <Music2 size={35} />
                    </span>
                    <h2>{p.name}</h2>
                    <p>
                      {p.arrangement?.notes.length ?? 0} 个编配音符 ·{" "}
                      {p.duration.toFixed(1)}s
                    </p>
                    <small>
                      {new Date(p.updatedAt).toLocaleString("zh-CN")}
                    </small>
                    <div className="plugin-actions">
                      <button
                        className="button primary"
                        onClick={() => openProject(p)}
                      >
                        继续创作
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`删除 ${p.name}`}
                        onClick={async () => {
                          await removeProject(p.id);
                          await del("audio:" + p.id);
                          setProjects(await listProjects());
                        }}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!projects.length && (
                <div className="empty-panel">
                  还没有保存的作品。工作台会自动保存你的修改。
                </div>
              )}
            </>
          ) : (
            <>
              <section className="workbench-heading">
                <div>
                  <p className="eyebrow">FROM LISTENING TO PLAYING</p>
                  <h1>
                    让喜欢的旋律，<em>在指尖响起。</em>
                  </h1>
                  <p>从一首喜欢的歌开始，找到属于自己的弹奏方式。</p>
                </div>
                <button
                  className="button secondary demo-button"
                  disabled={!ready || !!busy}
                  onClick={useDemo}
                >
                  <Headphones size={17} />
                  体验原创示例
                </button>
              </section>
              <div className="workspace">
                <SourceControls />
                <ScorePanel />
              </div>
              <footer className="page-footer">
                <span>弦作，为每一次练习而作。</span>
                <span>复杂混音可能错音或漏音，编配请结合试听与试弹核对。</span>
              </footer>
            </>
          )}
        </main>
      </div>
      <input
        ref={projectInput}
        type="file"
        accept=".json"
        className="visually-hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            if (f.size > 10 * 1024 * 1024) throw new Error("项目文件过大");
            const p = JSON.parse(await f.text());
            validateProject(p);
            await openProject(p);
          } catch (err) {
            notify(errorMessage(err));
          }
          e.target.value = "";
        }}
      />
      {settings && (
        <div className="modal-backdrop" onClick={() => setSettings(false)}>
          <APISettingsDialog />
        </div>
      )}
    </div>
  );
}
