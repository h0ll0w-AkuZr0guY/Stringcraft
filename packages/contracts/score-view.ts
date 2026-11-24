/** All views and instruments map notation back to project seconds and stable IDs. */
export interface ScoreHit {
  noteIds: string[];
  startSeconds: number;
  endSeconds: number;
}
export interface ScoreRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface ScoreViewAdapter {
  hitTest(x: number, y: number): ScoreHit | null;
  locate(seconds: number): ScoreRegion | null;
}
