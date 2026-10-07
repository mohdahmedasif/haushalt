import { Select } from "antd";
import type { Category, CategoryKind } from "../types";

/** "Paid back" is set by linking a reimbursement, not picked by hand. */
const LINK_ONLY = new Set(["loan_in"]);

export function categoriesForAmount(categories: Category[], amount?: number): Category[] {
  const pickable = categories.filter((c) => !LINK_ONLY.has(c.id));
  if (amount == null || amount === 0) return pickable;
  const allowed = new Set<CategoryKind>(amount > 0 ? ["income", "transfer"] : ["expense", "transfer"]);
  return pickable.filter((c) => allowed.has(c.kind));
}

export function CategorySelect({
  value,
  categories,
  amount,
  onChange,
  size = "middle",
  allowClear = false,
  placeholder = "Pick a category",
}: {
  value: string;
  categories: Category[];
  amount?: number;
  onChange: (id: string | null) => void;
  size?: "small" | "middle";
  allowClear?: boolean;
  placeholder?: string;
}) {
  const current = categories.find((c) => c.id === value);
  const visible = categoriesForAmount(categories, amount);
  const optionsFor = current && !visible.some((c) => c.id === current.id) ? [...visible, current] : visible;
  const groups = (
    [
      { label: "Expense", kind: "expense" as const },
      { label: "Income", kind: "income" as const },
      { label: "Transfer", kind: "transfer" as const },
    ] as const
  )
    .map((group) => ({
      label: group.label,
      options: optionsFor
        .filter((c) => c.kind === group.kind)
        .map((c) => ({ value: c.id, label: c.name })),
    }))
    .filter((group) => group.options.length);

  return (
    <Select
      size={size}
      showSearch
      allowClear={allowClear}
      optionFilterProp="label"
      placeholder={placeholder}
      value={value || undefined}
      onChange={(next) => onChange(next || null)}
      style={{ width: "100%" }}
      options={[{ value: "", label: placeholder }, ...groups]}
      optionRender={(opt) => {
        const cat = categories.find((c) => c.id === opt.value);
        return (
          <span className="cat-opt">
            <i className="cat-dot" style={{ background: cat?.color || "#c4beb4" }} />
            {String(opt.label)}
          </span>
        );
      }}
      labelRender={(props) => {
        const cat = categories.find((c) => c.id === props.value);
        if (!cat) return <span className="cat-opt muted">{placeholder}</span>;
        return (
          <span className="cat-opt">
            <i className="cat-dot" style={{ background: cat.color }} />
            {cat.name}
          </span>
        );
      }}
    />
  );
}
