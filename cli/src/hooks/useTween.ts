/** useTween —— frame 推进时把 value 朝 target 指数缓动靠近（用于折叠/滑入动画） */
import { useEffect, useRef, useState } from "react";

export function useTween(target: number, speed = 0.28): number {
  const [v, setV] = useState(target);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    timer.current = setInterval(() => {
      setV((cur) => {
        const d = target - cur;
        if (Math.abs(d) < 0.5) return target;
        return cur + d * speed;
      });
    }, 33);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [target, speed]);
  return v;
}
