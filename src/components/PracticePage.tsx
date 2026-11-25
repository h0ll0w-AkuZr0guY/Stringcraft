import { useEffect, useMemo, useRef, useState } from "react";
import { Gamepad2, Keyboard, Pause, Play } from "lucide-react";
import type {
  PracticeAttack,
  PracticeChart,
  PracticeChord,
  PracticeMode,
  PracticePlugin,
  PracticeReport,
} from "../../packages/contracts/practice";
import type { PlaybackDriver } from "../../packages/music/transport";
import type { MusicPlugin, NoteEvent } from "../../packages/contracts";
import { load } from "../../packages/plugin-host";
import { noteName } from "../../packages/music/demo";
import { demoChart, demoPractice } from "../../plugins/practice-demo";
import { projectChart } from "../../plugins/practice-demo/project";
import { nativeHost, pagesEdition } from "../edition";
import { getPreference, setPreference } from "../preferences";
import { useWorkbenchContext } from "../hooks/WorkbenchContext";
import { useTransport } from "../hooks/useTransport";
import { playPracticeTone } from "./practice-audio";
import "./practice.css";

import {
  guitarKeys,
  legacyGuitarKeys,
  pianoKeys,
  splitKeys,
  whiteAnchors,
  type PracticeHand,
} from "./practice-keys";

const modeLabel = { free: "自由弹奏", rhythm: "按拍跟练", wait: "等弹对" };
const verdict = {
  perfect: "精准",
  good: "良好",
  hit: "命中",
  missed: "漏弹",
  wrong: "错键",
  early: "偏早",
  late: "偏晚",
};
const rounded = (n: number) => n.toFixed(1);
type Binding = {
  code: string;
  token: string;
  pitches: number[];
  label: string;
};
const showCode = (key: string) =>
  key
    .replace(/^(Key|Digit)/, "")
    .replace("BracketLeft", "[")
    .replace("BracketRight", "]")
    .replace("Semicolon", ";")
    .replace("Quote", "'")
    .replace("ArrowDown", "↓")
    .replace("ArrowUp", "↑");

