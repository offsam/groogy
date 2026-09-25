"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Briefcase,
  Calendar,
  Heart,
  Inbox,
  MapPinned,
  MessageCircle,
  MoreVertical,
  Search,
  Settings,
  ShoppingBag,
  Store,
  Tag,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import {
  CABINET_NAV_ITEMS,
  type CabinetNavKey,
} from "@/types/profile-cabinet";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "kroogy.cabinet_nav_order.v1";
const DOCK_COUNT = 4;
const LONG_PRESS_MS = 2000;

const NAV_ICONS: Record<CabinetNavKey, LucideIcon> = {
  profile: UserRound,
  circles: UsersRound,
  businesses: Store,
  listings: Tag,
  services: Briefcase,
  marketplace: ShoppingBag,
  surroundings: MapPinned,
  searches: Search,
  requests: Inbox,
  messenger: MessageCircle,
  events: Calendar,
  dating: Heart,
  settings: Settings,
};

const DEFAULT_ORDER: CabinetNavKey[] = CABINET_NAV_ITEMS.map((i) => i.key);

function itemMeta(key: CabinetNavKey) {
  return CABINET_NAV_ITEMS.find((i) => i.key === key)!;
}

function loadOrder(): CabinetNavKey[] {
  if (typeof window === "undefined") return DEFAULT_ORDER;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ORDER;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return DEFAULT_ORDER;
    const keys = parsed.filter(
      (k): k is CabinetNavKey =>
        typeof k === "string" && DEFAULT_ORDER.includes(k as CabinetNavKey),
    );
    const missing = DEFAULT_ORDER.filter((k) => !keys.includes(k));
    return [...keys, ...missing];
  } catch {
    return DEFAULT_ORDER;
  }
}

