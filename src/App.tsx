import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  FolderHeart,
  Info,
  Gamepad2,
  Layers3,
  Puzzle,
  Settings2,
  X,
} from "lucide-react";
import UnifiedWorkspace from "./components/UnifiedWorkspace";

import { saveProject } from "../packages/storage";
import PluginCenter from "./components/PluginCenter";

import APISettingsDialog from "./components/APISettingsDialog";
import { useWorkbench } from "./hooks/useWorkbench";
import { WorkbenchContext } from "./hooks/WorkbenchContext";
import ProjectLibrary from "./components/ProjectLibrary";
import PracticePage from "./components/PracticePage";
import { nativeHost, pagesEdition } from "./edition";
import {
  getPreference,
  setPreference,
  textSizes,
  type TextSize,
} from "./preferences";
import "./experience.css";

export default function App() {
  const controller = useWorkbench();
  const latest = useRef(controller);
  latest.current = controller;
  const host = nativeHost();
  useEffect(() => {
    if (!host) return;
    const receive = (event: Event) => {
      const controller = latest.current;
      const value = (event as MessageEvent).data;
      if (typeof value === "string" && value.startsWith("runtime:"))
        controller.notify(value.slice(8));
      switch ((event as MessageEvent).data) {
        case "open-settings":
          controller.setSettings(true);
          break;
        case "models-selected":
          controller.notify("模型目录已保存，重启后生效。");
          break;
        case "pause":
          controller.stop();
          break;
        case "restore":
          controller.transport.seek(controller.transport.snapshot().position);
          break;
        case "save-and-exit":
          controller.stop();
          void (
            !controller.saved.startsWith("作品已删除") &&
            (controller.project.sourceKind !== "demo" ||
              controller.saved !== "原创示例 · 尚未修改")
              ? saveProject(controller.project)
              : Promise.resolve()
          ).then(
            () => {
              controller.abortRef.current?.abort();
              host.postMessage("saved");
            },
            () => host.postMessage("save-failed"),
          );
          break;
      }
    };
    host.addEventListener("message", receive);
    return () => host.removeEventListener("message", receive);
  }, [host]);
  useEffect(() => {
    if (controller.ready) host?.postMessage("ready");
  }, [host, controller.ready]);
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
    message,
    setMessage,
    notify,
    projectInput,
    settings,
    setSettings,
  } = controller;
  const [size, setSize] = useState<TextSize>(() => {
    const value = getPreference<TextSize>("text-size", "standard");
    return Object.hasOwn(textSizes, value) ? value : "standard";
  });
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--ui-scale",
      String(textSizes[size]),
    );
    setPreference("text-size", size);
  }, [size]);
  return (
    <div className="app-shell" data-page={page}>
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
            className={page === "practice" ? "active" : ""}
            onClick={() => section("practice")}
          >
            <Gamepad2 size={19} />
            {pagesEdition ? "键盘试玩" : "键盘练习"}
          </button>
          {!pagesEdition && (
            <button
              className={page === "plugins" ? "active" : ""}
              onClick={() => section("plugins")}
            >
              <Puzzle size={19} />
              插件中心
              {controller.pluginCount !== null && (
                <span className="nav-badge">{controller.pluginCount}</span>
              )}
            </button>
          )}
          <a href="docs/index.html" target="_blank" rel="noreferrer">
            <BookOpen size={19} />
            使用与开发文档
            <ArrowUpRight size={14} />
          </a>
        </nav>
        <div className="sidebar-bottom">
          <a
            href="https://github.com/h0ll0w-AkuZr0guY/Stringcraft"
            target="_blank"
            rel="noreferrer"
          >
            GitHub 开源项目 <ArrowUpRight size={14} />
          </a>
          <span className="version">{__APP_VERSION__}</span>
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
                : page === "practice"
                  ? "键盘练习"
                  : "插件中心"}
          </div>
          <div className="topbar-actions">
            <span className="local-build">
              {__APP_VERSION__} · {__BUILD_SHA__}
            </span>
            <span className="local-status">
              <i />
              本机处理
            </span>
            {
              <button
                className="icon-button"
                title="全局设置"
                aria-label="全局设置"
                onClick={() => setSettings(true)}
              >
                <Settings2 size={19} />
              </button>
            }
            <a
              className="download-app"
              href={`${import.meta.env.BASE_URL}docs/LOCAL_TRIAL.html`}
              target="_blank"
              rel="noreferrer"
            >
              <BookOpen size={15} />
              本地试用说明
            </a>
          </div>
        </header>
        <main className="main-content" data-page={page}>
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
          {import.meta.env.MODE !== "pages" && page === "plugins" ? (
            <PluginCenter notify={notify} />
          ) : page === "projects" ? (
            <ProjectLibrary />
          ) : page === "practice" ? (
            <PracticePage />
          ) : (
            <UnifiedWorkspace />
          )}
        </main>
      </div>
      <input
        ref={projectInput}
        type="file"
        accept={controller.local ? ".json,.zip,.stringcraft" : ".json"}
        data-testid="project-import"
        className="visually-hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          await controller.importFile(f);
          e.target.value = "";
        }}
      />
      {settings && <APISettingsDialog size={size} setSize={setSize} />}
    </div>
  );
}
