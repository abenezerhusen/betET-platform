"use client";

import { useState, useTransition } from "react";
import { optimisticUpdate, rafThrottle } from "@/lib/performance";
import { Loader2 } from "lucide-react";

interface FastButtonProps {
  onClick?: () => Promise<any>;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  optimistic?: boolean;
  disabled?: boolean;
}

export function FastButton({
  onClick,
  children,
  className = "",
  style,
  optimistic = false,
  disabled = false
}: FastButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [isOptimistic, setIsOptimistic] = useState(false);
  const [clickCount, setClickCount] = useState(0);

  // Throttled click handler using RAF for smooth animations
  const handleClick = rafThrottle(async () => {
    if (disabled || isPending) return;

    if (optimistic && onClick) {
      // Optimistic UI update
      const currentCount = clickCount;

      optimisticUpdate(
        currentCount,
        currentCount + 1,
        async () => {
          setIsOptimistic(true);
          await onClick();
          return currentCount + 1;
        },
        (newCount) => {
          setClickCount(newCount);
          setIsOptimistic(false);
        },
        (error) => {
          console.error('[FastButton] Error:', error);
          setIsOptimistic(false);
        }
      );
    } else if (onClick) {
      // Regular async handling with React 18 transitions
      startTransition(async () => {
        try {
          await onClick();
          setClickCount(prev => prev + 1);
        } catch (error) {
          console.error('[FastButton] Error:', error);
        }
      });
    }
  });

  const isLoading = isPending || isOptimistic;

  return (
    <button
      onClick={handleClick}
      disabled={disabled || isLoading}
      className={`
        relative overflow-hidden
        transition-all duration-200
        active:scale-95
        disabled:opacity-50 disabled:cursor-not-allowed
        ${isLoading ? 'pointer-events-none' : ''}
        ${className}
      `}
      style={{
        ...style,
        // Hardware acceleration for smoother animations
        transform: 'translateZ(0)',
        willChange: 'transform, opacity',
      }}
    >
      {/* Content */}
      <span className={`flex items-center justify-center gap-2 ${isLoading ? 'opacity-0' : 'opacity-100'} transition-opacity`}>
        {children}
      </span>

      {/* Loading spinner overlay */}
      {isLoading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="w-5 h-5 animate-spin" />
        </span>
      )}

      {/* Ripple effect on click */}
      <span
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(circle, rgba(255,255,255,0.3) 0%, transparent 70%)',
          opacity: 0,
          animation: isLoading ? 'none' : undefined,
        }}
      />
    </button>
  );
}

// Example usage component
export function FastButtonExample() {
  const [status, setStatus] = useState('Ready');

  const handleSlowOperation = async () => {
    setStatus('Processing...');

    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 2000));

    setStatus('Completed!');
    setTimeout(() => setStatus('Ready'), 2000);
  };

  return (
    <div className="p-6 space-y-4">
      <h3 className="text-xl font-bold">Fast Button Examples</h3>

      {/* Regular Fast Button */}
      <div className="space-y-2">
        <p className="text-sm text-gray-400">Regular with transitions:</p>
        <FastButton
          onClick={handleSlowOperation}
          className="px-6 py-3 rounded-lg font-bold text-black"
          style={{ background: "var(--mezzo-accent-green)" }}
        >
          Click Me (Regular)
        </FastButton>
      </div>

      {/* Optimistic UI Button */}
      <div className="space-y-2">
        <p className="text-sm text-gray-400">With optimistic UI:</p>
        <FastButton
          onClick={handleSlowOperation}
          optimistic={true}
          className="px-6 py-3 rounded-lg font-bold text-black"
          style={{ background: "var(--mezzo-accent-yellow)" }}
        >
          Click Me (Optimistic)
        </FastButton>
      </div>

      {/* Disabled State */}
      <div className="space-y-2">
        <p className="text-sm text-gray-400">Disabled state:</p>
        <FastButton
          disabled={true}
          className="px-6 py-3 rounded-lg font-bold text-white"
          style={{ background: "#4a4a6a" }}
        >
          Disabled Button
        </FastButton>
      </div>

      {/* Status */}
      <div className="mt-4 p-4 rounded-lg" style={{ background: "var(--mezzo-bg-secondary)" }}>
        <p className="text-sm">Status: <span className="font-bold text-[var(--mezzo-accent-green)]">{status}</span></p>
      </div>
    </div>
  );
}
