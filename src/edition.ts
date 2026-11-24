export const pagesEdition = import.meta.env.MODE === "pages";
export type DesktopBridge = EventTarget & {
  postMessage(command: string): void;
};
export function nativeHost(): DesktopBridge | undefined {
  return (window as Window & { chrome?: { webview?: DesktopBridge } }).chrome
    ?.webview;
}
