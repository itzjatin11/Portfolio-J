# jatindeveloper.in

Personal portfolio of Jatin Singh Taadiyal. It's a static site built with Vite, GSAP ScrollTrigger and Lenis smooth scrolling. The fonts (Fraunces, Inter Tight, JetBrains Mono) are self-hosted through Fontsource.

```bash
npm install
npm run dev      # local dev server
npm run build    # production build -> dist/
npm run preview  # serve the build
```

Deploy `dist/` to any static host (Vercel, Netlify, GitHub Pages, Cloudflare Pages).

## Editing

- **Content** is plain HTML in `index.html`: projects, about text and toolbox.
- **Email**: set `data-email="you@example.com"` on the `.contact__mail` link. The button then switches from GitHub to a `mailto:` link.
- **Motion** is in `src/main.js`:
  - `data-speed` sets vertical parallax (below 1 is slower than the scroll).
  - `data-drift` sets horizontal drift on big type.
  - `data-parallax-wrap` / `data-parallax-img` add image-style parallax inside a frame.
  - Project cards stack on desktop.
- If the visitor has **reduced motion** turned on, smooth scroll and all animation are skipped.
