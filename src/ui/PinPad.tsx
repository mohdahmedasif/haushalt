import { useCallback, useEffect, useRef, useState } from "react";

const MAX = 8;
const MIN = 4;

/** On-screen digit keys plus the physical keyboard: digits, Backspace, Enter. */
export function PinPad({ disabled, onSubmit }: { disabled?: boolean; onSubmit: (pin: string) => void }) {
  // The ref is the source of truth, so digits typed faster than React re-renders are never lost.
  const pinRef = useRef("");
  const [pin, setPin] = useState("");
  const disabledRef = useRef(Boolean(disabled));
  disabledRef.current = Boolean(disabled);
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;

  const press = useCallback((key: string) => {
    if (disabledRef.current) return;
    if (key === "Enter") {
      if (pinRef.current.length < MIN) return;
      const entered = pinRef.current;
      pinRef.current = "";
      setPin("");
      submitRef.current(entered);
      return;
    }
    if (key === "Backspace") pinRef.current = pinRef.current.slice(0, -1);
    else if (/^\d$/.test(key) && pinRef.current.length < MAX) pinRef.current += key;
    setPin(pinRef.current);
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (/^\d$/.test(event.key) || event.key === "Backspace" || event.key === "Enter") {
        event.preventDefault();
        press(event.key);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);

  return (
    <div className={`pin-pad${disabled ? " disabled" : ""}`}>
      <div className="pin-dots" aria-label={`${pin.length} digits entered`}>
        {Array.from({ length: Math.max(MIN, pin.length) }, (_, i) => (
          <span key={i} className={i < pin.length ? "pin-dot filled" : "pin-dot"} />
        ))}
      </div>
      <div className="pin-keys">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <button key={digit} type="button" className="pin-key" disabled={disabled} onClick={() => press(digit)}>
            {digit}
          </button>
        ))}
        <button type="button" className="pin-key quiet" disabled={disabled} onClick={() => press("Backspace")} aria-label="Delete">
          ⌫
        </button>
        <button type="button" className="pin-key" disabled={disabled} onClick={() => press("0")}>
          0
        </button>
        <button
          type="button"
          className="pin-key go"
          disabled={disabled || pin.length < MIN}
          onClick={() => press("Enter")}
          aria-label="Unlock"
        >
          OK
        </button>
      </div>
    </div>
  );
}