export default function PracticePage() {
  const c = useWorkbenchContext();
  const [full, setFull] = useState<{
    plugin: PracticePlugin;
    version: string;
  }>();
  const [instrument, setInstrument] = useState<"piano" | "guitar">("piano");
  const [source, setSource] = useState<"demo" | "project">("demo");
  useEffect(() => {
    if (import.meta.env.MODE !== "pages" && nativeHost())
      void import("../../packages/plugin-host/practice")
        .then((p) => p.privatePractice())
        .then(setFull)
        .catch((e) => c.notify(e.message));
  }, []);
  const chart = useMemo(
    () =>
      source === "project" && full
        ? projectChart(c.project, instrument)
        : demoChart(instrument),
    [source, instrument, c.project, full],
  );
  return (
    <section className="practice-page">
      <header className="practice-heading">
        <Gamepad2 size={25} />
        <div>
          <h1>{pagesEdition ? "键盘试玩" : "键盘练习"}</h1>
          <p>
            {full
              ? "用电脑键盘弹自己的作品，也可以先选原创练习。"
              : "用电脑键盘跟弹原创小节，先听一遍，再跟上拍子。"}
          </p>
        </div>
      </header>
      <div className="practice-choices">
        <div role="group" aria-label="练习乐器">
          <button
            aria-pressed={instrument === "piano"}
            onClick={() => setInstrument("piano")}
          >
            钢琴
          </button>
          <button
            aria-pressed={instrument === "guitar"}
            onClick={() => setInstrument("guitar")}
          >
            吉他
          </button>
        </div>
        {full && (
          <label>
            练习素材
            <select
              value={source}
              onChange={(e) => setSource(e.target.value as typeof source)}
            >
              <option value="demo">原创练习</option>
              <option value="project">当前作品</option>
            </select>
          </label>
        )}
        {!pagesEdition && nativeHost() && !full && (
          <button
            className="button secondary small"
            onClick={() => c.section("plugins")}
          >
            导入完整练习插件
          </button>
        )}
      </div>
      {chart ? (
        <PracticeStudio
          key={instrument + source + c.project.id + Boolean(full)}
          chart={chart}
          engine={full?.plugin ?? demoPractice}
          detailed={!!full}
        />
      ) : (
        <p className="empty-panel">
          先在工作台生成{instrument === "piano" ? "钢琴双手谱" : "吉他编配"}
          ，即可练习当前作品。
        </p>
      )}
    </section>
  );
}
function PracticeStudio({
  chart,
  engine,
  detailed,
}: {
  chart: PracticeChart;
  engine: PracticePlugin;
  detailed: boolean;
}) {
  const { transport } = useWorkbenchContext();
  const snap = useTransport(transport);
  const [mode, setMode] = useState<PracticeMode>("rhythm");
  const [rangeStart, setStart] = useState(0),
    [rangeEnd, setEnd] = useState(chart.duration),
    [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState(1),
    [offset, setOffset] = useState(() =>
      detailed ? getPreference("practice-offset", 0) : 0,
    );
  const [reference, setReference] = useState(false);
  const [report, setReport] = useState<PracticeReport>({
    hits: 0,
    misses: 0,
    wrong: 0,
    history: [],
  });
  const [sessionActive, setActive] = useState(false);
  const [bases, setBases] = useState(() =>
    getPreference("practice-octaves", { left: 48, right: 60 }),
  );
  const [layout, setLayout] = useState<"split" | "wide" | "legacy">("split");
  const [keyMap, setKeyMap] = useState<Record<string, string>>(() =>
    getPreference("practice-keys-v2", {}),
  );
  const [remap, setRemap] = useState<string>();
  const [bank, setBank] = useState(0);
  const [selected, setSelected] = useState<PracticeChord | null>(
    chart.chords[0] ?? null,
  );
  const [held, setHeld] = useState<string[]>([]);
  const [focusResult, setFocusResult] = useState<number | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const pressStop = useRef(new Map<string, () => void>());
  const board = useRef<HTMLDivElement>(null);
  const run = useMemo(
    () => engine.create(chart, mode, offset),
    [engine, chart, mode, offset],
  );
  const [waitAt, setWaitAt] = useState(rangeStart);
  const current = useRef({ playing: false, position: rangeStart, base: 0 });
  const piano = chart.instrument === "piano";
  const [sampleRenderer, setSampleRenderer] = useState<MusicPlugin>();
  const [toneStatus, setToneStatus] = useState("检查钢琴音色");
  useEffect(() => {
    if (!piano) return;
    let alive = true;
    const ctx = new OfflineAudioContext(1, 32, 24000);
    const notes: NoteEvent[] = Array.from({ length: 30 }, (_, index) => ({
      id: "key-" + index,
      start: 0,
      duration: 0.2,
      pitch: { midi: 21 + index * 3 },
      velocity: 0.56,
      score: 1,
      source: "demo",
    }));
    void load("piano-samples")
      .then(async (plugin) => {
        await plugin.prepareAudio?.(ctx, notes, "grand");
        if (alive) {
          setSampleRenderer(plugin);
          setToneStatus(
            plugin.hasSamples?.(notes)
              ? "实录钢琴 · Salamander"
              : "合成键盘 · 采样未齐",
          );
        }
      })
      .catch(() => {
        if (alive) setToneStatus("合成键盘 · 采样未启用");
      });
    return () => {
      alive = false;
    };
  }, [piano]);
  const sound = (
    ctx: AudioContext,
    midi: number,
    at: number,
    duration?: number,
  ) =>
    (piano
      ? sampleRenderer?.playSampleNote?.(ctx, midi, 0.56, at, duration)
      : undefined) ??
    playPracticeTone(ctx, midi, chart.instrument, at, duration);
  const chordPage = chart.chords.slice(bank * 8, bank * 8 + 8);
  const guitarLayout = layout === "legacy" ? legacyGuitarKeys : guitarKeys;
  const chordKeys = guitarLayout.chords;
  const pick = guitarLayout.strings;
  const choices = piano
    ? pianoKeys(
        layout,
        bases.left,
        layout === "wide" ? Math.floor(bases.right / 12) * 12 : bases.right,
      ).map((key) => ({
        ...key,
        token: "key:" + key.hand + ":" + key.midi,
        pitches: [key.midi],
        label: noteName(key.midi),
      }))
    : [];
  const layoutPrefix = chart.instrument + ":" + layout + ":";
  const oldKeyMap =
    layout === "legacy"
      ? getPreference<Record<string, string>>("practice-keys", {})
      : {};
  const mapCode = (code: string) =>
    keyMap[layoutPrefix + code] ??
    oldKeyMap[chart.instrument + ":" + code] ??
    code;
  const release = (code: string) => {
    pressStop.current.get(code)?.();
    pressStop.current.delete(code);
    setHeld([...pressStop.current.keys()]);
  };
  const releaseAll = () => {
    for (const stop of pressStop.current.values()) stop();
    pressStop.current.clear();
    setHeld([]);
  };
  const context = () => {
    const ctx = audio.current ?? (audio.current = new AudioContext());
    void ctx.resume();
    return ctx;
  };
  const refresh = () => setReport(run.report());
  useEffect(() => {
    const previous = transport.snapshot();
    transport.pause();
    transport.setLoop(null);
    transport.setDuration(chart.duration);
    transport.seek(0);
    return () => {
      transport.pause();
      transport.setLoop(null);
      transport.setDuration(previous.duration);
      transport.setSpeed(previous.speed);
      transport.seek(previous.position);
      transport.setLoop(previous.loop);
      releaseAll();
      void audio.current?.close().catch(() => {});
      audio.current = null;
    };
  }, [transport, chart.duration]);
  useEffect(() => {
    transport.pause();
    transport.setLoop(null);
    transport.setSpeed(speed);
    transport.setDuration(rangeEnd);
    transport.seek(rangeStart);
    setWaitAt(rangeStart);
    run.begin(rangeStart, rangeEnd);
    setActive(false);
    setFocusResult(null);
    refresh();
    releaseAll();
  }, [run, transport, rangeStart, rangeEnd, loop, speed]);
  useEffect(() => {
    if (mode !== "rhythm" || !sessionActive) return;
    let last = transport.snapshot();
    return transport.subscribe(() => {
      const next = transport.snapshot();
      if (
        next.seekRevision !== last.seekRevision ||
        next.position < last.position - 0.01
      ) {
        run.begin(Math.max(rangeStart, next.position), rangeEnd);
        releaseAll();
      }
      if (next.status === "playing") run.tick(next.position, next.speed);
      if (last.status === "playing" && next.status === "paused") {
        releaseAll();
        if (next.position >= rangeEnd - 0.001)
          run.tick(rangeEnd + 0.22, next.speed);
      }
      const a = run.report();
      if (
        a.history.length !== report.history.length ||
        a.hits !== report.hits ||
        a.wrong !== report.wrong ||
        a.misses !== report.misses
      )
        setReport(a);
      last = next;
    });
  }, [
    transport,
    run,
    sessionActive,
    mode,
    rangeStart,
    rangeEnd,
    report.hits,
    report.misses,
    report.wrong,
    report.history.length,
  ]);
  const position = mode === "wait" ? waitAt : snap.position;
  const audioDriver: PlaybackDriver = async (from, to, speed, valid) => {
    const ctx = context();
    await ctx.resume();
    const origin = ctx.currentTime + 0.05;
    current.current = { playing: true, position: from, base: origin };
    const scheduled: (() => void)[] = [];
    if (reference) {
      let next = chart.attacks.findIndex((a) => a.at >= from);
      const schedule = () => {
        if (!valid() || next < 0) return;
        const limit = from + (ctx.currentTime - origin + 0.12) * speed;
        while (
          chart.attacks[next] &&
          chart.attacks[next].at <= limit &&
          chart.attacks[next].at < Math.min(to, rangeEnd)
        ) {
          const a = chart.attacks[next++],
            at = origin + (a.at - from) / speed;
          if (at >= ctx.currentTime - 0.015)
            a.pitches.forEach((m, i) =>
              scheduled.push(
                sound(
                  ctx,
                  m,
                  Math.max(ctx.currentTime, at) + i * 0.012,
                  Math.min(0.34, a.duration / speed),
                ),
              ),
            );
        }
      };
      schedule();
      const timer = setInterval(schedule, 35);
      return {
        position: () =>
          Math.min(
            rangeEnd,
            from + Math.max(0, ctx.currentTime - origin) * speed,
          ),
        stop: () => {
          clearInterval(timer);
          for (const stop of scheduled) stop();
          current.current.playing = false;
        },
      };
    }
    return {
      position: () =>
        Math.min(
          rangeEnd,
          from + Math.max(0, ctx.currentTime - origin) * speed,
        ),
      stop: () => {
        current.current.playing = false;
      },
    };
  };
  const start = () => {
    if (mode === "free") {
      board.current?.focus();
      void context();
      return;
    }
    if (snap.status !== "paused") {
      transport.pause();
      releaseAll();
      return;
    }
    board.current?.focus();
    void context();
    if (mode === "wait") {
      run.begin(rangeStart, rangeEnd);
      const next = run.next();
      setActive(!!next);
      setWaitAt(next?.at ?? rangeStart);
      refresh();
      return;
    }
    if (!sessionActive || snap.position >= rangeEnd - 0.001) {
      run.begin(rangeStart, rangeEnd);
      refresh();
      transport.seek(rangeStart);
    }
    transport.setDuration(rangeEnd);
    transport.setLoop(loop ? { start: rangeStart, end: rangeEnd } : null);
    setActive(true);
    void transport.play(audioDriver);
  };
  function playInput(code: string, binding: Binding, spread = false) {
    if (pressStop.current.has(code)) return;
    const ctx = context();
    const voices = binding.pitches.map((pitch, i) =>
      sound(
        ctx,
        pitch,
        ctx.currentTime + (spread ? i * 0.011 : 0),
        spread ? 0.25 : undefined,
      ),
    );
    pressStop.current.set(code, () => voices.forEach((stop) => stop()));
    setHeld([...pressStop.current.keys()]);
    if (
      !sessionActive ||
      mode === "free" ||
      (mode === "rhythm" && snap.status !== "playing")
    )
      return;
    const exact = current.current.playing
      ? current.current.position +
        (ctx.currentTime - current.current.base) * speed
      : position;
    run.press(binding.token, exact, speed);
    refresh();
    if (mode === "wait") {
      const next = run.next();
      setWaitAt(next?.at ?? rangeEnd);
      if (!next) setActive(false);
    }
  }
  function activateGuitar(code: string, action: "down" | "up" | number) {
    if (typeof action === "number") {
      const note = selected?.pitches[6 - action];
      const cue = run.next();
      const pitches =
        cue?.token === "pick:" + action && Math.abs(cue.at - position) < 0.28
          ? cue.pitches
          : note !== null && note !== undefined
            ? [note]
            : [];
      playInput(code, {
        code,
        token: "pick:" + action,
        pitches,
        label: action + "弦",
      });
      return;
    }
    if (!selected) return;
    const notes = selected.pitches.filter((p): p is number => p !== null);
    playInput(
      code,
      {
        code,
        token: "strum:" + action + ":" + selected.id,
        pitches: action === "up" ? notes.reverse() : notes,
        label: selected.name,
      },
      true,
    );
  }
  function remapKey(code: string, next: string) {
    const assigned = [
      ...choices.map((k) => k.code),
      ...(!piano
        ? [...chordKeys, guitarLayout.down, guitarLayout.up, ...pick]
        : []),
    ];
    if (
      !/^(Key[A-Z]|Digit[0-9]|BracketLeft|BracketRight|Semicolon|Quote|Comma|Period|Slash|ArrowUp|ArrowDown)$/.test(
        next,
      )
    )
      return;
    if (assigned.some((item) => item !== code && mapCode(item) === next))
      return;
    const nextMap = { ...keyMap, [layoutPrefix + code]: next };
    setKeyMap(nextMap);
    setPreference("practice-keys-v2", nextMap);
    setRemap(undefined);
  }
  useEffect(() => {
    const blur = () => {
      releaseAll();
      if (transport.snapshot().status !== "paused") transport.pause();
    };
    window.addEventListener("blur", blur);
    const keyup = (e: KeyboardEvent) => {
      if (pressStop.current.has(e.code)) release(e.code);
    };
    window.addEventListener("keyup", keyup);
    const visibility = () => {
      if (document.hidden) blur();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("blur", blur);
      window.removeEventListener("keyup", keyup);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [transport]);
  const windowLength = 3.2;
  const upcoming = chart.attacks.filter(
    (a) =>
      a.at + a.duration > position - 0.04 && a.at < position + windowLength,
  );
  const reveal = mode === "wait" ? run.next() : upcoming[0];
  const covers = (binding: Binding, attack: PracticeAttack) =>
    binding.token === attack.token ||
    (layout === "wide" &&
      attack.pitches.length === 1 &&
      attack.pitches[0] === binding.pitches[0]);
  const practiceBinding = (binding: Binding) => {
    if (layout !== "wide") return binding;
    const attack = [reveal, ...upcoming].find((a) => a && covers(binding, a));
    return attack ? { ...binding, token: attack.token } : binding;
  };
  const measure = reveal?.measure ?? 1;
  const newBases = { ...bases };
  const anchorOptions = whiteAnchors.slice(0, -4);
  if (piano && layout === "split") {
    for (const hand of ["left", "right"] as const) {
      const pitches = chart.attacks
        .filter(
          (a) =>
            a.measure === measure && a.token.startsWith("key:" + hand + ":"),
        )
        .flatMap((a) => a.pitches);
      const score = (base: number) => {
        const available = new Set(splitKeys(hand, base).map((key) => key.midi));
        return pitches.filter((midi) => available.has(midi)).length;
      };
      for (const base of anchorOptions) {
        if (score(base) > score(newBases[hand])) newBases[hand] = base;
      }
    }
  }
  const shift = newBases.left !== bases.left || newBases.right !== bases.right;
  const changeBase = (hand: PracticeHand, base: number) => {
    if (pressStop.current.size) return;
    const next = { ...bases, [hand]: base };
    setBases(next);
    setPreference("practice-octaves", next);
  };
  const outside = piano
    ? chart.attacks.filter(
        (a) =>
          a.at >= rangeStart &&
          a.at < rangeEnd &&
          !choices.some((b) => covers(b, a)),
      ).length
    : 0;
  function showDetails() {
    return (
      <details className="practice-settings">
        <summary>练习设置与键位</summary>
        <div className="practice-fields">
          <label>
            开始秒
            <input
              type="number"
              min="0"
              step=".1"
              max={rangeEnd - 0.1}
              value={rangeStart}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n >= 0 && n < rangeEnd - 0.05) setStart(n);
              }}
            />
          </label>
          <label>
            结束秒
            <input
              type="number"
              min={rangeStart + 0.1}
              step=".1"
              max={chart.duration}
              value={rangeEnd}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n <= chart.duration && n > rangeStart + 0.05) setEnd(n);
              }}
            />
          </label>
          <label>
            延迟校准（毫秒）
            <input
              type="number"
              min="-150"
              max="150"
              value={offset}
              onChange={(e) => {
                const n = Math.max(-150, Math.min(150, Number(e.target.value)));
                setOffset(n);
                setPreference("practice-offset", n);
              }}
            />
          </label>
          {piano &&
            (["left", "right"] as const).map((hand) => (
              <label key={hand}>
                {hand === "left" ? "左手" : "右手"}起始八度
                <select
                  value={bases[hand]}
                  onChange={(e) => changeBase(hand, Number(e.target.value))}
                >
                  {(layout === "split"
                    ? anchorOptions
                    : [24, 36, 48, 60, 72, 84, 96]
                  ).map((base) => (
                    <option key={base} value={base}>
                      {noteName(base)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
        </div>
        <div className="practice-keymap">
          {(piano
            ? choices.map((b) => [b.code, b.label])
            : [
                ...chordKeys.map((key, i) => [key, "和弦 " + (i + 1)]),
                [guitarLayout.down, "下扫"],
                [guitarLayout.up, "上扫"],
                ...pick.map((key, i) => [key, i + 1 + "弦"]),
              ]
          ).map(([code, label]) => (
            <button
              key={code}
              onClick={() => {
                setRemap(code);
                board.current?.focus();
              }}
            >
              {label} · {showCode(mapCode(code))}
            </button>
          ))}
        </div>
        {remap && <p role="status">请按一个未占用的字母键、数字键或标点键。</p>}
        <button
          className="text-button"
          onClick={() => {
            setKeyMap({});
            setPreference("practice-keys-v2", {});
            setRemap(undefined);
          }}
        >
          恢复默认键位
        </button>
      </details>
    );
  }
  return (
    <div className="practice-studio">
      <div className="practice-controls">
        <strong>{chart.title}</strong>
        {piano && <span>{toneStatus}</span>}
        <label>
          键位
          <select
            aria-label="练习键位预设"
            value={layout}
            onChange={(e) => {
              releaseAll();
              setLayout(e.target.value as typeof layout);
            }}
          >
            <option value="split">{piano ? "双手分区" : "左右手分工"}</option>
            {piano && <option value="wide">单手宽音域</option>}
            <option value="legacy">旧版键位与自定义</option>
          </select>
        </label>
        {piano && layout === "wide" && (
          <>
            <button
              onClick={() =>
                changeBase(
                  "right",
                  Math.max(24, Math.floor(bases.right / 12) * 12 - 12),
                )
              }
            >
              降八度
            </button>
            <button
              onClick={() =>
                changeBase(
                  "right",
                  Math.min(96, Math.floor(bases.right / 12) * 12 + 12),
                )
              }
            >
              升八度
            </button>
          </>
        )}
        <div role="group" aria-label="练习模式">
          {engine.modes.map((m) => (
            <button
              key={m}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {modeLabel[m]}
            </button>
          ))}
        </div>
        <button className="button primary small" onClick={start}>
          {snap.status !== "paused" ? <Pause size={16} /> : <Play size={16} />}
          {snap.status !== "paused"
            ? "暂停"
            : mode === "wait" && sessionActive
              ? "重新开始"
              : mode === "free"
                ? "开始弹奏"
                : "开始跟练"}
        </button>
        <label>
          速度
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          >
            {[0.5, 0.75, 1, 1.25].map((v) => (
              <option key={v} value={v}>
                {v}×
              </option>
            ))}
          </select>
        </label>
        {detailed && mode === "rhythm" && (
          <label className="inline-check">
            <input
              type="checkbox"
              checked={loop}
              onChange={(e) => setLoop(e.target.checked)}
            />
            循环
          </label>
        )}
        {mode === "rhythm" && (
          <label className="inline-check">
            <input
              type="checkbox"
              checked={reference}
              onChange={(e) => setReference(e.target.checked)}
            />
            参考音
          </label>
        )}
        <output>
          {rounded(position)} / {rounded(rangeEnd)} 秒
        </output>
      </div>
      <div
        className="practice-board"
        ref={board}
        tabIndex={0}
        role="application"
        aria-label="键盘练习区"
        onKeyDown={(e) => {
          if (
            e.repeat ||
            e.nativeEvent.isComposing ||
            e.ctrlKey ||
            e.altKey ||
            e.metaKey
          )
            return;
          if ((e.target as HTMLElement).matches("input,select,textarea"))
            return;
          if (remap) {
            remapKey(remap, e.code);
            e.preventDefault();
            return;
          }
          if (piano) {
            const b = choices.find((b) => mapCode(b.code) === e.code);
            if (b) {
              e.preventDefault();
              playInput(e.code, practiceBinding(b));
            }
            return;
          }
          const chord =
            chordPage[chordKeys.findIndex((k) => mapCode(k) === e.code)];
          if (chord) {
            e.preventDefault();
            setSelected(chord);
            return;
          }
          const s = pick.findIndex((k) => mapCode(k) === e.code);
          if (
            s >= 0 ||
            [mapCode(guitarLayout.down), mapCode(guitarLayout.up)].includes(
              e.code,
            )
          ) {
            e.preventDefault();
            activateGuitar(
              e.code,
              s >= 0
                ? 6 - s
                : e.code === mapCode(guitarLayout.down)
                  ? "down"
                  : "up",
            );
          }
        }}
      >
        <div className="practice-caption">
          <Keyboard size={17} />
          {reveal
            ? "下一步 · 小节 " + reveal.measure + " · " + reveal.label
            : "预备或自由弹奏"}
          {outside > 0 && <span>{outside} 个练习音在当前键区外</span>}
          {piano && layout === "split" && (
            <span>
              左手 {noteName(bases.left)} 起 · 右手 {noteName(bases.right)} 起
            </span>
          )}
          {shift && (
            <button
              disabled={held.length > 0 || snap.status === "playing"}
              onClick={() => {
                setBases(newBases);
                setPreference("practice-octaves", newBases);
                board.current?.focus();
              }}
            >
              按第 {measure} 小节移位
            </button>
          )}
          {!piano && <span>左手选和弦 · 右手扫弦或拨弦</span>}
        </div>
        <div className={piano ? "piano-waterfall" : "guitar-timing"}>
          {upcoming.slice(0, 112).map((a) => {
            const index = choices.findIndex((b) => covers(b, a));
            const pct = Math.max(
              0,
              Math.min(96, ((a.at - position) / windowLength) * 100),
            );
            return piano ? (
              index >= 0 && (
                <span
                  key={a.id}
                  className="fall"
                  data-hand={choices[index].hand}
                  style={{
                    left: choices[index].center - 1.6 + "%",
                    bottom: pct + "%",
                    height:
                      Math.max(
                        2,
                        Math.min(26, (a.duration / windowLength) * 100),
                      ) + "%",
                  }}
                  title={a.label}
                />
              )
            ) : (
              <span
                key={a.id}
                className="guitar-cue"
                style={{ left: Math.min(89, pct) + "%" }}
              >
                {a.label}
              </span>
            );
          })}
        </div>
        {piano ? (
          <div
            className="piano-keys"
            data-layout={layout}
            aria-label="模拟钢琴键盘"
          >
            {choices.map((b) => (
              <button
                key={b.code}
                style={{ left: b.center + "%" }}
                className={b.black ? "black" : "white"}
                data-active={
                  held.includes(mapCode(b.code)) ||
                  held.includes("pointer:" + b.code)
                }
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  playInput("pointer:" + b.code, practiceBinding(b));
                }}
                onPointerUp={() => release("pointer:" + b.code)}
                onPointerCancel={() => release("pointer:" + b.code)}
                aria-label={b.label + " " + showCode(mapCode(b.code))}
              >
                <small>{b.label}</small>
                <kbd>{showCode(mapCode(b.code))}</kbd>
              </button>
            ))}
          </div>
        ) : (
          <div className="guitar-controls">
            <div className="guitar-fretboard" aria-label="当前和弦弦位">
              {selected?.frets.map((n, i) => (
                <span key={i}>
                  <small>{6 - i}弦</small>
                  <b>{n < 0 ? "×" : n === 0 ? "空弦" : n + "品"}</b>
                </span>
              ))}
            </div>
            <div className="guitar-input">
              <div>
                {chordPage.map((ch, i) => (
                  <button
                    key={ch.id}
                    aria-pressed={selected?.id === ch.id}
                    onClick={() => {
                      setSelected(ch);
                      board.current?.focus();
                    }}
                  >
                    {ch.name}
                    <kbd>{showCode(mapCode(chordKeys[i]))}</kbd>
                  </button>
                ))}
                {chart.chords.length > 8 && (
                  <button
                    onClick={() => {
                      setBank((bank + 1) % Math.ceil(chart.chords.length / 8));
                      board.current?.focus();
                    }}
                  >
                    下一组和弦
                  </button>
                )}
              </div>
              <div>
                {(["down", "up", ...pick.map((_, i) => 6 - i)] as const).map(
                  (action) => {
                    const key =
                      action === "down"
                        ? guitarLayout.down
                        : action === "up"
                          ? guitarLayout.up
                          : pick[6 - action];
                    return (
                      <button
                        key={key}
                        onPointerDown={(e) => {
                          e.currentTarget.setPointerCapture(e.pointerId);
                          activateGuitar("pointer:" + key, action);
                        }}
                        onPointerUp={() => release("pointer:" + key)}
                        onPointerCancel={() => release("pointer:" + key)}
                      >
                        {action === "down"
                          ? "下扫"
                          : action === "up"
                            ? "上扫"
                            : action + "弦"}
                        <kbd>{showCode(mapCode(key))}</kbd>
                      </button>
                    );
                  },
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      {detailed && showDetails()}
      {mode !== "free" && (
        <section className="practice-results" aria-label="练习反馈">
          <p>
            <strong>命中 {report.hits}</strong>
            <span>漏弹 {report.misses}</span>
            <span>错键 {report.wrong}</span>
            {report.accuracy !== undefined && (
              <span>准确度 {report.accuracy}%</span>
            )}
            {report.score !== undefined && <span>得分 {report.score}</span>}
            {report.firstTry !== undefined && (
              <span>
                首次正确 {report.firstTry}% · 重试 {report.retries}
              </span>
            )}
            {report.meanOffsetMs !== undefined && (
              <span>平均偏差 {report.meanOffsetMs} ms</span>
            )}
          </p>
          {!!report.history.length && (
            <ol>
              {report.history
                .slice(-(detailed ? 16 : 1))
                .reverse()
                .map((h, i) => (
                  <li key={i}>
                    <button
                      disabled={!detailed || !h.measure}
                      onClick={() => {
                        setFocusResult(h.measure ?? null);
                        const a = chart.attacks.find((a) => a.id === h.eventId);
                        if (a) {
                          transport.pause();
                          transport.seek(a.at);
                          setWaitAt(a.at);
                        }
                      }}
                    >
                      {h.measure && "小节 " + h.measure + " · "}
                      {h.label} · {verdict[h.verdict]}
                      {h.differenceMs !== undefined &&
                        " " + h.differenceMs + " ms"}
                    </button>
                  </li>
                ))}
            </ol>
          )}
          {focusResult !== null && <p>已定位小节 {focusResult}</p>}
        </section>
      )}
    </div>
  );
}
