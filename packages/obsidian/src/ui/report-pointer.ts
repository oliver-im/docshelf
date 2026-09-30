import { webFrame } from 'electron';
import type { webContents } from '@electron/remote';

type ReportGuest = NonNullable<ReturnType<typeof webContents.fromId>>;
type HostWindow = Window & { electronWindow?: { webContents: { sendInputEvent(event: { type: 'mouseMove'; x: number; y: number }): void } } };

// How long a release waits for the rest of its events.
const SETTLE_MS = 150;
// A stuck move must never leave the window ignoring the pointer.
const FALLBACK_MS = 1000;

// Electron hands a report's pointer back to Obsidian in two broken ways. A
// drag that leaves the report stops capturing the pointer, so the rest of the
// window reacts to it and the report never sees the release. Obsidian also
// receives every release inside the report, at the report's coordinates, and
// hovers whatever sits there in its own window, often a sidebar row.
//
// While the report's button is down, the window ignores the pointer. After
// the release, a release outside is handed to the report, and Obsidian is
// moved to where the pointer really is before it reacts again.
export class ReportPointer {
  private active = false;
  private insideRelease: { x: number; y: number } | null = null;
  private outsideRelease: MouseEvent | null = null;
  private movedAfterRelease = false;
  private timer = 0;

  constructor(private webview: HTMLElement, private guest: () => ReportGuest | null) {}

  // The report's primary button went down.
  down(): void {
    const win = this.win();
    if (!win) return;
    win.clearTimeout(this.timer);
    this.insideRelease = null;
    this.outsideRelease = null;
    this.movedAfterRelease = false;
    if (this.active) return;
    this.active = true;
    this.webview.ownerDocument.body.addClass('docshelf-report-pointer');
    win.addEventListener('mouseup', this.onMouseUp, true);
    win.addEventListener('mousemove', this.onMouseMove, true);
    win.addEventListener('blur', this.stop);
  }

  // The report saw the release at these report coordinates.
  up(x: number, y: number): void {
    if (!this.active) return;
    // A real move already corrected the host position while this guest
    // notification was in transit. The guest also has its release.
    if (this.movedAfterRelease) { this.stop(); return; }
    this.insideRelease = { x, y };
    this.settleSoon();
  }

  stop = (): void => {
    const win = this.win();
    if (!this.active || !win) return;
    this.active = false;
    win.clearTimeout(this.timer);
    this.webview.ownerDocument.body.removeClass('docshelf-report-pointer');
    win.removeEventListener('mouseup', this.onMouseUp, true);
    win.removeEventListener('mousemove', this.onMouseMove, true);
    win.removeEventListener('blur', this.stop);
  };

  private onMouseUp = (event: MouseEvent): void => {
    if (event.button !== 0) return;
    this.outsideRelease = event;
    this.settleSoon();
  };

  // A buttonless move corrects the host position, but an outside release
  // still needs forwarding. Wait for a possible delayed guest notification
  // before deciding which kind of release it was.
  private onMouseMove = (event: MouseEvent): void => {
    if (event.buttons & 1) return;
    if (this.outsideRelease && !this.insideRelease) {
      this.movedAfterRelease = true;
      return;
    }
    this.stop();
  };

  private settleSoon(): void {
    const win = this.win();
    if (!win) return;
    win.clearTimeout(this.timer);
    this.timer = win.setTimeout(this.settle, SETTLE_MS);
  }

  private settle = (): void => {
    const win = this.win();
    if (!win) return;
    const bounds = this.webview.getBoundingClientRect();
    const zoom = webFrame.getZoomFactor();
    if (this.insideRelease) {
      const scale = (this.guest()?.getZoomFactor() || zoom) / zoom;
      const x = Math.min(Math.max(bounds.left + this.insideRelease.x * scale, bounds.left), bounds.right - 1);
      const y = Math.min(Math.max(bounds.top + this.insideRelease.y * scale, bounds.top), bounds.bottom - 1);
      try { win.electronWindow?.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(x * zoom), y: Math.round(y * zoom) }); } catch { /* The window closed. */ }
      this.timer = win.setTimeout(this.stop, FALLBACK_MS);
    } else if (this.outsideRelease) {
      const { clientX, clientY } = this.outsideRelease;
      try { this.guest()?.sendInputEvent({ type: 'mouseUp', x: Math.round((clientX - bounds.left) * zoom), y: Math.round((clientY - bounds.top) * zoom), button: 'left', clickCount: 1 }); } catch { /* The report closed. */ }
      this.stop();
    }
  };

  private win(): HostWindow | null {
    return this.webview.ownerDocument.defaultView;
  }
}
