export type ContextMenuItem = {
  id: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
};

export type ContextMenuProps = {
  x: number;
  y: number;
  visible: boolean;
  items: ContextMenuItem[];
  onPick: (id: string) => void;
  onClose: () => void;
};

export function ContextMenu({
  x,
  y,
  visible,
  items,
  onPick,
  onClose,
}: ContextMenuProps) {
  if (!visible) return null;
  return (
    <>
      <div className="md-ctx-backdrop" onClick={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div className="md-ctx-menu" style={{ left: x, top: y }}>
        {items.map((it) => (
          <button
            key={it.id}
            type="button"
            className={"md-ctx-item" + (it.danger ? " danger" : "")}
            disabled={it.disabled}
            onClick={() => {
              onPick(it.id);
              onClose();
            }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>
  );
}
