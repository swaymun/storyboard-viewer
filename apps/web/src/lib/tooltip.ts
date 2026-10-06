/**
 * Accessible tooltips for buttons (mostly icon buttons): `{@attach tooltip('Duplicate', '⌘D')}`.
 *
 * - Shows on hover (after a short delay; at once when moving between tooltipped controls) and on
 *   keyboard focus; hides on leave, blur, any press and Esc (WCAG 1.4.13: dismissible, hoverable,
 *   persistent: moving the pointer onto the tooltip keeps it open). It never takes clicks
 *   (`pointer-events: none`; "hoverable" is tracked by position), never shows while a button is
 *   held (drags), and goes away when typing starts.
 * - One shared `role="tooltip"` element; the control gets `aria-describedby` while it shows, and
 *   an `aria-label` from the tooltip text when it has no accessible name of its own.
 * - Replaces the native `title` (which is not keyboard accessible and would show twice).
 * Colors come from theme tokens (`.sbd-tooltip` in app.css).
 */
import type { Attachment } from 'svelte/attachments';

const ID = 'sbd-tooltip';
const DELAY = 450;
/** Moving from one tooltipped control to the next within this time shows it at once. */
const WARM = 400;

let tip: HTMLDivElement | null = null;
let owner: HTMLElement | null = null;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let lastHidden = 0;

function element(): HTMLDivElement {
  if (tip && tip.isConnected) return tip;
  tip = document.createElement('div');
  tip.id = ID;
  tip.className = 'sbd-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.append(tip);
  return tip;
}

/** Any key but a lone modifier or Tab hides it (Esc dismisses; typing must not be covered). */
function onKey(e: KeyboardEvent) {
  if (!owner) return;
  if (['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
  hide();
}

/** Any press anywhere hides it at once (it must never sit on top of what is clicked next). */
function onPress() {
  if (owner) hide();
}

/** While the pointer is over the tooltip itself, it stays (hoverable without taking clicks). */
function onMove(e: PointerEvent) {
  if (!owner || !tip || tip.hidden) return;
  const r = tip.getBoundingClientRect();
  const t = owner.getBoundingClientRect();
  const inside = (b: DOMRect) =>
    e.clientX >= b.left - 2 &&
    e.clientX <= b.right + 2 &&
    e.clientY >= b.top - 8 &&
    e.clientY <= b.bottom + 8;
  if (inside(r) || inside(t)) clearTimeout(hideTimer);
  else scheduleHide();
}

function place(target: HTMLElement, el: HTMLDivElement) {
  const r = target.getBoundingClientRect();
  const t = el.getBoundingClientRect();
  const gap = 6;
  let top = r.bottom + gap;
  if (top + t.height > window.innerHeight - 4) top = r.top - gap - t.height;
  let left = r.left + r.width / 2 - t.width / 2;
  left = Math.max(4, Math.min(left, window.innerWidth - t.width - 4));
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(Math.max(4, top))}px`;
}

function show(target: HTMLElement, text: string, shortcut: string | undefined) {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (!target.isConnected) return;
  const el = element();
  el.replaceChildren(document.createTextNode(text));
  if (shortcut) {
    const k = document.createElement('kbd');
    k.textContent = shortcut;
    el.append(' ', k);
  }
  if (owner && owner !== target) owner.removeAttribute('aria-describedby');
  owner = target;
  el.hidden = false;
  place(target, el);
  target.setAttribute('aria-describedby', ID);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('pointerdown', onPress, true);
  window.addEventListener('pointermove', onMove, true);
}

function hide() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (tip) tip.hidden = true;
  owner?.removeAttribute('aria-describedby');
  if (owner) lastHidden = Date.now();
  owner = null;
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('pointerdown', onPress, true);
  window.removeEventListener('pointermove', onMove, true);
}

function scheduleHide() {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hide, 120);
}

const hasName = (el: HTMLElement) =>
  !!el.getAttribute('aria-label') ||
  !!el.getAttribute('aria-labelledby') ||
  !!el.textContent?.trim();

/** Tooltip with an optional keyboard shortcut shown after the text. */
export function tooltip(text: string, shortcut?: string): Attachment<HTMLElement> {
  return (node) => {
    if (node.hasAttribute('title')) node.removeAttribute('title');
    if (!hasName(node)) node.setAttribute('aria-label', text);
    if (shortcut) node.dataset['shortcut'] = shortcut;
    const enter = (e: PointerEvent) => {
      clearTimeout(showTimer);
      if (e.buttons) return; // dragging something: no tooltips on the way
      const warm = owner !== null || Date.now() - lastHidden < WARM;
      if (warm) show(node, text, shortcut);
      else showTimer = setTimeout(() => show(node, text, shortcut), DELAY);
    };
    const leave = () => {
      clearTimeout(showTimer);
      // onMove keeps it while the pointer goes onto the tooltip
      if (owner === node && !tip?.matches(':hover')) scheduleHide();
    };
    const focus = () => {
      if (node.matches(':focus-visible')) show(node, text, shortcut);
    };
    const blur = () => {
      if (owner === node) hide();
    };
    const down = () => {
      if (owner === node) hide();
      clearTimeout(showTimer);
    };
    node.addEventListener('pointerenter', enter);
    node.addEventListener('pointerleave', leave);
    node.addEventListener('focus', focus);
    node.addEventListener('blur', blur);
    node.addEventListener('pointerdown', down);
    // the text changed while it shows (e.g. "Undo: Move layer" after an edit)
    if (owner === node) show(node, text, shortcut);
    return () => {
      node.removeEventListener('pointerenter', enter);
      node.removeEventListener('pointerleave', leave);
      node.removeEventListener('focus', focus);
      node.removeEventListener('blur', blur);
      node.removeEventListener('pointerdown', down);
      if (owner === node) hide();
    };
  };
}