function saveOrder(order: CabinetNavKey[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
}

type Props = {
  username: string | null;
  active?: CabinetNavKey;
};

type NavTarget =
  | { kind: "link"; href: string }
  | { kind: "span" };

function resolveTarget(
  key: CabinetNavKey,
  profileHref: string,
): NavTarget {
  if (key === "profile") return { kind: "link", href: profileHref };
  if (key === "settings") return { kind: "link", href: "/me/settings" };
  if (key === "circles") return { kind: "link", href: "/me/circles" };
  if (key === "businesses") return { kind: "link", href: "/me/businesses" };
  if (key === "listings") return { kind: "link", href: "/me/listings" };
  if (key === "services") return { kind: "link", href: "/me/services" };
  return { kind: "span" };
  if (key === "surroundings") return { kind: "link", href: "/me/surroundings" };
  if (key === "events") return { kind: "link", href: "/events" };
  if (key === "searches") return { kind: "link", href: "/me/searches" };
}

export function CabinetLeftNav({ username, active = "profile" }: Props) {
  const profileHref = username ? `/u/${username}` : "/profile";
  const [order, setOrder] = useState<CabinetNavKey[]>(DEFAULT_ORDER);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [dragging, setDragging] = useState<CabinetNavKey | null>(null);
  const [dragOver, setDragOver] = useState<CabinetNavKey | null>(null);
  const [mounted, setMounted] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFired = useRef(false);
  const suppressClick = useRef(false);

  useEffect(() => {
    setOrder(loadOrder());
    setMounted(true);
  }, []);

  const dockKeys = order.slice(0, DOCK_COUNT);
  const overflowKeys = order.slice(DOCK_COUNT);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  function startLongPress(
    key: CabinetNavKey,
    opts: { revealOverflow: boolean },
  ) {
    longPressFired.current = false;
    clearLongPress();
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true;
      suppressClick.current = true;
      setReorderMode(true);
      if (opts.revealOverflow) setMoreOpen(true);
      setDragging(key);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try {
          navigator.vibrate(30);
        } catch {
          /* ignore */
        }
      }
    }, LONG_PRESS_MS);
  }

  function swapKeys(a: CabinetNavKey, b: CabinetNavKey) {
    if (a === b) return;
    setOrder((prev) => {
      const next = [...prev];
      const i = next.indexOf(a);
      const j = next.indexOf(b);
      if (i < 0 || j < 0) return prev;
      [next[i], next[j]] = [next[j]!, next[i]!];
      saveOrder(next);
      return next;
    });
  }

  function onIconPointerDown(
    key: CabinetNavKey,
    e: ReactPointerEvent,
    opts: { revealOverflow: boolean },
  ) {
    if (e.button !== 0) return;
    startLongPress(key, opts);
  }

  function onIconPointerUp() {
    clearLongPress();
  }

  function onIconPointerCancel() {
    clearLongPress();
  }

  function onIconClick(key: CabinetNavKey, e: React.MouseEvent) {
    if (suppressClick.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClick.current = false;
      return;
    }
    if (reorderMode) {
      e.preventDefault();
      e.stopPropagation();
      if (dragging && dragging !== key) {
        swapKeys(dragging, key);
        setDragging(key);
      } else {
        setDragging(key);
      }
    }
  }

  function finishReorder() {
    setReorderMode(false);
    setDragging(null);
    setDragOver(null);
    setMoreOpen(false);
  }

  function renderIconButton(
    key: CabinetNavKey,
    opts: { size?: "dock" | "rail"; revealOverflow?: boolean },
  ) {
    const meta = itemMeta(key);
    const Icon = NAV_ICONS[key];
    const isActive = key === active;
    const isDragging = dragging === key;
    const isOver = Boolean(dragOver === key && dragging && dragging !== key);
    const target = resolveTarget(key, profileHref);
    const size = opts.size ?? "dock";
    const revealOverflow = opts.revealOverflow ?? true;

    const className = cn(
      "inline-flex items-center justify-center rounded-xl transition select-none",
      size === "dock" ? "size-12" : "size-11",
      isActive && !reorderMode
        ? "bg-slate-900 text-white"
        : "bg-white text-slate-700 ring-1 ring-slate-200",
      reorderMode && "ring-brand-blue/40",
      isDragging && "scale-110 ring-2 ring-brand-blue",
      isOver && "ring-2 ring-brand-orange bg-orange-50",
    );

    const body = (
      <>
        <Icon aria-hidden className="size-5" strokeWidth={2} />
        <span className="sr-only">{meta.label}</span>
      </>
    );

    const handlers = {
      onPointerDown: (e: ReactPointerEvent) =>
        onIconPointerDown(key, e, { revealOverflow }),
      onPointerUp: onIconPointerUp,
      onPointerCancel: onIconPointerCancel,
      onClick: (e: React.MouseEvent) => onIconClick(key, e),
      onDragOver: (e: React.DragEvent) => {
        if (!reorderMode) return;
        e.preventDefault();
        setDragOver(key);
      },
      onDragEnter: () => {
        if (!reorderMode) return;
        setDragOver(key);
      },
      onDrop: (e: React.DragEvent) => {
        if (!reorderMode || !dragging) return;
        e.preventDefault();
        swapKeys(dragging, key);
        setDragOver(null);
      },
      draggable: reorderMode,
      onDragStart: (e: React.DragEvent) => {
        if (!reorderMode) {
          e.preventDefault();
          return;
        }
        setDragging(key);
        e.dataTransfer.effectAllowed = "move";
      },
      onDragEnd: () => {
        setDragOver(null);
      },
      title: meta.label,
      "aria-label": meta.label,
    };

    if (reorderMode || target.kind === "span") {
      return (
        <button className={className} type="button" {...handlers}>
          {body}
        </button>
      );
    }

    return (
      <Link className={className} href={target.href} {...handlers}>
        {body}
      </Link>
    );
  }

  function renderDesktopRow(key: CabinetNavKey) {
    const meta = itemMeta(key);
    const Icon = NAV_ICONS[key];
    const isActive = key === active;
    const isDragging = dragging === key;
    const isOver = Boolean(dragOver === key && dragging && dragging !== key);
    const target = resolveTarget(key, profileHref);

    const className = cn(
      "inline-flex min-h-11 w-full select-none items-center gap-2 rounded-lg px-3 text-sm font-medium transition",
      isActive && !reorderMode
        ? "bg-slate-900 text-white"
        : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50",
      reorderMode && "ring-brand-blue/40",
      isDragging && "scale-[1.02] ring-2 ring-brand-blue",
      isOver && "ring-2 ring-brand-orange bg-orange-50",
    );

    const content = (
      <>
        <Icon aria-hidden className="size-4 shrink-0" />
        {meta.label}
      </>
    );

    const handlers = {
      onPointerDown: (e: ReactPointerEvent) =>
        onIconPointerDown(key, e, { revealOverflow: false }),
      onPointerUp: onIconPointerUp,
      onPointerCancel: onIconPointerCancel,
      onClick: (e: React.MouseEvent) => onIconClick(key, e),
      onDragOver: (e: React.DragEvent) => {
        if (!reorderMode) return;
        e.preventDefault();
        setDragOver(key);
      },
      onDragEnter: () => {
        if (!reorderMode) return;
        setDragOver(key);
      },
      onDrop: (e: React.DragEvent) => {
        if (!reorderMode || !dragging) return;
        e.preventDefault();
        swapKeys(dragging, key);
        setDragOver(null);
      },
      draggable: reorderMode,
      onDragStart: (e: React.DragEvent) => {
        if (!reorderMode) {
          e.preventDefault();
          return;
        }
        setDragging(key);
        e.dataTransfer.effectAllowed = "move";
      },
      onDragEnd: () => {
        setDragOver(null);
      },
      title: reorderMode
        ? "Нажмите другой пункт, чтобы поменять местами"
        : meta.label,
      "aria-label": meta.label,
    };

    if (reorderMode || target.kind === "span") {
      return (
        <button className={className} key={key} type="button" {...handlers}>
          {content}
        </button>
      );
    }

    return (
      <Link className={className} href={target.href} key={key} {...handlers}>
        {content}
      </Link>
    );
  }

  const desktopNav = (
    <nav
      aria-label="Кабинет"
      className="hidden md:flex md:w-44 md:shrink-0 md:flex-col md:gap-1"
    >
      {reorderMode ? (
        <p className="mb-1 px-1 text-[10px] font-medium leading-snug text-slate-500">
          Удерживайте 2 сек · нажмите другой пункт, чтобы поменять местами
        </p>
      ) : null}
      {order.map((key) => renderDesktopRow(key))}
      {reorderMode ? (
        <button
          className="mt-1 inline-flex min-h-10 items-center justify-center rounded-lg bg-brand-blue px-3 text-xs font-semibold text-white"
          onClick={finishReorder}
          style={{ color: "#ffffff" }}
          type="button"
        >
          Готово
        </button>
      ) : null}
    </nav>
  );

  const mobileDock = (
    <>
      {moreOpen ? (
        <div
          className="fixed inset-0 z-[1050] md:hidden"
          onClick={() => {
            if (reorderMode) return;
            setMoreOpen(false);
          }}
        />
      ) : null}

      {moreOpen ? (
        <div
          className="fixed bottom-[4.5rem] right-2 z-[1060] flex flex-col gap-1.5 md:hidden"
          role="menu"
          aria-label="Ещё разделы"
        >
          {overflowKeys.map((key) => (
            <div key={key}>{renderIconButton(key, { size: "rail" })}</div>
          ))}
          {reorderMode ? (
            <button
              className="mt-1 inline-flex min-h-10 items-center justify-center rounded-xl bg-brand-blue px-3 text-xs font-semibold text-white"
              onClick={finishReorder}
              style={{ color: "#ffffff" }}
              type="button"
            >
              Готово
            </button>
          ) : null}
        </div>
      ) : null}

      <nav
        aria-label="Кабинет"
        className="fixed inset-x-0 bottom-0 z-[1060] border-t border-slate-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {reorderMode ? (
          <p className="px-3 pt-1.5 text-center text-[10px] font-medium text-slate-500">
            Удерживайте 2 сек · коснитесь другого значка, чтобы поменять местами
          </p>
        ) : null}
        <div className="mx-auto flex max-w-lg items-center justify-around gap-1 px-2 py-1.5">
          {dockKeys.map((key) => (
            <div key={key}>{renderIconButton(key, { size: "dock" })}</div>
          ))}
          <button
            aria-expanded={moreOpen}
            aria-label={moreOpen ? "Скрыть меню" : "Ещё"}
            className={cn(
              "inline-flex size-12 items-center justify-center rounded-xl transition",
              moreOpen
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-700 ring-1 ring-slate-200",
            )}
            onClick={() => {
              if (reorderMode) {
                finishReorder();
                return;
              }
              setMoreOpen((v) => !v);
            }}
            type="button"
          >
            <MoreVertical className="size-5" strokeWidth={2} />
          </button>
        </div>
      </nav>
    </>
  );

  return (
    <>
      {desktopNav}
      {mounted ? createPortal(mobileDock, document.body) : null}
    </>
  );
}
