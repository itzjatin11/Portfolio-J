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
- **Intro, then story.** After the core, the 3D scene fades out and stops rendering.
  - The rest of the page is told as chapters in time order: Prologue, 2023, 2025, Late 2025, On the side, 2026, Epilogue.
  - Each chapter has a year that drifts slower than the page, story lines that reveal, its projects, and a closing "Skills unlocked" row.
  - A side spine shows which chapter you're in.
  - Chapter content lives in `index.html` under the `CHAPTER nn` comments.
- **Motion** is in `src/main.js`:
  - letter-by-letter titles
  - the scroll-lit intro paragraph
  - hero type splitting apart on scroll
  - drifting outline words
  - card tilt and a pointer-following project preview
- **Theme**: the site is dark only, by design.
- If the visitor has **reduced motion** turned on, smooth scroll and animation are skipped, and the 3D hero shows a single frame.
