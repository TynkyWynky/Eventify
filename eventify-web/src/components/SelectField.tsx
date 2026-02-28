import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type SelectFieldProps = {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
};

type MenuPos = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export default function SelectField({
  value,
  options,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
}: SelectFieldProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null); 

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);

  const filteredOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  function computeMenuPosition() {
    const btn = buttonRef.current;
    if (!btn) return;

    const r = btn.getBoundingClientRect();
    const gap = 8;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    const spaceBelow = viewportH - r.bottom;
    const spaceAbove = r.top;

    const openDown = spaceBelow >= 240 || spaceBelow >= spaceAbove;

    const maxHeight = Math.max(
      160,
      (openDown ? spaceBelow : spaceAbove) - gap - 12
    );

    const menuWidth = clamp(r.width, 160, Math.max(160, viewportW - 24));
    const top = openDown ? r.bottom + gap : Math.max(12, r.top - gap - maxHeight);
    const left = clamp(r.left, 12, Math.max(12, viewportW - menuWidth - 12));

    setMenuPos({ top, left, width: menuWidth, maxHeight });
  }

  function openMenu() {
    setOpen(true);
    setQuery("");
    const idx = Math.max(0, options.indexOf(value));
    setActiveIndex(idx);
    requestAnimationFrame(() => {
      computeMenuPosition();
      searchRef.current?.focus();
    });
  }

  function closeMenu() {
    setOpen(false);
    setQuery("");
    requestAnimationFrame(() => buttonRef.current?.focus());
  }

  function toggleMenu() {
    if (open) closeMenu();
    else openMenu();
  }

  function pick(option: string) {
    onChange(option);
    closeMenu();
  }

  useEffect(() => {
    if (!open) return;

    function onMouseDown(e: MouseEvent) {
      const target = e.target as Node;

      const root = rootRef.current;
      const menu = menuRef.current;

      const insideRoot = !!root && root.contains(target);
      const insideMenu = !!menu && menu.contains(target);

      if (insideRoot || insideMenu) return;

      closeMenu();
    }

    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onMove = () => computeMenuPosition();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  function onButtonKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openMenu();
    }
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(filteredOptions.length - 1, i + 1));
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      const opt = filteredOptions[activeIndex];
      if (opt) pick(opt);
    }
  }

  const label = value || placeholder;

  return (
    <div ref={rootRef} className="selectRoot">
      <button
        ref={buttonRef}
        type="button"
        className="selectButton"
        onClick={toggleMenu}
        onKeyDown={onButtonKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="selectValue">{label}</span>
        <span className="selectChevron" aria-hidden>
          ▾
        </span>
      </button>

      {open && menuPos
        ? createPortal(
            <div
              ref={menuRef} 
              className="selectMenu"
              style={{ top: menuPos.top, left: menuPos.left, width: menuPos.width }}
              role="listbox"
              tabIndex={-1}
              onKeyDown={onMenuKeyDown}
            >
              <div className="selectSearchWrap">
                <input
                  ref={searchRef}
                  className="selectSearch"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setActiveIndex(0);
                  }}
                  placeholder={searchPlaceholder}
                />
              </div>

              <div className="selectOptions" style={{ maxHeight: menuPos.maxHeight }}>
                {filteredOptions.length === 0 ? (
                  <div className="selectNoResults">No results</div>
                ) : (
                  filteredOptions.map((opt, idx) => {
                    const isSelected = opt === value;
                    const isActive = idx === activeIndex;

                    return (
                      <div
                        key={opt}
                        role="option"
                        aria-selected={isSelected}
                        className={[
                          "selectOption",
                          isActive ? "isActive" : "",
                          isSelected ? "isSelected" : "",
                        ].join(" ")}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onMouseDown={(e) => e.preventDefault()} 
                        onClick={() => pick(opt)} 
                      >
                        <span className="selectOptionLabel">{opt}</span>
                        {isSelected ? <span className="selectTick">✓</span> : null}
                      </div>
                    );
                  })
                )}
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
