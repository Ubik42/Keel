import { useRef, useEffect } from 'react';

/**
 * Checkbox for one format group in the format filter panel (split out of DimensionFilterBar, P4).
 */
/** Category checkbox with native indeterminate for partial format selection. */
export function FormatGroupCheckbox({
  checked,
  indeterminate,
  disabled,
  label,
  onToggle,
}: {
  checked: boolean;
  indeterminate: boolean;
  disabled: boolean;
  label: string;
  onToggle: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);
  return (
    <label className="format-filter-group-check">
      <input
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
        ref={inputRef}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}
