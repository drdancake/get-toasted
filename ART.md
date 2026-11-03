# ART.md: the modeling checklist

Owner: Taj. Look target: Nour-adjacent food commercial. Low poly, strong textures, saturated, glossy. Fast and cute beats high resolution. Everything runs on a phone.

## Export rules
- Blender -> GLB, Y up, 1 unit = 1 cm, origin at the base center of each object, applied transforms.
- Draco compression on export. Textures PNG, power of two, 512 default, 1024 only for the hero rav.
- One material per object where possible. PBR: base color, roughness, optional normal. Keep metallic for stainless only.
- Name meshes `rav_beef`, `rav_buffalo`, `rav_cheese`, `rav_gooey`, `basket`, `fryer`, `cup_marinara` etc. The code loads by name.
- Working files in `art/` (LFS). Exports in `assets/models/`. Never commit a GLB over 2 MB without a chat.

## Tier 1: needed for MVP-1 (first real build)
- [ ] **Ravioli base mesh**: ~2 in square pillow, slight dome, fluted/ridged border, a visible seam. 300 to 800 tris. This one mesh serves all four flavors.
  - Texture set per flavor: one base color with the crumb texture (pebbly, sandy, herb flecks). The code drives doneness with a shader, so **paint it at the "golden" state** and provide a **burn mask** (grayscale: edges and ridges darkest, center lightest) so the shader knows where to darken first.
  - Gooey: same mesh scaled ~1.15, maybe a slightly rounder dome.
  - **Pop state (cheese only)**: a morph target or second mesh with a molten white cheese blob breaking the seam.
- [ ] **Finish layer**: a sparse white speckle texture used for both parmesan and powdered sugar (code tints it), and a green fleck texture for parsley. Applied as a second layer; coverage 0..1 driven by code.
- [ ] **Fryer basket**: wire mesh, handle. The mesh pattern can be a texture with alpha, not geometry.
- [ ] **Fryer**: stainless vat, the oil surface as a flat plane (code animates bubbles). Three identical instances.
- [ ] **Sauce cups** x3: marinara (chunky red), ranch (white), lemon berry mascarpone (pale cream with a pink swirl). Same cup mesh, three textures.
- [ ] **Shakers**: parm/parsley/salt (one combined "savory" shaker is fine for MVP), powdered sugar shaker, and the **cornstarch** one that looks almost identical.
- [ ] **Paper boat / to-go box** with wax paper, the serving vessel.
- [ ] **Ticket**: a paper ticket, printed look. 2D texture on a quad is fine.
- [ ] **Matt**: 2D illustrated portrait, 3 to 4 expressions (neutral, unimpressed, delighted, dead inside). PNG with alpha. Not 3D.
- [ ] **Backdrop**: the STL Toasted kitchen as a single painted/baked backdrop plane, or a low-poly stainless counter and tile wall. One lighting setup, baked if possible.

## Tier 2: MVP-2
- [ ] Wings (raw breaded, cooked), wing basket contents
- [ ] Chicken cutlet (breaded, cooked)
- [ ] Stacked basket variant or just the same basket reused
- [ ] Steam and oil bubble sprites, smoke for burnt
- [ ] Spill/drop state

## Later
- [ ] Rotating special rav (a template texture so a new flavor is just a texture)
- [ ] Brittany portrait
- [ ] The Hill through the window, the storefront for the end screen
- [ ] The arcade cabinet bezel art

## Reference (from the research notes)
- Colors by stage: pale cream (raw) -> beige wet crumb -> amber gold at done -> deep brown and black on thin edges and bubbles when overdone.
- Crust: matte, pebbly, sandy, darker herb flecks, white parmesan dust settling into the texture.
- Bite/cross-section (not MVP): crumb / thin chewy pasta / filling. Meat filling grey-brown and crumbly; cheese molten white and stringy.
- Marinara: thick, chunky, glossy red, clings in a smear, drips at the corner.
- Plating: red plastic basket or paper boat with wax paper at bars and the stadium; white oval plate stacked 6 to 8 with a ramekin at restaurants. STL Toasted is to-go, so paper boat / box.
