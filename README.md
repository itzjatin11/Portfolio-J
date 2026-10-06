# jatindeveloper.in

Personal portfolio of Jatin Singh Taadiyal. A static site built with Vite, GSAP ScrollTrigger, Lenis and three.js. Fonts (Barlow Condensed, Barlow, JetBrains Mono, Latin subsets) are self-hosted in `public/fonts`.

```bash
npm install
npm run dev      # local dev server
npm run build    # production build -> dist/
npm run preview  # serve the build
```

Deploy `dist/` to any static host.

## The idea

A visit is a request to Jatin's machine. To answer it, his profile is read off the SSD and carried to the CPU core along the real load path, and the camera travels with the data through one persistent 3D world:

SSD (About) → PCIe bus (Skills) → DRAM (Work) → cache (Experience) → core and transistor (Contact) → back out to the board (footer).

Travel on the board is sideways between parts. Scale only changes at the CPU: the die and the FinFET live in their own places in the scene (y = −120 and y = −240), and the camera swaps to them while fog briefly fills the screen with the page background.

## Files

- `index.html`: all content. Everything is readable without JavaScript.
- `src/world.js`: the three.js world. One fixed canvas behind the page; one travel value `T` (0 hero, 1 storage, 2 PCIe, 3 DRAM, 4 cache, 5 core, 6 back on the board). Camera paths are Catmull-Rom curves re-parameterised for constant perceived speed. Frames render on demand only.
- `src/textures.js`: procedural canvas textures. Most are channel-coded (R trace, G accent, B silkscreen) so the theme recolours them on the GPU without redrawing.
- `src/gauge.js`: the persistent gauge (view width, access time, human scale, "if L1 were 1 second").
- `src/main.js`: scroll → `T` mapping, pins (desktop), mobile hops, contact form and the on-submit round trip, theme.
- `src/style.css`: layout, both themes and the scene palette (`--s-*` variables read by the world).

## Notes

- Contact form posts to Formspree (`action` on the form).
- Light theme is a "blueprint X-ray" palette; the scene tweens to it in 400 ms.
- Reduced motion, or a low-end device (no WebGL2 or ≤ 2 GB memory): no camera travel, one still frame per station with a short crossfade.
- `?debug` exposes the world on `window.__world` for inspection; `?noworld` skips the 3D scene.
