# jatindeveloper.in

Personal portfolio of Jatin Singh Taadiyal. It's a static site built with Vite, GSAP ScrollTrigger and Lenis smooth scrolling. three.js renders the hero. Barlow Condensed and JetBrains Mono are self-hosted through Fontsource.

```bash
npm install
npm run dev      # local dev server
npm run build    # production build -> dist/
npm run preview  # serve the build
```

Deploy `dist/` to any static host (Vercel, Netlify, GitHub Pages, Cloudflare Pages).

## Editing

- **Content** is plain HTML in `index.html`: projects, about text and toolbox.
- **Contact form** posts to Formspree (`action` on the form in `index.html`) without leaving the page.
- **3D hero** is in `src/journey.js`: a scroll-driven fly-through from a circuit board, into the chip and down a data tunnel.
  - Its overlays (HUD, boot log, titles) are driven by one scrubbed GSAP timeline in `src/main.js`.
  - three.js is lazy-loaded.
  - The render loop pauses when the hero is off screen or the tab is hidden.
- **One continuous world.** The 3D tunnel stays fixed behind the whole page.
  - A scrim dims it behind readable sections.
  - Its speed and spin follow your scroll.
  - A fixed HUD reports the current layer and the depth: PCB → Package → Die → Core → Bus → Proc → Git → I/O.
  - The sections build on it:
    - skills are a pinned horizontal data bus
    - projects are app windows flying out of the depth
    - experience is a git log graph drawn on scroll
    - contact is a self-typing terminal
  - Pinning only applies on wide screens.
- **Motion** is in `src/main.js`:
  - letter-by-letter titles
  - the scroll-lit intro paragraph
  - hero type splitting apart on scroll
  - drifting outline words
  - card tilt and a pointer-following project preview
- **Theme**: the site is dark only, by design.
- If the visitor has **reduced motion** turned on, smooth scroll and animation are skipped, and the 3D hero shows a single frame.
