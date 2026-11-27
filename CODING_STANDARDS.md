# Coding Standards

Judgement calls reviewed on changes to `triangle-lands`. Mechanical checks (TypeScript strict mode, pure terrain imports, GLSL `safePow` / tone-mapping includes, prototype isolation) are enforced automatically by `npm run check`.

## Wordless UI

- Keep production HUD, prompts, banners, and overlays **strictly wordless**: convey state through geometric glyphs, animation, camera framing, particles, and audio rather than text copy.
- Keep throwaway visual prototypes and dev-only controls gated behind `import.meta.env.DEV` dynamic imports so production builds tree-shake them out completely.

## Watercolor & Selective Bloom Shaders

- Prefer `createCelMaterial` in `src/cel.ts` for solid world geometry so new props inherit regional atmospheric fog, day/night tinting, shadows, and rim lighting consistently.
- Reserve HDR values above the bloom threshold (`> 0.98`) for intentional emissive accents (shrine crystals, orbs, sky sun/moon, glowing mushrooms); keep broad surfaces below threshold so `UnrealBloomPass` does not wash out silhouettes.
- Reuse shared `BufferGeometry` and textures across repeated world objects (such as shrines or instanced foliage) rather than allocating per-instance geometry.

## Spatial Framing & Sightlines

- `terrain.height()` line-of-sight checks do not include instanced vegetation (`createVegetation`). Whenever changing camera presets, landmark placements, summit props, or distant visual cues, visually verify rendered frames across lighting presets (`day`, `sunset`, `night`) to catch foreground tree occlusion, sky contrast issues, or bulky silhouettes on sharp distant peaks.
- Preserve progressive sightline reveal for distant landmarks (shrines, wonders): let triangular terrain slopes and regional fog hide and reveal them rather than hard proximity pop-in cutoffs, while local collectibles and challenges (spirit orbs, wind trial rings) may emerge smoothly with proximity to keep distant horizons clean. Ensure opening transitions (`introSwoop`) never prematurely trigger gameplay discoveries or reveals.
- Keep player camera control sovereign during free `play`: reserve automated FOV zoom, gaze redirection, and vignette/letterbox framing for bounded, one-time discovery beats or explicit modes (`cinematic`, `vista`, Temporal Moment dwell) that yield to manual input, rather than continuous proximity overrides.

## Throwaway Prototypes

- Isolate experimental variants in `*.prototype.ts` files, archive explored variants on a throwaway branch before folding the winner into `main`, and rewrite the winning variant to match production conventions instead of leaving switcher scaffolding on `main`.
