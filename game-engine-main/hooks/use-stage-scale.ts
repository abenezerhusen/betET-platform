'use client'

import * as React from 'react'

/**
 * Locks a fixed-design game to a 1440×900 "stage" and reports the uniform
 * scale factor needed to fit that stage into the current viewport (contain).
 *
 * The games (Multi Hot 5, Fast Keno) were authored for a 1440×900 desktop
 * viewport. Without this, larger screens (e.g. 1920×1080) leave the game small
 * and surrounded by empty space, while the layout drifts between resolutions.
 * By scaling a fixed 1440×900 stage by `min(vw/1440, vh/900)` we make every
 * desktop/laptop render the exact same 1440×900 layout, just scaled uniformly.
 *
 * Writes the factor to the `--game-scale` CSS variable on <html> so the scaling
 * itself lives in CSS (`transform: scale(var(--game-scale))`). Below 768px the
 * variable is cleared so the existing mobile reflow is left fully untouched.
 */
const BASE_W = 1440
const BASE_H = 900
const MOBILE_BREAKPOINT = 768

export function useStageScale() {
  React.useEffect(() => {
    const root = document.documentElement

    const apply = () => {
      const w = window.innerWidth
      const h = window.innerHeight
      if (w < MOBILE_BREAKPOINT) {
        root.style.removeProperty('--game-scale')
        return
      }
      const scale = Math.min(w / BASE_W, h / BASE_H)
      root.style.setProperty('--game-scale', String(scale))
    }

    apply()
    window.addEventListener('resize', apply)
    window.addEventListener('orientationchange', apply)
    return () => {
      window.removeEventListener('resize', apply)
      window.removeEventListener('orientationchange', apply)
      root.style.removeProperty('--game-scale')
    }
  }, [])
}
