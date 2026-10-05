# jatindeveloper.in

Personal portfolio of Jatin Singh Taadiyal. It's a static site built with Vite, GSAP ScrollTrigger and Lenis smooth scrolling. Geist and Geist Mono are self-hosted through Fontsource.

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
- **Motion** is in `src/main.js`:
  - the sidebar intro and the name decode effect
  - fade-up reveals and section titles that decode as you reach them
  - architecture diagrams whose arrows animate while they're on screen
  - background grid parallax and a pointer spotlight (desktop only)
- If the visitor has **reduced motion** turned on, smooth scroll and all animation are skipped.
